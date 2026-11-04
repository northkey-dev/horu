# Horu as a container (Raspberry Pi 64-bit, or any PC). See the README section "Raspberry Pi / Docker".
#
#   docker build -t horu --build-arg MODULES=manga,whisper .
#
# MODULES (comma separated, default "manga"): manga = Suwayomi + mokuro/manga-ocr + the photo detector,
# whisper = faster-whisper. An empty list builds the service only.

ARG NODE_IMAGE=node:24-trixie-slim

# ---- build the app (pwa) and the Chrome extension ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY pwa/package.json pwa/
COPY extension/package.json extension/
RUN npm ci
COPY . .
RUN npm run build

# ---- the service ----
FROM ${NODE_IMAGE} AS runtime
ARG MODULES="manga"
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN set -eux; \
    packages="ffmpeg curl ca-certificates tini"; \
    case ",$MODULES," in *,manga,*|*,whisper,*) packages="$packages python3 python3-venv libgl1 libglib2.0-0";; esac; \
    case ",$MODULES," in *,manga,*) packages="$packages openjdk-21-jre-headless";; esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends $packages; \
    rm -rf /var/lib/apt/lists/*

# Service dependencies only (the service runs its TypeScript directly)
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY pwa/package.json pwa/
COPY extension/package.json extension/
RUN npm ci --omit=dev --workspace server --include-workspace-root && npm cache clean --force

COPY server server
COPY shared shared
COPY tools/*.py tools/
COPY tools/requirements.txt tools/
COPY --from=build /app/pwa/dist pwa/dist
COPY --from=build /app/extension/dist extension/dist

# Models and caches live in the image (not in the data volume), readable and writable by any user id.
ENV XDG_CACHE_HOME=/opt/cache \
    HF_HOME=/opt/cache/huggingface \
    TORCH_HOME=/opt/cache/torch \
    EASYOCR_MODULE_PATH=/opt/cache/easyocr \
    HOME=/tmp/horu-home

# Python side (text recognition for manga and photos, Whisper). PyTorch comes as the CPU build.
RUN set -eux; \
    mkdir -p /opt/cache "$HOME"; \
    case ",$MODULES," in *,manga,*|*,whisper,*) python3 -m venv tools/.venv;; esac; \
    case ",$MODULES," in *,manga,*) \
      tools/.venv/bin/pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu; \
      tools/.venv/bin/pip install --no-cache-dir 'mokuro==0.2.5' 'python-bidi==0.6.12' 'pyyaml==6.0.3' 'scikit-image==0.26.0'; \
      tools/.venv/bin/pip install --no-cache-dir --no-deps 'easyocr==1.7.2'; \
      tools/.venv/bin/python -c "from mokuro.manga_page_ocr import MangaPageOcr; MangaPageOcr(force_cpu=True)"; \
      tools/.venv/bin/python -c "import easyocr; easyocr.Reader(['en'], gpu=False, recognizer=False, verbose=False)"; \
      mkdir -p tools/suwayomi/bin; \
      curl -fL https://github.com/Suwayomi/Suwayomi-Server/releases/download/v2.4.2366/Suwayomi-Server-v2.4.2366.jar -o tools/suwayomi/bin/Suwayomi-Server.jar; \
      echo 'af9feb20af9d7ebe9e30769e6c6ebc7fc7ab1c447388d42e0280b1da5fe07bfd  tools/suwayomi/bin/Suwayomi-Server.jar' | sha256sum -c -;; \
    esac; \
    case ",$MODULES," in *,whisper,*) tools/.venv/bin/pip install --no-cache-dir 'faster-whisper==1.2.1';; esac; \
    chmod -R a+rwX /opt/cache; \
    rm -rf "$HOME"

ENV HORU_DATA=/data \
    HORU_DOCKER=1 \
    NODE_ENV=production \
    HOME=/tmp/horu-home
RUN mkdir -p /data && chmod 777 /data
VOLUME /data
EXPOSE 7317

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7317/api/status').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# tini hands signals to node and reaps the Python/Java children
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "mkdir -p \"$HOME\" && exec node server/src/main.ts"]
