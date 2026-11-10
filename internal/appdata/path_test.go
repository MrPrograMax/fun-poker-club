package appdata

import (
	"os"
	"path/filepath"
	"testing"
)

func TestUserDirectoryDoesNotDependOnBinaryOrWorkingDirectory(t *testing.T) {
	home := t.TempDir()
	custom := filepath.Join(home, "custom")
	for _, tc := range []struct {
		os, variable, value, want string
	}{
		{"darwin", "", "", filepath.Join(home, "Library", "Application Support", "Until Morning")},
		{"windows", "LOCALAPPDATA", custom, filepath.Join(custom, "Until Morning")},
		{"windows", "", "", filepath.Join(home, "AppData", "Local", "Until Morning")},
		{"linux", "XDG_DATA_HOME", custom, filepath.Join(custom, "until-morning")},
		{"linux", "XDG_DATA_HOME", "relative", filepath.Join(home, ".local", "share", "until-morning")},
		{"linux", "", "", filepath.Join(home, ".local", "share", "until-morning")},
	} {
		t.Run(tc.os+tc.value, func(t *testing.T) {
			getenv := func(key string) string {
				if key == tc.variable {
					return tc.value
				}
				return ""
			}
			if got := userDir(tc.os, home, getenv); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestExplicitPortableDirectory(t *testing.T) {
	want, err := filepath.Abs("data")
	if err != nil {
		t.Fatal(err)
	}
	got, err := Resolve("data")
	if err != nil || got != want {
		t.Fatalf("got %q, %v; want %q", got, err, want)
	}
}

func TestLegacyDirectoryBesideAppOrBinary(t *testing.T) {
	root := t.TempDir()
	for _, executable := range []string{
		filepath.Join(root, "until-morning.exe"),
		filepath.Join(root, "Until Morning.app", "Contents", "MacOS", "until-morning-server"),
	} {
		if got := legacyDir(executable); got != filepath.Join(root, "data") {
			t.Fatal(got)
		}
	}
}

func TestMigrationPreservesStateAndArchivesAndNeverOverwrites(t *testing.T) {
	root := t.TempDir()
	source, destination := filepath.Join(root, "download", "data"), filepath.Join(root, "user", "Until Morning")
	files := map[string]string{"state.json": `{"revision":42,"state":{"game":null}}`, "archives/old-game.json": `{"game":{"finished":true}}`}
	for name, body := range files {
		path := filepath.Join(source, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := migrate(source, destination); err != nil {
		t.Fatal(err)
	}
	for name, body := range files {
		for _, dir := range []string{source, destination} {
			data, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil || string(data) != body {
				t.Fatalf("%s changed: %s, %v", dir, data, err)
			}
		}
	}
	if err := os.WriteFile(filepath.Join(destination, "state.json"), []byte("newer game"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := migrate(source, destination); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(destination, "state.json"))
	if err != nil || string(data) != "newer game" {
		t.Fatal("overwrote an existing game")
	}
}

func TestMissingLegacyDataDoesNotCreateEmptySave(t *testing.T) {
	root := t.TempDir()
	destination := filepath.Join(root, "user-data")
	if err := migrate(filepath.Join(root, "missing"), destination); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatal("created a directory without legacy data")
	}
}

func TestFailedMigrationDoesNotPublishPartialData(t *testing.T) {
	root := t.TempDir()
	source, destination := filepath.Join(root, "data"), filepath.Join(root, "user-data")
	if err := os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "state.json"), []byte("saved game"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(source, "state.json"), filepath.Join(source, "linked.json")); err != nil {
		t.Skip(err)
	}
	if err := migrate(source, destination); err == nil {
		t.Fatal("accepted a linked data file")
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatal("published an incomplete import")
	}
	data, err := os.ReadFile(filepath.Join(source, "state.json"))
	if err != nil || string(data) != "saved game" {
		t.Fatal("changed original data")
	}
	leftovers, _ := filepath.Glob(filepath.Join(root, ".until-morning-import-*"))
	if len(leftovers) != 0 {
		t.Fatal("left partial staging directories", leftovers)
	}
}
