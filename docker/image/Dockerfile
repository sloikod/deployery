FROM node:22-bookworm AS builder

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs vitest.workspace.ts README.md ./
COPY apps ./apps
COPY packages ./packages
COPY docker ./docker

RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm --filter deployery-extension-desktop run bundle-novnc
RUN pnpm --filter deployery-extension-desktop run package

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ARG WAYVNC_VERSION=v0.9.1
ARG NEATVNC_VERSION=v0.9.1
ARG AML_VERSION=v0.3.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    rsync \
    python3 \
    sudo \
    xz-utils \
    git \
    && rm -rf /var/lib/apt/lists/*

ARG S6_OVERLAY_VERSION=3.2.2.0
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp/s6-overlay-noarch.tar.xz
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz /tmp/s6-overlay-x86_64.tar.xz
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-symlinks-noarch.tar.xz /tmp/s6-overlay-symlinks-noarch.tar.xz
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
    && tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz \
    && tar -C / -Jxpf /tmp/s6-overlay-symlinks-noarch.tar.xz \
    && rm /tmp/s6-overlay-*.tar.xz

RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-linux.gpg \
    && printf "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n" > /etc/apt/sources.list.d/nodesource.list \
    && printf "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-linux.gpg] https://dl.google.com/linux/chrome/deb/ stable main\n" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        nodejs \
        dbus-user-session \
        pulseaudio \
        python3-websockify \
        sway \
        xwayland \
        xdg-utils \
        ripgrep \
        fd-find \
        fzf \
        less \
        jq \
        unzip \
        procps \
        locales \
        google-chrome-stable \
        build-essential \
        meson \
        ninja-build \
        pkg-config \
        scdoc \
        libdrm-dev \
        libxkbcommon-dev \
        libwlroots-dev \
        libjansson-dev \
        libpam0g-dev \
        libgnutls28-dev \
        libavfilter-dev \
        libavcodec-dev \
        libavutil-dev \
        libturbojpeg0-dev \
        libpixman-1-dev \
        libgbm-dev \
    && rm -rf /var/lib/apt/lists/*

COPY docker/image/assets/deployery/monotonic-shim.c /tmp/monotonic-shim.c
RUN gcc -shared -fPIC -o /usr/lib/libmonotonic-shim.so /tmp/monotonic-shim.c -ldl && rm /tmp/monotonic-shim.c

RUN bash -lc "set -euo pipefail \
    && mkdir -p /tmp/build-wayvnc \
    && cd /tmp/build-wayvnc \
    && git clone --branch ${WAYVNC_VERSION} --depth 1 https://github.com/any1/wayvnc.git \
    && git clone --branch ${NEATVNC_VERSION} --depth 1 https://github.com/any1/neatvnc.git \
    && git clone --branch ${AML_VERSION} --depth 1 https://github.com/any1/aml.git \
    && mkdir -p wayvnc/subprojects neatvnc/subprojects \
    && ln -sf ../../neatvnc wayvnc/subprojects/neatvnc \
    && ln -sf ../../aml wayvnc/subprojects/aml \
    && ln -sf ../../aml neatvnc/subprojects/aml \
    && cd wayvnc \
    && meson setup build --buildtype=release \
    && meson compile -C build \
    && meson install -C build \
    && ldconfig \
    && rm -rf /tmp/build-wayvnc"

RUN curl -fsSL https://code-server.dev/install.sh | sh \
    && useradd -m -s /bin/bash user \
    && echo 'user ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/user \
    && chmod 0440 /etc/sudoers.d/user \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && ln -sf /usr/bin/google-chrome-stable /usr/local/bin/google-chrome \
    && locale-gen en_US.UTF-8 \
    && update-locale LANG=en_US.UTF-8

WORKDIR /deployery

COPY --from=builder /workspace /deployery
COPY --from=builder /workspace/packages/extension-desktop/deployery-extension-desktop.vsix /deployery/extensions/deployery-extension-desktop.vsix
COPY docker/image/assets/Desktop /deployery/managed-assets/Desktop
COPY docker/image/assets/code-server /deployery/managed-assets/code-server
COPY docker/image/assets/code-server/branding /deployery/code-server-branding
COPY docker/image/assets/deployery/cursor.tar.gz /tmp/cursor.tar.gz
RUN mkdir -p /usr/share/icons && tar xzf /tmp/cursor.tar.gz -C /usr/share/icons && rm /tmp/cursor.tar.gz

COPY docker/image/assets/deployery/wayland-env.sh /deployery/wayland-env.sh
COPY docker/image/assets/deployery/fonts-local.conf /deployery/fonts-local.conf
COPY docker/image/assets/deployery/start-code-server.sh /deployery/start-code-server.sh
COPY docker/image/assets/deployery/start-sway.sh /deployery/start-sway.sh
COPY docker/image/assets/deployery/install-managed-assets.sh /deployery/install-managed-assets.sh
COPY docker/image/assets/deployery/patch-code-server-workbench.js /deployery/patch-code-server-workbench.js
COPY docker/image/entrypoint.sh /entrypoint.sh
COPY docker/image/assets/s6-rc.d/ /etc/s6-overlay/s6-rc.d/

RUN mkdir -p /home/user/Desktop /home/user/.config/deployery /home/user/.local/share/code-server/User \
    && chown -R user:user /home/user \
    && cp /deployery/managed-assets/code-server/settings.json /home/user/.local/share/code-server/User/settings.json \
    && node /deployery/patch-code-server-workbench.js \
    && su - user -c 'code-server --user-data-dir /home/user/.local/share/code-server --install-extension thang-nm.flow-icons || true' \
    && su - user -c 'code-server --user-data-dir /home/user/.local/share/code-server --install-extension /deployery/extensions/deployery-extension-desktop.vsix || true' \
    && chmod +x /entrypoint.sh /deployery/start-code-server.sh /deployery/start-sway.sh /deployery/install-managed-assets.sh /deployery/wayland-env.sh /deployery/patch-code-server-workbench.js \
    && chmod +x /etc/s6-overlay/s6-rc.d/init-deployery/up \
        /etc/s6-overlay/s6-rc.d/sway/run \
        /etc/s6-overlay/s6-rc.d/sway/finish \
        /etc/s6-overlay/s6-rc.d/code-server/run \
        /etc/s6-overlay/s6-rc.d/code-server/finish

EXPOSE 3131
ENTRYPOINT ["/init"]
CMD ["node", "/deployery/apps/api/dist/index.js"]
