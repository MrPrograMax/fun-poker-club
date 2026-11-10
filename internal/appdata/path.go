// Package appdata selects persistent storage for desktop and portable launches.
package appdata

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
)

// Resolve keeps explicit paths portable. Direct launches use the user's data
// directory and copy a legacy sibling data directory only on the first launch.
func Resolve(explicit string) (string, error) {
	if explicit != "" {
		return filepath.Abs(explicit)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := userDir(runtime.GOOS, home, os.Getenv)
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	if err := migrate(legacyDir(executable), dir); err != nil {
		return "", fmt.Errorf("copy previous games to %s (original data is unchanged): %w", dir, err)
	}
	return dir, nil
}

func legacyDir(executable string) string {
	folder := filepath.Dir(executable)
	contents := filepath.Dir(folder)
	bundle := filepath.Dir(contents)
	if filepath.Base(folder) == "MacOS" && filepath.Base(contents) == "Contents" && filepath.Ext(bundle) == ".app" {
		folder = filepath.Dir(bundle)
	}
	return filepath.Join(folder, "data")
}

func userDir(goos, home string, getenv func(string) string) string {
	switch goos {
	case "windows":
		base := getenv("LOCALAPPDATA")
		if !filepath.IsAbs(base) {
			base = filepath.Join(home, "AppData", "Local")
		}
		return filepath.Join(base, "Until Morning")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Until Morning")
	default:
		base := getenv("XDG_DATA_HOME")
		if !filepath.IsAbs(base) {
			base = filepath.Join(home, ".local", "share")
		}
		return filepath.Join(base, "until-morning")
	}
}

func migrate(source, destination string) error {
	if _, err := os.Lstat(destination); err == nil {
		return nil // Never replace existing games, including an explicitly created empty directory.
	} else if !os.IsNotExist(err) {
		return err
	}
	if _, err := os.Stat(filepath.Join(source, "state.json")); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("legacy data must be a directory, not a symbolic link")
	}
	parent := filepath.Dir(destination)
	if err := os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	temporary, err := os.MkdirTemp(parent, ".until-morning-import-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	err = filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(filepath.Join(temporary, relative), 0700)
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("unsupported legacy data file: %s", relative)
		}
		return copyFile(path, filepath.Join(temporary, relative))
	})
	if err != nil {
		return err
	}
	// Commit the whole copy together, so a failed import cannot look like a fresh game.
	return os.Rename(temporary, destination)
}

func copyFile(source, destination string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if err == nil {
		err = out.Sync()
	}
	closeErr := out.Close()
	if err != nil {
		return err
	}
	return closeErr
}
