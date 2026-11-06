FROM archlinux:latest AS base

# pacman's download sandbox does not work in containerized environments
RUN sed -i '/^\[options\]/a DisableSandbox' /etc/pacman.conf

# Keep distro git for package dependencies and base-devel for AUR builds.
# The remaining libraries also support the Git installation in /opt/git.
RUN pacman -Syu --noconfirm && \
  pacman -S --noconfirm --needed sudo base-devel git curl expat pcre2 zlib perl && \
  rm -rf /var/cache/pacman/pkg/*

FROM base AS git-builder

RUN pacman -S --noconfirm --needed rust && rm -rf /var/cache/pacman/pkg/*

# Shared versions and checksums are supplied by Bake; no local defaults.
ARG GIT_VERSION
ARG GIT_SHA256

RUN curl -fsSL "https://www.kernel.org/pub/software/scm/git/git-${GIT_VERSION}.tar.xz" -o /tmp/git.tar.xz && \
  printf '%s  %s\n' "$GIT_SHA256" /tmp/git.tar.xz | sha256sum -c - && \
  mkdir /tmp/git && \
  tar -xJf /tmp/git.tar.xz -C /tmp/git --strip-components=1 && \
  make -C /tmp/git -j"$(nproc)" prefix=/opt/git sysconfdir=/etc USE_LIBPCRE2=YesPlease NO_TCLTK=YesPlease all && \
  make -C /tmp/git prefix=/opt/git sysconfdir=/etc USE_LIBPCRE2=YesPlease NO_TCLTK=YesPlease install

FROM base

ARG GIT_VERSION
ARG YAY_VERSION
ARG YAY_SHA256

COPY --from=git-builder /opt/git /opt/git
RUN ln -s /opt/git/bin/* /usr/local/bin/
ENV PATH="/opt/git/bin:${PATH}"

# Install the checksum-verified upstream binary instead of a floating AUR recipe.
RUN curl -fsSL "https://github.com/Jguer/yay/releases/download/v${YAY_VERSION}/yay_${YAY_VERSION}_x86_64.tar.gz" -o /tmp/yay.tar.gz && \
  printf '%s  %s\n' "$YAY_SHA256" /tmp/yay.tar.gz | sha256sum -c - && \
  mkdir /tmp/yay && \
  tar -xzf /tmp/yay.tar.gz -C /tmp/yay --strip-components=1 && \
  install -Dm755 /tmp/yay/yay /usr/local/bin/yay && \
  install -Dm644 /tmp/yay/yay.8 /usr/local/share/man/man8/yay.8 && \
  rm -rf /tmp/yay /tmp/yay.tar.gz

RUN useradd -m -d /vercel -u 1000 -s /bin/bash arch && \
  printf '%s\n' \
  'Defaults always_set_home' \
  'Defaults !env_reset' \
  'Defaults !fqdn' \
  'arch ALL=(ALL) NOPASSWD:ALL' \
  > /etc/sudoers.d/sandbox && \
  chmod 0440 /etc/sudoers.d/sandbox && \
  chown -R arch:arch /vercel

ENV HOME=/vercel
USER arch
WORKDIR /vercel

# Check the selected tools as the runtime user (yay also reports libalpm).
RUN test "$(git --version)" = "git version ${GIT_VERSION}" && \
  test "$(yay --version | cut -d ' ' -f 1-2)" = "yay v${YAY_VERSION}"
