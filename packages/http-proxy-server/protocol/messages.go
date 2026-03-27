package protocol

import "encoding/json"

// Message types sent between the Go proxy and the TypeScript client.

const (
	TypeRequest         = "request"
	TypeResponse        = "response"
	TypeConnect         = "connect"
	TypeConnectResponse = "connect-response"
	TypeReady           = "ready"
	TypeError           = "error"
	TypeRegister        = "register"
	TypeRegisterAck     = "register-ack"
	TypeUnregister      = "unregister"
)

// Envelope is the top-level JSON frame on the WebSocket.
type Envelope struct {
	Type string `json:"type"`
}

// ProxyRequest is sent from Go → TS when an HTTP request arrives.
type ProxyRequest struct {
	Type      string              `json:"type"` // "request"
	RequestID string              `json:"requestId"`
	SessionID string              `json:"sessionId"`
	Method    string              `json:"method"`
	URL       string              `json:"url"`
	Headers   map[string][]string `json:"headers"`
	Body      string              `json:"body,omitempty"` // base64
}

// ProxyResponse is sent from TS → Go with the callback result.
type ProxyResponse struct {
	Type      string              `json:"type"` // "response"
	RequestID string              `json:"requestId"`
	Status    int                 `json:"status"`
	Headers   map[string][]string `json:"headers,omitempty"`
	Body      string              `json:"body,omitempty"` // base64
}

// ConnectRequest is sent from Go → TS for HTTPS CONNECT tunneling.
type ConnectRequest struct {
	Type      string `json:"type"` // "connect"
	RequestID string `json:"requestId"`
	SessionID string `json:"sessionId"`
	Host      string `json:"host"`
}

// ConnectResponse is sent from TS → Go to allow/deny a CONNECT.
type ConnectResponse struct {
	Type      string `json:"type"` // "connect-response"
	RequestID string `json:"requestId"`
	Allow     bool   `json:"allow"`
}

// ReadyMessage is sent from TS → Go on initial handshake.
type ReadyMessage struct {
	Type string `json:"type"` // "ready"
}

// ErrorMessage is sent from TS → Go when a callback fails.
type ErrorMessage struct {
	Type      string `json:"type"` // "error"
	RequestID string `json:"requestId"`
	Message   string `json:"message"`
}

// RegisterMessage is sent from TS → Go to claim ownership of sessions.
type RegisterMessage struct {
	Type       string   `json:"type"` // "register"
	SessionIDs []string `json:"sessionIds"`
}

// RegisterAckMessage is sent from Go → TS to confirm registration.
type RegisterAckMessage struct {
	Type       string   `json:"type"` // "register-ack"
	SessionIDs []string `json:"sessionIds"`
}

// UnregisterMessage is sent from TS → Go to release session ownership.
type UnregisterMessage struct {
	Type       string   `json:"type"` // "unregister"
	SessionIDs []string `json:"sessionIds"`
}

// ParseType extracts the message type from a raw JSON frame.
func ParseType(data []byte) (string, error) {
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		return "", err
	}
	return env.Type, nil
}
