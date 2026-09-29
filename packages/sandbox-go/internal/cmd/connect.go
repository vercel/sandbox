package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/spf13/cobra"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/api"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/model"
	"golang.org/x/term"
)

const defaultShell = "shell=\"${SHELL:-sh}\"\ncase \"${shell##*/}\" in\n  bash) exec \"$shell\" --norc -i ;;\n  *) exec \"$shell\" -i ;;\nesac"

type connectOptions struct {
	cwd             string
	env             []string
	sudo            bool
	noExtendTimeout bool
}

func (a *app) newConnect() *cobra.Command {
	var options connectOptions
	command := &cobra.Command{
		Use:     "connect SANDBOX",
		Aliases: []string{"ssh", "shell"},
		Short:   "Start an interactive shell in an existing sandbox",
		Args:    cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, args []string) error {
			client, err := a.client(command.Context())
			if err != nil {
				return err
			}
			sandbox, err := client.Get(command.Context(), args[0], true)
			if err != nil {
				return err
			}
			return a.connect(command.Context(), client, sandbox, options)
		},
	}
	command.Flags().StringVarP(&options.cwd, "workdir", "w", "", "Working directory")
	command.Flags().StringSliceVarP(&options.env, "env", "e", nil, "Environment variable KEY=VALUE")
	command.Flags().BoolVar(&options.sudo, "sudo", false, "Run shell with extended privileges")
	command.Flags().BoolVar(&options.noExtendTimeout, "no-extend-timeout", false, "Do not extend the sandbox timeout")
	return command
}

func (a *app) connect(ctx context.Context, client *api.Client, sandbox model.SandboxResponse, options connectOptions) error {
	input, inputOK := a.stdin.(*os.File)
	outputFile, outputOK := a.stdout.(*os.File)
	if !inputOK || !outputOK || !term.IsTerminal(int(input.Fd())) || !term.IsTerminal(int(outputFile.Fd())) {
		return fmt.Errorf("connect requires an interactive terminal")
	}
	env, err := parsePairs(options.env)
	if err != nil {
		return err
	}
	interactive, err := client.OpenInteractive(ctx, sandbox.Session.ID)
	if err != nil {
		return err
	}
	endpoint, err := url.Parse(interactive.URL)
	if err != nil {
		return err
	}
	query := endpoint.Query()
	query.Set("token", interactive.Token)
	endpoint.RawQuery = query.Encode()
	connection, _, err := websocket.DefaultDialer.DialContext(ctx, endpoint.String(), nil)
	if err != nil {
		return err
	}
	defer connection.Close()

	cols, rows, _ := term.GetSize(int(outputFile.Fd()))
	command := "sh"
	args := []string{"-ic", defaultShell}
	if options.sudo {
		command = "sudo"
		args = append([]string{"sh"}, args...)
	}
	envList := []string{"TERM=xterm-256color", "PS1=▲ $PWD/ "}
	for key, value := range env {
		envList = append(envList, key+"="+value)
	}
	cwd := options.cwd
	if cwd == "" {
		cwd = sandbox.Session.CWD
	}
	if err := connection.WriteJSON(map[string]any{"type": "start", "command": command, "args": args, "env": envList, "cwd": cwd, "cols": cols, "rows": rows}); err != nil {
		return err
	}

	oldState, err := term.MakeRaw(int(input.Fd()))
	if err != nil {
		return err
	}
	defer term.Restore(int(input.Fd()), oldState)
	if !options.noExtendTimeout {
		go extendPeriodically(ctx, client, sandbox.Session.ID)
	}

	done := make(chan error, 2)
	go func() {
		buffer := make([]byte, 32*1024)
		for {
			n, err := input.Read(buffer)
			if err != nil {
				done <- err
				return
			}
			if err := connection.WriteMessage(websocket.BinaryMessage, buffer[:n]); err != nil {
				done <- err
				return
			}
		}
	}()
	go func() {
		for {
			messageType, data, err := connection.ReadMessage()
			if err != nil {
				done <- err
				return
			}
			if messageType == websocket.BinaryMessage {
				_, _ = a.stdout.Write(data)
				continue
			}
			var message struct {
				Type string `json:"type"`
				Code *int   `json:"code"`
			}
			if json.Unmarshal(data, &message) == nil && message.Type == "exit" {
				if message.Code != nil && *message.Code != 0 {
					done <- remoteExitError{*message.Code}
				} else {
					done <- nil
				}
				return
			}
			_, _ = a.stdout.Write(data)
		}
	}()
	resize := make(chan os.Signal, 1)
	signal.Notify(resize, syscall.SIGWINCH)
	defer signal.Stop(resize)
	for {
		select {
		case err := <-done:
			if err == io.EOF || websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return nil
			}
			return err
		case <-resize:
			cols, rows, _ := term.GetSize(int(outputFile.Fd()))
			_ = connection.WriteJSON(map[string]any{"type": "resize", "cols": cols, "rows": rows})
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func extendPeriodically(ctx context.Context, client *api.Client, sessionID string) {
	ticker := time.NewTicker(4 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			_ = client.ExtendTimeout(ctx, sessionID, 5*time.Minute)
		case <-ctx.Done():
			return
		}
	}
}
