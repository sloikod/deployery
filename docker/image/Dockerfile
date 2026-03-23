FROM node:22-bookworm AS builder

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs vitest.workspace.ts README.md ./
COPY apps ./apps
COPY packages ./packages
COPY docker ./docker
COPY scripts ./scripts

RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm --filter deployery-extension-desktop run bundle-novnc
RUN pnpm --filter deployery-extension-desktop run package

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    rsync \
    python3 \
    sudo \
    tini \
    debootstrap \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && printf "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN debootstrap --variant=minbase --components=main,universe noble /opt/deployery/base-rootfs http://archive.ubuntu.com/ubuntu/ \
    && printf "deb http://archive.ubuntu.com/ubuntu noble main universe\n\
deb http://archive.ubuntu.com/ubuntu noble-updates main universe\n\
deb http://security.ubuntu.com/ubuntu noble-security main universe\n" > /opt/deployery/base-rootfs/etc/apt/sources.list \
    && chroot /opt/deployery/base-rootfs /bin/bash -lc "apt-get update && apt-get install -y --no-install-recommends \
        sudo curl ca-certificates git gnupg python3 python3-pip nodejs npm dbus-user-session \
        pulseaudio python3-websockify sway wayvnc xwayland xdg-utils ripgrep fd-find fzf less jq unzip procps locales \
      && rm -rf /var/lib/apt/lists/*" \
    && chroot /opt/deployery/base-rootfs /bin/bash -lc "curl -fsSL https://code-server.dev/install.sh | sh" \
    && chroot /opt/deployery/base-rootfs /bin/bash -lc "useradd -m -s /bin/bash deployery && echo 'deployery ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deployery" \
    && chroot /opt/deployery/base-rootfs /bin/bash -lc "ln -sf /usr/bin/fdfind /usr/local/bin/fd" \
    && chroot /opt/deployery/base-rootfs /bin/bash -lc "locale-gen en_US.UTF-8 && update-locale LANG=en_US.UTF-8"

WORKDIR /deployery

COPY --from=builder /workspace /deployery
COPY --from=builder /workspace/packages/extension-desktop/deployery-extension-desktop.vsix /opt/deployery/extensions/deployery-extension-desktop.vsix
COPY docker/image/assets/Desktop /opt/deployery/managed-assets/Desktop
COPY docker/image/assets/code-server /opt/deployery/managed-assets/code-server
COPY docker/image/assets/deployery/wayland-env.sh /deployery/wayland-env.sh
COPY docker/image/assets/deployery/virtual-pointer.py /deployery/virtual-pointer.py
COPY docker/image/assets/deployery/fonts-local.conf /deployery/fonts-local.conf
COPY docker/image/assets/deployery/start-code-server.sh /deployery/start-code-server.sh
COPY docker/image/assets/deployery/start-sway.sh /deployery/start-sway.sh
COPY docker/image/assets/deployery/install-managed-assets.sh /deployery/install-managed-assets.sh
COPY docker/image/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh /deployery/start-code-server.sh /deployery/start-sway.sh /deployery/install-managed-assets.sh /deployery/wayland-env.sh

EXPOSE 3131
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
