FROM base AS builder
USER root
ENV HOME=/root

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      build-essential curl libarchive-tools pkg-config \
      libbz2-dev libffi-dev liblzma-dev libmpdec-dev libncurses-dev libreadline-dev \
      libsqlite3-dev libssl-dev libzstd-dev uuid-dev zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*

ARG PYTHON_VERSION

# Build separately so compilers and headers are not shipped in the runtime image.
RUN curl -fsSL "https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tar.xz" -o /tmp/python.tar.xz && \
    mkdir /tmp/python && \
    bsdtar -xJf /tmp/python.tar.xz --strip-components=1 -C /tmp/python && \
    cd /tmp/python && \
    ./configure --prefix=/usr/local --with-ensurepip=install && \
    make -j "$(nproc)" && \
    make install && \
    ln -s python3 /usr/local/bin/python && \
    ln -s pip3 /usr/local/bin/pip

FROM base
USER root
ENV HOME=/root

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git libbz2-1.0 libffi8 liblzma5 libmpdec4 libncursesw6 libreadline8t64 \
      libsqlite3-0 libssl3t64 libuuid1 libzstd1 zlib1g && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local /usr/local

RUN python -m pip install --no-cache-dir uv && \
    chown -R ubuntu:ubuntu /vercel

ENV HOME=/vercel
USER ubuntu
WORKDIR /vercel

# User-installed console scripts (pip, uv tool) land in ~/.local/bin.
ENV PATH="/vercel/.local/bin:${PATH}"

ARG PYTHON_VERSION
RUN git --version && \
    python -c "import platform; assert platform.python_version() == '${PYTHON_VERSION}'" && \
    python3 --version && \
    "python${PYTHON_VERSION%.*}" --version && \
    python -c "import _decimal, bz2, ctypes, curses, lzma, readline, sqlite3, ssl, uuid, zlib; from compression import zstd" && \
    pip --version && \
    pip3 --version && \
    uv --version && \
    uvx --version && \
    python -m venv /tmp/python-venv && \
    /tmp/python-venv/bin/python -c "import platform; assert platform.python_version() == '${PYTHON_VERSION}'" && \
    /tmp/python-venv/bin/python -m pip --version && \
    rm -rf /tmp/python-venv
