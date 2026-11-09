package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"
)

const maxStateBytes = 8 << 20

var archiveID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)

type archiveSummary struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Mode        string  `json:"mode"`
	Finished    bool    `json:"finished"`
	StartedAt   int64   `json:"startedAt"`
	FinishedAt  *int64  `json:"finishedAt"`
	Elapsed     float64 `json:"elapsed"`
	PlayerCount int     `json:"playerCount"`
	SavedAt     string  `json:"savedAt"`
}
type archivedGame struct {
	archiveSummary
	Game json.RawMessage `json:"game"`
}

func gameFromState(raw json.RawMessage) json.RawMessage {
	var state struct {
		Game json.RawMessage `json:"game"`
	}
	_ = json.Unmarshal(raw, &state)
	if bytes.Equal(bytes.TrimSpace(state.Game), []byte("null")) {
		return nil
	}
	return state.Game
}
func describeArchive(raw json.RawMessage) (archivedGame, error) {
	if !validGameJSON(raw) {
		return archivedGame{}, errors.New("invalid game")
	}
	var g struct {
		ID     string `json:"id"`
		Config struct {
			Name string `json:"name"`
			Mode string `json:"mode"`
		} `json:"config"`
		Players    []json.RawMessage `json:"players"`
		Finished   bool              `json:"finished"`
		StartedAt  int64             `json:"startedAt"`
		FinishedAt *int64            `json:"finishedAt"`
		Elapsed    float64           `json:"elapsed"`
	}
	if err := json.Unmarshal(raw, &g); err != nil {
		return archivedGame{}, err
	}
	if g.ID == "" {
		hash := sha256.Sum256(raw)
		g.ID = "legacy-" + hex.EncodeToString(hash[:12])
	}
	if !archiveID.MatchString(g.ID) {
		return archivedGame{}, errors.New("invalid game ID")
	}
	return archivedGame{archiveSummary: archiveSummary{ID: g.ID, Name: g.Config.Name, Mode: g.Config.Mode, Finished: g.Finished, StartedAt: g.StartedAt, FinishedAt: g.FinishedAt, Elapsed: g.Elapsed, PlayerCount: len(g.Players), SavedAt: time.Now().UTC().Format(time.RFC3339Nano)}, Game: raw}, nil
}
func (s *store) archivePath(id string) string {
	return filepath.Join(filepath.Dir(s.path), "archives", id+".json")
}
func (s *store) saveArchive(raw json.RawMessage) error {
	entry, err := describeArchive(raw)
	if err != nil {
		return err
	}
	path := s.archivePath(entry.ID)
	if previous, err := os.ReadFile(path); err == nil {
		var old archivedGame
		if json.Unmarshal(previous, &old) == nil && bytes.Equal(old.Game, entry.Game) {
			return nil
		}
	}
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	return writeAtomic(path, data)
}
func (s *store) archiveTransition(next json.RawMessage) error {
	previousGame, nextGame := gameFromState(s.data.State), gameFromState(next)
	if len(previousGame) > 0 {
		previous, err := describeArchive(previousGame)
		if err == nil {
			var identity struct {
				ID string `json:"id"`
			}
			_ = json.Unmarshal(previousGame, &identity)
			nextEntry, nextErr := describeArchive(nextGame)
			// Loading a pre-archive save assigns its first ID without creating a second match.
			if nextErr != nil || (identity.ID != "" && previous.ID != nextEntry.ID) {
				if err := s.saveArchive(previousGame); err != nil {
					return err
				}
			}
		}
	}
	if len(nextGame) > 0 {
		entry, err := describeArchive(nextGame)
		if err != nil {
			return err
		}
		_, statErr := os.Stat(s.archivePath(entry.ID))
		// Undo or reentry updates the same match instead of leaving stale winnings in its archive.
		if entry.Finished || statErr == nil {
			return s.saveArchive(nextGame)
		}
	}
	return nil
}
func (s *store) archives(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method != http.MethodGet {
		respond(w, 405, map[string]string{"error": "Method not allowed"})
		return
	}
	if id := r.PathValue("id"); id != "" {
		if !archiveID.MatchString(id) {
			respond(w, 400, map[string]string{"error": "Invalid archive ID"})
			return
		}
		data, err := os.ReadFile(s.archivePath(id))
		if errors.Is(err, os.ErrNotExist) {
			respond(w, 404, map[string]string{"error": "Game not found"})
			return
		}
		if err != nil || !json.Valid(data) {
			respond(w, 500, map[string]string{"error": "Could not read archived game"})
			return
		}
		respond(w, 200, json.RawMessage(data))
		return
	}
	files, err := os.ReadDir(filepath.Dir(s.archivePath("index")))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		respond(w, 500, map[string]string{"error": "Could not read archives"})
		return
	}
	entries := []archiveSummary{}
	for _, file := range files {
		if file.IsDir() || filepath.Ext(file.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(filepath.Dir(s.archivePath("index")), file.Name()))
		if err != nil {
			continue
		}
		var entry archivedGame
		if json.Unmarshal(data, &entry) == nil && archiveID.MatchString(entry.ID) {
			entries = append(entries, entry.archiveSummary)
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].SavedAt > entries[j].SavedAt })
	respond(w, 200, map[string]any{"games": entries})
}
