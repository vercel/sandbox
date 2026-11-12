ARG UBUNTU_IMAGE
FROM ${UBUNTU_IMAGE}

ENV LANG=C.UTF-8

ARG DEBIAN_FRONTEND=noninteractive
ARG UBUNTU_SNAPSHOT
RUN apt-get update --snapshot "${UBUNTU_SNAPSHOT}" -o Acquire::Retries=10 -o Acquire::https::Verify-Peer=false && \
    apt-get install -y --no-install-recommends --snapshot "${UBUNTU_SNAPSHOT}" -o Acquire::Retries=10 -o Acquire::https::Verify-Peer=false ca-certificates && \
    apt-get upgrade -y --snapshot "${UBUNTU_SNAPSHOT}" -o Acquire::Retries=10 && \
    apt-get install -y --no-install-recommends --snapshot "${UBUNTU_SNAPSHOT}" -o Acquire::Retries=10 sudo && \
    rm -rf /var/lib/apt/lists/*

RUN printf '%s\n' \
      'Defaults always_set_home' \
      'Defaults !env_reset' \
      'Defaults !fqdn' \
      'ubuntu ALL=(ALL) NOPASSWD:ALL' \
      > /etc/sudoers.d/sandbox && \
    chmod 0440 /etc/sudoers.d/sandbox && \
    install -d -o ubuntu -g ubuntu /vercel && \
    usermod --home /vercel ubuntu && \
    chown -R ubuntu:ubuntu /vercel

ENV HOME=/vercel
ENV SHELL=/bin/bash
USER ubuntu
WORKDIR /vercel
