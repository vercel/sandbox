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
  default = "ubuntu:resolute-20261024.1@sha256:6a06111c3b0a8600feadb270aec771dc239bf407b25625f93f44ab00e11f4d3c"
}

variable "ARCH_IMAGE" {
  default = "archlinux:base-20261101.0.620205@sha256:b1c2fe6e717bfd5673af8fc217e1e1c3ce0dcbb1d53c3414c8425e7ce79fc6d9"
}

variable "AMAZONLINUX_IMAGE" {
  default = "amazonlinux:2023.12.20261102.0@sha256:3ccfbe800f864982b0a4e124a614b2382518cbd04b3c1cd35202bd46f392675b"
}

variable "BUN_IMAGE" {
  default = "oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d"
}

variable "NODE_22_VERSION" {
  default = "22.23.4"
}

variable "NODE_24_VERSION" {
  default = "24.22.1"
}

variable "NODE_26_VERSION" {
  default = "26.12.1"
}

variable "PNPM_VERSION" {
  default = "11.28.10"
}

variable "AL_PNPM_VERSION" {
  default = "10.34.9"
}

variable "UV_VERSION" {
  default = "0.13.7"
}

variable "AL_PIP_VERSION" {
  default = "26.3"
}

variable "GH_VERSION" {
  default = "2.103.3"
}

variable "CLAUDE_CODE_VERSION" {
  default = "2.1.317"
}

variable "CODEX_VERSION" {
  default = "0.166.0"
}

variable "OPENCODE_VERSION" {
  default = "1.19.5"
}

variable "PI_VERSION" {
  default = "1.5.0"
}

variable "FX_VERSION" {
  default = "0.0.14"
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
  targets = ["ubuntu", "node", "python", "universal", "arch"]
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
    UBUNTU_IMAGE = UBUNTU_IMAGE
  }
}

target "node" {
  matrix = {
    node = [
      {
        major   = "22"
        version = NODE_22_VERSION
      },
      {
        major   = "24"
        version = NODE_24_VERSION
      },
      {
        major   = "26"
        version = NODE_26_VERSION
      },
    ]
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
    NODE_VERSION = node.version
    PNPM_VERSION = PNPM_VERSION
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
    PYTHON_VERSION = "3.14"
    UV_VERSION     = UV_VERSION
  }
}

target "universal" {
  inherits = ["_common"]
  context  = "universal"
  tags     = ["${REGISTRY}/universal:latest${TAG_SUFFIX}"]

  contexts = {
    base = "target:ubuntu"
  }

  args = {
    BUN_IMAGE           = BUN_IMAGE
    CLAUDE_CODE_VERSION = CLAUDE_CODE_VERSION
    CODEX_VERSION       = CODEX_VERSION
    FX_VERSION          = FX_VERSION
    GH_VERSION          = GH_VERSION
    NODE_VERSION        = NODE_24_VERSION
    OPENCODE_VERSION    = OPENCODE_VERSION
    PI_VERSION          = PI_VERSION
    PNPM_VERSION        = PNPM_VERSION
    PYTHON_VERSION      = "3.14"
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
  }
}

target "al-node" {
  matrix = {
    node = [
      {
        major   = "22"
        version = NODE_22_VERSION
      },
      {
        major   = "24"
        version = NODE_24_VERSION
      },
      {
        major   = "26"
        version = NODE_26_VERSION
      },
    ]
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
