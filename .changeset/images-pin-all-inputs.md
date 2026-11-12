---
"sandbox-image-ubuntu": patch
"sandbox-image-universal": patch
"sandbox-image-node": patch
"sandbox-image-python": patch
"sandbox-image-arch": patch
"sandbox-image-al-base": patch
"sandbox-image-al-node": patch
"sandbox-image-al-python": patch
---

Pin image inputs in `docker-bake.hcl`: base images by digest, tools by exact version, and Ubuntu packages by an Ubuntu archive snapshot.
