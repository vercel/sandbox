# python

Python on top of the [ubuntu](../ubuntu) base image.

| Image tags                                                   | Python source                                | Bake target  |
| ------------------------------------------------------------ | -------------------------------------------- | ------------ |
| `vercel/sandbox/python:3.14`                                 | Versioned Ubuntu archive package             | `python`     |
| `vercel/sandbox/python:3.15`, `vercel/sandbox/python:3.15.0` | CPython 3.15.0 source, verified with SHA-256 | `python-315` |

Python 3.14 is pinned via the versioned package from the Ubuntu archive;
the build fails if the distro stops shipping that version.

Python 3.15 is compiled from the [official CPython source release](https://www.python.org/downloads/release/python-3150/)
in a separate build stage, keeping compilers and development headers out of the
runtime image. The interpreter is installed under `/usr/local` without replacing
Ubuntu's system Python. Update both `PYTHON_VERSION` and `PYTHON_SHA256` when
updating the source release.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

Both versions include `git`, `pip`, `venv`, `uv`, and `uvx`, with `python` and
`python3` pointing to the selected interpreter.

- Python 3.14 uses `python3.14`, `python3.14-venv`, `python3-pip`, and
  `python-is-python3` from Ubuntu.
- Python 3.15 provides `python3.15`, `pip`, and `pip3` from the source build.
  The image build verifies the interpreter version, standard-library extension
  imports, and virtual environment creation with pip as the `ubuntu` user.
- `uv` and `uvx` are installed via pip in both images.

## Building locally

From the `images` directory:

```sh
docker buildx bake python-315
```

The existing `docker buildx bake python` target continues to build Python 3.14.
The default and `vmi` groups build both versions.
