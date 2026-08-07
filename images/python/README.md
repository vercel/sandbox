# python

`vercel/sandbox/python:3.14`

Python on top of the [ubuntu](../ubuntu) base image. Pinned to Python 3.14
via the versioned package from the Ubuntu archive; the build fails if the
distro stops shipping that version.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

- Git
- `python3.14` and `python3.14-venv` (pinned versioned packages)
- `python3-pip`
- `python-is-python3` (provides the `python` command)
- `uv` and `uvx` (installed via pip)
