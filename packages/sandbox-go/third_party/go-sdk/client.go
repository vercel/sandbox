package vercel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const defaultBaseURL = "https://api.vercel.com"

// Client is a concurrency-safe Vercel REST API client.
type Client struct {
	baseURL    *url.URL
	httpClient *http.Client
	token      string
	userAgent  string
	retry      RetryConfig
}

// Option configures a Client.
type Option func(*Client) error

// RequestOption configures one API request.
type RequestOption func(*requestOptions)

type requestOptions struct {
	retry *RetryConfig
}

// RetryConfig controls retries for idempotent requests.
type RetryConfig struct {
	MaxAttempts int
	MinDelay    time.Duration
	MaxDelay    time.Duration
	StatusCodes map[int]bool
}

// NewClient constructs a Vercel client.
func NewClient(options ...Option) (*Client, error) {
	baseURL, _ := url.Parse(defaultBaseURL)
	client := &Client{
		baseURL:    baseURL,
		httpClient: http.DefaultClient,
		userAgent:  "vercel-go/0.1.0",
		retry: RetryConfig{
			MaxAttempts: 3,
			MinDelay:    250 * time.Millisecond,
			MaxDelay:    4 * time.Second,
			StatusCodes: map[int]bool{429: true, 500: true, 502: true, 503: true, 504: true},
		},
	}
	for _, option := range options {
		if err := option(client); err != nil {
			return nil, err
		}
	}
	return client, nil
}

// WithBearerToken authenticates requests with an HTTP bearer token.
func WithBearerToken(token string) Option {
	return func(client *Client) error {
		client.token = token
		return nil
	}
}

// WithBaseURL overrides the Vercel API base URL.
func WithBaseURL(rawURL string) Option {
	return func(client *Client) error {
		parsed, err := url.Parse(rawURL)
		if err != nil {
			return fmt.Errorf("parse base URL: %w", err)
		}
		if parsed.Scheme == "" || parsed.Host == "" {
			return fmt.Errorf("base URL must be absolute: %q", rawURL)
		}
		client.baseURL = parsed
		return nil
	}
}

// WithHTTPClient uses the supplied HTTP client.
func WithHTTPClient(httpClient *http.Client) Option {
	return func(client *Client) error {
		if httpClient == nil {
			return errors.New("HTTP client must not be nil")
		}
		client.httpClient = httpClient
		return nil
	}
}

// WithUserAgent overrides the default User-Agent header.
func WithUserAgent(userAgent string) Option {
	return func(client *Client) error {
		client.userAgent = userAgent
		return nil
	}
}

// WithRetryConfig changes the default retry policy.
func WithRetryConfig(config RetryConfig) Option {
	return func(client *Client) error {
		if config.MaxAttempts < 1 {
			return errors.New("retry MaxAttempts must be at least 1")
		}
		client.retry = config
		return nil
	}
}

// WithRequestRetryConfig overrides retries for one request.
func WithRequestRetryConfig(config RetryConfig) RequestOption {
	return func(options *requestOptions) { options.retry = &config }
}

// Request describes a generated API operation.
type Request struct {
	Method  string
	Path    string
	Query   url.Values
	Headers http.Header
	Body    any
}

// Do executes an API request and decodes its JSON response into output.
func (client *Client) Do(ctx context.Context, input Request, output any, options ...RequestOption) error {
	if client == nil {
		return errors.New("vercel client is nil")
	}
	requestOptions := requestOptions{}
	for _, option := range options {
		option(&requestOptions)
	}
	retry := client.retry
	if requestOptions.retry != nil {
		retry = *requestOptions.retry
	}
	if retry.MaxAttempts < 1 {
		retry.MaxAttempts = 1
	}

	var bodyBytes []byte
	var err error
	if input.Body != nil {
		bodyBytes, err = json.Marshal(input.Body)
		if err != nil {
			return fmt.Errorf("encode request body: %w", err)
		}
	}

	for attempt := 1; attempt <= retry.MaxAttempts; attempt++ {
		response, requestErr := client.doOnce(ctx, input, bodyBytes)
		if requestErr != nil {
			if attempt == retry.MaxAttempts || !isIdempotent(input.Method) {
				return requestErr
			}
			if err := waitForRetry(ctx, retryDelay(retry, attempt, "")); err != nil {
				return err
			}
			continue
		}

		responseBody, readErr := io.ReadAll(response.Body)
		closeErr := response.Body.Close()
		if readErr != nil {
			return fmt.Errorf("read response: %w", readErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close response: %w", closeErr)
		}
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			if output == nil || len(responseBody) == 0 {
				return nil
			}
			if err := json.Unmarshal(responseBody, output); err != nil {
				return fmt.Errorf("decode response: %w", err)
			}
			return nil
		}

		apiErr := newAPIError(response, responseBody)
		if attempt == retry.MaxAttempts || !isIdempotent(input.Method) || !retry.StatusCodes[response.StatusCode] {
			return apiErr
		}
		if err := waitForRetry(ctx, retryDelay(retry, attempt, response.Header.Get("Retry-After"))); err != nil {
			return err
		}
	}
	return errors.New("request attempts exhausted")
}

func (client *Client) doOnce(ctx context.Context, input Request, body []byte) (*http.Response, error) {
	relative, err := url.Parse(input.Path)
	if err != nil {
		return nil, fmt.Errorf("parse request path: %w", err)
	}
	endpoint := client.baseURL.ResolveReference(relative)
	endpoint.RawQuery = input.Query.Encode()
	request, err := http.NewRequestWithContext(ctx, input.Method, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	for key, values := range input.Headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", client.userAgent)
	if input.Body != nil && request.Header.Get("Content-Type") == "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if client.token != "" {
		request.Header.Set("Authorization", "Bearer "+client.token)
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("execute request: %w", err)
	}
	return response, nil
}

func isIdempotent(method string) bool {
	switch strings.ToUpper(method) {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodPut, http.MethodDelete:
		return true
	default:
		return false
	}
}

func retryDelay(config RetryConfig, attempt int, retryAfter string) time.Duration {
	if seconds, err := strconv.Atoi(retryAfter); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	minimum := config.MinDelay
	if minimum <= 0 {
		minimum = 250 * time.Millisecond
	}
	maximum := config.MaxDelay
	if maximum <= 0 {
		maximum = 4 * time.Second
	}
	delay := time.Duration(float64(minimum) * math.Pow(2, float64(attempt-1)))
	if delay > maximum {
		delay = maximum
	}
	jitter := time.Duration(rand.Int64N(max(1, int64(delay/4))))
	return delay + jitter
}

func waitForRetry(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
