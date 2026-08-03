variable "REGISTRY" {
  default = "vcr.vercel.com/vercel/sandbox"
}

group "default" {
  targets = ["ubuntu", "node", "python", "universal", "arch"]
}

target "_common" {
  platforms = ["linux/amd64"]
}

target "ubuntu" {
  inherits = ["_common"]
  context  = "ubuntu"
  tags     = ["${REGISTRY}/ubuntu:latest"]
}

target "node" {
  matrix = {
    major = ["22", "24", "26"]
  }

  name     = "node-${major}"
  inherits = ["_common"]
  context  = "node"
  tags     = ["${REGISTRY}/node:${major}"]

  contexts = {
    base = "target:ubuntu"
  }

  args = {
    NODE_MAJOR = major
  }
}

target "python" {
  inherits = ["_common"]
  context  = "python"
  tags     = ["${REGISTRY}/python:3.14"]

  contexts = {
    base = "target:ubuntu"
  }

  args = {
    PYTHON_VERSION = "3.14"
  }
}

target "universal" {
  inherits = ["_common"]
  context  = "universal"
  tags     = ["${REGISTRY}/universal:latest"]

  contexts = {
    base = "target:ubuntu"
  }

  args = {
    NODE_MAJOR     = "24"
    PYTHON_VERSION = "3.14"
  }
}

target "arch" {
  inherits = ["_common"]
  context  = "arch"
  tags     = ["${REGISTRY}/arch:latest"]
}
