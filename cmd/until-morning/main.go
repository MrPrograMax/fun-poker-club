package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"runtime"
	"syscall"

	"github.com/MrPrograMax/fun-poker-club/internal/appdata"
	"github.com/MrPrograMax/fun-poker-club/internal/server"
)

func main() {
	autoOpen := flag.Bool("open-browser", true, "Open the app in the default browser after startup")
	dataDir := flag.String("data-dir", os.Getenv("DATA_DIR"), "Game storage directory (default: user application data)")
	flag.Parse()
	if err := run(*autoOpen, *dataDir); err != nil {
		log.Print(err)
		if runtime.GOOS == "windows" && *autoOpen {
			fmt.Fprintln(os.Stderr, "Could not start Until Morning. Press Enter to close.")
			fmt.Scanln()
		}
		os.Exit(1)
	}
}

func run(autoOpen bool, dataDir string) error {
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:8080"
	}
	dir, err := appdata.Resolve(dataDir)
	if err != nil {
		return err
	}
	log.Printf("Saved games: %s", dir)
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	return server.Run(stop, server.Config{
		ListenAddr:  address,
		DataDir:     dir,
		OpenBrowser: autoOpen,
	})
}
