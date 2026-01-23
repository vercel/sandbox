package glue

import (
	"fmt"
	"os"
	"sync"

	"github.com/creack/pty"
	"github.com/vercel/sandbox/pty-tunnel-server/protocol"
)

type MessageHandler struct {
	ptyFile *os.File

	readyOnce sync.Once
	ready     chan struct{}
}

func NewMessageHandler(ptyFile *os.File) *MessageHandler {
	return &MessageHandler{
		ptyFile: ptyFile,
		ready:   make(chan struct{}),
	}
}

// WaitReady waits until a "ready" message is received from the client.
func (h *MessageHandler) WaitReady() {
	<-h.ready
}

func (h *MessageHandler) HandleBytes(msg []byte) error {
	parsed, err := protocol.Parse(msg)
	if err != nil {
		return fmt.Errorf("parsing message: %v", err)
	}
	switch parsed.Type {
	case protocol.MessageTypeReady:
		h.readyOnce.Do(func() {
			close(h.ready)
		})
	case protocol.MessageTypeResize:
		resize, err := parsed.Resize()
		if err != nil {
			return fmt.Errorf("parsing resize message (%x): %v", msg, err)
		}
		err = pty.Setsize(h.ptyFile, &pty.Winsize{Rows: uint16(resize.Rows), Cols: uint16(resize.Cols)})
		if err != nil {
			return fmt.Errorf("setting PTY size to %dx%d: %v", resize.Cols, resize.Rows, err)
		}
	case protocol.MessageTypeMessage:
		text, err := parsed.Text()
		if err != nil {
			return fmt.Errorf("parsing text message (%x): %v", msg, err)
		}

		_, err = h.ptyFile.Write(text.Data)
		if err != nil {
			return fmt.Errorf("writing data to PTY: %v", err)
		}
	default:
		return fmt.Errorf("unknown message type: %v", parsed.Type)
	}

	return nil
}
