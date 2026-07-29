FROM archlinux:latest

# pacman's download sandbox does not work in containerized environments
RUN sed -i '/^\[options\]/a DisableSandbox' /etc/pacman.conf

# base-devel and git are required to build AUR packages with yay.
RUN pacman -Syu --noconfirm && \
  pacman -S --noconfirm --needed sudo base-devel git && \
  rm -rf /var/cache/pacman/pkg/*

# create `arch` (uid 1000) with passwordless sudo.
RUN useradd -m -u 1000 -s /bin/bash arch && \
  printf '%s\n' \
  'Defaults always_set_home' \
  'Defaults !env_reset' \
  'Defaults !fqdn' \
  'arch ALL=(ALL) NOPASSWD:ALL' \
  > /etc/sudoers.d/sandbox && \
  chmod 0440 /etc/sudoers.d/sandbox

USER arch
WORKDIR /home/arch

# yay (AUR helper)
RUN git clone https://aur.archlinux.org/yay-bin.git /tmp/yay-bin && \
  cd /tmp/yay-bin && \
  makepkg -si --noconfirm && \
  rm -rf /tmp/yay-bin && \
  sudo rm -rf /var/cache/pacman/pkg/* && \
  yay --version
