package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
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
func (s *store) write(next snapshot) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	b, err := json.Marshal(next)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(s.path), ".state-*")
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
	if err := os.Rename(f.Name(), s.path); err != nil {
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
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
		decoder.DisallowUnknownFields()
		var next snapshot
		if err := decoder.Decode(&next); err != nil {
			respond(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body (maximum 1 MiB)"})
			return
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			respond(w, http.StatusBadRequest, map[string]string{"error": "Expected one JSON object"})
			return
		}
		var state struct {
			Version int             `json:"version"`
			Config  json.RawMessage `json:"config"`
			Seats   json.RawMessage `json:"seats"`
			Library json.RawMessage `json:"library"`
			Step    string          `json:"step"`
		}
		if json.Unmarshal(next.State, &state) != nil || state.Version != 1 || len(state.Config) == 0 || len(state.Seats) == 0 || len(state.Library) == 0 || (state.Step != "settings" && state.Step != "seating" && state.Step != "board") {
			respond(w, http.StatusBadRequest, map[string]string{"error": "Invalid game state"})
			return
		}
		if next.Revision != s.data.Revision {
			respond(w, http.StatusConflict, map[string]any{"error": "State changed in another client", "revision": s.data.Revision})
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
	server := &http.Server{Addr: address, Handler: handler(s), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	go func() {
		<-stop.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	log.Printf("RIVER: http://%s", strings.TrimPrefix(address, "http://"))
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
