FROM sandbox-base AS sandbox-node

ARG NODE_ARCH=x64
ARG NODE_MAJOR
ARG NODE_VERSION

RUN mkdir -p /vercel/runtimes/node${NODE_MAJOR} && curl https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-$NODE_ARCH.tar.gz | tar -zx --strip-components=1 -C /vercel/runtimes/node${NODE_MAJOR} && /vercel/runtimes/node${NODE_MAJOR}/bin/node --version
ENV PATH="/vercel/runtimes/node${NODE_MAJOR}/bin:${PATH}"

RUN npm install -g pnpm@10

USER vercel-sandbox

RUN mkdir -p ~/.global/{npm,pnpm} && \
  npm config set prefix ~/.global/npm && \
  pnpm config set global-dir ~/.global/pnpm && \
  pnpm config set global-bin-dir ~/.global/pnpm/bin

ENV PATH="/vercel/runtimes/node${NODE_MAJOR}/bin:/home/vercel-sandbox/.global/pnpm/bin:/home/vercel-sandbox/.global/npm/bin:${PATH}"
