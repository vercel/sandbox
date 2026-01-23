package modes_test

import (
	"fmt"
	"log/slog"
	"os"
	"path"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/vercel/sandbox/pty-tunnel-server/modes"
)

func TestExternalProcessBootstrapper(t *testing.T) {
	getTempFile := func() string {
		tmpdir := os.TempDir()
		path := fmt.Sprintf("%s/config-%d-%d.json", tmpdir, os.Getpid(), time.Now().UnixNano())
		return path
	}

	t.Run("GetOrCreateServer: Happy Path", func(t *testing.T) {
		configPath := getTempFile()
		wd, err := os.Getwd()
		require.NoError(t, err)
		wd = path.Dir(wd)
		fmt.Println("wd: " + wd)
		bootstrapper := modes.ExternalProcessBootstrapper{
			TestExecutable: []string{"go", "run", wd},

			ConfigPath: configPath,
			Debug:      true,
			Token:      "123",
			Logger: slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
				Level: slog.LevelDebug,
			})),
		}
		serverInfo, err := bootstrapper.GetOrCreateServer()

		t.Cleanup(func() {
			// kill serverInfo.PID if exists
			process, err := os.FindProcess(serverInfo.PID)
			if err != nil {
				return
			}
			err = process.Kill()
			if err != nil {
				fmt.Printf("Failed to kill process %d: %v\n", serverInfo.PID, err)
			} else {
				fmt.Println("Killed process", serverInfo.PID)
			}
		})

		require.NoError(t, err)
		require.Equal(t, serverInfo.Token, "123")

		// Process exists
		_, err = os.FindProcess(serverInfo.PID)
		require.NoError(t, err)
	})
}
