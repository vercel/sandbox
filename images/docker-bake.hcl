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
  default = "ubuntu:resolute-20261105.1@sha256:d66b366dac61b575bee2aef07e9c26e8070096fbe84a3d4d3eb0da069b5d76db"
}

variable "UBUNTU_SNAPSHOT" {
  default = "20261123T060000Z"
}

variable "ARCH_IMAGE" {
  default = "archlinux:base-20261108.0.623074@sha256:d4594bb2300cba11f41c2f27923eb56f63d9988909c402f9c95517d1e362c899"
}

variable "AMAZONLINUX_IMAGE" {
  default = "amazonlinux:2023.12.20261117.0@sha256:9cf762f5099b606bcd851391317af7cd75b11363c4816ebcb5e91292dd5736a7"
}

variable "BUN_IMAGE" {
  default = "oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18"
}

variable "NODE_VERSIONS" {
  type = map(string)
  default = {
    "22" = "22.23.5"
    "24" = "24.22.3"
    "26" = "26.13.1"
  }
}

# Each sha256 is the XZ source checksum from the release's page on python.org.
variable "PYTHON_VERSIONS" {
  type = map(object({ version = string, sha256 = string }))
  default = {
    "3.14" = {
      version = "3.14.10"
      sha256  = "de414a57119abef52784d8993e341d53aed635fc2b05c2607d9f98a2c5b72032"
    }
    "3.15" = {
      version = "3.15.2"
      sha256  = "8b5536d280142ecf6cdfe15d12a21ba1c65e300bbf7b28a8d0cdb849575797de"
    }
  }
}

variable "PNPM_VERSION" {
  default = "11.29.0"
}

variable "AL_PNPM_VERSION" {
  default = "10.34.9"
}

variable "UV_VERSION" {
  default = "0.13.9"
}

variable "PIP_VERSION" {
  default = "26.3"
}

variable "SETUPTOOLS_VERSION" {
  default = "84.2.1"
}

variable "WHEEL_VERSION" {
  default = "0.48.0"
}

variable "PACKAGING_VERSION" {
  default = "26.3"
}

variable "AL_GIT_VERSION" {
  default = "2.49.0"
}

variable "GH_VERSION" {
  default = "2.105.0"
}

variable "CLAUDE_CODE_VERSION" {
  default = "2.1.330"
}

variable "CODEX_VERSION" {
  default = "0.171.0"
}

variable "OPENCODE_VERSION" {
  default = "1.19.6"
}

variable "PI_VERSION" {
  default = "1.6.0"
}

variable "FX_VERSION" {
  default = "0.0.17"
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
  matrix = {
    python = [for minor, release in PYTHON_VERSIONS : merge(release, { minor = minor })]
  }

  name     = "python-${replace(python.minor, ".", "")}"
  inherits = ["_common"]
  context  = "python"
  tags     = ["${REGISTRY}/python:${python.minor}${TAG_SUFFIX}"]

  contexts = {
    base = "target:ubuntu"
  }

  args = {
    PACKAGING_VERSION  = PACKAGING_VERSION
    PIP_VERSION        = PIP_VERSION
    PYTHON_SHA256      = python.sha256
    PYTHON_VERSION     = python.version
    SETUPTOOLS_VERSION = SETUPTOOLS_VERSION
    UBUNTU_SNAPSHOT    = UBUNTU_SNAPSHOT
    UV_VERSION         = UV_VERSION
    WHEEL_VERSION      = WHEEL_VERSION
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
    PIP_VERSION    = PIP_VERSION
    PYTHON_VERSION = "3.13.1"
    UV_VERSION     = UV_VERSION
  }
}
