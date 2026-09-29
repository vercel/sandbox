package cmd

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

type copyPath struct {
	remote        bool
	sandbox, path string
}

func parseCopyPath(value string) (copyPath, error) {
	if strings.Count(value, ":") == 0 {
		return copyPath{path: value}, nil
	}
	sandbox, item, ok := strings.Cut(value, ":")
	if !ok || sandbox == "" || item == "" {
		return copyPath{}, fmt.Errorf("invalid copy path %q; expected SANDBOX:PATH", value)
	}
	return copyPath{remote: true, sandbox: sandbox, path: item}, nil
}

func (a *app) newCopy() *cobra.Command {
	return &cobra.Command{
		Use:     "copy SRC DST",
		Aliases: []string{"cp"},
		Short:   "Copy a file between the local filesystem and a sandbox",
		Args:    cobra.ExactArgs(2),
		RunE: func(command *cobra.Command, args []string) error {
			source, err := parseCopyPath(args[0])
			if err != nil {
				return err
			}
			destination, err := parseCopyPath(args[1])
			if err != nil {
				return err
			}
			if source.remote == destination.remote {
				return fmt.Errorf("exactly one copy path must be remote")
			}
			client, err := a.client(command.Context())
			if err != nil {
				return err
			}
			if source.remote {
				sandbox, err := client.Get(command.Context(), source.sandbox, true)
				if err != nil {
					return err
				}
				reader, found, err := client.ReadFile(command.Context(), sandbox.Session.ID, source.path)
				if err != nil {
					return err
				}
				if !found {
					return fmt.Errorf("file not found: %s in sandbox %s", source.path, source.sandbox)
				}
				defer reader.Close()
				file, err := os.Create(destination.path)
				if err != nil {
					return err
				}
				if _, err := io.Copy(file, reader); err != nil {
					file.Close()
					return err
				}
				if err := file.Close(); err != nil {
					return err
				}
			} else {
				file, err := os.Open(source.path)
				if err != nil {
					return err
				}
				defer file.Close()
				sandbox, err := client.Get(command.Context(), destination.sandbox, true)
				if err != nil {
					return err
				}
				if err := client.WriteFile(command.Context(), sandbox.Session.ID, destination.path, file); err != nil {
					return err
				}
			}
			fmt.Fprintf(a.stderr, "Copied %s to %s successfully.\n", args[0], args[1])
			return nil
		},
	}
}
