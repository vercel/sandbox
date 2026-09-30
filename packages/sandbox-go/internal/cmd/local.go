package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/spf13/cobra"
)

func (a *app) newLogin() *cobra.Command {
	return &cobra.Command{Use: "login", Short: "Log in to the Sandbox CLI", Args: cobra.NoArgs, RunE: func(command *cobra.Command, _ []string) error { return a.runVercel(command, "login") }}
}
func (a *app) newLogout() *cobra.Command {
	return &cobra.Command{Use: "logout", Short: "Log out of the Sandbox CLI", Args: cobra.NoArgs, RunE: func(command *cobra.Command, _ []string) error { return a.runVercel(command, "logout") }}
}
func (a *app) runVercel(command *cobra.Command, subcommand string) error {
	binary, err := exec.LookPath("vercel")
	if err != nil {
		return fmt.Errorf("Vercel CLI is required for %s; install it and run `vercel %s`", subcommand, subcommand)
	}
	process := exec.CommandContext(command.Context(), binary, subcommand)
	process.Stdin = a.stdin
	process.Stdout = a.stdout
	process.Stderr = a.stderr
	return process.Run()
}

func (a *app) newTelemetry() *cobra.Command {
	root := &cobra.Command{Use: "telemetry", Short: "Manage telemetry collection status"}
	root.AddCommand(a.telemetryStatus(), a.telemetrySet("enable", true), a.telemetrySet("disable", false))
	return root
}
func (a *app) telemetryStatus() *cobra.Command {
	return &cobra.Command{Use: "status", Short: "Show whether telemetry is enabled", Args: cobra.NoArgs, RunE: func(_ *cobra.Command, _ []string) error {
		enabled, err := readTelemetry()
		if err != nil {
			return err
		}
		fmt.Fprintf(a.stdout, "Telemetry collection is %s.\n", map[bool]string{true: "enabled", false: "disabled"}[enabled])
		return nil
	}}
}
func (a *app) telemetrySet(name string, enabled bool) *cobra.Command {
	return &cobra.Command{Use: name, Short: name + " telemetry collection", Args: cobra.NoArgs, RunE: func(_ *cobra.Command, _ []string) error {
		if err := writeTelemetry(enabled); err != nil {
			return err
		}
		fmt.Fprintf(a.stdout, "Telemetry collection %sd.\n", name)
		return nil
	}}
}
func telemetryConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "com.vercel.cli", "config.json"), nil
	case "windows":
		return filepath.Join(os.Getenv("APPDATA"), "com.vercel.cli", "config.json"), nil
	default:
		return filepath.Join(home, ".local", "share", "com.vercel.cli", "config.json"), nil
	}
}
func readTelemetry() (bool, error) {
	path, err := telemetryConfigPath()
	if err != nil {
		return false, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	var value map[string]any
	if json.Unmarshal(data, &value) != nil {
		return false, err
	}
	telemetry, _ := value["telemetry"].(map[string]any)
	enabled, ok := telemetry["enabled"].(bool)
	if !ok {
		return true, nil
	}
	return enabled, nil
}
func writeTelemetry(enabled bool) error {
	path, err := telemetryConfigPath()
	if err != nil {
		return err
	}
	value := map[string]any{}
	if data, readErr := os.ReadFile(path); readErr == nil {
		_ = json.Unmarshal(data, &value)
	}
	value["telemetry"] = map[string]bool{"enabled": enabled}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}
