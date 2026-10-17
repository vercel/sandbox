package config

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	defaultAPI     = "https://api.vercel.com"
	defaultProject = "vercel-sandbox-default-project"
	vercelClientID = "cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp"
)

type Scope struct {
	Token     string
	TeamID    string
	ProjectID string
}

type Flags struct {
	Token   string
	Scope   string
	Team    string
	Project string
}

type authConfig struct {
	Token        string `json:"token"`
	RefreshToken string `json:"refreshToken"`
	ExpiresAt    int64  `json:"expiresAt"`
}

type projectConfig struct {
	OrgID     string `json:"orgId"`
	ProjectID string `json:"projectId"`
}

func (f Flags) Resolve(ctx context.Context) (Scope, error) {
	return f.resolve(ctx, os.Getwd, http.DefaultClient, defaultAPI)
}

func (f Flags) resolve(ctx context.Context, getwd func() (string, error), client *http.Client, apiURL string) (Scope, error) {
	token := first(f.Token, os.Getenv("VERCEL_AUTH_TOKEN"), os.Getenv("VERCEL_OIDC_TOKEN"))
	if token == "" {
		var err error
		token, err = existingCLIToken(ctx, client)
		if err != nil {
			return Scope{}, err
		}
	}
	if token == "" {
		return Scope{}, errors.New("not logged in to Vercel; run `vercel login`, pass --token, or set VERCEL_AUTH_TOKEN")
	}

	team := first(f.Scope, f.Team)
	project := f.Project
	if claims := jwtClaims(token); claims != nil {
		team = first(team, claims.OwnerID)
		project = first(project, claims.ProjectID)
	}
	if cwd, err := getwd(); err == nil {
		if linked := findLinkedProject(cwd); linked != nil {
			team = first(team, linked.OrgID)
			project = first(project, linked.ProjectID)
		}
	}
	if project == "" {
		if team == "" {
			team = currentTeam()
		}
		resolvedTeam, err := inferTeam(ctx, client, apiURL, token, team)
		if err != nil {
			return Scope{}, err
		}
		team = resolvedTeam
		project = defaultProject
		if err := ensureDefaultProject(ctx, client, apiURL, token, team); err != nil {
			return Scope{}, err
		}
	}
	if team == "" {
		return Scope{}, errors.New("could not determine Vercel team; pass --scope or run from a linked project")
	}
	return Scope{Token: token, TeamID: team, ProjectID: project}, nil
}

func existingCLIToken(ctx context.Context, client *http.Client) (string, error) {
	pathname := authPath()
	if pathname == "" {
		return "", nil
	}
	data, err := os.ReadFile(pathname)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", fmt.Errorf("read Vercel CLI authentication: %w", err)
	}
	var auth authConfig
	if err := json.Unmarshal(data, &auth); err != nil {
		return "", fmt.Errorf("parse Vercel CLI authentication: %w", err)
	}
	if auth.Token == "" {
		return "", nil
	}
	if auth.ExpiresAt == 0 || auth.ExpiresAt > time.Now().Add(30*time.Second).Unix() {
		return auth.Token, nil
	}
	if auth.RefreshToken == "" {
		return "", errors.New("Vercel login has expired; run `vercel login`")
	}
	refreshed, err := refreshAccessToken(ctx, client, auth.RefreshToken)
	if err != nil {
		return "", fmt.Errorf("refresh Vercel CLI authentication: %w; run `vercel login`", err)
	}
	auth.Token = refreshed.Token
	auth.ExpiresAt = refreshed.ExpiresAt
	if refreshed.RefreshToken != "" {
		auth.RefreshToken = refreshed.RefreshToken
	}
	encoded, err := json.MarshalIndent(auth, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(pathname, encoded, 0o600); err != nil {
		return "", fmt.Errorf("save refreshed Vercel CLI authentication: %w", err)
	}
	return auth.Token, nil
}

func refreshAccessToken(ctx context.Context, client *http.Client, refreshToken string) (authConfig, error) {
	discovery, err := client.Get("https://vercel.com/.well-known/openid-configuration")
	if err != nil {
		return authConfig{}, err
	}
	defer discovery.Body.Close()
	var metadata struct {
		TokenEndpoint string `json:"token_endpoint"`
	}
	if discovery.StatusCode < 200 || discovery.StatusCode >= 300 || json.NewDecoder(discovery.Body).Decode(&metadata) != nil || metadata.TokenEndpoint == "" {
		return authConfig{}, errors.New("OAuth discovery failed")
	}
	values := url.Values{"client_id": {vercelClientID}, "grant_type": {"refresh_token"}, "refresh_token": {refreshToken}}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, metadata.TokenEndpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return authConfig{}, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := client.Do(request)
	if err != nil {
		return authConfig{}, err
	}
	defer response.Body.Close()
	var result struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
		TokenType    string `json:"token_type"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return authConfig{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || result.AccessToken == "" || result.TokenType != "Bearer" {
		return authConfig{}, fmt.Errorf("token endpoint returned %s", response.Status)
	}
	return authConfig{Token: result.AccessToken, RefreshToken: result.RefreshToken, ExpiresAt: time.Now().Unix() + result.ExpiresIn}, nil
}

func inferTeam(ctx context.Context, client *http.Client, apiURL, token, requested string) (string, error) {
	if requested != "" {
		return requested, nil
	}
	var response struct {
		User struct {
			DefaultTeamID string `json:"defaultTeamId"`
			Username      string `json:"username"`
		} `json:"user"`
	}
	if err := apiJSON(ctx, client, http.MethodGet, apiURL+"/v2/user", token, nil, &response); err != nil {
		return "", fmt.Errorf("infer Vercel scope: %w", err)
	}
	if response.User.DefaultTeamID != "" {
		return response.User.DefaultTeamID, nil
	}
	if response.User.Username != "" {
		return response.User.Username, nil
	}
	return "", errors.New("Vercel account has no usable team")
}

func ensureDefaultProject(ctx context.Context, client *http.Client, apiURL, token, team string) error {
	teamQuery := teamParameter(team)
	endpoint := apiURL + "/v2/projects/" + url.PathEscape(defaultProject) + "?" + teamQuery
	request, err := authenticatedRequest(ctx, http.MethodGet, endpoint, token, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	if response.StatusCode != http.StatusNotFound {
		return fmt.Errorf("check default Sandbox project: Vercel API returned %s", response.Status)
	}
	body := map[string]string{"name": defaultProject}
	if err := apiJSON(ctx, client, http.MethodPost, apiURL+"/v11/projects?"+teamQuery, token, body, nil); err != nil {
		return fmt.Errorf("create default Sandbox project: %w", err)
	}
	return nil
}

func apiJSON(ctx context.Context, client *http.Client, method, endpoint, token string, body, output any) error {
	request, err := authenticatedRequest(ctx, method, endpoint, token, body)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
		return fmt.Errorf("Vercel API returned %s: %s", response.Status, strings.TrimSpace(string(data)))
	}
	if output != nil {
		return json.NewDecoder(response.Body).Decode(output)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	return nil
}

func authenticatedRequest(ctx context.Context, method, endpoint, token string, body any) (*http.Request, error) {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(data)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("User-Agent", "vercel/sandbox-go")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	return request, nil
}

func findLinkedProject(cwd string) *projectConfig {
	for {
		data, err := os.ReadFile(filepath.Join(cwd, ".vercel", "project.json"))
		if err == nil {
			var linked projectConfig
			if json.Unmarshal(data, &linked) == nil && linked.OrgID != "" && linked.ProjectID != "" {
				return &linked
			}
		}
		parent := filepath.Dir(cwd)
		if parent == cwd {
			return nil
		}
		cwd = parent
	}
}

func currentTeam() string {
	for _, directory := range configDirectories() {
		data, err := os.ReadFile(filepath.Join(directory, "config.json"))
		if err != nil {
			continue
		}
		var config struct {
			CurrentTeam string `json:"currentTeam"`
		}
		if json.Unmarshal(data, &config) == nil && config.CurrentTeam != "" {
			return config.CurrentTeam
		}
	}
	return ""
}

func authPath() string {
	for _, directory := range configDirectories() {
		pathname := filepath.Join(directory, "auth.json")
		if _, err := os.Stat(pathname); err == nil {
			return pathname
		}
	}
	directories := configDirectories()
	if len(directories) == 0 {
		return ""
	}
	return filepath.Join(directories[0], "auth.json")
}

func configDirectories() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	var primary string
	switch runtime.GOOS {
	case "darwin":
		primary = filepath.Join(home, "Library", "Application Support", "com.vercel.cli")
	case "windows":
		primary = filepath.Join(first(os.Getenv("APPDATA"), filepath.Join(home, "AppData", "Roaming")), "com.vercel.cli")
	default:
		primary = filepath.Join(first(os.Getenv("XDG_DATA_HOME"), filepath.Join(home, ".local", "share")), "com.vercel.cli")
	}
	return []string{primary, filepath.Join(home, ".now")}
}

func teamParameter(team string) string {
	if strings.HasPrefix(team, "team_") {
		return "teamId=" + url.QueryEscape(team)
	}
	return "slug=" + url.QueryEscape(team)
}

type claims struct {
	OwnerID   string `json:"owner_id"`
	ProjectID string `json:"project_id"`
}

func jwtClaims(token string) *claims {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	var value claims
	if json.Unmarshal(data, &value) != nil || value.OwnerID == "" {
		return nil
	}
	return &value
}

func first(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
