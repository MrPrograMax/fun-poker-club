package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
)

//go:embed dist/*
var web embed.FS

type snapshot struct {
	Revision uint64          `json:"revision"`
	State    json.RawMessage `json:"state"`
}

type store struct {
	mu   sync.Mutex
	path string
	data snapshot
}

func openStore(path string) (*store, error) {
	s := &store{path: path, data: snapshot{State: json.RawMessage("null")}}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &s.data); err != nil {
		return nil, err
	}
	return s, nil
}

// Persist before publishing the new revision to readers.
func writeAtomic(path string, b []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".state-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
func (s *store) write(next snapshot) error {
	b, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if err := writeAtomic(s.path, b); err != nil {
		return err
	}
	s.data = next
	return nil
}

func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func objectJSON(raw json.RawMessage) bool {
	var value map[string]json.RawMessage
	return json.Unmarshal(raw, &value) == nil && value != nil
}

func objectArrayJSON(raw json.RawMessage) bool {
	var values []json.RawMessage
	if json.Unmarshal(raw, &values) != nil || values == nil {
		return false
	}
	for _, value := range values {
		if !objectJSON(value) {
			return false
		}
	}
	return true
}

func validGameJSON(raw json.RawMessage) bool {
	var game struct {
		Config  json.RawMessage   `json:"config"`
		Players json.RawMessage   `json:"players"`
		Levels  []json.RawMessage `json:"levels"`
		Index   *int              `json:"index"`
	}
	if json.Unmarshal(raw, &game) != nil || !objectJSON(game.Config) || !objectArrayJSON(game.Players) || game.Index == nil || *game.Index < 0 || *game.Index >= len(game.Levels) {
		return false
	}
	for _, level := range game.Levels {
		if !objectJSON(level) {
			return false
		}
	}
	return true
}

func validStateJSON(raw json.RawMessage) bool {
	var state struct {
		Version int             `json:"version"`
		Config  json.RawMessage `json:"config"`
		Seats   json.RawMessage `json:"seats"`
		Library json.RawMessage `json:"library"`
		Game    json.RawMessage `json:"game"`
		Step    string          `json:"step"`
	}
	if json.Unmarshal(raw, &state) != nil || state.Version != 1 || !objectJSON(state.Config) || !objectArrayJSON(state.Seats) || !objectArrayJSON(state.Library) || (state.Step != "settings" && state.Step != "seating" && state.Step != "board") {
		return false
	}
	// Setup drafts may omit the game; an existing game needs its actual containers.
	return len(state.Game) == 0 || bytes.Equal(bytes.TrimSpace(state.Game), []byte("null")) || validGameJSON(state.Game)
}

func (s *store) api(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch r.Method {
	case http.MethodGet:
		respond(w, http.StatusOK, s.data)
	case http.MethodPut:
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Host != r.Host || (u.Scheme != "http" && u.Scheme != "https") {
				respond(w, http.StatusForbidden, map[string]string{"error": "Cross-origin writes are forbidden"})
				return
			}
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			respond(w, http.StatusForbidden, map[string]string{"error": "Cross-site writes are forbidden"})
			return
		}
		mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mediaType != "application/json" {
			respond(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Expected application/json"})
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxStateBytes))
		decoder.DisallowUnknownFields()
		var next snapshot
		if err := decoder.Decode(&next); err != nil {
			respond(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body (maximum 8 MiB)"})
			return
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			respond(w, http.StatusBadRequest, map[string]string{"error": "Expected one JSON object"})
			return
		}
		if !validStateJSON(next.State) {
			respond(w, http.StatusBadRequest, map[string]string{"error": "Invalid game state"})
			return
		}
		if next.Revision != s.data.Revision {
			respond(w, http.StatusConflict, map[string]any{"error": "State changed in another client", "revision": s.data.Revision})
			return
		}
		if err := s.archiveTransition(next.State); err != nil {
			log.Printf("archive game: %v", err)
			respond(w, http.StatusInternalServerError, map[string]string{"error": "Could not archive game; current game was kept"})
			return
		}
		next.Revision++
		if err := s.write(next); err != nil {
			log.Printf("save state: %v", err)
			respond(w, http.StatusInternalServerError, map[string]string{"error": "Could not save game"})
			return
		}
		respond(w, http.StatusOK, map[string]uint64{"revision": next.Revision})
	default:
		w.Header().Set("Allow", "GET, PUT")
		respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
	}
}

func handler(s *store) http.Handler {
	assets, _ := fs.Sub(web, "dist")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/state", s.api)
	mux.HandleFunc("GET /api/archives", s.archives)
	mux.HandleFunc("GET /api/archives/{id}", s.archives)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusOK, map[string]string{"status": "ok", "service": "river-poker", "storage": "file"})
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusNotFound, map[string]string{"error": "Not found"})
	})
	files := http.FileServer(http.FS(assets))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		files.ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		mux.ServeHTTP(w, r)
	})
}

func main() {
	autoOpen := flag.Bool("open-browser", false, "Open the app in the default browser after startup")
	flag.Parse()
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:8080"
	}
	dir := os.Getenv("DATA_DIR")
	if dir == "" {
		dir = "data"
	}
	s, err := openStore(filepath.Join(dir, "state.json"))
	if err != nil {
		log.Fatalf("open storage: %v", err)
	}
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	var opener func(string) error
	if *autoOpen {
		opener = openBrowser
	}
	if err := runServer(stop, address, handler(s), opener); err != nil {
		log.Fatal(err)
	}
}
