package server

import (
	"bytes"
	"encoding/json"
)

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
