FROM base AS builder
USER root
ENV HOME=/root

ARG DEBIAN_FRONTEND=noninteractive
ARG UBUNTU_SNAPSHOT
RUN apt-get update --snapshot "${UBUNTU_SNAPSHOT}" -o Acquire::Retries=10 && \
    apt-get install -y --no-install-recommends --snapshot "${UBUNTU_SNAPSHOT}" -o Acquire::Retries=10 \
      build-essential curl libarchive-tools pkg-config \
      libbz2-dev libdb-dev libffi-dev liblzma-dev libmpdec-dev libncurses-dev libreadline-dev \
      libsqlite3-dev libssl-dev libzstd-dev uuid-dev zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*

ARG PYTHON_VERSION
ARG PYTHON_SHA256

# Build separately so compilers and headers are not shipped in the runtime image.
# Require a repository-pinned digest before downloading or extracting sources.
RUN test -n "${PYTHON_SHA256}" && \
    curl -fsSL "https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tar.xz" -o /tmp/python.tar.xz && \
    printf '%s  /tmp/python.tar.xz\n' "${PYTHON_SHA256}" | sha256sum --check --strict && \
    mkdir /tmp/python && \
    bsdtar -xJf /tmp/python.tar.xz --strip-components=1 -C /tmp/python && \
    cd /tmp/python && \
    ./configure --prefix=/usr/local --with-ensurepip=install --disable-test-modules --enable-loadable-sqlite-extensions && \
    make -j "$(nproc)" && \
    make install && \
    ln -s python3 /usr/local/bin/python && \
    ln -s pip3 /usr/local/bin/pip

FROM base
USER root
ENV HOME=/root

ARG DEBIAN_FRONTEND=noninteractive
ARG UBUNTU_SNAPSHOT
ARG UV_VERSION
RUN apt-get update --snapshot "${UBUNTU_SNAPSHOT}" -o Acquire::Retries=10 && \
    apt-get install -y --no-install-recommends --snapshot "${UBUNTU_SNAPSHOT}" -o Acquire::Retries=10 \
      curl git libbz2-1.0 libdb5.3t64 libffi8 liblzma5 libmpdec4 libncursesw6 libreadline8t64 \
      libsqlite3-0 libssl3t64 libuuid1 libzstd1 media-types netbase tzdata zlib1g && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local /usr/local

ARG PACKAGING_VERSION
ARG PIP_VERSION
ARG SETUPTOOLS_VERSION
ARG WHEEL_VERSION
RUN python -m pip install --no-cache-dir \
      "pip==${PIP_VERSION}" \
      "packaging==${PACKAGING_VERSION}" \
      "setuptools==${SETUPTOOLS_VERSION}" \
      "wheel==${WHEEL_VERSION}" \
      "uv==${UV_VERSION}" && \
    chown -R ubuntu:ubuntu /vercel

ENV HOME=/vercel
USER ubuntu
WORKDIR /vercel

# User-installed console scripts (pip, uv tool) land in ~/.local/bin.
ENV PATH="/vercel/.local/bin:${PATH}"

ARG PYTHON_VERSION
RUN curl --version && \
    git --version && \
    python -c "import platform; assert platform.python_version() == '${PYTHON_VERSION}'" && \
    python3 --version && \
    "python${PYTHON_VERSION%.*}" --version && \
    python -c "import _decimal, bz2, ctypes, curses, dbm.ndbm, lzma, readline, sqlite3, ssl, uuid, zlib; from compression import zstd" && \
    python -c "import sqlite3, unittest; t = unittest.TestCase(); c = sqlite3.connect(':memory:'); c.enable_load_extension(True); t.assertRaisesRegex(sqlite3.OperationalError, 'cannot open shared object file', c.load_extension, '/nonexistent/ext'); c.enable_load_extension(False); t.assertRaisesRegex(sqlite3.OperationalError, 'not authorized', c.load_extension, '/nonexistent/ext')" && \
    python -c "import packaging, setuptools, wheel; from zoneinfo import ZoneInfo; ZoneInfo('America/New_York'); import socket; assert socket.getservbyname('https', 'tcp') == 443; from pathlib import Path; assert Path('/etc/mime.types').is_file()" && \
    python -c "from importlib.util import find_spec; assert find_spec('test') is None; assert find_spec('_testcapi') is None" && \
    pip --version && \
    pip3 --version && \
    uv --version && \
    uvx --version && \
    python -m venv /tmp/python-venv && \
    /tmp/python-venv/bin/python -c "import platform; assert platform.python_version() == '${PYTHON_VERSION}'" && \
    /tmp/python-venv/bin/python -m pip --version && \
    rm -rf /tmp/python-venv
