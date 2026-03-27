package proxy

import (
	"encoding/base64"
	"strings"
)

// ExtractSessionID pulls the session ID from a Proxy-Authorization header.
// The HTTP_PROXY URL is http://<sessionId>:x@host:port, so clients send
// a Proxy-Authorization: Basic header where the username is the session ID.
func ExtractSessionID(proxyAuth string) string {
	if proxyAuth == "" {
		return ""
	}

	// Expect "Basic <base64>"
	const prefix = "Basic "
	if !strings.HasPrefix(proxyAuth, prefix) {
		return ""
	}

	decoded, err := base64.StdEncoding.DecodeString(proxyAuth[len(prefix):])
	if err != nil {
		return ""
	}

	// Format is "sessionId:x" — take everything before the first ':'
	parts := strings.SplitN(string(decoded), ":", 2)
	if len(parts) == 0 {
		return ""
	}
	return parts[0]
}
