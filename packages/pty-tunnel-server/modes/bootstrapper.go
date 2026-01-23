package modes

import "github.com/vercel/sandbox/pty-tunnel-server/config"

// Bootstrapper is an interface for getting or creating a pty-tunnel server.
// so we can define whether to run in out of process.
type Bootstrapper interface {
	GetOrCreateServer() (serverInfo config.ServerInfo, err error)
}
