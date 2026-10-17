package main

import (
	"os"

	"github.com/vercel/sandbox/packages/sandbox-go/internal/cmd"
)

func main() {
	os.Exit(cmd.Execute())
}
