---
"sandbox-image-ubuntu": patch
"sandbox-image-node": patch
"sandbox-image-python": patch
"sandbox-image-universal": patch
---

`apt` in the Ubuntu-based images now downloads packages from Ubuntu's mirror on AWS (`us-east-1.ec2.archive.ubuntu.com`) first and falls back to `archive.ubuntu.com`, then `security.ubuntu.com`.
