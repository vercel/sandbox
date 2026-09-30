package model

import (
	"encoding/json"
	"fmt"
)

type Sandbox struct {
	Name                     string            `json:"name"`
	Persistent               bool              `json:"persistent"`
	Region                   string            `json:"region"`
	VCPUs                    float64           `json:"vcpus"`
	Memory                   float64           `json:"memory"`
	Runtime                  string            `json:"runtime"`
	Image                    string            `json:"image"`
	Timeout                  int64             `json:"timeout"`
	CreatedAt                int64             `json:"createdAt"`
	ExpiresAt                int64             `json:"expiresAt"`
	CurrentSessionID         string            `json:"currentSessionId"`
	CurrentSnapshotID        string            `json:"currentSnapshotId"`
	Status                   string            `json:"status"`
	Tags                     map[string]string `json:"tags"`
	TotalActiveCPUDurationMs int64             `json:"totalActiveCpuDurationMs"`
	TotalIngressBytes        int64             `json:"totalIngressBytes"`
	TotalEgressBytes         int64             `json:"totalEgressBytes"`
}

type Session struct {
	ID                  string          `json:"id"`
	CWD                 string          `json:"cwd"`
	InteractivePort     int             `json:"interactivePort"`
	Status              string          `json:"status"`
	CreatedAt           int64           `json:"createdAt"`
	Region              string          `json:"region"`
	Memory              float64         `json:"memory"`
	VCPUs               float64         `json:"vcpus"`
	Runtime             string          `json:"runtime"`
	Timeout             int64           `json:"timeout"`
	Duration            int64           `json:"duration"`
	SourceSnapshotID    string          `json:"sourceSnapshotId"`
	ActiveCPUDurationMs int64           `json:"activeCpuDurationMs"`
	NetworkTransfer     NetworkTransfer `json:"networkTransfer"`
}

type NetworkTransfer struct {
	Ingress int64 `json:"ingress"`
	Egress  int64 `json:"egress"`
}

type Snapshot struct {
	ID              string   `json:"id"`
	SnapshotID      string   `json:"snapshotId"`
	SourceSessionID string   `json:"sourceSessionId"`
	Region          string   `json:"region"`
	Regions         []string `json:"regions"`
	Status          string   `json:"status"`
	SizeBytes       int64    `json:"sizeBytes"`
	ExpiresAt       int64    `json:"expiresAt"`
	CreatedAt       int64    `json:"createdAt"`
	ParentID        string   `json:"parentId"`
}

type Drive struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	ProjectID          string `json:"projectId"`
	Region             string `json:"region"`
	MaxSizeBytes       int64  `json:"maxSizeBytes"`
	MaxSize            int64  `json:"maxSize"`
	CurrentSessionID   string `json:"currentSessionId"`
	CurrentSandboxName string `json:"currentSandboxName"`
	CreatedAt          int64  `json:"createdAt"`
	UpdatedAt          int64  `json:"updatedAt"`
}

type SandboxResponse struct {
	Sandbox Sandbox `json:"sandbox"`
	Session Session `json:"session"`
	Resumed bool    `json:"resumed"`
}

type Pagination struct {
	Count int     `json:"count"`
	Next  *string `json:"next"`
}

type ListResponse struct {
	Sandboxes  []Sandbox  `json:"sandboxes"`
	Pagination Pagination `json:"pagination"`
}

type Command struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Args       []string `json:"args"`
	SessionID  string   `json:"sessionId"`
	ExitCode   *int     `json:"exitCode"`
	DurationMs int64    `json:"durationMs"`
}

type CommandEvent struct {
	Command *Command        `json:"command,omitempty"`
	Stream  string          `json:"stream,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type Interactive struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

func DecodeMap[T any](value map[string]any) (T, error) {
	var output T
	data, err := json.Marshal(value)
	if err != nil {
		return output, fmt.Errorf("encode API response: %w", err)
	}
	if err := json.Unmarshal(data, &output); err != nil {
		return output, fmt.Errorf("decode API response: %w", err)
	}
	return output, nil
}
