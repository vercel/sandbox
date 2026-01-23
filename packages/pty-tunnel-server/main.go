package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/vercel/sandbox/pty-tunnel-server/config"
	"github.com/vercel/sandbox/pty-tunnel-server/modes"

	_ "embed"
)

func main() {
	var help = flag.Bool("help", false, "Show help")
	var token = flag.String("token", "", "Authentication token for single mode")
	var version = flag.Bool("version", false, "Show version")
	var debug = flag.Bool("debug", false, "Enable debug logging")
	var mode = flag.String("mode", "single", "Mode to run: single, server, or client")
	var port = flag.Int("port", 0, "Port for server mode (0 for random)")
	var rawInactivityDeadline = flag.String("inactivity-deadline", "60s", "Inactivity deadline duration (e.g., 30s, 1m)")

	var columns = flag.Int("cols", 80, "Number of columns for PTY")
	var rows = flag.Int("rows", 24, "Number of rows for PTY")
	var configPath = flag.String("config", "/tmp/vercel/interactive/config.json", "Path to server config file")

	flag.Parse()

	inactivityDeadline, err := time.ParseDuration(*rawInactivityDeadline)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Invalid inactivity-deadline: %v\n", err)
		return
	}

	logLevel := new(slog.LevelVar)
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: logLevel,
	})).With("mode", *mode)

	if *debug {
		logLevel.Set(slog.LevelDebug)
		logger.Debug("Debug logging enabled")
	}

	if *version {
		version := getPackageVersion()
		fmt.Printf("pty-tunnel-server %s\n", version)
		return
	}

	if *help {
		printUsage()
		return
	}

	switch *mode {
	case "single":
		singleMode := &modes.ClientMode{
			Logger: logger,
			Bootstrapper: &modes.InProcessBootstrapper{
				Logger: logger,
				Token:  *token,
				Port:   *port,
			},
			Columns:            *columns,
			Rows:               *rows,
			CommandArgs:        flag.Args(),
			InactivityDeadline: inactivityDeadline,
		}
		err = singleMode.Run()
	case "server":
		server := &modes.MultiplexerMode{
			Logger: logger,
			Token:  *token,
			Port:   *port,
			OnReady: func(port int, token string) error {
				_, err := fmt.Printf("port=%d token=%s\n", port, token)
				if err != nil {
					return err
				}
				return config.WriteServerConfig(config.ServerInfo{
					PID:     os.Getpid(),
					Token:   token,
					Port:    port,
					Created: time.Now().Unix(),
				}, *configPath)
			},
		}
		err = server.Run()
	case "client":
		client := &modes.ClientMode{
			Logger: logger,
			Bootstrapper: &modes.ExternalProcessBootstrapper{
				Logger:     logger,
				Token:      *token,
				Port:       *port,
				ConfigPath: *configPath,
				Debug:      *debug,
			},
			Columns:            *columns,
			Rows:               *rows,
			CommandArgs:        flag.Args(),
			InactivityDeadline: inactivityDeadline,
		}
		err = client.Run()
	default:
		printUsage()
		os.Exit(1)
		return
	}

	if err != nil {
		logger.Error(err.Error())
		os.Exit(1)
		return
	}
}

func printUsage() {
	fmt.Printf(`PTY Tunnel Server - WebSocket Edition

USAGE:
    pty-tunnel-server [OPTIONS] [command args...]

OPTIONS:
    --mode <mode>               Mode to run: single, server, or client (default: single)
    --token <token>             Authentication token for single mode
    --port <port>               Port for server mode (0 for random, default: 0)
    --cols <columns>            Number of columns for PTY (default: 80)
    --rows <rows>               Number of rows for PTY (default: 24)
    --config <path>             Path to server config file (default: /tmp/vercel/interactive/config.json)
    --debug                     Enable debug logging
    --help                      Show this help message
    --version                   Show version information

MODES:
    single                      Run single-use mode with in-process server (default)
    server                      Run multiplexer server (daemon) mode
    client                      Run client mode connecting to existing server

EXAMPLES:
    # Run command in single mode (default)
    pty-tunnel-server --token abc123 bash

    # Start multiplexer server
    pty-tunnel-server --mode server --token abc123 --port 8080

    # Connect as client to existing server
    pty-tunnel-server --mode client --token abc123 --port 8080 bash

    # Run with custom PTY size
    pty-tunnel-server --cols 120 --rows 40 --token abc123 python3

ARCHITECTURE:
    The WebSocket-based PTY tunnel uses a three-actor model:
    
    1. CLI Client (Actor 3) - Connects from user's local machine via WSS
    2. WebSocket Server (Actor 1) - Message routing hub inside sandbox  
    3. Sandbox Process (Actor 2) - PTY runner connecting via local WS
    
    Messages route: CLI Client <-> WebSocket Server <-> Sandbox Process
`)
}
