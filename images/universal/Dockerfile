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

ARG GH_VERSION
ARG GH_SHA256
ARG GIT_LFS_VERSION
ARG GIT_LFS_SHA256
RUN mkdir -p /opt/tools/bin /tmp/gh /tmp/git-lfs && \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o /tmp/gh.tar.gz && \
    echo "${GH_SHA256}  /tmp/gh.tar.gz" | sha256sum -c - && \
    bsdtar -xf /tmp/gh.tar.gz --strip-components=1 -C /tmp/gh && \
    install -m 0755 /tmp/gh/bin/gh /opt/tools/bin/gh && \
    curl -fsSL "https://github.com/git-lfs/git-lfs/releases/download/v${GIT_LFS_VERSION}/git-lfs-linux-amd64-v${GIT_LFS_VERSION}.tar.gz" -o /tmp/git-lfs.tar.gz && \
    echo "${GIT_LFS_SHA256}  /tmp/git-lfs.tar.gz" | sha256sum -c - && \
    bsdtar -xf /tmp/git-lfs.tar.gz --strip-components=1 -C /tmp/git-lfs && \
    install -m 0755 /tmp/git-lfs/git-lfs /opt/tools/bin/git-lfs && \
    rm -rf /tmp/gh /tmp/gh.tar.gz /tmp/git-lfs /tmp/git-lfs.tar.gz

FROM base
USER root
ENV HOME=/root

ARG DEBIAN_FRONTEND=noninteractive
ARG PYTHON_VERSION
ARG PIP_VERSION
ARG UV_VERSION
ARG GIT_VERSION
ARG GH_VERSION
ARG GIT_LFS_VERSION
ARG BUN_VERSION
ARG PNPM_VERSION
ARG CLAUDE_CODE_VERSION
ARG CODEX_VERSION
ARG OPENCODE_VERSION
ARG PI_VERSION

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bzip2 \
      curl \
      dnsutils \
      file \
      fzf \
      gnupg \
      iproute2 \
      iputils-ping \
      jq \
      less \
      libarchive-tools \
      libatomic1 \
      lsof \
      nano \
      netcat-openbsd \
      openssl \
      procps \
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
    rm -rf /var/lib/apt/lists/*

COPY --from=node /opt/node /usr/local
COPY --from=node /opt/tools/bin/ /usr/local/bin/
RUN git lfs install --system

RUN npm install -g "pnpm@${PNPM_VERSION}" && \
    npm cache clean --force

# Bun.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/
RUN ln -s bun /usr/local/bin/bunx

# Coding agents.
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
    bsdtar -xzf fx-linux-x86_64.tar.gz -C ~/.local/bin fx && \
    rm fx-linux-x86_64.tar.gz fx-linux-x86_64.tar.gz.sha256

RUN node --version && \
    bun --version | grep -Fx "${BUN_VERSION}" && \
    pnpm --version | grep -Fx "${PNPM_VERSION}" && \
    python --version | grep -Fx "Python ${PYTHON_VERSION}" && \
    python3 --version | grep -Fx "Python ${PYTHON_VERSION}" && \
    pip --version | grep -F "pip ${PIP_VERSION} from " && \
    uv --version && \
    test "$(uv --version | cut -d ' ' -f 1-2)" = "uv ${UV_VERSION}" && \
    git --version | grep -Fx "git version ${GIT_VERSION}" && \
    git lfs version | grep -F "git-lfs/${GIT_LFS_VERSION} (" && \
    gh --version | grep -F "gh version ${GH_VERSION} (" && \
    sudo whoami && \
    opencode --version | grep -Fx "${OPENCODE_VERSION}" && \
    claude --version | grep -Fx "${CLAUDE_CODE_VERSION} (Claude Code)" && \
    codex --version | grep -Fx "codex-cli ${CODEX_VERSION}" && \
    pi --version | grep -Fx "${PI_VERSION}" && \
    fx --version
