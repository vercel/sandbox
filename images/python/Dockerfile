FROM base
USER root
ENV HOME=/root

ARG DEBIAN_FRONTEND=noninteractive
ARG PYTHON_VERSION=3.14

RUN apt-get update && \
  apt-get install -y --no-install-recommends \
  git \
  "python${PYTHON_VERSION}" \
  "python${PYTHON_VERSION}-venv" \
  python3-pip \
  python-is-python3 && \
  rm -f /usr/lib/python3*/EXTERNALLY-MANAGED && \
  rm -rf /var/lib/apt/lists/* && \
  pip install uv && \
  rm -rf /root/.cache/pip

RUN chown -R ubuntu:ubuntu /vercel

ENV HOME=/vercel
USER ubuntu
WORKDIR /vercel

# User-installed console scripts (pip, uv tool) land in ~/.local/bin.
ENV PATH="/vercel/.local/bin:${PATH}"

RUN git --version && \
  python --version | grep -F "Python ${PYTHON_VERSION}." && \
  python3 --version && \
  pip --version && \
  uv --version
