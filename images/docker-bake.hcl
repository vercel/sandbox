group "default" {
  targets = ["ubuntu", "node", "python", "universal", "arch"]
}

target "_common" {
  platforms = ["linux/amd64"]
}

target "ubuntu" {
  inherits = ["_common"]
  context  = "ubuntu"
  tags     = ["vercel/sandbox/ubuntu:latest"]
}

target "node" {
  matrix = {
    major = ["22", "24", "26"]
  }

  name     = "node-${major}"
  inherits = ["_common"]
  context  = "node"
  tags     = ["vercel/sandbox/node:${major}"]

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
  tags     = ["vercel/sandbox/python:3.14"]

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
  tags     = ["vercel/sandbox/universal:latest"]

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
  tags     = ["vercel/sandbox/arch:latest"]
}
