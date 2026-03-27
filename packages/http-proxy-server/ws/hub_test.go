package ws

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/vercel/sandbox/http-proxy-server/protocol"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))
}

func TestHubResolve(t *testing.T) {
	hub := NewHub("test-token", testLogger())

	requestID := "req-123"

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		time.Sleep(50 * time.Millisecond)
		response := protocol.ProxyResponse{
			Type:      protocol.TypeResponse,
			RequestID: requestID,
			Status:    200,
		}
		data, _ := json.Marshal(response)
		hub.Resolve(requestID, data)
	}()

	ch := make(chan []byte, 1)
	hub.pending.Store(requestID, ch)
	defer hub.pending.Delete(requestID)

	wg.Wait()

	select {
	case data := <-ch:
		var resp protocol.ProxyResponse
		if err := json.Unmarshal(data, &resp); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if resp.Status != 200 {
			t.Errorf("status: got %d, want 200", resp.Status)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for response")
	}
}

func TestHubResolveUnknownRequestDoesNotPanic(t *testing.T) {
	hub := NewHub("test-token", testLogger())
	hub.Resolve("nonexistent-request-id", []byte(`{}`))
}

func TestHubReadyChannel(t *testing.T) {
	hub := NewHub("test-token", testLogger())

	select {
	case <-hub.Ready():
		t.Fatal("ready channel should not be closed yet")
	default:
	}

	hub.readyOnce.Do(func() { close(hub.ready) })

	select {
	case <-hub.Ready():
	case <-time.After(100 * time.Millisecond):
		t.Fatal("ready channel should be closed")
	}
}

func TestHubRejectsInvalidToken(t *testing.T) {
	hub := NewHub("correct-token", testLogger())

	server := httptest.NewServer(http.HandlerFunc(hub.HandleWebSocket))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?token=wrong-token"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatal("expected connection to be rejected")
	}
	if resp != nil && resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestHubAcceptsValidToken(t *testing.T) {
	hub := NewHub("correct-token", testLogger())

	server := httptest.NewServer(http.HandlerFunc(hub.HandleWebSocket))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?token=correct-token"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("expected connection to succeed: %v", err)
	}
	defer conn.Close()
}

func TestHubWebSocketReadyMessage(t *testing.T) {
	hub := NewHub("token", testLogger())

	server := httptest.NewServer(http.HandlerFunc(hub.HandleWebSocket))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?token=token"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	ready := protocol.ReadyMessage{Type: protocol.TypeReady}
	data, _ := json.Marshal(ready)
	conn.WriteMessage(websocket.TextMessage, data)

	select {
	case <-hub.Ready():
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for ready")
	}
}

func TestHubWebSocketResponseRouting(t *testing.T) {
	hub := NewHub("token", testLogger())

	server := httptest.NewServer(http.HandlerFunc(hub.HandleWebSocket))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?token=token"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	requestID := "test-req-1"
	ch := make(chan []byte, 1)
	hub.pending.Store(requestID, ch)

	resp := protocol.ProxyResponse{
		Type:      protocol.TypeResponse,
		RequestID: requestID,
		Status:    404,
	}
	data, _ := json.Marshal(resp)
	conn.WriteMessage(websocket.TextMessage, data)

	select {
	case received := <-ch:
		var parsed protocol.ProxyResponse
		if err := json.Unmarshal(received, &parsed); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if parsed.Status != 404 {
			t.Errorf("status: got %d, want 404", parsed.Status)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for response on channel")
	}
}

// --- Multi-client tests ---

func TestHubMultiClientSessionRouting(t *testing.T) {
	hub := NewHub("token", testLogger())

	server := httptest.NewServer(http.HandlerFunc(hub.HandleWebSocket))
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?token=token"

	// Connect client A
	connA, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial A: %v", err)
	}
	defer connA.Close()

	// Connect client B
	connB, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial B: %v", err)
	}
	defer connB.Close()

	// Client A registers session-a
	regA, _ := json.Marshal(protocol.RegisterMessage{Type: protocol.TypeRegister, SessionIDs: []string{"session-a"}})
	connA.WriteMessage(websocket.TextMessage, regA)

	// Client B registers session-b
	regB, _ := json.Marshal(protocol.RegisterMessage{Type: protocol.TypeRegister, SessionIDs: []string{"session-b"}})
	connB.WriteMessage(websocket.TextMessage, regB)

	time.Sleep(50 * time.Millisecond) // Let registrations propagate

	// Read from both clients in goroutines
	receivedA := make(chan string, 1)
	go func() {
		connA.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, data, err := connA.ReadMessage()
		if err != nil {
			receivedA <- "error: " + err.Error()
			return
		}
		receivedA <- string(data)
	}()

	receivedB := make(chan string, 1)
	go func() {
		connB.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, data, err := connB.ReadMessage()
		if err != nil {
			receivedB <- "error: " + err.Error()
			return
		}
		receivedB <- string(data)
	}()

	// Send to session-a → should go to client A
	msg := protocol.ProxyRequest{
		Type:      protocol.TypeRequest,
		RequestID: "req-1",
		SessionID: "session-a",
		Method:    "GET",
		URL:       "http://example.com/a",
	}
	if err := hub.SendToSession("session-a", msg); err != nil {
		t.Fatalf("send to session-a: %v", err)
	}

	// Send to session-b → should go to client B
	msg2 := protocol.ProxyRequest{
		Type:      protocol.TypeRequest,
		RequestID: "req-2",
		SessionID: "session-b",
		Method:    "GET",
		URL:       "http://example.com/b",
	}
	if err := hub.SendToSession("session-b", msg2); err != nil {
		t.Fatalf("send to session-b: %v", err)
	}

	// Verify routing
	dataA := <-receivedA
	if !strings.Contains(dataA, "session-a") || !strings.Contains(dataA, "example.com/a") {
		t.Errorf("client A got wrong message: %s", dataA)
	}

	dataB := <-receivedB
	if !strings.Contains(dataB, "session-b") || !strings.Contains(dataB, "example.com/b") {
		t.Errorf("client B got wrong message: %s", dataB)
	}
}

func TestHubClientDisconnectCleansUpSessions(t *testing.T) {
	hub := NewHub("token", testLogger())

	server := httptest.NewServer(http.HandlerFunc(hub.HandleWebSocket))
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?token=token"

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	// Register sessions
	reg, _ := json.Marshal(protocol.RegisterMessage{Type: protocol.TypeRegister, SessionIDs: []string{"s1", "s2"}})
	conn.WriteMessage(websocket.TextMessage, reg)
	time.Sleep(50 * time.Millisecond)

	// Verify sessions are registered
	hub.sessionsMu.RLock()
	if len(hub.sessions) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(hub.sessions))
	}
	hub.sessionsMu.RUnlock()

	// Disconnect
	conn.Close()
	time.Sleep(100 * time.Millisecond)

	// Verify sessions are cleaned up
	hub.sessionsMu.RLock()
	if len(hub.sessions) != 0 {
		t.Errorf("expected 0 sessions after disconnect, got %d", len(hub.sessions))
	}
	hub.sessionsMu.RUnlock()
}

func TestHubUnregisteredSessionReturnsError(t *testing.T) {
	hub := NewHub("token", testLogger())

	err := hub.SendToSession("nonexistent-session", protocol.ProxyRequest{})
	if err == nil {
		t.Fatal("expected error for unregistered session")
	}
}
