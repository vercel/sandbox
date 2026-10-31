FROM ubuntu:26.04 AS git-builder

ARG DEBIAN_FRONTEND=noninteractive
ARG GIT_VERSION
ARG GIT_SHA256

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      build-essential ca-certificates cargo curl libarchive-tools rustc \
      libcurl4-openssl-dev libexpat1-dev libpcre2-dev libssl-dev perl zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*

RUN test -n "${GIT_VERSION}" && test -n "${GIT_SHA256}" && \
    curl -fsSL "https://www.kernel.org/pub/software/scm/git/git-${GIT_VERSION}.tar.xz" \
      -o /tmp/git.tar.xz && \
    echo "${GIT_SHA256}  /tmp/git.tar.xz" | sha256sum -c - && \
    mkdir /tmp/git && \
    bsdtar -xJf /tmp/git.tar.xz --strip-components=1 -C /tmp/git && \
    cd /tmp/git && \
    make -j "$(nproc)" prefix=/opt/git sysconfdir=/etc USE_LIBPCRE2=YesPlease NO_GETTEXT=YesPlease NO_TCLTK=YesPlease TAR=bsdtar all && \
    make prefix=/opt/git sysconfdir=/etc USE_LIBPCRE2=YesPlease NO_GETTEXT=YesPlease NO_TCLTK=YesPlease TAR=bsdtar install && \
    rm -rf /tmp/git /tmp/git.tar.xz

FROM ubuntu:26.04

ARG GIT_VERSION

ENV LANG=C.UTF-8
ENV PATH="/opt/git/bin:${PATH}"

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
      ca-certificates libcurl4t64 libexpat1 libpcre2-8-0 libssl3t64 openssh-client perl sudo zlib1g && \
    rm -rf /var/lib/apt/lists/*

COPY --from=git-builder /opt/git /opt/git
# Keep the pinned Git available through sudo's default secure_path as well.
RUN ln -s /opt/git/bin/* /usr/local/bin/

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

RUN test "$(command -v git)" = /opt/git/bin/git && \
    test "$(git --version)" = "git version ${GIT_VERSION}" && \
    test "$(sudo git --version)" = "git version ${GIT_VERSION}" && \
    git init /tmp/git-smoke && \
    printf 'pinned-git\n' > /tmp/git-smoke/check && \
    git -C /tmp/git-smoke grep --no-index -P 'pinned-\w+' && \
    rm -rf /tmp/git-smoke
