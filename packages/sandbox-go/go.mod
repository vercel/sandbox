module github.com/vercel/sandbox/packages/sandbox-go

go 1.26.1

require (
	github.com/gorilla/websocket v1.5.3
	github.com/spf13/cobra v1.10.1
	github.com/vercel/go-sdk v0.0.0
	golang.org/x/term v0.35.0
)

require (
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/spf13/pflag v1.0.9 // indirect
	golang.org/x/sys v0.36.0 // indirect
)

replace github.com/vercel/go-sdk => ./third_party/go-sdk
