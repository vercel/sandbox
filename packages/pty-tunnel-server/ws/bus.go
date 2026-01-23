package ws

import (
	"context"
	"crypto/subtle"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/vercel/sandbox/pty-tunnel-server/protocol"
)

type ClientConnection struct {
	conn       *websocket.Conn
	cancel     context.CancelFunc
	ctx        context.Context
	writeMutex *sync.Mutex

	warmupOnce *sync.Once
}

func (cc *ClientConnection) WriteMessage(data []byte) error {
	cc.writeMutex.Lock()
	defer cc.writeMutex.Unlock()
	return cc.conn.WriteMessage(websocket.BinaryMessage, data)
}

type ProcessConnections struct {
	// the "client" connections
	subscribers map[*websocket.Conn]ClientConnection
	// the "process" connection
	producer *websocket.Conn
	mutex    sync.RWMutex

	ctx    context.Context
	cancel context.CancelFunc
	logger *slog.Logger

	subscriberToProducer  chan protocol.Message
	producerToSubscribers chan []byte
}

func (pc *ProcessConnections) Run() {
	go func() {
		for {
			pc.logger.Debug("before reading message from producer")
			msgType, msg, err := pc.producer.ReadMessage()

			pc.logger.Debug("Reading message from producer", "msgType", msgType, "msgLength", len(msg), "err", err)

			if err == io.EOF || websocket.IsCloseError(err) {
				break
			} else if err != nil {
				pc.logger.Error("Error reading from producer", "error", err)
				break
			}

			pc.logger.Debug("Received message from producer", "payloadLength", len(msg))
			pc.producerToSubscribers <- msg
		}

		pc.logger.Info("Producer connection closed")
		pc.cancel()
	}()

	for {
		select {
		case <-pc.ctx.Done():
			return
		case msg := <-pc.producerToSubscribers:
			pc.forwardToSubscribers(msg)
		case msg := <-pc.subscriberToProducer:
			pc.logger.Info("received from subscriber", "msgType", msg.Type.String())
			pc.logger.Debug("Forwarding message from subscriber to producer", "msgType", msg.Type.String(), "payloadLength", len(msg.Payload))
			buffer := msg.Bytes()
			err := pc.producer.WriteMessage(websocket.BinaryMessage, buffer)
			if err != nil {
				pc.logger.Error("Error writing to producer", "error", err)
			}
		}
	}
}

func (pc *ProcessConnections) forwardToSubscribers(msg []byte) {
	pc.mutex.RLock()
	defer pc.mutex.RUnlock()
	pc.logger.Debug("Forwarding message from producer to subscribers", "subscriberCount", len(pc.subscribers), "payloadLength", len(msg), "msg", hex.EncodeToString(msg))

	wg := sync.WaitGroup{}

	for _, conn := range pc.subscribers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			conn.warmupOnce.Do(func() {
				conn.WriteMessage([]byte{})
			})
			if err := conn.WriteMessage(msg); err != nil {
				pc.logger.Error("Error writing to subscriber", "error", err, "subscriber", conn.conn.RemoteAddr())
			} else {
				pc.logger.Info("Successfully wrote message to subscriber", "subscriber", conn.conn.RemoteAddr(), "msg", hex.EncodeToString(msg))
			}
		}()
	}

	wg.Wait()
}

func (pc *ProcessConnections) Cleanup() {
	pc.cancel()
	pc.mutex.Lock()
	defer pc.mutex.Unlock()
	for k, conn := range pc.subscribers {
		conn.cancel()
		delete(pc.subscribers, k)
	}
}

func (pc *ProcessConnections) AcceptClient(conn *websocket.Conn) {
	ctx, close := context.WithCancel(pc.ctx)

	pc.mutex.Lock()
	pc.subscribers[conn] = ClientConnection{
		conn:       conn,
		ctx:        ctx,
		cancel:     close,
		warmupOnce: &sync.Once{},
		writeMutex: &sync.Mutex{},
	}
	pc.mutex.Unlock()

	go slurpMessages(pc.logger, conn, close, pc.subscriberToProducer)

	<-ctx.Done()
	pc.mutex.Lock()
	delete(pc.subscribers, conn)
	pc.mutex.Unlock()
}

func NewForProcess(logger *slog.Logger, conn *websocket.Conn, pid string) *ProcessConnections {
	ctx, cancel := context.WithCancel(context.Background())
	return &ProcessConnections{
		subscribers:           make(map[*websocket.Conn]ClientConnection),
		producer:              conn,
		subscriberToProducer:  make(chan protocol.Message, 100),
		producerToSubscribers: make(chan []byte, 100),
		ctx:                   ctx,
		cancel:                cancel,
		logger:                logger.With("processId", pid),
	}
}

type Bus struct {
	token  []byte
	logger *slog.Logger

	processes map[string]*ProcessConnections
	mutex     sync.RWMutex
}

func NewBus(token string, logger *slog.Logger) *Bus {
	return &Bus{
		token:     []byte(token),
		logger:    logger,
		processes: make(map[string]*ProcessConnections),
	}
}

var upgrader = websocket.Upgrader{}

type ConnectionType string

var (
	ConnectionTypeClient  ConnectionType = "client"
	ConnectionTypeProcess ConnectionType = "process"
)

func (c ConnectionType) IsValid() bool {
	return c == ConnectionTypeClient || c == ConnectionTypeProcess
}

func (b *Bus) HandleWebSocketConnection(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	token := query.Get("token")
	processID := query.Get("processId")
	connType := ConnectionType(r.PathValue("type"))

	if token == "" || !connType.IsValid() || processID == "" {
		b.logger.Warn("Missing required parameters", "token", token, "processID", processID, "connType", connType)
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	logger := b.logger.With("remoteAddr", r.RemoteAddr, "processID", processID, "connType", connType)

	if subtle.ConstantTimeCompare([]byte(token), b.token) != 1 {
		logger.Warn("Unauthorized WebSocket connection attempt", "provided_token", token, "token", string(b.token))
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	logger.Debug("Auth successful")

	if connType == ConnectionTypeClient && b.getProcess(processID) == nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)

	if err != nil {
		slog.Error("upgrading failed", "error", err.Error())
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	defer func() {
		logger.Info("Closing WebSocket connection")
		conn.WriteControl(websocket.CloseMessage, []byte{}, time.Now().Add(1*time.Second))
		if err := conn.Close(); err != nil {
			logger.Error("Error closing WebSocket connection", "error", err)
		}
	}()
	logger.Debug("WebSocket connection established")

	switch connType {
	case ConnectionTypeClient:
		processConn := b.getProcess(processID)
		if processConn == nil {
			return
		}

		processConn.AcceptClient(conn)
	case ConnectionTypeProcess:
		proc := NewForProcess(logger, conn, processID)
		b.mutex.Lock()
		b.processes[processID] = proc
		b.mutex.Unlock()

		proc.Run()

		b.mutex.Lock()
		delete(b.processes, processID)
		b.mutex.Unlock()

		proc.Cleanup()
	default:
		return
	}
}

func (b *Bus) getProcess(processID string) *ProcessConnections {
	b.mutex.RLock()
	defer b.mutex.RUnlock()
	return b.processes[processID]
}

func slurpMessages(logger *slog.Logger, conn *websocket.Conn, cancel context.CancelFunc, targetChan chan protocol.Message) {
	for {
		msgType, msg, err := conn.ReadMessage()
		if err == io.EOF {
			break
		} else if err != nil {
			logger.Error("Error reading from producer", "error", err)
			break
		}

		var buf []byte
		switch msgType {
		case websocket.TextMessage:
			buf = protocol.Message{Type: protocol.MessageTypeMessage, Payload: msg}.Bytes()
		case websocket.BinaryMessage:
			buf = msg
		default:
			logger.Error("Unsupported message type from producer", "msgType", msgType)
			continue
		}

		parsedMsg, err := protocol.Parse(buf)
		if err != nil {
			logger.Error("Error parsing message from producer", "error", err, "msgAsHex", hex.EncodeToString(buf))
			continue
		}

		logger.Debug("Received message from subscriber", "msgType", parsedMsg.Type.String(), "payloadLength", len(parsedMsg.Payload))
		targetChan <- parsedMsg
	}

	logger.Info("Producer connection closed")
	cancel()
}
