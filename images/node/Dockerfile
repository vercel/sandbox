FROM base AS fetch
USER root

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl libarchive-tools && \
    rm -rf /var/lib/apt/lists/*

ARG NODE_MAJOR
RUN tarball="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/SHASUMS256.txt" \
      | grep -oE 'node-v[0-9]+\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' | head -n1)" && \
    mkdir -p /opt/node && \
    curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/${tarball}" \
      | bsdtar -xJ --strip-components=1 -C /opt/node && \
    rm -f /opt/node/CHANGELOG.md /opt/node/LICENSE /opt/node/README.md

FROM base
USER root

# Node.js requires libatomic.
RUN apt-get update && \
    apt-get install -y --no-install-recommends libatomic1 && \
    rm -rf /var/lib/apt/lists/*

COPY --from=fetch /opt/node /usr/local

RUN npm install -g pnpm@11 && \
    npm cache clean --force

USER ubuntu

RUN mkdir -p ~/.global/npm ~/.global/pnpm && \
    npm config set prefix ~/.global/npm && \
    pnpm config set global-dir ~/.global/pnpm && \
    pnpm config set global-bin-dir ~/.global/pnpm/bin

ENV PATH="/home/ubuntu/.global/pnpm/bin:/home/ubuntu/.global/npm/bin:${PATH}"

RUN node --version && \
    npm --version && \
    pnpm --version
