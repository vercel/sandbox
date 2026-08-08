variable "REGISTRY" {
  default = "vcr.vercel.com/vercel/sandbox"
}

group "default" {
  targets = ["ubuntu", "node", "python", "universal", "arch"]
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
