package ws

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/vercel/sandbox/http-proxy-server/protocol"
)

var upgrader = websocket.Upgrader{}

// ClientState tracks a connected WS client and its registered sessions.
type ClientState struct {
	conn       *websocket.Conn
	writeMu    sync.Mutex
	sessionIDs map[string]bool
}

func (cs *ClientState) WriteJSON(msg any) error {
	cs.writeMu.Lock()
	defer cs.writeMu.Unlock()
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return cs.conn.WriteMessage(websocket.TextMessage, data)
}

// Hub manages multiple WebSocket clients from external TS processes.
// Each client registers the session IDs it owns. The HTTP proxy routes
// requests to the correct client based on session ID.
type Hub struct {
	token  []byte
	logger *slog.Logger

	// Multiple connected WS clients
	clients   map[*websocket.Conn]*ClientState
	clientsMu sync.RWMutex

	// Session → client routing
	sessions   map[string]*ClientState
	sessionsMu sync.RWMutex

	// Pending HTTP requests waiting for a response, keyed by requestId
	pending sync.Map // map[string]chan []byte

	// Signals that at least one TS client has sent "ready"
	ready     chan struct{}
	readyOnce sync.Once
}

func NewHub(token string, logger *slog.Logger) *Hub {
	return &Hub{
		token:    []byte(token),
		logger:   logger,
		ready:    make(chan struct{}),
		clients:  make(map[*websocket.Conn]*ClientState),
		sessions: make(map[string]*ClientState),
	}
}

// Ready returns a channel that is closed when the first TS client sends "ready".
func (h *Hub) Ready() <-chan struct{} {
	return h.ready
}

// SendToSession sends a JSON message to the WS client that owns the given session.
func (h *Hub) SendToSession(sessionID string, msg any) error {
	h.sessionsMu.RLock()
	cs, ok := h.sessions[sessionID]
	h.sessionsMu.RUnlock()

	if !ok || cs == nil {
		return fmt.Errorf("no client registered for session %s", sessionID)
	}

	return cs.WriteJSON(msg)
}

// SendToSessionAndWait sends a request to the session owner and blocks until a response arrives.
func (h *Hub) SendToSessionAndWait(sessionID string, requestID string, msg any) ([]byte, error) {
	ch := make(chan []byte, 1)
	h.pending.Store(requestID, ch)
	defer h.pending.Delete(requestID)

	if err := h.SendToSession(sessionID, msg); err != nil {
		return nil, err
	}

	data, ok := <-ch
	if !ok {
		return nil, fmt.Errorf("response channel closed for request %s", requestID)
	}
	return data, nil
}

// Resolve delivers a response to a pending request.
func (h *Hub) Resolve(requestID string, data []byte) {
	val, ok := h.pending.Load(requestID)
	if !ok {
		h.logger.Warn("No pending request for response", "requestId", requestID)
		return
	}
	ch := val.(chan []byte)
	ch <- data
}

func (h *Hub) registerSessions(cs *ClientState, sessionIDs []string) {
	h.sessionsMu.Lock()
	defer h.sessionsMu.Unlock()
	for _, id := range sessionIDs {
		h.sessions[id] = cs
		cs.sessionIDs[id] = true
	}
	h.logger.Debug("Sessions registered", "count", len(sessionIDs))
}

func (h *Hub) unregisterSessions(cs *ClientState, sessionIDs []string) {
	h.sessionsMu.Lock()
	defer h.sessionsMu.Unlock()
	for _, id := range sessionIDs {
		if h.sessions[id] == cs {
			delete(h.sessions, id)
		}
		delete(cs.sessionIDs, id)
	}
}

func (h *Hub) removeClient(conn *websocket.Conn) {
	h.clientsMu.Lock()
	cs, ok := h.clients[conn]
	if ok {
		delete(h.clients, conn)
	}
	h.clientsMu.Unlock()

	if ok && cs != nil {
		// Clean up all session mappings for this client
		h.sessionsMu.Lock()
		for id := range cs.sessionIDs {
			if h.sessions[id] == cs {
				delete(h.sessions, id)
			}
		}
		h.sessionsMu.Unlock()
	}
}

// HandleWebSocket is the HTTP handler for the /ws endpoint.
func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if subtle.ConstantTimeCompare([]byte(token), h.token) != 1 {
		h.logger.Warn("Unauthorized WebSocket connection attempt")
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("WebSocket upgrade failed", "error", err)
		return
	}

	cs := &ClientState{
		conn:       conn,
		sessionIDs: make(map[string]bool),
	}

	h.clientsMu.Lock()
	h.clients[conn] = cs
	h.clientsMu.Unlock()

	h.logger.Info("TS client connected", "remoteAddr", r.RemoteAddr)

	defer func() {
		h.removeClient(conn)
		conn.Close()
		h.logger.Info("TS client disconnected", "remoteAddr", r.RemoteAddr)
	}()

	// Read loop: dispatch incoming messages
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				break
			}
			h.logger.Error("Error reading from TS client", "error", err)
			break
		}

		msgType, err := protocol.ParseType(data)
		if err != nil {
			h.logger.Error("Failed to parse message type", "error", err)
			continue
		}

		switch msgType {
		case protocol.TypeReady:
			h.readyOnce.Do(func() {
				h.logger.Info("TS client sent ready")
				close(h.ready)
			})

		case protocol.TypeRegister:
			var msg protocol.RegisterMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				h.logger.Error("Failed to parse register message", "error", err)
				continue
			}
			h.registerSessions(cs, msg.SessionIDs)
			// Send ack so the client knows registration is complete
			ack := protocol.RegisterAckMessage{Type: protocol.TypeRegisterAck, SessionIDs: msg.SessionIDs}
			ackData, _ := json.Marshal(ack)
			cs.writeMu.Lock()
			cs.conn.WriteMessage(websocket.TextMessage, ackData)
			cs.writeMu.Unlock()

		case protocol.TypeUnregister:
			var msg protocol.UnregisterMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				h.logger.Error("Failed to parse unregister message", "error", err)
				continue
			}
			h.unregisterSessions(cs, msg.SessionIDs)

		case protocol.TypeResponse:
			var resp protocol.ProxyResponse
			if err := json.Unmarshal(data, &resp); err != nil {
				h.logger.Error("Failed to parse response", "error", err)
				continue
			}
			h.Resolve(resp.RequestID, data)

		case protocol.TypeConnectResponse:
			var resp protocol.ConnectResponse
			if err := json.Unmarshal(data, &resp); err != nil {
				h.logger.Error("Failed to parse connect response", "error", err)
				continue
			}
			h.Resolve(resp.RequestID, data)

		case protocol.TypeError:
			var errMsg protocol.ErrorMessage
			if err := json.Unmarshal(data, &errMsg); err != nil {
				h.logger.Error("Failed to parse error message", "error", err)
				continue
			}
			h.Resolve(errMsg.RequestID, data)

		default:
			h.logger.Warn("Unknown message type from TS client", "type", msgType)
		}
	}
}
