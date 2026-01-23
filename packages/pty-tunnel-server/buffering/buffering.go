package buffering

import (
	"io"
	"log/slog"
	"time"
)

// ManualBufferedWriter is an io.Writer that buffers writes to an internal buffer
// until Ready is called
type ManualBufferedWriter struct {
	Inner         io.Writer
	Buffer        []byte
	Logger        *slog.Logger
	MarkedReadyAt time.Time
}

// Write implements io.Writer.
func (c *ManualBufferedWriter) Write(p []byte) (n int, err error) {
	if c.Buffer != nil {
		c.Buffer = append(c.Buffer, p...)
		c.Logger.Debug("Buffering write", "length", len(p), "bufferedLength", len(c.Buffer))
		return len(p), nil
	}

	return c.Inner.Write(p)
}

func (c *ManualBufferedWriter) Ready() (n int, err error) {
	if c.MarkedReadyAt.IsZero() {
		c.MarkedReadyAt = time.Now()
	}

	buffer := c.Buffer
	if buffer == nil {
		return 0, nil
	}
	c.Buffer = nil
	return c.Inner.Write(buffer)
}
