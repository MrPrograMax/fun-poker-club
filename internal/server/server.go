// Package server serves the local poker app and persists its games.
package server

import (
	"context"
	"fmt"
	"path/filepath"
)

// Config holds startup settings supplied by the command.
type Config struct {
	ListenAddr  string
	DataDir     string
	OpenBrowser bool
}

// Run opens storage and serves the app until ctx is cancelled.
func Run(ctx context.Context, config Config) error {
	s, err := openStore(filepath.Join(config.DataDir, "state.json"))
	if err != nil {
		return fmt.Errorf("open storage: %w", err)
	}
	var opener func(string) error
	if config.OpenBrowser {
		opener = openBrowser
	}
	return runServer(ctx, config.ListenAddr, handler(s), opener)
}
