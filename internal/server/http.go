package server

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"

	"github.com/MrPrograMax/fun-poker-club/web"
)

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
		rollbackArchive, err := s.archiveTransition(next.State)
		if err != nil {
			log.Printf("archive game: %v", err)
			respond(w, http.StatusInternalServerError, map[string]string{"error": "Could not archive game; current game was kept"})
			return
		}
		next.Revision++
		if err := s.write(next); err != nil {
			log.Printf("save state: %v", errors.Join(err, rollbackArchive()))
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
	files := http.FileServer(http.FS(web.Assets()))
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
