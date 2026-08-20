# runtime-python

`vercel/sandbox/runtime-python:3.13.1`

Python on top of the [runtime-base](../runtime-base) image. Python 3.13.1 is
compiled from source and installed under `/vercel/runtimes/python`.

Runs as the `vercel-sandbox` user (uid 1000) with passwordless sudo.

## Packages

- Python 3.13.1
- `pip` and `venv`
- `uv`
- Git 2.49.0
