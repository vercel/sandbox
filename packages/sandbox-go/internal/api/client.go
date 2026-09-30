package api

import (
	"archive/tar"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	vercel "github.com/vercel/go-sdk"
	"github.com/vercel/go-sdk/sandboxes"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/config"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/model"
)

const baseURL = "https://api.vercel.com"

type Client struct {
	scope      config.Scope
	sdk        *vercel.Client
	httpClient *http.Client
	baseURL    string
}

func New(scope config.Scope) (*Client, error) {
	return newClient(scope, baseURL, http.DefaultClient)
}

func newClient(scope config.Scope, endpoint string, httpClient *http.Client) (*Client, error) {
	sdk, err := vercel.NewClient(
		vercel.WithBearerToken(scope.Token),
		vercel.WithUserAgent("vercel/sandbox-go"),
		vercel.WithBaseURL(endpoint),
		vercel.WithHTTPClient(httpClient),
	)
	if err != nil {
		return nil, err
	}
	return &Client{scope: scope, sdk: sdk, httpClient: httpClient, baseURL: endpoint}, nil
}

func (c *Client) Create(ctx context.Context, body map[string]any) (model.SandboxResponse, error) {
	body["projectId"] = c.scope.ProjectID
	response, err := sandboxes.CreateSandboxesV4(ctx, c.sdk, sandboxes.CreateSandboxesV4Request{
		TeamId: stringPtr(c.scope.TeamID),
		Body:   body,
	})
	if err != nil {
		return model.SandboxResponse{}, err
	}
	return model.DecodeMap[model.SandboxResponse](*response)
}

func (c *Client) Fork(ctx context.Context, source string, body map[string]any) (model.SandboxResponse, error) {
	response, err := sandboxes.CreateSandboxesByNameForkV3(ctx, c.sdk, sandboxes.CreateSandboxesByNameForkV3Request{
		Name:      source,
		ProjectId: stringPtr(c.scope.ProjectID),
		TeamId:    stringPtr(c.scope.TeamID),
		Body:      body,
	})
	if err != nil {
		return model.SandboxResponse{}, err
	}
	return model.DecodeMap[model.SandboxResponse](*response)
}

func (c *Client) List(ctx context.Context, options ListOptions) (model.ListResponse, error) {
	request := sandboxes.ListNamedSandboxesRequest{
		Project:    stringPtr(c.scope.ProjectID),
		TeamId:     stringPtr(c.scope.TeamID),
		Limit:      floatPtr(float64(options.Limit)),
		Cursor:     optionalString(options.Cursor),
		NamePrefix: optionalString(options.NamePrefix),
		SortBy:     optionalString(options.SortBy),
		SortOrder:  optionalString(options.SortOrder),
		Tags:       options.Tags,
	}
	response, err := sandboxes.ListNamedSandboxes(ctx, c.sdk, request)
	if err != nil {
		return model.ListResponse{}, err
	}
	data, err := json.Marshal(response)
	if err != nil {
		return model.ListResponse{}, err
	}
	var output model.ListResponse
	if err := json.Unmarshal(data, &output); err != nil {
		return model.ListResponse{}, err
	}
	return output, nil
}

type ListOptions struct {
	Limit      int
	Cursor     string
	NamePrefix string
	SortBy     string
	SortOrder  string
	Tags       []string
}

type ResourceListOptions struct {
	Name      string
	Limit     int
	Cursor    string
	SortOrder string
}

func (c *Client) Get(ctx context.Context, name string, resume bool) (model.SandboxResponse, error) {
	response, err := sandboxes.GetNamedSandbox(ctx, c.sdk, sandboxes.GetNamedSandboxRequest{
		Name:      name,
		ProjectId: stringPtr(c.scope.ProjectID),
		Resume:    boolPtr(resume),
		TeamId:    stringPtr(c.scope.TeamID),
	})
	if err != nil {
		return model.SandboxResponse{}, err
	}
	return model.DecodeMap[model.SandboxResponse](*response)
}

func (c *Client) Delete(ctx context.Context, name string) error {
	return c.DeleteWithSnapshots(ctx, name, false)
}

func (c *Client) DeleteWithSnapshots(ctx context.Context, name string, deleteOrphanSnapshots bool) error {
	_, err := sandboxes.DeleteSandbox(ctx, c.sdk, sandboxes.DeleteSandboxRequest{
		Name:                  name,
		ProjectId:             stringPtr(c.scope.ProjectID),
		DeleteOrphanSnapshots: boolPtr(deleteOrphanSnapshots),
		TeamId:                stringPtr(c.scope.TeamID),
	})
	return err
}

func (c *Client) Snapshot(ctx context.Context, sessionID string, expiration *time.Duration) (model.Snapshot, error) {
	body := map[string]any{}
	if expiration != nil {
		body["expiration"] = expiration.Milliseconds()
	}
	response, err := sandboxes.CreateSandboxesSessionsBySessionIdSnapshotV3(ctx, c.sdk, sandboxes.CreateSandboxesSessionsBySessionIdSnapshotV3Request{
		SessionId: sessionID,
		TeamId:    stringPtr(c.scope.TeamID),
		Body:      body,
	})
	if err != nil {
		return model.Snapshot{}, err
	}
	decoded, err := model.DecodeMap[struct {
		Snapshot model.Snapshot `json:"snapshot"`
	}](*response)
	return decoded.Snapshot, err
}

func (c *Client) ListSessions(ctx context.Context, options ResourceListOptions) ([]model.Session, model.Pagination, error) {
	response, err := sandboxes.ListSessions(ctx, c.sdk, sandboxes.ListSessionsRequest{
		Project:   stringPtr(c.scope.ProjectID),
		Name:      optionalString(options.Name),
		Limit:     floatPtr(float64(options.Limit)),
		Cursor:    optionalString(options.Cursor),
		SortOrder: optionalString(options.SortOrder),
		TeamId:    stringPtr(c.scope.TeamID),
	})
	if err != nil {
		return nil, model.Pagination{}, err
	}
	return decodeResourceList[model.Session](*response, "sessions")
}

func (c *Client) ListSnapshots(ctx context.Context, options ResourceListOptions) ([]model.Snapshot, model.Pagination, error) {
	response, err := sandboxes.ListSessionSnapshots(ctx, c.sdk, sandboxes.ListSessionSnapshotsRequest{
		Project:   stringPtr(c.scope.ProjectID),
		Name:      optionalString(options.Name),
		Limit:     floatPtr(float64(options.Limit)),
		Cursor:    optionalString(options.Cursor),
		SortOrder: optionalString(options.SortOrder),
		TeamId:    stringPtr(c.scope.TeamID),
	})
	if err != nil {
		return nil, model.Pagination{}, err
	}
	return decodeResourceList[model.Snapshot](*response, "snapshots")
}

func (c *Client) GetSnapshot(ctx context.Context, id string) (model.Snapshot, error) {
	response, err := sandboxes.GetSessionSnapshot(ctx, c.sdk, sandboxes.GetSessionSnapshotRequest{SnapshotId: id, TeamId: stringPtr(c.scope.TeamID)})
	if err != nil {
		return model.Snapshot{}, err
	}
	decoded, err := model.DecodeMap[struct {
		Snapshot model.Snapshot `json:"snapshot"`
	}](*response)
	return decoded.Snapshot, err
}

func (c *Client) DeleteSnapshot(ctx context.Context, id string) error {
	_, err := sandboxes.DeleteSessionSnapshot(ctx, c.sdk, sandboxes.DeleteSessionSnapshotRequest{SnapshotId: id, TeamId: stringPtr(c.scope.TeamID)})
	return err
}

func (c *Client) ListDrives(ctx context.Context, options ListOptions) ([]model.Drive, model.Pagination, error) {
	response, err := sandboxes.ListDrives(ctx, c.sdk, sandboxes.ListDrivesRequest{
		ProjectId: stringPtr(c.scope.ProjectID), Limit: floatPtr(float64(options.Limit)), Cursor: optionalString(options.Cursor),
		SortBy: optionalString(options.SortBy), NamePrefix: optionalString(options.NamePrefix), SortOrder: optionalString(options.SortOrder), TeamId: stringPtr(c.scope.TeamID),
	})
	if err != nil {
		return nil, model.Pagination{}, err
	}
	return decodeResourceList[model.Drive](*response, "drives")
}

func (c *Client) GetOrCreateDrive(ctx context.Context, name string, body map[string]any) (model.Drive, error) {
	body["projectId"] = c.scope.ProjectID
	response, err := sandboxes.GetOrCreateDrive(ctx, c.sdk, sandboxes.GetOrCreateDriveRequest{Name: name, TeamId: stringPtr(c.scope.TeamID), Body: body})
	if err != nil {
		return model.Drive{}, err
	}
	decoded, err := model.DecodeMap[struct {
		Drive model.Drive `json:"drive"`
	}](*response)
	return decoded.Drive, err
}

func (c *Client) DeleteDrive(ctx context.Context, name string) error {
	_, err := sandboxes.DeleteDrive(ctx, c.sdk, sandboxes.DeleteDriveRequest{Name: name, ProjectId: stringPtr(c.scope.ProjectID), TeamId: stringPtr(c.scope.TeamID)})
	return err
}

func (c *Client) Update(ctx context.Context, name string, body map[string]any) (model.SandboxResponse, error) {
	response, err := sandboxes.UpdateSandbox(ctx, c.sdk, sandboxes.UpdateSandboxRequest{Name: name, ProjectId: stringPtr(c.scope.ProjectID), TeamId: stringPtr(c.scope.TeamID), Body: body})
	if err != nil {
		return model.SandboxResponse{}, err
	}
	data, err := json.Marshal(response)
	if err != nil {
		return model.SandboxResponse{}, err
	}
	var output model.SandboxResponse
	if err := json.Unmarshal(data, &output); err != nil {
		return output, err
	}
	return output, nil
}

func decodeResourceList[T any](value any, field string) ([]T, model.Pagination, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, model.Pagination{}, err
	}
	var envelope struct {
		Sessions   []T              `json:"sessions"`
		Snapshots  []T              `json:"snapshots"`
		Drives     []T              `json:"drives"`
		Pagination model.Pagination `json:"pagination"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, model.Pagination{}, err
	}
	switch field {
	case "sessions":
		return envelope.Sessions, envelope.Pagination, nil
	case "snapshots":
		return envelope.Snapshots, envelope.Pagination, nil
	case "drives":
		return envelope.Drives, envelope.Pagination, nil
	default:
		return nil, model.Pagination{}, fmt.Errorf("unknown resource list %q", field)
	}
}

func (c *Client) Stop(ctx context.Context, sessionID string) (map[string]any, error) {
	// The generated SDK currently sends this POST without a JSON content type,
	// which the Sandbox API rejects with 415. Keep the endpoint shape aligned
	// with sandboxes.StopSession while supplying the required empty JSON body.
	response, err := c.request(ctx, http.MethodPost, "/v2/sandboxes/sessions/"+url.PathEscape(sessionID)+"/stop", map[string]any{}, "application/json")
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var output map[string]any
	if err := json.NewDecoder(response.Body).Decode(&output); err != nil {
		return nil, err
	}
	return output, nil
}

type RunOptions struct {
	Command string
	Args    []string
	CWD     string
	Env     map[string]string
	Sudo    bool
	Timeout time.Duration
	Stdout  io.Writer
	Stderr  io.Writer
}

func (c *Client) Run(ctx context.Context, sessionID string, options RunOptions) (model.Command, error) {
	body := map[string]any{
		"command": options.Command,
		"args":    options.Args,
		"env":     options.Env,
		"sudo":    options.Sudo,
		"wait":    true,
		"logs":    true,
	}
	if options.CWD != "" {
		body["cwd"] = options.CWD
	}
	if options.Timeout > 0 {
		body["timeout"] = options.Timeout.Milliseconds()
	}

	response, err := c.request(ctx, http.MethodPost, "/v2/sandboxes/sessions/"+url.PathEscape(sessionID)+"/cmd", body, "application/x-ndjson")
	if err != nil {
		return model.Command{}, err
	}
	defer response.Body.Close()

	var command model.Command
	scanner := bufio.NewScanner(response.Body)
	buffer := make([]byte, 64*1024)
	scanner.Buffer(buffer, 1024*1024)
	for scanner.Scan() {
		var event model.CommandEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return command, fmt.Errorf("decode command stream: %w", err)
		}
		if event.Command != nil {
			command = *event.Command
			continue
		}
		if event.Stream == "error" {
			return command, fmt.Errorf("remote command stream: %s", event.Data)
		}
		var data string
		if err := json.Unmarshal(event.Data, &data); err != nil {
			continue
		}
		if event.Stream == "stderr" {
			_, _ = io.WriteString(options.Stderr, data)
		} else if event.Stream == "stdout" {
			_, _ = io.WriteString(options.Stdout, data)
		}
	}
	if err := scanner.Err(); err != nil {
		return command, err
	}
	if command.ExitCode == nil {
		return command, errors.New("command stream ended before exit status was received")
	}
	return command, nil
}

func (c *Client) OpenInteractive(ctx context.Context, sessionID string) (model.Interactive, error) {
	response, err := c.request(ctx, http.MethodPost, "/v2/sandboxes/sessions/"+url.PathEscape(sessionID)+"/interactive", map[string]any{}, "application/json")
	if err != nil {
		return model.Interactive{}, err
	}
	defer response.Body.Close()
	var output model.Interactive
	if err := json.NewDecoder(response.Body).Decode(&output); err != nil {
		return output, err
	}
	return output, nil
}

func (c *Client) ExtendTimeout(ctx context.Context, sessionID string, duration time.Duration) error {
	_, err := sandboxes.ExtendSessionTimeout(ctx, c.sdk, sandboxes.ExtendSessionTimeoutRequest{
		SessionId: sessionID,
		TeamId:    stringPtr(c.scope.TeamID),
		Body:      map[string]any{"duration": duration.Milliseconds()},
	})
	return err
}

func (c *Client) ReadFile(ctx context.Context, sessionID, remotePath string) (io.ReadCloser, bool, error) {
	response, err := c.request(ctx, http.MethodPost, "/v2/sandboxes/sessions/"+url.PathEscape(sessionID)+"/fs/read", map[string]any{"path": remotePath}, "")
	if err != nil {
		var status *StatusError
		if errors.As(err, &status) && status.StatusCode == http.StatusNotFound {
			return nil, false, nil
		}
		return nil, false, err
	}
	return response.Body, true, nil
}

func (c *Client) WriteFile(ctx context.Context, sessionID, remotePath string, content io.Reader) error {
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	data, err := io.ReadAll(content)
	if err != nil {
		return err
	}
	name := strings.TrimPrefix(path.Clean(remotePath), "/")
	if err := tarWriter.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(data))}); err != nil {
		return err
	}
	if _, err := tarWriter.Write(data); err != nil {
		return err
	}
	if err := tarWriter.Close(); err != nil {
		return err
	}
	if err := gzipWriter.Close(); err != nil {
		return err
	}

	requestPath := "/v2/sandboxes/sessions/" + url.PathEscape(sessionID) + "/fs/write"
	query := url.Values{"teamId": {c.scope.TeamID}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+requestPath+"?"+query.Encode(), bytes.NewReader(archive.Bytes()))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.scope.Token)
	req.Header.Set("User-Agent", "vercel/sandbox-go")
	req.Header.Set("Content-Type", "application/gzip")
	req.Header.Set("x-cwd", "/")
	response, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return statusError(response)
	}
	return nil
}

func (c *Client) request(ctx context.Context, method, requestPath string, body any, expectedContentType string) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(data)
	}
	query := url.Values{"teamId": {c.scope.TeamID}}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+requestPath+"?"+query.Encode(), reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.scope.Token)
	req.Header.Set("User-Agent", "vercel/sandbox-go")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer response.Body.Close()
		return nil, statusError(response)
	}
	if expectedContentType != "" && !strings.Contains(response.Header.Get("Content-Type"), expectedContentType) {
		defer response.Body.Close()
		return nil, fmt.Errorf("unexpected content type %q", response.Header.Get("Content-Type"))
	}
	return response, nil
}

type StatusError struct {
	StatusCode int
	Body       string
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("Vercel API returned %d: %s", e.StatusCode, e.Body)
}

func statusError(response *http.Response) error {
	data, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	return &StatusError{StatusCode: response.StatusCode, Body: strings.TrimSpace(string(data))}
}

func stringPtr(value string) *string  { return &value }
func boolPtr(value bool) *bool        { return &value }
func floatPtr(value float64) *float64 { return &value }
func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
