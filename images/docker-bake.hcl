variable "REGISTRY" {
  default = "vcr.vercel.com/vercel/sandbox"
}

group "default" {
  targets = ["ubuntu", "node", "python", "universal", "arch", "runtime-node", "runtime-python"]
}

target "_common" {
  platforms = ["linux/amd64"]
  output = [
    "type=image,oci-mediatypes=true,compression=zstd,compression-level=3,force-compression=true"
  ]
}

target "ubuntu" {
  inherits = ["_common"]
  context  = "ubuntu"
  tags     = ["${REGISTRY}/ubuntu:latest"]
}

target "node" {
  matrix = {
    node = [
      {
        major   = "22"
        version = "22.23.2"
      },
      {
        major   = "24"
        version = "24.19.0"
      },
      {
        major   = "26"
        version = "26.7.0"
      },
    ]
  }

  name     = "node-${node.major}"
  inherits = ["_common"]
  context  = "node"
  tags = [
    "${REGISTRY}/node:${node.major}",
    "${REGISTRY}/node:${node.version}",
  ]

  contexts = {
    base = "target:ubuntu"
  }

  args = {
    NODE_VERSION = node.version
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

target "runtime-builder-base" {
  inherits   = ["_common"]
  context    = "runtime-base"
  dockerfile = "Dockerfile"
  target     = "builder-base"
}

target "runtime-base" {
  inherits   = ["_common"]
  context    = "runtime-base"
  dockerfile = "Dockerfile"
  target     = "sandbox-base"

  contexts = {
    src = "."
  }
}

target "runtime-node" {
  matrix = {
    node = [
      {
        major   = "22"
        version = "22.22.2"
      },
      {
        major   = "24"
        version = "24.14.1"
      },
      {
        major   = "26"
        version = "26.1.0"
      },
    ]
  }

  name       = "runtime-node-${node.major}"
  inherits   = ["_common"]
  context    = "runtime-node"
  dockerfile = "Dockerfile"
  tags = [
    "${REGISTRY}/node:al-${node.major}",
    "${REGISTRY}/node:al-${node.version}",
  ]

  contexts = {
    sandbox-base = "target:runtime-base"
  }

  args = {
    NODE_ARCH    = "x64"
    NODE_MAJOR   = node.major
    NODE_VERSION = node.version
  }
}

target "runtime-python" {
  inherits   = ["_common"]
  context    = "runtime-python"
  dockerfile = "Dockerfile"
  tags       = ["${REGISTRY}/python:al-3.13.1"]

  contexts = {
    builder-base = "target:runtime-builder-base"
    sandbox-base = "target:runtime-base"
  }

  args = {
    PYTHON_VERSION = "3.13.1"
  }
}
