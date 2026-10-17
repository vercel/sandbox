package config

import (
	"context"
	"encoding/base64"
	"testing"
)

func TestResolveUsesOIDCClaims(t *testing.T) {
	t.Setenv("VERCEL_AUTH_TOKEN", "")
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"owner_id":"team_123","project_id":"prj_123"}`))
	t.Setenv("VERCEL_OIDC_TOKEN", "x."+payload+".x")

	scope, err := (Flags{}).Resolve(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if scope.TeamID != "team_123" || scope.ProjectID != "prj_123" {
		t.Fatalf("unexpected scope: %#v", scope)
	}
}

func TestResolveRequiresScopeForPersonalToken(t *testing.T) {
	t.Setenv("VERCEL_AUTH_TOKEN", "personal")
	t.Setenv("VERCEL_OIDC_TOKEN", "")
	if _, err := (Flags{}).Resolve(context.Background()); err == nil {
		t.Fatal("expected missing scope error")
	}
}
