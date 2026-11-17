---
"sandbox-image-python": patch
---

Pin pip, setuptools, wheel, and packaging in the Python 3.14 and 3.15 images, and move their Python versions into `PYTHON_VERSIONS` in `docker-bake.hcl`. pip moves from the 26.2.1 bundled with CPython to 26.3, whose certificate bundle no longer trusts the compromised eMudhra roots.
