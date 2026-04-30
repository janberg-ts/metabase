FROM mcr.microsoft.com/vscode/devcontainers/java:21

ARG BABASHKA_VERSION=1.12.212
ARG UV_VERSION=0.10.2
ARG CLOJURE_INSTALLER=linux-install-1.12.0.1488.sh

# Install the toolchain pinned in mise.toml closely enough for Metabase dev:
# Node 22, Bun, Clojure CLI, Babashka, Python 3.12, uv, and a few CLI utilities.
RUN ( curl -fsSL https://deb.nodesource.com/setup_22.x | bash ) \
  && export DEBIAN_FRONTEND=noninteractive \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    nodejs \
    python3 \
    python3-pip \
    python3-venv \
    rlwrap \
    fontconfig \
    jq \
    ripgrep \
    fd-find \
    fzf \
    zip \
    unzip \
  && npm install -g bun \
  && curl -fsSL https://download.clojure.org/install/${CLOJURE_INSTALLER} | bash \
  && curl -fsSL https://raw.githubusercontent.com/babashka/babashka/master/install | bash -s -- --version ${BABASHKA_VERSION} --dir /usr/local/bin \
  && curl -LsSf https://astral.sh/uv/install.sh | env UV_VERSION=${UV_VERSION} sh \
  && ln -sf /root/.local/bin/uv /usr/local/bin/uv \
  && ln -sf /root/.local/bin/uvx /usr/local/bin/uvx \
  && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
