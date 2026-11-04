#!/usr/bin/env bash
# Horu – install or update the laptop service (macOS, Linux).
#   bash scripts/install.sh
#   bash scripts/install.sh --modules whisper,manga
#   bash scripts/install.sh --modules core --autostart
#
# Modules (the phone app works without all of them):
#   core     Node service and Chrome extension (always installed); start it with scripts/horu.sh
#   whisper  speech recognition for marks without subtitles (Python, faster-whisper, ~1.5 GB model on first use)
#   manga    manga sources (Suwayomi, needs Java 21) and text recognition (mokuro)
#   claude   card explanations with Claude Code (`claude -p`, uses your Claude subscription)
#   ollama   card explanations with a local model (Ollama, free, needs a decent CPU/GPU)
# Without --modules the script asks for each optional module.

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

modules=""
autostart=0
while [ $# -gt 0 ]; do
  case "$1" in
    --modules) modules="$2"; shift 2 ;;
    --autostart) autostart=1; shift ;;
    *) echo "Unknown option $1"; exit 1 ;;
  esac
done

if [ -z "$modules" ]; then
  modules="core"
  for m in whisper manga claude ollama; do
    case $m in
      whisper) label="Whisper speech recognition (marks without subtitles)" ;;
      manga) label="Manga sources (Suwayomi) and text recognition (mokuro)" ;;
      claude) label="Claude Code for card explanations" ;;
      ollama) label="Ollama (local AI) for card explanations" ;;
    esac
    read -r -p "Install $label? [y/N] " answer
    case "$answer" in [yYjJ]*) modules="$modules,$m" ;; esac
  done
fi
want() { case ",$modules," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "$1 was not found. $2"; exit 1; }; }
step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }
os="$(uname -s)"
hint() { if [ "$os" = Darwin ]; then echo "brew install $1"; else echo "sudo apt install $2  (or your distribution's package)"; fi; }

# ---------------------------------------------------------------- core
step "core: npm install"
need node "Install Node.js 22 or newer from nodejs.org, then run this again."
npm install --no-audit --no-fund

step "core: build the app and the Chrome extension"
npm run build

step "core: ffmpeg (audio clips, screenshots)"
command -v ffmpeg >/dev/null 2>&1 || echo "ffmpeg is missing: $(hint ffmpeg ffmpeg). Horu runs without it, but cards get no audio."

chmod +x scripts/horu.sh
if [ $autostart = 1 ]; then
  if [ "$os" = Darwin ]; then
    plist="$HOME/Library/LaunchAgents/horu.plist"
    cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>horu</string>
  <key>ProgramArguments</key><array><string>$root/scripts/horu.sh</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH</string></dict>
</dict></plist>
EOF
    launchctl unload "$plist" 2>/dev/null || true
    launchctl load "$plist"
    echo "Horu starts when you log in (remove: launchctl unload $plist && rm $plist)."
  else
    unit="$HOME/.config/systemd/user/horu.service"
    mkdir -p "$(dirname "$unit")"
    cat >"$unit" <<EOF
[Unit]
Description=Horu laptop service

[Service]
ExecStart=$root/scripts/horu.sh run
Environment=PATH=$PATH
Restart=on-failure

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now horu.service
    echo "Horu starts when you log in (remove: systemctl --user disable --now horu)."
  fi
fi

# ---------------------------------------------------------------- Python modules
venv="$root/tools/.venv"
pip_install() {
  if [ ! -x "$venv/bin/python" ]; then
    need python3 "Install Python 3.11 or 3.12 ($(hint python@3.12 python3-venv)), then run this again."
    python3 -m venv "$venv"
    "$venv/bin/python" -m pip install --quiet --upgrade pip
  fi
  "$venv/bin/python" -m pip install --quiet "$@" || echo "Installing $* failed."
}

if want whisper; then
  step "whisper: faster-whisper"
  pip_install 'faster-whisper>=1.1'
fi

if want manga; then
  step "manga: mokuro (text recognition)"
  pip_install 'mokuro>=0.2.5'
  # Photos (Read -> Camera): EasyOCR's text detector. --no-deps keeps it from pulling a second OpenCV and PyTorch.
  pip_install python-bidi pyyaml scikit-image
  "$venv/bin/python" -m pip install --quiet --no-deps 'easyocr==1.7.2' || echo "Installing easyocr failed (photos will use the manga detector)."
  "$venv/bin/python" -c "import easyocr; easyocr.Reader(['en'], gpu=False, recognizer=False, verbose=False)" 2>/dev/null || true
  jar="$root/tools/suwayomi/bin/Suwayomi-Server.jar"
  if [ ! -f "$jar" ]; then
    step "manga: Suwayomi (manga sources)"
    url="$(curl -fsSL https://api.github.com/repos/Suwayomi/Suwayomi-Server/releases/latest | grep -o '"browser_download_url": *"[^"]*\.jar"' | head -1 | sed 's/.*"\(http[^"]*\)"/\1/')"
    mkdir -p "$(dirname "$jar")"
    curl -fL "$url" -o "$jar"
  fi
  command -v java >/dev/null 2>&1 || echo "Suwayomi needs Java 21: $(hint openjdk@21 openjdk-21-jre)."
  echo "Manga sources come from an extension repository you add in Settings -> Manga (Horu ships none)."
fi

if want claude; then
  step "claude: Claude Code"
  command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code || echo "Installing Claude Code failed."
  echo 'Run `claude` once in a terminal and sign in. Then pick "Claude Code" under Settings -> Cards on the laptop.'
fi

if want ollama; then
  step "ollama"
  if ! command -v ollama >/dev/null 2>&1; then
    if [ "$os" = Darwin ]; then brew install ollama || echo "Install Ollama from ollama.com."; else echo "Install Ollama from ollama.com (curl -fsSL https://ollama.com/install.sh | sh)."; fi
  fi
  command -v ollama >/dev/null 2>&1 && ollama pull qwen3:8b
  echo 'Pick "Ollama on the laptop" under Settings -> Cards on the laptop.'
fi

# ---------------------------------------------------------------- start
step "start"
[ $autostart = 1 ] || scripts/horu.sh start
sleep 4
if curl -fsS http://127.0.0.1:7317/api/status >/dev/null; then echo "Horu is running."; else echo "Horu did not answer yet - check data/horu.log"; fi
cat <<EOF

Next steps:
  1. Chrome -> chrome://extensions -> Developer mode -> Load unpacked -> extension/dist
  2. Tailscale on laptop and phone, then once: tailscale serve --bg 7317
     (no Tailscale: the pairing page also shows a code for the home Wi-Fi)
  3. Open http://localhost:7317/pair and scan the code in the app (Settings -> Laptop)
Start and stop: scripts/horu.sh start | stop | status
Add modules later: bash scripts/install.sh --modules whisper,manga
EOF
