package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func archiveState(id string, finished bool, events int) string {
	game := map[string]any{"id": id, "config": map[string]any{"name": "Test match", "mode": "tournament"}, "players": []any{map[string]any{"id": "player", "name": "Test", "nick": "Test"}}, "levels": []any{map[string]any{"kind": "level", "duration": 1200}}, "index": 0, "finished": finished, "startedAt": 1000, "elapsed": 12000, "events": make([]any, events)}
	for i := 0; i < events; i++ {
		game["events"].([]any)[i] = map[string]any{"type": "addon", "at": i, "amount": 500}
	}
	state := map[string]any{"version": 1, "config": map[string]any{"name": "Test match"}, "seats": []any{}, "library": []any{}, "step": "board", "game": game}
	data, _ := json.Marshal(state)
	return string(data)
}
func putArchiveState(t *testing.T, s *store, state string) {
	t.Helper()
	body := fmt.Sprintf(`{"revision":%d,"state":%s}`, s.data.Revision, state)
	if r := request(handler(s), "PUT", "/api/state", body, ""); r.Code != 200 {
		t.Fatalf("save: %d %s", r.Code, r.Body.String())
	}
}
func TestArchiveFinishUndoAndNewGame(t *testing.T) {
	s := testStore(t)
	h := handler(s)
	putArchiveState(t, s, archiveState("match-one", false, 5))
	if _, err := os.Stat(s.archivePath("match-one")); !os.IsNotExist(err) {
		t.Fatal("active match archived prematurely")
	}
	putArchiveState(t, s, archiveState("match-one", true, 450))
	detail := request(h, "GET", "/api/archives/match-one", "", "")
	if detail.Code != http.StatusOK {
		t.Fatal(detail.Code)
	}
	var saved struct {
		Game struct {
			Events []any `json:"events"`
		} `json:"game"`
		Finished bool `json:"finished"`
	}
	if err := json.Unmarshal(detail.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if !saved.Finished || len(saved.Game.Events) != 450 {
		t.Fatal("archive lost result or events")
	}
	putArchiveState(t, s, archiveState("match-one", false, 449))
	detail = request(h, "GET", "/api/archives/match-one", "", "")
	_ = json.Unmarshal(detail.Body.Bytes(), &saved)
	if saved.Finished || len(saved.Game.Events) != 449 {
		t.Fatal("undo left stale archived result")
	}
	putArchiveState(t, s, archiveState("match-two", false, 2))
	list := request(h, "GET", "/api/archives", "", "")
	var index struct {
		Games []archiveSummary `json:"games"`
	}
	_ = json.Unmarshal(list.Body.Bytes(), &index)
	if len(index.Games) != 1 || index.Games[0].ID != "match-one" {
		t.Fatal("archive duplicated or lost a match")
	}
	before := string(s.data.State)
	revision := s.data.Revision
	request(h, "GET", "/api/archives/match-one", "", "")
	if string(s.data.State) != before || s.data.Revision != revision {
		t.Fatal("archive view changed current match")
	}
	putArchiveState(t, s, validState)
	if _, err := os.Stat(s.archivePath("match-two")); err != nil {
		t.Fatal("new game lost unfinished match", err)
	}
	loaded, err := openStore(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if request(handler(loaded), "GET", "/api/archives/match-one", "", "").Code != 200 {
		t.Fatal("restart lost archive")
	}
	if info, err := os.Stat(s.archivePath("match-one")); err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("archive permissions")
	}
}
func TestArchiveRejectsStaleWriteAndUnsafeIDs(t *testing.T) {
	s := testStore(t)
	putArchiveState(t, s, archiveState("match-one", true, 1))
	before, err := os.ReadFile(s.archivePath("match-one"))
	if err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"revision":0,"state":%s}`, archiveState("match-one", true, 99))
	if request(handler(s), "PUT", "/api/state", body, "").Code != 409 {
		t.Fatal("stale state accepted")
	}
	after, _ := os.ReadFile(s.archivePath("match-one"))
	if string(before) != string(after) {
		t.Fatal("stale writer changed archive")
	}
	if request(handler(s), "GET", "/api/archives/%2e%2e", "", "").Code != 400 {
		t.Fatal("unsafe archive ID accepted")
	}
	if request(handler(s), "GET", "/api/archives/unknown", "", "").Code != 404 {
		t.Fatal("missing archive not reported")
	}
}
func TestArchiveFailureKeepsCurrentGame(t *testing.T) {
	s := testStore(t)
	putArchiveState(t, s, archiveState("match-one", false, 1))
	if err := os.WriteFile(filepath.Join(filepath.Dir(s.path), "archives"), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	before := s.data
	body := fmt.Sprintf(`{"revision":%d,"state":%s}`, s.data.Revision, validState)
	if request(handler(s), "PUT", "/api/state", body, "").Code != 500 {
		t.Fatal("archive failure was ignored")
	}
	if s.data.Revision != before.Revision || string(s.data.State) != string(before.State) {
		t.Fatal("current game discarded")
	}
}
func TestLongHistoryFitsNewPersistenceLimit(t *testing.T) {
	s := testStore(t)
	state := strings.TrimSuffix(archiveState("long-game", true, 500), "}") + `,"testPadding":"` + strings.Repeat("x", 2<<20) + `"}`
	putArchiveState(t, s, state)
	if request(handler(s), "GET", "/api/archives/long-game", "", "").Code != 200 {
		t.Fatal("large state not archived")
	}
}

func TestLegacyGameReceivesIDWithoutDuplicatingArchive(t *testing.T) {
	s := testStore(t)
	legacy := strings.Replace(archiveState("old", false, 1), `"id":"old",`, "", 1)
	putArchiveState(t, s, legacy)
	putArchiveState(t, s, archiveState("assigned-id", true, 2))
	r := request(handler(s), "GET", "/api/archives", "", "")
	var list struct {
		Games []archiveSummary `json:"games"`
	}
	_ = json.Unmarshal(r.Body.Bytes(), &list)
	if len(list.Games) != 1 || list.Games[0].ID != "assigned-id" {
		t.Fatalf("migration created duplicates: %s", r.Body.String())
	}
}
