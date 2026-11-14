variable "REGISTRY" {
  default = "vcr.vercel.com/vercel/sandbox"
}

variable "TAG_SUFFIX" {
  default = ""
}

variable "PUSH" {
  default = false
}

variable "UBUNTU_IMAGE" {
  default = "ubuntu:resolute-20261105.1@sha256:66b8084a0d45bd4877992bd38e04b51bfa99bd57293364cb6391fb674771846e"
}

variable "UBUNTU_SNAPSHOT" {
  default = "20261114T060000Z"
}

variable "ARCH_IMAGE" {
  default = "archlinux:base-20261108.0.623074@sha256:d4594bb2300cba11f41c2f27923eb56f63d9988909c402f9c95517d1e362c899"
}

variable "AMAZONLINUX_IMAGE" {
  default = "amazonlinux:2023.12.20261102.0@sha256:3ccfbe800f864982b0a4e124a614b2382518cbd04b3c1cd35202bd46f392675b"
}

variable "BUN_IMAGE" {
  default = "oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d"
}

variable "NODE_VERSIONS" {
  type = map(string)
  default = {
    "22" = "22.23.5"
    "24" = "24.22.3"
    "26" = "26.13.1"
  }
}

variable "PNPM_VERSION" {
  default = "11.28.12"
}

variable "AL_PNPM_VERSION" {
  default = "10.34.9"
}

variable "UV_VERSION" {
  default = "0.13.8"
}

variable "AL_PIP_VERSION" {
  default = "26.3"
}

variable "AL_GIT_VERSION" {
  default = "2.49.0"
}

variable "GH_VERSION" {
  default = "2.104.0"
}

variable "CLAUDE_CODE_VERSION" {
  default = "2.1.325"
}

variable "CODEX_VERSION" {
  default = "0.169.0"
}

variable "OPENCODE_VERSION" {
  default = "1.19.5"
}

variable "PI_VERSION" {
  default = "1.5.2"
}

variable "FX_VERSION" {
  default = "0.0.16"
}

variable "YAY_BIN_COMMIT" {
  default = "a2812a593d4017a657bbedf98761db78072b5e4c"
}

group "default" {
  targets = ["runtimes", "vmi"]
}

group "runtimes" {
  targets = ["al-node", "al-python"]
}

group "vmi" {
  targets = ["ubuntu", "node", "python", "python-315", "universal", "arch"]
}

target "_common" {
  platforms = ["linux/amd64"]
  attest = [
    "type=provenance,disabled=true",
    "type=sbom,disabled=true"
  ]
  output = [
    "type=image,push=${PUSH},oci-mediatypes=true,compression=zstd,compression-level=3,force-compression=true"
  ]
}

target "ubuntu" {
  inherits = ["_common"]
  context  = "ubuntu"
  tags     = ["${REGISTRY}/ubuntu:latest${TAG_SUFFIX}"]

  args = {
    UBUNTU_IMAGE    = UBUNTU_IMAGE
    UBUNTU_SNAPSHOT = UBUNTU_SNAPSHOT
  }
}

target "node" {
  matrix = {
    node = [for major, version in NODE_VERSIONS : { major = major, version = version }]
  }

  name     = "node-${node.major}"
  inherits = ["_common"]
  context  = "node"
  tags = [
    "${REGISTRY}/node:${node.major}${TAG_SUFFIX}",
    "${REGISTRY}/node:${node.version}${TAG_SUFFIX}",
  ]

  contexts = {
    base = "target:ubuntu"
  }

  args = {
    NODE_VERSION    = node.version
    PNPM_VERSION    = PNPM_VERSION
    UBUNTU_SNAPSHOT = UBUNTU_SNAPSHOT
  }
}

target "python" {
  inherits = ["_common"]
  context  = "python"
  tags     = ["${REGISTRY}/python:3.14${TAG_SUFFIX}"]

  contexts = {
    base = "target:ubuntu"
  }

  args = {
    # XZ source checksum: https://www.python.org/downloads/release/python-3148/
    PYTHON_VERSION = "3.14.8"
    PYTHON_SHA256  = "c2215904f02b175596dc49351585104f4bc20341e1c47378b26a2c274360ce73"
    UBUNTU_SNAPSHOT = UBUNTU_SNAPSHOT
    UV_VERSION      = UV_VERSION
  }
}

target "python-315" {
  inherits = ["_common"]
  context  = "python"
  tags = ["${REGISTRY}/python:3.15${TAG_SUFFIX}"]

  contexts = {
    base = "target:ubuntu"
  }

  args = {
    # XZ source checksum: https://www.python.org/downloads/release/python-3150/
    PYTHON_VERSION = "3.15.0"
    PYTHON_SHA256  = "ba4bed1ba346b916890b76d9e320451420aa69f6408997d33c66482eeae3d575"
    UBUNTU_SNAPSHOT = UBUNTU_SNAPSHOT
    UV_VERSION      = UV_VERSION
  }
}

target "universal" {
  inherits = ["_common"]
  context  = "universal"
  tags     = ["${REGISTRY}/universal:latest${TAG_SUFFIX}"]

  contexts = {
    base = "target:ubuntu"
    bun  = "docker-image://${BUN_IMAGE}"
  }

  args = {
    CLAUDE_CODE_VERSION = CLAUDE_CODE_VERSION
    CODEX_VERSION       = CODEX_VERSION
    FX_VERSION          = FX_VERSION
    GH_VERSION          = GH_VERSION
    NODE_VERSION        = NODE_VERSIONS["24"]
    OPENCODE_VERSION    = OPENCODE_VERSION
    PI_VERSION          = PI_VERSION
    PNPM_VERSION        = PNPM_VERSION
    PYTHON_VERSION      = "3.14"
    UBUNTU_SNAPSHOT     = UBUNTU_SNAPSHOT
    UV_VERSION          = UV_VERSION
  }
}

target "arch" {
  inherits = ["_common"]
  context  = "arch"
  tags     = ["${REGISTRY}/arch:latest${TAG_SUFFIX}"]

  args = {
    ARCH_IMAGE     = ARCH_IMAGE
    YAY_BIN_COMMIT = YAY_BIN_COMMIT
  }
}

target "al-builder-base" {
  inherits   = ["_common"]
  context    = "al-base"
  dockerfile = "Dockerfile"
  target     = "builder-base"

  args = {
    AMAZONLINUX_IMAGE = AMAZONLINUX_IMAGE
  }
}

target "al-base" {
  inherits   = ["_common"]
  context    = "al-base"
  dockerfile = "Dockerfile"
  target     = "sandbox-base"

  contexts = {
    src = "al-base"
  }

  args = {
    AMAZONLINUX_IMAGE = AMAZONLINUX_IMAGE
    GIT_VERSION       = AL_GIT_VERSION
  }
}

target "al-node" {
  matrix = {
    node = [for major, version in NODE_VERSIONS : { major = major, version = version }]
  }

  name       = "al-node-${node.major}"
  inherits   = ["_common"]
  context    = "al-node"
  dockerfile = "Dockerfile"
  tags = [
    "${REGISTRY}/node:al-${node.major}${TAG_SUFFIX}",
    "${REGISTRY}/node:al-${node.version}${TAG_SUFFIX}",
  ]

  contexts = {
    sandbox-base = "target:al-base"
  }

  args = {
    NODE_ARCH    = "x64"
    NODE_MAJOR   = node.major
    NODE_VERSION = node.version
    PNPM_VERSION = AL_PNPM_VERSION
  }
}

target "al-python" {
  inherits   = ["_common"]
  context    = "al-python"
  dockerfile = "Dockerfile"
  tags       = ["${REGISTRY}/python:al-3.13.1${TAG_SUFFIX}"]

  contexts = {
    builder-base = "target:al-builder-base"
    sandbox-base = "target:al-base"
  }

  args = {
    PIP_VERSION    = AL_PIP_VERSION
    PYTHON_VERSION = "3.13.1"
    UV_VERSION     = UV_VERSION
  }
}
