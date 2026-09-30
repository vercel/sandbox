package cmd

import (
	"testing"
	"time"
)

func TestParsePairs(t *testing.T) {
	values, err := parsePairs([]string{"A=1", "B=two=parts"})
	if err != nil {
		t.Fatal(err)
	}
	if values["A"] != "1" || values["B"] != "two=parts" {
		t.Fatalf("unexpected values: %#v", values)
	}
	if _, err := parsePairs([]string{"invalid"}); err == nil {
		t.Fatal("expected invalid pair error")
	}
}

func TestParseCopyPath(t *testing.T) {
	remote, err := parseCopyPath("demo:/tmp/file")
	if err != nil {
		t.Fatal(err)
	}
	if !remote.remote || remote.sandbox != "demo" || remote.path != "/tmp/file" {
		t.Fatalf("unexpected remote path: %#v", remote)
	}
	local, err := parseCopyPath("./file")
	if err != nil || local.remote {
		t.Fatalf("unexpected local path: %#v, %v", local, err)
	}
}

func TestCreateRejectsRuntimeAndImage(t *testing.T) {
	root := NewRoot(nil, nil, nil)
	root.SetArgs([]string{"create", "--runtime", "node24", "--image", "repo:v1"})
	if err := root.Execute(); err == nil {
		t.Fatal("expected conflict error")
	}
}

func TestCreateAcceptsPositionalName(t *testing.T) {
	options := createOptions{name: "foo", timeout: 5 * time.Minute}
	body, err := createBody(options)
	if err != nil {
		t.Fatal(err)
	}
	if body["name"] != "foo" {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestCreateOmitsUnsetOptionalFields(t *testing.T) {
	body, err := createBody(createOptions{timeout: 5 * time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"name", "ports", "env", "tags", "region", "failoverRegions", "networkId", "mounts"} {
		if _, ok := body[field]; ok {
			t.Fatalf("unset %s must be omitted: %#v", field, body)
		}
	}
}

func TestRootIncludesCompatibleCommandSurface(t *testing.T) {
	root := NewRoot(nil, nil, nil)
	commands := []string{"list", "create", "sh", "fork", "config", "copy", "exec", "connect", "stop", "remove", "run", "snapshot", "snapshots", "sessions", "drives", "telemetry", "login", "logout"}
	for _, name := range commands {
		command, _, err := root.Find([]string{name})
		if err != nil || command.Name() != name {
			t.Fatalf("%s command missing: command=%v err=%v", name, command, err)
		}
	}
}

func TestNestedCommandSurface(t *testing.T) {
	root := NewRoot(nil, nil, nil)
	paths := [][]string{
		{"snapshots", "list"}, {"snapshots", "get"}, {"snapshots", "delete"},
		{"sessions", "list"}, {"drives", "list"}, {"drives", "get-or-create"}, {"drives", "delete"},
		{"config", "list"}, {"config", "vcpus"}, {"config", "timeout"}, {"config", "persistent"}, {"config", "region"}, {"config", "tags"},
		{"telemetry", "status"}, {"telemetry", "enable"}, {"telemetry", "disable"},
	}
	for _, path := range paths {
		command, _, err := root.Find(path)
		if err != nil || command.Name() != path[len(path)-1] {
			t.Fatalf("command %v missing: command=%v err=%v", path, command, err)
		}
	}
}
