package protocol

import (
	"testing"
)

func TestBinaryMessageParsing(t *testing.T) {
	testCases := []struct {
		name     string
		input    []byte
		expected MessageType
		payload  []byte
	}{
		{"text message", []byte{0x00, 0x68, 0x65, 0x6c, 0x6c, 0x6f}, MessageTypeMessage, []byte("hello")},
		{"resize message", []byte{0x01, 0x00, 0x50, 0x00, 0x18}, MessageTypeResize, []byte{0x00, 0x50, 0x00, 0x18}},
		{"ready message", []byte{0x02}, MessageTypeReady, []byte{}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			msg, err := Parse(tc.input)
			if err != nil {
				t.Fatalf("Parse failed: %v", err)
			}

			if msg.Type != tc.expected {
				t.Errorf("Expected type %d, got %d", tc.expected, msg.Type)
			}

			if len(tc.payload) == 0 && len(msg.Payload) == 0 {
				return // Both empty, test passes
			}

			if len(msg.Payload) != len(tc.payload) {
				t.Errorf("Expected payload length %d, got %d", len(tc.payload), len(msg.Payload))
				return
			}

			for i, b := range tc.payload {
				if msg.Payload[i] != b {
					t.Errorf("Expected payload byte %d to be %x, got %x", i, b, msg.Payload[i])
				}
			}
		})
	}
}

func TestBinaryMessageParsingEdgeCases(t *testing.T) {
	edgeCases := []struct {
		name        string
		input       []byte
		shouldError bool
	}{
		{"empty message", []byte{}, true},
		{"single byte message", []byte{0x00}, false},    // Valid message with empty payload
		{"invalid message type", []byte{0x99}, true},    // Should parse but type will be unknown
		{"malformed resize", []byte{0x01, 0x50}, false}, // Should parse but resize parsing will fail
	}

	for _, tc := range edgeCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse(tc.input)
			if tc.shouldError && err == nil {
				t.Error("Expected error but got none")
			}
			if !tc.shouldError && err != nil {
				t.Errorf("Expected no error but got: %v", err)
			}
		})
	}
}

func TestResizeMessage(t *testing.T) {
	cols := uint16(80)
	rows := uint16(24)

	// Create resize message manually
	msg := Message{
		Type:    MessageTypeResize,
		Payload: []byte{0x00, 0x50, 0x00, 0x18}, // 80 cols, 24 rows in big endian
	}

	resize, err := msg.Resize()
	if err != nil {
		t.Fatalf("Failed to parse resize message: %v", err)
	}

	if resize.Cols != cols {
		t.Errorf("Expected cols %d, got %d", cols, resize.Cols)
	}

	if resize.Rows != rows {
		t.Errorf("Expected rows %d, got %d", rows, resize.Rows)
	}
}

func TestTextMessage(t *testing.T) {
	testData := "Hello, World!"
	msg := Message{
		Type:    MessageTypeMessage,
		Payload: []byte(testData),
	}

	text, err := msg.Text()
	if err != nil {
		t.Fatalf("Failed to parse text message: %v", err)
	}

	if string(text.Data) != testData {
		t.Errorf("Expected text %q, got %q", testData, string(text.Data))
	}
}

func TestReadyMessage(t *testing.T) {
	msg := Message{
		Type:    MessageTypeReady,
		Payload: []byte{},
	}

	_, err := msg.Ready()
	if err != nil {
		t.Fatalf("Failed to parse ready message: %v", err)
	}
}
