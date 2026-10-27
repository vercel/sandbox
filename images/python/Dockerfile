FROM base AS builder
USER root
ENV HOME=/root

ARG DEBIAN_FRONTEND=noninteractive
ARG PYTHON_VERSION
ARG PYTHON_SHA256

RUN apt-get update && \
  apt-get install -y --no-install-recommends \
    curl gcc make libarchive-tools \
    libbz2-dev libffi-dev libgdbm-dev libgdbm-compat-dev liblzma-dev \
    libncurses-dev libreadline-dev libsqlite3-dev libssl-dev libzstd-dev \
    uuid-dev zlib1g-dev && \
  rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tar.xz" \
    -o /tmp/python.tar.xz && \
  echo "${PYTHON_SHA256}  /tmp/python.tar.xz" | sha256sum -c - && \
  mkdir /tmp/python && \
  bsdtar -xJf /tmp/python.tar.xz --strip-components=1 -C /tmp/python && \
  cd /tmp/python && \
  ./configure --prefix=/usr/local --with-ensurepip=install && \
  make -j "$(nproc)" && \
  make install && \
  ln -s python3 /usr/local/bin/python && \
  ln -s pip3 /usr/local/bin/pip && \
  rm -rf /tmp/python /tmp/python.tar.xz

FROM base
USER root
ENV HOME=/root

ARG DEBIAN_FRONTEND=noninteractive
ARG PYTHON_VERSION
ARG PIP_VERSION
ARG UV_VERSION
ARG GIT_VERSION

RUN apt-get update && \
  apt-get install -y --no-install-recommends \
    libbz2-1.0 libffi8 libgdbm6t64 libgdbm-compat4t64 liblzma5 \
    libncursesw6 libreadline8t64 libsqlite3-0 libssl3t64 libzstd1 \
    libuuid1 zlib1g && \
  rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local /usr/local

RUN python -m pip install --no-cache-dir --upgrade "pip==${PIP_VERSION}" "uv==${UV_VERSION}"

RUN chown -R ubuntu:ubuntu /vercel

ENV HOME=/vercel
USER ubuntu
WORKDIR /vercel

# User-installed console scripts (pip, uv tool) land in ~/.local/bin.
ENV PATH="/vercel/.local/bin:${PATH}"

RUN git --version | grep -Fx "git version ${GIT_VERSION}" && \
  python --version | grep -Fx "Python ${PYTHON_VERSION}" && \
  python3 --version | grep -Fx "Python ${PYTHON_VERSION}" && \
  python -c 'import bz2, ctypes, curses, dbm.gnu, dbm.ndbm, lzma, readline, sqlite3, ssl, uuid, zlib; from compression import zstd' && \
  python -m venv /tmp/python-smoke && \
  /tmp/python-smoke/bin/python -m pip --version && \
  rm -rf /tmp/python-smoke && \
  pip --version | grep -F "pip ${PIP_VERSION} from " && \
  uv --version && \
  test "$(uv --version | cut -d ' ' -f 1-2)" = "uv ${UV_VERSION}"
