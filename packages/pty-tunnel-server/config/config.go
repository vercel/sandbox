package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"syscall"
)

type ServerInfo struct {
	PID     int    `json:"pid"`
	Port    int    `json:"port"`
	Token   string `json:"token"`
	Created int64  `json:"created"`
}

func readServerConfig(path string) (ServerInfo, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ServerInfo{}, fmt.Errorf("reading config file: %v", err)
	}

	var serverInfo ServerInfo
	if err := json.Unmarshal(data, &serverInfo); err != nil {
		return ServerInfo{}, fmt.Errorf("parsing config file: %v", err)
	}

	return serverInfo, nil
}

// WriteServerConfig writes the server configuration to the config file atomically
func WriteServerConfig(serverInfo ServerInfo, configPath string) error {
	configDir := path.Dir(configPath)
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("creating config directory: %v", err)
	}

	data, err := json.Marshal(serverInfo)
	if err != nil {
		return fmt.Errorf("marshaling config: %v", err)
	}

	return os.WriteFile(configPath, data, 0644)
}

// isProcessRunning checks if the given PID is running
func isProcessRunning(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}

	// Send signal 0 to check if process exists
	err = process.Signal(syscall.Signal(0))
	return err == nil
}

// VerifyConnection verifies if the server process is running based on the config file
// and returns the server info if it is running
func VerifyConnection(configPath string) (info ServerInfo, err error) {
	info, err = readServerConfig(configPath)
	if err != nil {
		return
	}

	if !isProcessRunning(info.PID) {
		return info, fmt.Errorf("no process with PID %d", info.PID)
	}

	return
}
