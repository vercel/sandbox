package protocol

import (
	"encoding/binary"
	"fmt"
)

type MessageType uint8

const (
	MessageTypeMessage MessageType = 0
	MessageTypeResize  MessageType = 1
	MessageTypeReady   MessageType = 2
)

func (mt MessageType) String() string {
	switch mt {
	case MessageTypeMessage:
		return "Message"
	case MessageTypeResize:
		return "Resize"
	case MessageTypeReady:
		return "Ready"
	default:
		return "Unknown"
	}
}

func ParseMessageType(b byte) (MessageType, error) {
	switch MessageType(b) {
	case MessageTypeMessage, MessageTypeResize, MessageTypeReady:
		return MessageType(b), nil
	default:
		return 0, fmt.Errorf("unknown message type: %d", b)
	}
}

type Message struct {
	Type    MessageType
	Payload []byte
}
type MessageText struct {
	Data []byte
}
type MessageResize struct {
	Cols, Rows uint16
}
type MessageReady struct{}

func (m Message) Resize() (MessageResize, error) {
	if m.Type != MessageTypeResize || len(m.Payload) < 4 {
		return MessageResize{}, fmt.Errorf("invalid resize message")
	}

	cols := binary.BigEndian.Uint16(m.Payload[0:2])
	rows := binary.BigEndian.Uint16(m.Payload[2:4])
	if cols < 1 || rows < 1 {
		return MessageResize{}, fmt.Errorf("resize dimensions must be greater than 0")
	}

	return MessageResize{
		Cols: cols,
		Rows: rows,
	}, nil
}

func (m Message) Ready() (MessageReady, error) {
	if m.Type != MessageTypeReady {
		return MessageReady{}, fmt.Errorf("invalid ready message")
	}

	return MessageReady{}, nil
}

func (m Message) Text() (MessageText, error) {
	if m.Type != MessageTypeMessage {
		return MessageText{}, fmt.Errorf("invalid text message")
	}

	return MessageText{Data: m.Payload}, nil
}

// Parse parses a byte slice into a Message struct
// that can be further processed based on its type.
func Parse(data []byte) (Message, error) {
	if len(data) == 0 {
		return Message{}, fmt.Errorf("empty message")
	}

	messageType, err := ParseMessageType(data[0])
	if err != nil {
		return Message{}, err
	}

	return Message{
		Type:    messageType,
		Payload: data[1:],
	}, nil
}

func (m Message) Bytes() []byte {
	return append([]byte{uint8(m.Type)}, m.Payload...)
}
