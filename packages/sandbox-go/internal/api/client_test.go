package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vercel/sandbox/packages/sandbox-go/internal/config"
)

func TestListUsesGeneratedSDKOperation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v2/sandboxes" {
			t.Errorf("unexpected path %s", request.URL.Path)
		}
		if request.URL.Query().Get("teamId") != "team_1" || request.URL.Query().Get("project") != "prj_1" {
			t.Errorf("unexpected query %s", request.URL.RawQuery)
		}
		writer.Header().Set("Content-Type", "application/json")
		fmt.Fprint(writer, `{"sandboxes":[{"name":"demo","persistent":true,"createdAt":1,"updatedAt":1,"currentSessionId":"sess_1","status":"running"}],"pagination":{"count":1,"next":null}}`)
	}))
	defer server.Close()
	client, err := newClient(config.Scope{Token: "token", TeamID: "team_1", ProjectID: "prj_1"}, server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.List(context.Background(), ListOptions{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Sandboxes) != 1 || response.Sandboxes[0].Name != "demo" {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestRunStreamsOutputAndExitCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/x-ndjson")
		fmt.Fprintln(writer, `{"command":{"id":"cmd_1","name":"echo","args":[],"sessionId":"sess_1","exitCode":null}}`)
		fmt.Fprintln(writer, `{"stream":"stdout","data":"hello\n"}`)
		fmt.Fprintln(writer, `{"command":{"id":"cmd_1","name":"echo","args":[],"sessionId":"sess_1","exitCode":7}}`)
	}))
	defer server.Close()
	client, err := newClient(config.Scope{Token: "token", TeamID: "team_1", ProjectID: "prj_1"}, server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	var stdout strings.Builder
	command, err := client.Run(context.Background(), "sess_1", RunOptions{Command: "echo", Stdout: &stdout, Stderr: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	if stdout.String() != "hello\n" || command.ExitCode == nil || *command.ExitCode != 7 {
		t.Fatalf("unexpected output=%q command=%#v", stdout.String(), command)
	}
}
