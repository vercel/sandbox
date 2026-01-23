package ws

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

type WebSocketServer struct {
	Port   int
	Token  string
	Server *http.Server
	logger *slog.Logger
	bus    *Bus
}

// findAvailablePort finds an available port in the given range
func findAvailablePort(start, end int) (int, error) {
	for port := start; port <= end; port++ {
		ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
		if err == nil {
			ln.Close()
			return port, nil
		}
	}
	return 0, fmt.Errorf("no available ports in range %d-%d", start, end)
}

// generateToken creates a random base64 token
func generateToken() string {
	bytes := make([]byte, 32)
	rand.Read(bytes)
	return base64.URLEncoding.EncodeToString(bytes)
}

// NewWebSocketServer creates a new WebSocket server
func NewWebSocketServer(logger *slog.Logger, token string, port int) (*WebSocketServer, error) {
	var err error
	if port == 0 {
		// Find available port
		port, err = findAvailablePort(8000, 9000)
		if err != nil {
			return nil, fmt.Errorf("finding available port: %v", err)
		}
	}

	// Generate token
	if token == "" {
		token = generateToken()
	}

	// Create message bus
	messageBus := NewBus(token, logger)

	// Create HTTP server
	mux := http.NewServeMux()
	mux.HandleFunc("/ws/{type}", messageBus.HandleWebSocketConnection)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", port),
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	return &WebSocketServer{
		Port:   port,
		Token:  token,
		Server: server,
		bus:    messageBus,
		logger: logger,
	}, nil
}
