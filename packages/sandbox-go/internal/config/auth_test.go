package config

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestResolveReusesCLIAuthAndLinkedProject(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("VERCEL_AUTH_TOKEN", "")
	t.Setenv("VERCEL_OIDC_TOKEN", "")
	authDir := filepath.Join(home, "Library", "Application Support", "com.vercel.cli")
	if err := os.MkdirAll(authDir, 0o700); err != nil {
		t.Fatal(err)
	}
	writeJSON(t, filepath.Join(authDir, "auth.json"), authConfig{Token: "cli-token"})
	projectDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(projectDir, ".vercel"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeJSON(t, filepath.Join(projectDir, ".vercel", "project.json"), projectConfig{OrgID: "team_linked", ProjectID: "prj_linked"})

	scope, err := (Flags{}).resolve(context.Background(), func() (string, error) { return projectDir, nil }, http.DefaultClient, defaultAPI)
	if err != nil {
		t.Fatal(err)
	}
	if scope.Token != "cli-token" || scope.TeamID != "team_linked" || scope.ProjectID != "prj_linked" {
		t.Fatalf("unexpected scope: %#v", scope)
	}
}

func TestExistingCLITokenRefreshesExpiredToken(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	authDir := filepath.Join(home, "Library", "Application Support", "com.vercel.cli")
	if err := os.MkdirAll(authDir, 0o700); err != nil {
		t.Fatal(err)
	}
	pathname := filepath.Join(authDir, "auth.json")
	writeJSON(t, pathname, authConfig{Token: "expired", RefreshToken: "refresh", ExpiresAt: time.Now().Add(-time.Minute).Unix()})

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/.well-known/openid-configuration":
			json.NewEncoder(writer).Encode(map[string]string{"token_endpoint": server.URL + "/token"})
		case "/token":
			json.NewEncoder(writer).Encode(map[string]any{"access_token": "fresh", "refresh_token": "new-refresh", "expires_in": 3600, "token_type": "Bearer"})
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	original := "https://vercel.com/.well-known/openid-configuration"
	client := server.Client()
	client.Transport = rewriteTransport{base: client.Transport, from: original, to: server.URL + "/.well-known/openid-configuration"}
	token, err := existingCLIToken(context.Background(), client)
	if err != nil {
		t.Fatal(err)
	}
	if token != "fresh" {
		t.Fatalf("unexpected token %q", token)
	}
	var saved authConfig
	data, _ := os.ReadFile(pathname)
	if json.Unmarshal(data, &saved) != nil || saved.RefreshToken != "new-refresh" {
		t.Fatalf("unexpected saved auth: %#v", saved)
	}
}

type rewriteTransport struct {
	base     http.RoundTripper
	from, to string
}

func (transport rewriteTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.String() == transport.from {
		clone := request.Clone(request.Context())
		replacement, _ := http.NewRequest(request.Method, transport.to, request.Body)
		clone.URL = replacement.URL
		request = clone
	}
	return transport.base.RoundTrip(request)
}

func writeJSON(t *testing.T, pathname string, value any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pathname, data, 0o600); err != nil {
		t.Fatal(err)
	}
}
