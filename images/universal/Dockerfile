FROM base AS node
USER root

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl libarchive-tools && \
    rm -rf /var/lib/apt/lists/*

ARG NODE_MAJOR=24
RUN tarball="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/SHASUMS256.txt" \
      | grep -oE 'node-v[0-9]+\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' | head -n1)" && \
    mkdir -p /opt/node && \
    curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/${tarball}" \
      | bsdtar -xJ --strip-components=1 -C /opt/node && \
    rm -f /opt/node/CHANGELOG.md /opt/node/LICENSE /opt/node/README.md

FROM base
USER root

ARG DEBIAN_FRONTEND=noninteractive
ARG PYTHON_VERSION=3.14

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    install -d -m 0755 /etc/apt/keyrings && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      awscli \
      bzip2 \
      dnsutils \
      file \
      fzf \
      gh \
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
    rm -f /usr/lib/python3*/EXTERNALLY-MANAGED && \
    rm -rf /var/lib/apt/lists/* && \
    pip install uv && \
    rm -rf /root/.cache/pip && \
    git lfs install --system

COPY --from=node /opt/node /usr/local

RUN npm install -g pnpm@10 && \
    npm cache clean --force

# Coding agents.
RUN npm install -g \
      opencode-ai \
      @anthropic-ai/claude-code \
      @openai/codex && \
    npm install -g --ignore-scripts @earendil-works/pi-coding-agent && \
    npm cache clean --force

USER ubuntu

RUN mkdir -p ~/.global/npm ~/.global/pnpm && \
    npm config set prefix ~/.global/npm && \
    pnpm config set global-dir ~/.global/pnpm && \
    pnpm config set global-bin-dir ~/.global/pnpm/bin

ENV PATH="/home/ubuntu/.local/bin:/home/ubuntu/.global/pnpm/bin:/home/ubuntu/.global/npm/bin:${PATH}"

RUN node --version && \
    python --version | grep -F "Python ${PYTHON_VERSION}." && \
    pip --version && \
    uv --version && \
    git --version && \
    gh --version && \
    aws --version && \
    sudo whoami && \
    opencode --version && \
    claude --version && \
    codex --version && \
    pi --version
