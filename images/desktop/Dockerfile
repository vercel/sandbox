FROM base
USER root
ENV HOME=/root
# Keep npm from reading /vercel/.npmrc as project config.
WORKDIR /

ARG SCREEN_RELAY_VERSION
RUN npm install -g "screen-relay@${SCREEN_RELAY_VERSION}" && \
    npm cache clean --force

# Install screen-relay's X11 and XFCE packages from the pinned snapshot, so
# `screen-relay install` only has to build the engine. xdotool sends input to
# the display while a viewer holds screen-relay's single input connection.
ARG DEBIAN_FRONTEND=noninteractive
ARG UBUNTU_SNAPSHOT
RUN packages=$(awk -F '\t' '$1 == "core" || $1 == "x11" || $1 == "xfce" { print $3 }' \
      "$(npm root -g)/screen-relay/packages.tsv" | tr ' ' '\n' | grep -vx -- '-') && \
    apt-get update --snapshot "${UBUNTU_SNAPSHOT}" -o Acquire::Retries=10 && \
    apt-get install -y --no-install-recommends --snapshot "${UBUNTU_SNAPSHOT}" -o Acquire::Retries=10 $packages xdotool && \
    rm -rf /var/lib/apt/lists/*

ENV HOME=/vercel
USER ubuntu
WORKDIR /vercel

# Builds the engine under ~/.local/share/screen-relay.
RUN screen-relay install --yes && \
    screen-relay doctor && \
    command -v xdotool
