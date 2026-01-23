package ws

import (
	"io"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/vercel/sandbox/pty-tunnel-server/term"
)

// Writer is a WebSocket-based implementation of term.TermTarget.
type Writer struct {
	Conn *websocket.Conn
}

// Close implements io.WriteCloser.
func (w *Writer) Close() error {
	return w.Conn.Close()
}

// ReadBinary implements term.TermTarget.
func (w *Writer) ReadBinary() ([]byte, error) {
	_, msg, err := w.Conn.ReadMessage()
	if err != nil && strings.HasSuffix(err.Error(), ": use of closed network connection") {
		return msg, io.EOF
	}
	return msg, err
}

// Write implements io.Writer.
func (w *Writer) Write(p []byte) (n int, err error) {
	err = w.Conn.WriteMessage(websocket.BinaryMessage, p)
	if err != nil {
		return 0, err
	}
	return len(p), nil
}

var _ io.WriteCloser = (*Writer)(nil)
var _ term.TermTarget = (*Writer)(nil)
