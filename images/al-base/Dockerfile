FROM amazonlinux:2023 AS builder-base

WORKDIR /sandbox

RUN dnf update -y && \
    echo "install_weak_deps=False" >> /etc/dnf/dnf.conf && \
    dnf install -y \
    bind-utils \
    bzip2 \
    findutils \
    gcc \
    git \
    gzip \
    iputils \
    libicu \
    libjpeg \
    libpng \
    make \
    ncurses-libs \
    openssl \
    openssl-libs \
    openssl-devel \
    procps \
    tar \
    unzip \
    wget \
    which \
    whois \
    xz-devel \
    zlib-devel \
    zstd \
    curl-devel \
    expat-devel \
    gettext-devel \
    perl-devel \
    autoconf \
    libffi-devel && \
    dnf clean all && \
    rm -rf /var/cache/yum /var/lib/rpm/__db.*

FROM builder-base AS builder-git

# Compile git 2.49.0 from source to /opt/git
RUN cd /tmp && \
    curl -L https://github.com/git/git/archive/v2.49.0.tar.gz | tar -zx && \
    cd git-2.49.0 && \
    make configure && \
    ./configure --prefix=/opt/git && \
    make all && \
    make install && \
    cd / && rm -rf /tmp/git-2.49.0

FROM amazonlinux:2023 AS sandbox-base

RUN dnf update -y && \
    echo "install_weak_deps=False" >> /etc/dnf/dnf.conf && \
    dnf install -y \
    bind-utils \
    bzip2 \
    findutils \
    git \
    gzip \
    iputils \
    libatomic \
    libicu \
    libjpeg \
    libpng \
    ncurses-libs \
    openssl \
    openssl-libs \
    procps \
    sudo \
    tar \
    unzip \
    which \
    whois \
    zstd \
    iptables-legacy && \
    dnf clean all && \
    rm -rf /var/cache/yum /var/lib/rpm/__db.* && \
    alternatives --set iptables /usr/sbin/iptables-legacy

COPY --from=builder-git /opt/git /opt/git

# Note: Installing package manager git for dependencies, but PATH prioritizes our compiled git 2.49.0
ENV PATH="/vercel/bin:/opt/git/bin:/home/vercel-sandbox/.local/bin:/usr/local/bin:${PATH}"

COPY --from=src ./sudoers /etc/sudoers

RUN groupadd -g 1000 vercel-sandbox && \
    useradd -m -u 1000 -g vercel-sandbox -s /bin/bash vercel-sandbox && \
    mkdir /vercel/sandbox && \
    chown vercel-sandbox:vercel-sandbox /vercel/sandbox
