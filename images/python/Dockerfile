FROM base
USER root
ENV HOME=/root

ARG DEBIAN_FRONTEND=noninteractive
ARG UBUNTU_SNAPSHOT
ARG PYTHON_VERSION=3.14
ARG UV_VERSION

RUN apt-get update --snapshot "${UBUNTU_SNAPSHOT}" && \
  apt-get install -y --no-install-recommends --snapshot "${UBUNTU_SNAPSHOT}" \
  curl \
  git \
  "python${PYTHON_VERSION}" \
  "python${PYTHON_VERSION}-venv" \
  python3-pip \
  python-is-python3 && \
  rm -f /usr/lib/python3*/EXTERNALLY-MANAGED && \
  rm -rf /var/lib/apt/lists/* && \
  pip install "uv==${UV_VERSION}" && \
  rm -rf /root/.cache/pip

RUN chown -R ubuntu:ubuntu /vercel

ENV HOME=/vercel
USER ubuntu
WORKDIR /vercel

# User-installed console scripts (pip, uv tool) land in ~/.local/bin.
ENV PATH="/vercel/.local/bin:${PATH}"

RUN curl --version && \
  git --version && \
  python --version | grep -F "Python ${PYTHON_VERSION}." && \
  python3 --version && \
  pip --version && \
  uv --version
