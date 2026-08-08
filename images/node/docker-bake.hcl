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
