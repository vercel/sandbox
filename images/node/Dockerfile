FROM base AS fetch
USER root
ENV HOME=/root

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
ENV HOME=/root

# Node.js requires libatomic.
RUN apt-get update && \
    apt-get install -y --no-install-recommends git libatomic1 && \
    rm -rf /var/lib/apt/lists/*

COPY --from=fetch /opt/node /usr/local

RUN npm install -g pnpm@11 && \
    npm cache clean --force

RUN chown -R ubuntu:ubuntu /vercel

ENV HOME=/vercel
USER ubuntu
WORKDIR /vercel

RUN mkdir -p ~/.global/npm ~/.global/pnpm && \
    npm config set prefix ~/.global/npm && \
    pnpm config set global-dir ~/.global/pnpm && \
    pnpm config set global-bin-dir ~/.global/pnpm/bin

ENV PATH="/vercel/.global/pnpm/bin:/vercel/.global/npm/bin:${PATH}"

RUN git --version && \
    node --version && \
    npm --version && \
    pnpm --version
