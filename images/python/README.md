# python

Python on top of the [ubuntu](../ubuntu) base image.

| Image tags                                                   | Python version | Bake target  |
| ------------------------------------------------------------ | -------------- | ------------ |
| `vercel/sandbox/python:3.14`                                 | 3.14.8         | `python`     |
| `vercel/sandbox/python:3.15`, `vercel/sandbox/python:3.15.0` | 3.15.0         | `python-315` |

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

- `curl`
- `git`
- `python`, `python3`, and the versioned interpreter (for example, `python3.15`)
- `pip`, `pip3`, and `venv`
- `packaging`, `setuptools`, and `wheel`
- `uv` and `uvx` (installed via pip)
- `media-types`, `netbase`, and `tzdata` (MIME types, network services, and time zones)
- Standard-library extension dependencies, including Berkeley DB for `dbm.ndbm`
