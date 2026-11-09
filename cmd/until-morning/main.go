package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/MrPrograMax/fun-poker-club/internal/server"
)

func main() {
	autoOpen := flag.Bool("open-browser", false, "Open the app in the default browser after startup")
	flag.Parse()
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:8080"
	}
	dir := os.Getenv("DATA_DIR")
	if dir == "" {
		dir = "data"
	}
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := server.Run(stop, server.Config{
		ListenAddr:  address,
		DataDir:     dir,
		OpenBrowser: *autoOpen,
	}); err != nil {
		log.Fatal(err)
	}
}
