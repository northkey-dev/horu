#!/usr/bin/env bash
# Horu on a Raspberry Pi (or any 64-bit Linux computer) as containers: Horu + a Tailscale container that gives it
# an https address. One command, a few questions.
#
#   bash scripts/pi-install.sh                           asks what it needs
#   TS_AUTHKEY=tskey-... bash scripts/pi-install.sh --yes   no questions (modules: manga)
#   HORU_MODULES=manga,whisper TS_AUTHKEY=... bash scripts/pi-install.sh --yes
#
# Without a Tailscale key it sets up the home-network-only variant (http, no microphone/offline/reminders).
# Run it again any time: it keeps your .env and data folder and only updates and restarts.
set -euo pipefail

yes=0
for arg in "$@"; do [ "$arg" = "--yes" ] || [ "$arg" = "-y" ] && yes=1; done

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
ask() { # ask "question" default -> answer (the default when --yes or no terminal)
  local answer=""
  if [ $yes = 0 ] && [ -r /dev/tty ]; then read -r -p "$1 " answer < /dev/tty || true; fi
  printf '%s' "${answer:-$2}"
}

# ---------------------------------------------------------------- where is the project
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
root=""
[ -f "$here/../docker-compose.yml" ] && root="$(cd "$here/.." && pwd)"
if [ -z "$root" ]; then
  command -v git >/dev/null 2>&1 || { echo "Install git first: sudo apt install -y git"; exit 1; }
  root="${HORU_DIR:-$HOME/horu}"
  say "Getting Horu into $root"
  if [ -d "$root/.git" ]; then git -C "$root" pull --ff-only; else git clone https://github.com/northkey-dev/horu.git "$root"; fi
fi
cd "$root"

# ---------------------------------------------------------------- checks
[ "$(uname -s)" = Linux ] || [ -n "${HORU_ALLOW_ANY_OS:-}" ] || { echo "This script is for Linux (Raspberry Pi OS, Ubuntu, Debian)."; exit 1; }
case "$(uname -m)" in
  aarch64|arm64|x86_64|amd64) ;;
  *) echo "This needs a 64-bit system (found $(uname -m)). On a Raspberry Pi install Raspberry Pi OS (64-bit)."; exit 1 ;;
esac
mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
mem_gb=$(( (mem_kb + 524288) / 1048576 ))
echo "Memory: about ${mem_gb} GB"

# ---------------------------------------------------------------- Docker
DOCKER="docker"
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
  DOCKER="sudo docker"
  warn "Docker is installed. After this script, log out and in again so you can use docker without sudo."
fi
if ! $DOCKER info >/dev/null 2>&1; then DOCKER="sudo docker"; fi
$DOCKER compose version >/dev/null 2>&1 || { echo "Docker Compose is missing: sudo apt install -y docker-compose-plugin"; exit 1; }

# ---------------------------------------------------------------- settings (.env)
setenv() { # setenv KEY VALUE
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=${2//|/\\|}|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
getenv() { grep "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }

if [ ! -f .env ]; then
  say "Settings"
  cp .env.example .env
  setenv PUID "$(id -u)"
  setenv PGID "$(id -g)"
  tz="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || true)"
  [ -n "$tz" ] && setenv TZ "$tz"
  lan="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$lan" ] || lan="$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
  setenv HORU_LAN_ADDRESS "${lan:-localhost}"
  [ -n "${HORU_PORT:-}" ] && setenv HORU_PORT "$HORU_PORT"

  key="${TS_AUTHKEY:-}"
  if [ -z "$key" ]; then
    echo "Tailscale gives Horu an https address (needed for microphone, offline use and reminders) and keeps it private."
    echo "Create a key at https://login.tailscale.com/admin/settings/keys (Generate auth key), and switch on MagicDNS and HTTPS certificates on the DNS page."
    key="$(ask 'Tailscale auth key (empty = home network only, no https):' '')"
  fi
  if [ -n "$key" ]; then
    setenv TS_AUTHKEY "$key"
    setenv COMPOSE_FILE docker-compose.yml
  else
    setenv COMPOSE_FILE docker-compose.lan.yml
    warn "No key: Horu will be reachable at http://$(getenv HORU_LAN_ADDRESS):${HORU_PORT:-7317} on the home network only."
  fi

  modules="${HORU_MODULES-}"
  if [ -z "${HORU_MODULES+x}" ]; then
    if [ "$mem_gb" -lt 4 ]; then
      warn "Only ${mem_gb} GB of memory: the manga text recognition needs about 2 GB while it works. Starting without it."
      modules=""
    else
      modules="manga"
      [ "$(ask 'Also Whisper (listening for marks without subtitles)? Slow on a Pi. [y/N]' n)" = y ] && modules="manga,whisper"
    fi
  fi
  setenv HORU_MODULES "$modules"
  anki="${HORU_ANKI_URL-}"
  setenv HORU_ANKI_URL "$anki"
else
  echo "Keeping your existing .env"
fi
mkdir -p data

# ---------------------------------------------------------------- image
say "Getting the Horu image"
image="ghcr.io/northkey-dev/horu:${HORU_VERSION:-latest}"
if $DOCKER image inspect "$image" >/dev/null 2>&1 && [ "${HORU_REBUILD:-0}" != 1 ]; then
  echo "Image is already here."
elif ! $DOCKER compose pull horu 2>/dev/null; then
  warn "No ready-made image could be downloaded (the repository may be private), building it here instead."
  warn "That takes 20 to 40 minutes on a Raspberry Pi (PyTorch and the text recognition models). Get a coffee."
  $DOCKER compose build horu
fi

say "Starting"
$DOCKER compose up -d

# ---------------------------------------------------------------- wait and tell
cid="$($DOCKER compose ps -q horu)"
printf 'Waiting for Horu'
state=""
for _ in $(seq 1 90); do
  state="$($DOCKER inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || true)"
  [ "$state" = healthy ] && break
  printf '.'; sleep 4
done
echo
[ "$state" = healthy ] || { warn "Horu did not report healthy yet. Look at: $DOCKER compose logs horu"; }

token="$(cat data/token.txt 2>/dev/null || true)"
say "Done"
if [ "$(getenv COMPOSE_FILE)" = docker-compose.yml ]; then
  name=""
  for _ in $(seq 1 30); do
    name="$($DOCKER compose exec -T tailscale tailscale status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/; s/\.$//' || true)"
    [ -n "$name" ] && break
    sleep 2
  done
  if [ -n "$name" ]; then
    echo "Horu address:  https://$name"
    echo "Connect phone: open  https://$name/pair  in a browser on a device that is on your tailnet, and scan the code in the app."
  else
    warn "Tailscale has not signed in yet. Check the key in .env and run: $DOCKER compose logs tailscale"
  fi
else
  port="$(getenv HORU_PORT)"; port="${port:-7317}"
  echo "Horu address:  http://$(getenv HORU_LAN_ADDRESS):$port   (home network only)"
  echo "Connect phone: open  http://$(getenv HORU_LAN_ADDRESS):$port/pair?t=$token  in a browser."
fi
cat <<EOF

Next:
  1. Phone: install Tailscale, scan the code on the pairing page with the camera and add the page to the home screen.
  2. Chrome on your computer: download the extension from the pairing page, unzip, chrome://extensions -> Load unpacked,
     then the extension's Options -> server address.
  3. Cards: Settings -> Cards on this phone (this Horu has no Anki). Anki on another computer? Set HORU_ANKI_URL in .env.
  4. Your old data (from the laptop): copy its data/ folder into $root/data while Horu is stopped ($DOCKER compose stop horu).

Update:   git pull && $DOCKER compose pull && $DOCKER compose up -d     (or run this script again)
Logs:     $DOCKER compose logs -f horu
Backup:   copy the data/ folder (it also keeps 14 daily backups in data/backups)
EOF
