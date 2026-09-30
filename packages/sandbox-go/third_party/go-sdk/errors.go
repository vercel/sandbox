package vercel

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// APIError is returned for non-successful Vercel API responses.
type APIError struct {
	StatusCode int
	RequestID  string
	Code       string
	Message    string
	Body       []byte
	Header     http.Header
}

func (err *APIError) Error() string {
	if err.Code != "" {
		return fmt.Sprintf("vercel API error %d (%s): %s", err.StatusCode, err.Code, err.Message)
	}
	if err.Message != "" {
		return fmt.Sprintf("vercel API error %d: %s", err.StatusCode, err.Message)
	}
	return fmt.Sprintf("vercel API error %d", err.StatusCode)
}

func newAPIError(response *http.Response, body []byte) *APIError {
	apiErr := &APIError{
		StatusCode: response.StatusCode,
		RequestID:  response.Header.Get("X-Vercel-Id"),
		Body:       append([]byte(nil), body...),
		Header:     response.Header.Clone(),
	}
	var direct struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Error   *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &direct) == nil {
		apiErr.Code = direct.Code
		apiErr.Message = direct.Message
		if direct.Error != nil {
			if apiErr.Code == "" {
				apiErr.Code = direct.Error.Code
			}
			if apiErr.Message == "" {
				apiErr.Message = direct.Error.Message
			}
		}
	}
	return apiErr
}
