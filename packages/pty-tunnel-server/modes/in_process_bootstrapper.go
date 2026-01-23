package modes

import (
	"log/slog"
	"os"

	"github.com/vercel/sandbox/pty-tunnel-server/config"
)

// InProcessBootstrapper is a Bootstrapper that runs the server in process.
// Used primarily for testing.
type InProcessBootstrapper struct {
	Token  string
	Logger *slog.Logger
	Port   int
}

var _ Bootstrapper = (*InProcessBootstrapper)(nil)

// GetOrCreateServer implements Bootstrapper and runs it in process.
func (b *InProcessBootstrapper) GetOrCreateServer() (info config.ServerInfo, err error) {
	infoChan := make(chan config.ServerInfo)
	multiplexer := &MultiplexerMode{
		Token:  b.Token,
		Logger: b.Logger,
		Port:   b.Port,
		OnReady: func(port int, token string) error {
			infoChan <- config.ServerInfo{Port: port, Token: token, PID: os.Getpid()}
			close(infoChan)
			return nil
		},
	}
	go multiplexer.Run()
	info = <-infoChan
	return info, nil
}
