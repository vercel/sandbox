package modes

import (
	"log/slog"
	"net"

	"github.com/vercel/sandbox/pty-tunnel-server/ws"
)

type MultiplexerMode struct {
	Logger *slog.Logger
	Token  string
	Port   int

	OnReady func(port int, token string) error
}

func (m *MultiplexerMode) Run() error {
	server, err := ws.NewWebSocketServer(m.Logger, m.Token, m.Port)
	if err != nil {
		return err
	}
	m.Token = server.Token
	m.Port = server.Port

	listener, err := net.Listen("tcp", server.Server.Addr)
	if err != nil {
		return err
	}

	if m.OnReady != nil {
		if err := m.OnReady(server.Port, server.Token); err != nil {
			return err
		}
	}

	return server.Server.Serve(listener)
}
