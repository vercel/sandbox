package modes

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/gorilla/websocket"
	"github.com/vercel/sandbox/pty-tunnel-server/term"
	"github.com/vercel/sandbox/pty-tunnel-server/ws"
)

// ClientMode represents the client mode of the PTY tunnel server.
// It gets or creates a server using a Bootstrapper and creates a pty that
// will be tunneled to the server over a WebSocket connection.
type ClientMode struct {
	Logger             *slog.Logger
	ProcessID          int
	InactivityDeadline time.Duration

	Rows        int
	Columns     int
	CommandArgs []string

	Bootstrapper Bootstrapper
}

func (c *ClientMode) Run() error {
	if c.ProcessID == 0 {
		c.ProcessID = os.Getpid()
	}

	info, err := c.Bootstrapper.GetOrCreateServer()
	if err != nil {
		return fmt.Errorf("cannot create server: %v", err)
	}

	connectionPayload, err := json.Marshal(map[string]any{
		"port":            info.Port,
		"token":           info.Token,
		"processId":       c.ProcessID,
		"serverProcessId": info.PID,
	})
	if err != nil {
		return fmt.Errorf("cannot marshal server info: %v", err)
	}

	fmt.Println(string(connectionPayload))

	term, err := term.NewTerm(c.Logger, c.Rows, c.Columns, c.CommandArgs)
	if err != nil {
		return fmt.Errorf("spawning pty: %v", err)
	}

	url := fmt.Sprintf("ws://localhost:%d/ws/process?token=%s&processId=%d", info.Port, info.Token, c.ProcessID)
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		return fmt.Errorf("connecting upstream (%s): %v", url, err)
	}
	defer conn.Close()

	target := &ws.Writer{Conn: conn}

	onReady := make(chan struct{})
	defer close(onReady)
	term.WithOnReady(func() {
		onReady <- struct{}{}
	})

	subprocess := make(chan error)
	defer close(subprocess)
	go func() {
		subprocess <- term.Run(target)
	}()

	select {
	case <-time.After(c.InactivityDeadline):
		return fmt.Errorf("inactivity timeout waiting for remote connection: over %s passed without a remote connection", c.InactivityDeadline)
	case err := <-subprocess:
		return err
	case <-onReady:
	}

	return <-subprocess
}
