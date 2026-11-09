package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

const validState = `{"version":1,"config":{"name":"Test"},"seats":[],"library":[],"step":"settings"}`

func testStore(t *testing.T) *store {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "data", "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func request(h http.Handler, method, path, body, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestPersistenceAndStaleWrite(t *testing.T) {
	s := testStore(t)
	h := handler(s)
	body := fmt.Sprintf(`{"revision":0,"state":%s}`, validState)
	w := request(h, "PUT", "/api/state", body, "")
	if w.Code != 200 {
		t.Fatalf("save: %d %s", w.Code, w.Body.String())
	}
	restored, err := openStore(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if restored.data.Revision != 1 || string(restored.data.State) != validState {
		t.Fatalf("unexpected saved state: %+v", restored.data)
	}
	if got := request(h, "PUT", "/api/state", body, "").Code; got != 409 {
		t.Fatalf("stale write returned %d", got)
	}
	w = request(h, "GET", "/api/state", "", "")
	var got snapshot
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Revision != 1 {
		t.Fatal("stale write changed revision")
	}
	info, err := os.Stat(s.path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("state file must be private")
	}
}

func TestConcurrentWritesHaveOneWinner(t *testing.T) {
	s := testStore(t)
	h := handler(s)
	body := fmt.Sprintf(`{"revision":0,"state":%s}`, validState)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- request(h, "PUT", "/api/state", body, "").Code }()
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("unexpected results: %v", counts)
	}
}

func TestInvalidRequestsDoNotWrite(t *testing.T) {
	cases := []struct {
		name, method, body, origin string
		status                     int
	}{
		{"malformed", "PUT", "{", "", 400},
		{"missing state", "PUT", `{"revision":0}`, "", 400},
		{"wrong version", "PUT", `{"revision":0,"state":{"version":2}}`, "", 400},
		{"trailing JSON", "PUT", fmt.Sprintf(`{"revision":0,"state":%s} {}`, validState), "", 400},
		{"cross origin", "PUT", fmt.Sprintf(`{"revision":0,"state":%s}`, validState), "https://evil.example", 403},
		{"method", "POST", "", "", 405},
		{"too large", "PUT", `{"revision":0,"state":"` + strings.Repeat("a", maxStateBytes) + `"}`, "", 400},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			s := testStore(t)
			w := request(handler(s), tt.method, "/api/state", tt.body, tt.origin)
			if w.Code != tt.status {
				t.Fatalf("got %d, want %d", w.Code, tt.status)
			}
			if s.data.Revision != 0 {
				t.Fatal("invalid request mutated state")
			}
		})
	}
}

func TestStaticAssetsAndHealth(t *testing.T) {
	h := handler(testStore(t))
	for _, path := range []string{"/", "/app.js", "/engine.js", "/styles.css", "/api/health"} {
		t.Run(path, func(t *testing.T) {
			w := request(h, "GET", path, "", "")
			if w.Code != 200 {
				t.Fatalf("got %d", w.Code)
			}
			if w.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal("missing security header")
			}
		})
	}
	if got := request(h, "GET", "/api/missing", "", "").Code; got != 404 {
		t.Fatalf("got %d", got)
	}
}

func TestCorruptedStoreIsNotSilentlyOverwritten(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(path, []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := openStore(path); err == nil {
		t.Fatal("expected corruption error")
	}
}

func TestMalformedStateContainersAreRejected(t *testing.T) {
	for _, field := range []string{"config", "seats", "library", "game"} {
		for _, value := range []string{"null", "false", "17", `"broken"`, "[]", "{}"} {
			if (field == "game" && value == "null") || (field == "config" && value == "{}") || ((field == "seats" || field == "library") && value == "[]") {
				continue
			}
			t.Run(field+"_"+value, func(t *testing.T) {
				s := testStore(t)
				var state map[string]json.RawMessage
				if err := json.Unmarshal([]byte(validState), &state); err != nil {
					t.Fatal(err)
				}
				state[field] = json.RawMessage(value)
				raw, err := json.Marshal(map[string]any{"revision": 0, "state": state})
				if err != nil {
					t.Fatal(err)
				}
				if got := request(handler(s), "PUT", "/api/state", string(raw), "").Code; got != 400 {
					t.Fatalf("invalid %s accepted: %d", field, got)
				}
				if s.data.Revision != 0 {
					t.Fatal("invalid request changed persisted revision")
				}
			})
		}
	}
}
