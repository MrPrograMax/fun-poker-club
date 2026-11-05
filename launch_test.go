package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestBrowserCanReachNewServer(t *testing.T) {
	for _, tc := range []struct {
		name, address string
		browserError  error
	}{
		{"loopback", "127.0.0.1:0", nil},
		{"all interfaces", "0.0.0.0:0", nil},
		{"browser unavailable", "127.0.0.1:0", errors.New("no default browser")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			type opening struct {
				url string
				err error
			}
			opened := make(chan opening, 1)
			done := make(chan error, 1)
			h := handler(testStore(t))
			client := &http.Client{Timeout: 2 * time.Second}
			go func() {
				done <- runServer(ctx, tc.address, h, func(url string) error {
					response, err := client.Get(url + "api/health")
					if err == nil {
						response.Body.Close()
						if response.StatusCode != http.StatusOK {
							err = errors.New("server is not ready")
						}
					}
					opened <- opening{url, err}
					return tc.browserError
				})
			}()
			select {
			case result := <-opened:
				if result.err != nil {
					t.Fatal(result.err)
				}
				// A missing default browser must leave the app available for manual access.
				response, err := client.Get(result.url)
				if err != nil {
					t.Fatal(err)
				}
				response.Body.Close()
				if response.StatusCode != http.StatusOK {
					t.Fatalf("app returned %d", response.StatusCode)
				}
			case err := <-done:
				t.Fatalf("server stopped before opening the browser: %v", err)
			case <-time.After(5 * time.Second):
				t.Fatal("browser was not opened")
			}
			cancel()
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("server did not shut down")
			}
		})
	}
}

func TestOccupiedPortDoesNotOpenBrowser(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	err = runServer(context.Background(), listener.Addr().String(), handler(testStore(t)), func(string) error {
		t.Error("browser must not open when the app cannot start")
		return nil
	})
	if err == nil {
		t.Fatal("expected an occupied-port error")
	}
}
