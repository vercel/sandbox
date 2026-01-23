package main

import (
	_ "embed"
	"encoding/json"
)

type packageJson struct {
	Version string `json:"version"`
}

//go:embed package.json
var packageJsonJson []byte

func getPackageVersion() string {
	var pkg packageJson
	err := json.Unmarshal(packageJsonJson, &pkg)
	if err != nil {
		panic(err)
	}
	return pkg.Version
}
