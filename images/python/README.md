# python

`vercel/sandbox/python:3.14` and `vercel/sandbox/python:3.14.10`

Python on top of the [ubuntu](../ubuntu) base image, including its source-built
Git. Python 3.14.10 is built from the verified upstream source archive, independently
of the version available in the Ubuntu archive. The build checks the exact
installed Python, pip, uv, and Git versions, standard-library extensions, and
venv/pip support.

The [universal](../universal) image inherits this Python runtime, pip, and uv.
Their versions are supplied by the
[shared Bake configuration](../README.md#shared-tool-versions): `PYTHON_VERSION`,
`PYTHON_SHA256`, `PIP_VERSION`, and `UV_VERSION`.
Legacy `al-*` images keep their existing versions and are not part of these pins.

To update Python, change `PYTHON_VERSION` and `PYTHON_SHA256` together in
[`docker-bake.hcl`](../docker-bake.hcl). Minor and full-version tags follow the
version: `3.14` and `3.14.10`.
OS libraries remain distro-managed for security updates; tool pins do not freeze
OS packages or transitive dependencies.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

- `git`
- Python 3.14.10 with `python`, `python3`, `pip`, `pip3`, and `venv`
- `uv` and `uvx` (installed via pip)
