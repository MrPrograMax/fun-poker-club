package server

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

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

// Persist before publishing the new revision to readers.
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
