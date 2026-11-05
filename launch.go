package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"
)

func browserURL(address net.Addr) string {
	host, port, _ := net.SplitHostPort(address.String())
	switch host {
	case "0.0.0.0":
		host = "127.0.0.1"
	case "::":
		host = "::1"
	}
	return "http://" + net.JoinHostPort(host, port) + "/"
}

func openBrowser(url string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url)
	case "darwin":
		command = exec.Command("open", url)
	case "linux":
		command = exec.Command("xdg-open", url)
	default:
		return fmt.Errorf("automatic browser opening is unavailable on %s", runtime.GOOS)
	}
	return command.Run()
}

func runServer(ctx context.Context, address string, handler http.Handler, opener func(string) error) error {
	// Bind before opening the browser, so a failed launch never opens another app on the port.
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	defer listener.Close()
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	url := browserURL(listener.Addr())
	log.Printf("Until Morning: %s", url)
	if opener != nil {
		go func() {
			if err := opener(url); err != nil {
				log.Printf("Could not open the browser: %v. Open %s manually.", err, url)
			}
		}()
	}
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
