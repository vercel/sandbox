package modes

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path"
	"syscall"
	"time"

	"github.com/vercel/sandbox/pty-tunnel-server/config"
)

// ExternalProcessBootstrapper is a Bootstrapper that spawns a new process for the server.
// This is the default behavior for production use.
type ExternalProcessBootstrapper struct {
	ConfigPath string
	Logger     *slog.Logger
	Debug      bool
	Token      string
	Port       int

	// TestExecutable is only used for testing purposes to override the
	// executable path.
	TestExecutable []string
}

var _ Bootstrapper = (*ExternalProcessBootstrapper)(nil)

// GetOrCreateServer implements Bootstrapper.
func (e *ExternalProcessBootstrapper) GetOrCreateServer() (info config.ServerInfo, err error) {
	info, err = config.VerifyConnection(e.ConfigPath)
	if err != nil {
		return e.spawnServer()
	}
	return
}

func (e *ExternalProcessBootstrapper) spawnServer() (info config.ServerInfo, err error) {
	var cmd *exec.Cmd
	var currentExe string
	if len(e.TestExecutable) > 0 {
		cmd = exec.Command(e.TestExecutable[0], e.TestExecutable[1:]...)
	} else {
		currentExe, err = os.Executable()
		if err != nil {
			return
		}
		cmd = exec.Command(currentExe)
	}

	cmd.Args = append(cmd.Args, "--mode=server", fmt.Sprintf("--config=%s", e.ConfigPath))
	if e.Debug {
		cmd.Args = append(cmd.Args, "--debug")
	}
	if e.Token != "" {
		cmd.Args = append(cmd.Args, "--token="+e.Token)
	}
	if e.Port != 0 {
		cmd.Args = append(cmd.Args, fmt.Sprintf("--port=%d", e.Port))
	}

	basename := path.Join(os.TempDir(), fmt.Sprintf("pty-tunnel-server-%d", time.Now().Nanosecond()))
	e.Logger.Debug("Creating temporary files for server stdout/stderr", "basename", basename)

	e.Logger.Info("Spawning new pty-tunnel-server process", "args", cmd.Args)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true, // new process group
	}
	err = cmd.Start()
	if err != nil {
		return
	}
	info.PID = cmd.Process.Pid
	info.Created = time.Now().Unix()
	err = cmd.Process.Release()
	if err != nil {
		err = fmt.Errorf("releasing process: %v", err)
		return
	}

	if info, err = e.pollServerConfiguration(info); err != nil {
		return
	}
	if err = e.pollServerReadiness(info.Port); err != nil {
		return
	}

	e.Logger.Info("Server spawned successfully", "port", info.Port, "serverPid", info.PID)

	return
}

func (e *ExternalProcessBootstrapper) pollServerConfiguration(info config.ServerInfo) (config.ServerInfo, error) {
	deadline := time.Now().Add(5 * time.Second)
	interval := 100 * time.Millisecond

	var lastErr error
	for {
		if deadline.Before(time.Now()) {
			err := fmt.Errorf("timed out waiting for server to start: %v", lastErr)
			return info, err
		}

		info, lastErr = config.VerifyConnection(e.ConfigPath)
		if lastErr != nil {
			time.Sleep(interval)
			continue
		}
		break
	}

	return info, nil
}

// pollServerReadiness Wait until the server is ready to accept connections, or times out.
func (e *ExternalProcessBootstrapper) pollServerReadiness(port int) error {
	ctx := context.Background()
	timeout := 10 * time.Second
	ctx, cancel := context.WithDeadline(ctx, time.Now().Add(timeout))
	defer cancel()

	url := fmt.Sprintf("http://localhost:%d/health", port)

	for {
		if ctx.Err() != nil {
			return fmt.Errorf("server not ready within %s", timeout)
		}
		r, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return err
		}

		res, err := http.DefaultClient.Do(r)
		if err != nil {
			e.Logger.Debug("Waiting for server to be ready...", "error", err)
		} else if res.StatusCode == http.StatusOK {
			return nil
		}

		time.Sleep(50 * time.Millisecond)
	}
}
