package term

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"time"

	"github.com/creack/pty"
	"github.com/vercel/sandbox/pty-tunnel-server/buffering"
	"github.com/vercel/sandbox/pty-tunnel-server/glue"
)

type TermTarget interface {
	io.Writer
	ReadBinary() ([]byte, error)
}

type Term struct {
	Rows    int
	Columns int
	Command string
	Args    []string
	Logger  *slog.Logger

	onReady func()
}

func (s *Term) WithOnReady(onReady func()) {
	s.onReady = onReady
}

func NewTerm(logger *slog.Logger, rows, columns int, commandAndArgs []string) (*Term, error) {
	if len(commandAndArgs) < 1 {
		return nil, fmt.Errorf("no command specified")
	}

	return &Term{
		Rows:    rows,
		Columns: columns,
		Command: commandAndArgs[0],
		Args:    commandAndArgs[1:],
		Logger:  logger,
	}, nil
}

func (s *Term) Run(conn TermTarget) error {
	// Create PTY for command
	cmd := exec.Command(s.Command, s.Args...)
	cmd.Env = os.Environ()

	ptyFile, err := pty.StartWithSize(cmd, &pty.Winsize{
		Rows: uint16(s.Rows),
		Cols: uint16(s.Columns),
	})
	if err != nil {
		return fmt.Errorf("spawning pty: %v", err)
	}
	defer ptyFile.Close()

	target := &buffering.ManualBufferedWriter{
		Buffer: []byte{},
		Inner:  conn,
		Logger: s.Logger,
	}

	messageHandler := glue.NewMessageHandler(ptyFile)

	go func() {
		messageHandler.WaitReady()
		if s.onReady != nil {
			s.onReady()
		}
		n, err := target.Ready()
		if err != nil {
			s.Logger.Error("Error flushing buffered writer", "error", err)
			return
		}
		s.Logger.Debug("Flushed buffered writer", "bytesWritten", n)
	}()

	go func() {
		for {
			msg, err := conn.ReadBinary()
			if err == io.EOF {
				break
			} else if err != nil {
				s.Logger.Error("Error reading message", "error", err)
				return
			}

			s.Logger.Debug("received bytes")
			err = messageHandler.HandleBytes(msg)
			if err != nil {
				s.Logger.Error("Error handling message", "error", err)
				return
			}
		}
	}()

	io.Copy(target, ptyFile)
	s.Logger.Debug("PTY connection closed")

	// If we never got a ready message, wait here to flush the buffer.
	// This is because if a customer runs a non-interactive command (like `ls` or `env`),
	// it'll exit before receiving a ready message.
	messageHandler.WaitReady()
	if _, err := target.Ready(); err != nil {
		s.Logger.Error("Error flushing final buffer", "error", err)
	}

	// Give time for the message to be processed by the Bus before closing
	if time.Since(target.MarkedReadyAt) < 100*time.Millisecond {
		time.Sleep(100 * time.Millisecond)
	}

	return nil
}
