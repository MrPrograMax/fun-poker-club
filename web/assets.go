// Package web embeds the frontend so release binaries need no external assets.
package web

import (
	"embed"
	"io/fs"
)

//go:embed static/*
var files embed.FS

// Assets returns the frontend with paths relative to the web root.
func Assets() fs.FS {
	// The directory is guaranteed by the embed pattern at build time.
	assets, _ := fs.Sub(files, "static")
	return assets
}
