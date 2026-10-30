# python

Python on top of the [ubuntu](../ubuntu) base image.

| Image tags                                                   | Python version | Bake target  |
| ------------------------------------------------------------ | -------------- | ------------ |
| `vercel/sandbox/python:3.14`                                 | 3.14.8         | `python`     |
| `vercel/sandbox/python:3.15`, `vercel/sandbox/python:3.15.0` | 3.15.0         | `python-315` |

Both versions use the same Dockerfile. Set `PYTHON_VERSION` to a full CPython
release version (`major.minor.patch`) to select the interpreter. The build
downloads the corresponding source release from `python.org` over HTTPS and
compiles it in a separate stage, keeping compilers and development headers out
of the runtime image. The interpreter is installed under `/usr/local` without
replacing Ubuntu's system Python.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

- `git`
- `python`, `python3`, and the versioned interpreter (for example, `python3.15`)
- `pip`, `pip3`, and `venv`
- `uv` and `uvx` (installed via pip)

The image build verifies the selected interpreter version, standard-library
extension imports, and virtual environment creation with pip as the `ubuntu`
user.

## Building locally

From the `images` directory:

```sh
docker buildx bake python
docker buildx bake python-315

# Select another release using only PYTHON_VERSION.
# Override tags too when loading or publishing a custom version.
docker buildx bake python --set python.args.PYTHON_VERSION=3.15.0 --set python.tags=python-local:3.15.0
```

The default and `vmi` groups build both versions. Adding a release does not
require a new Dockerfile; configure its version and tags in `docker-bake.hcl`.
