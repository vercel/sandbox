variable "REGISTRY" {
  default = "vcr.vercel.com/vercel/sandbox"
}

variable "TAG_SUFFIX" {
  default = ""
}

variable "PUSH" {
  default = false
}

# Shared tool versions. Update archive checksums together with their versions.
# OS packages remain distro-managed so security updates are not frozen here.
variable "NODE_VERSIONS" {
  type = map(string)
  default = {
    "22" = "22.23.4"
    "24" = "24.22.1"
    "26" = "26.12.1"
  }
}

variable "NODE_LTS_MAJOR" {
  default = "24"
}

variable "PYTHON_VERSION" {
  default = "3.14.10"
}

variable "PYTHON_SHA256" {
  default = "de414a57119abef52784d8993e341d53aed635fc2b05c2607d9f98a2c5b72032"
}

variable "PIP_VERSION" {
  default = "26.2.2"
}

variable "UV_VERSION" {
  default = "0.13.6"
}

variable "PNPM_VERSION" {
  default = "12.15.0"
}

variable "BUN_VERSION" {
  default = "1.4.4"
}

variable "GIT_VERSION" {
  default = "2.56.0"
}

variable "GIT_SHA256" {
  default = "26c56c296b38c0695b26fa95f475f1d01704d2d38e73465ca30b0b2f5dc789d3"
}

variable "GIT_LFS_VERSION" {
  default = "3.8.1"
}

variable "GIT_LFS_SHA256" {
  default = "e72cf723a4a660438862282e8aecf3885fc8123e88bfcad534cf6b941a354b75"
}

variable "GH_VERSION" {
  default = "2.103.3"
}

variable "GH_SHA256" {
  default = "4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d"
}

variable "CLAUDE_CODE_VERSION" {
  default = "2.1.311"
}

variable "CODEX_VERSION" {
  default = "0.164.0"
}

variable "OPENCODE_VERSION" {
  default = "1.19.4"
}

variable "PI_VERSION" {
  default = "1.4.0"
}

variable "FX_VERSION" {
  default = "0.0.14"
}

variable "YAY_VERSION" {
  default = "13.0.1"
}

variable "YAY_SHA256" {
  default = "1fdfcb5f7f387bc858d3a5754bdf4e4575bfbddac9560535a716d0ed7189c057"
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

target "_versioned" {
  inherits = ["_common"]
  # Shared only by maintained VMIs; legacy al-* targets keep their own versions.
  args = {
    PYTHON_VERSION      = PYTHON_VERSION
    PYTHON_SHA256       = PYTHON_SHA256
    PIP_VERSION         = PIP_VERSION
    UV_VERSION          = UV_VERSION
    PNPM_VERSION        = PNPM_VERSION
    BUN_VERSION         = BUN_VERSION
    GIT_VERSION         = GIT_VERSION
    GIT_SHA256          = GIT_SHA256
    GIT_LFS_VERSION     = GIT_LFS_VERSION
    GIT_LFS_SHA256      = GIT_LFS_SHA256
    GH_VERSION          = GH_VERSION
    GH_SHA256           = GH_SHA256
    CLAUDE_CODE_VERSION = CLAUDE_CODE_VERSION
    CODEX_VERSION       = CODEX_VERSION
    OPENCODE_VERSION    = OPENCODE_VERSION
    PI_VERSION          = PI_VERSION
    FX_VERSION          = FX_VERSION
    YAY_VERSION         = YAY_VERSION
    YAY_SHA256          = YAY_SHA256
  }
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
  inherits = ["_versioned"]
  context  = "ubuntu"
  tags     = ["${REGISTRY}/ubuntu:latest${TAG_SUFFIX}"]
}

target "node" {
  matrix = {
    node = [for major, version in NODE_VERSIONS : { major = major, version = version }]
  }

  name     = "node-${node.major}"
  inherits = ["_versioned"]
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
  }
}

target "python" {
  inherits = ["_versioned"]
  context  = "python"
  tags = [
    "${REGISTRY}/python:${join(".", slice(split(".", PYTHON_VERSION), 0, 2))}${TAG_SUFFIX}",
    "${REGISTRY}/python:${PYTHON_VERSION}${TAG_SUFFIX}",
  ]

  contexts = {
    base = "target:ubuntu"
  }
}

target "universal" {
  inherits = ["_versioned"]
  context  = "universal"
  tags     = ["${REGISTRY}/universal:latest${TAG_SUFFIX}"]

  contexts = {
    base = "target:python"
    bun  = "docker-image://oven/bun:${BUN_VERSION}"
  }

  args = {
    NODE_VERSION = NODE_VERSIONS[NODE_LTS_MAJOR]
  }
}

target "arch" {
  inherits = ["_versioned"]
  context  = "arch"
  tags     = ["${REGISTRY}/arch:latest${TAG_SUFFIX}"]
}

target "al-builder-base" {
  inherits   = ["_common"]
  context    = "al-base"
  dockerfile = "Dockerfile"
  target     = "builder-base"
}

target "al-base" {
  inherits   = ["_common"]
  context    = "al-base"
  dockerfile = "Dockerfile"
  target     = "sandbox-base"

  contexts = {
    src = "al-base"
  }
}

target "al-node" {
  matrix = {
    node = [
      {
        major   = "22"
        version = "22.23.4"
      },
      {
        major   = "24"
        version = "24.22.1"
      },
      {
        major   = "26"
        version = "26.12.1"
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
    PYTHON_VERSION = "3.13.1"
  }
}
