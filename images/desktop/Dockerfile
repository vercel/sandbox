FROM base
USER root
ENV HOME=/root

ARG DEBIAN_FRONTEND=noninteractive
ARG UBUNTU_SNAPSHOT
RUN apt-get update --snapshot "${UBUNTU_SNAPSHOT}" -o Acquire::Retries=10 && \
    apt-get install -y --no-install-recommends --snapshot "${UBUNTU_SNAPSHOT}" -o Acquire::Retries=10 \
      fluxbox fonts-dejavu-core iproute2 novnc procps python3 python3-websockify scrot \
      tigervnc-standalone-server x11-utils xdotool xterm && \
    rm -rf /var/lib/apt/lists/*

ENV HOME=/vercel
USER ubuntu
WORKDIR /vercel

RUN for bin in Xvnc websockify fluxbox xterm xdotool scrot xdpyinfo ss pgrep pkill python3 sha256sum setsid sudo; do \
      command -v "$bin" || exit 1; \
    done && \
    test -f /usr/share/novnc/vnc.html
