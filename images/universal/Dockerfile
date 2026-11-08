ARG BUN_IMAGE
FROM ${BUN_IMAGE} AS bun

FROM base AS node
USER root
ENV HOME=/root

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl libarchive-tools && \
    rm -rf /var/lib/apt/lists/*

ARG NODE_VERSION
RUN mkdir -p /opt/node && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
      | bsdtar -xJ --strip-components=1 -C /opt/node && \
    rm -f /opt/node/CHANGELOG.md /opt/node/LICENSE /opt/node/README.md

FROM base
USER root
ENV HOME=/root

ARG DEBIAN_FRONTEND=noninteractive
ARG PYTHON_VERSION=3.14
ARG GH_VERSION
ARG UV_VERSION

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    cd /tmp && \
    curl -fsSLO "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.deb" && \
    curl -fsSLO "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_checksums.txt" && \
    awk -v f="gh_${GH_VERSION}_linux_amd64.deb" '$2 == f' "gh_${GH_VERSION}_checksums.txt" | sha256sum -c && \
    apt-get install -y --no-install-recommends \
      "/tmp/gh_${GH_VERSION}_linux_amd64.deb" \
      bzip2 \
      dnsutils \
      file \
      fzf \
      git \
      git-lfs \
      gnupg \
      iproute2 \
      iputils-ping \
      jq \
      less \
      libatomic1 \
      lsof \
      nano \
      netcat-openbsd \
      openssl \
      procps \
      python-is-python3 \
      "python${PYTHON_VERSION}" \
      "python${PYTHON_VERSION}-venv" \
      python3-pip \
      ripgrep \
      rsync \
      sqlite3 \
      sudo \
      tmux \
      tree \
      unzip \
      vim \
      wget \
      xz-utils \
      zip && \
    rm -f "/tmp/gh_${GH_VERSION}_linux_amd64.deb" "/tmp/gh_${GH_VERSION}_checksums.txt" && \
    rm -f /usr/lib/python3*/EXTERNALLY-MANAGED && \
    rm -rf /var/lib/apt/lists/* && \
    pip install "uv==${UV_VERSION}" && \
    rm -rf /root/.cache/pip && \
    git lfs install --system

COPY --from=node /opt/node /usr/local

ARG PNPM_VERSION
RUN npm install -g "pnpm@${PNPM_VERSION}" && \
    npm cache clean --force

COPY --from=bun /usr/local/bin/bun /usr/local/bin/
RUN ln -s bun /usr/local/bin/bunx

# Coding agents.
ARG CLAUDE_CODE_VERSION
ARG CODEX_VERSION
ARG OPENCODE_VERSION
ARG PI_VERSION
RUN npm install -g \
      "opencode-ai@${OPENCODE_VERSION}" \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "@openai/codex@${CODEX_VERSION}" && \
    npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}" && \
    npm cache clean --force

RUN chown -R ubuntu:ubuntu /vercel

ENV HOME=/vercel
USER ubuntu
WORKDIR /vercel

RUN mkdir -p ~/.global/npm ~/.global/pnpm && \
    npm config set prefix ~/.global/npm && \
    pnpm config set global-dir ~/.global/pnpm && \
    pnpm config set global-bin-dir ~/.global/pnpm/bin

ENV PATH="/vercel/.local/bin:/vercel/.global/pnpm/bin:/vercel/.global/npm/bin:${PATH}"

# fx (https://github.com/vercel-labs/fx). Installed into ~/.local/bin, like the
# upstream installer, so `fx upgrade` works without sudo.
ARG FX_VERSION
RUN mkdir -p ~/.local/bin && \
    cd /tmp && \
    curl -fsSLO "https://github.com/vercel-labs/fx/releases/download/v${FX_VERSION}/fx-linux-x86_64.tar.gz" && \
    curl -fsSLO "https://github.com/vercel-labs/fx/releases/download/v${FX_VERSION}/fx-linux-x86_64.tar.gz.sha256" && \
    sha256sum -c fx-linux-x86_64.tar.gz.sha256 && \
    tar -xzf fx-linux-x86_64.tar.gz -C ~/.local/bin fx && \
    rm fx-linux-x86_64.tar.gz fx-linux-x86_64.tar.gz.sha256

ARG NODE_VERSION
RUN node --version | grep -Fx "v${NODE_VERSION}" && \
    pnpm --version | grep -Fx "${PNPM_VERSION}" && \
    bun --version && \
    python --version | grep -F "Python ${PYTHON_VERSION}." && \
    pip --version && \
    uv --version | grep -F "uv ${UV_VERSION} " && \
    git --version && \
    gh --version | grep -F "gh version ${GH_VERSION} " && \
    sudo whoami && \
    opencode --version | grep -Fx "${OPENCODE_VERSION}" && \
    claude --version | grep -F "${CLAUDE_CODE_VERSION} " && \
    codex --version | grep -Fx "codex-cli ${CODEX_VERSION}" && \
    pi --version | grep -Fx "${PI_VERSION}" && \
    fx --version
