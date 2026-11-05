# Horu – install or update the laptop service (Windows).
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Modules whisper,manga
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Modules core -Autostart
#
# Modules (the phone app works without all of them):
#   core     Node service, Chrome extension, Horu.exe tray launcher (always installed)
#   whisper  speech recognition for marks without subtitles (Python, faster-whisper, ~1.5 GB model download on first use)
#   manga    manga sources (Suwayomi, includes Java) and text recognition (mokuro)
#   claude   card explanations with Claude Code (`claude -p`, uses your Claude subscription)
#   ollama   card explanations with a local model (Ollama, free, needs a decent CPU/GPU)
# Without -Modules the script asks for each optional module.

param(
  [string[]]$Modules,
  [switch]$Autostart
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$optional = [ordered]@{
  whisper = 'Whisper speech recognition (marks without subtitles)'
  manga   = 'Manga sources (Suwayomi) and text recognition (mokuro)'
  tts     = 'A computer voice for cards without sound (about 120 MB)'
  claude  = 'Claude Code for card explanations'
  ollama  = 'Ollama (local AI) for card explanations'
}
if (-not $Modules) {
  $Modules = @('core')
  foreach ($m in $optional.Keys) {
    if ((Read-Host "Install $($optional[$m])? [y/N]") -match '^(y|j)') { $Modules += $m }
  }
}
$Modules = @($Modules | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
if ($Modules -notcontains 'core') { $Modules = @('core') + $Modules }
$want = { param($name) $Modules -contains $name }

function Need($command, $hint) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command was not found. $hint" }
}

# ---------------------------------------------------------------- core
Write-Host '== core: npm install' -ForegroundColor Cyan
Need node 'Install Node.js 22 or newer from nodejs.org, then run this again.'
npm install --no-audit --no-fund
if ($LASTEXITCODE) { throw 'npm install failed' }

Write-Host '== core: build the app and the Chrome extension' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE) { throw 'build failed' }

Write-Host '== core: ffmpeg (audio clips, screenshots)' -ForegroundColor Cyan
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) { winget install --id Gyan.FFmpeg --silent --accept-package-agreements --accept-source-agreements }
  else { Write-Warning 'Install ffmpeg (ffmpeg.org) and add it to PATH: without it cards get no audio.' }
  Write-Host 'Open a new terminal after this so ffmpeg is on the PATH.'
}

Write-Host '== core: compile Horu.exe' -ForegroundColor Cyan
$launcherDir = Join-Path $root 'tools\launcher'
$exe = Join-Path $launcherDir 'Horu.exe'
if (Test-Path $exe) { & $exe --stop; Start-Sleep -Seconds 2 }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /optimize+ /r:System.Windows.Forms.dll /r:System.Drawing.dll "/win32icon:$launcherDir\horu.ico" "/out:$exe" "$launcherDir\Horu.cs"
if ($LASTEXITCODE) { throw 'compiling Horu.exe failed' }

$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Horu.lnk'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = $exe
$link.WorkingDirectory = $launcherDir
$link.IconLocation = "$launcherDir\horu.ico"
$link.Save()
if ($Autostart) {
  Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Horu' -Value "`"$exe`""
  Write-Host 'Horu starts with Windows (switch off in Task Manager -> Startup apps).'
}

# ---------------------------------------------------------------- Python modules
$venvPython = Join-Path $root 'tools\.venv\Scripts\python.exe'
function Pip($packages) {
  if (-not (Test-Path $venvPython)) {
    Need python 'Install Python 3.11 or 3.12 from python.org (tick "Add to PATH"), then run this again.'
    python -m venv (Join-Path $root 'tools\.venv')
    & $venvPython -m pip install --quiet --upgrade pip
  }
  & $venvPython -m pip install --quiet @packages
  if ($LASTEXITCODE) { Write-Warning "Installing $packages failed." }
}

if (& $want 'whisper') {
  Write-Host '== whisper: faster-whisper' -ForegroundColor Cyan
  Pip @('faster-whisper==1.2.1')
}

if (& $want 'manga') {
  Write-Host '== manga: mokuro (text recognition)' -ForegroundColor Cyan
  Pip @('mokuro==0.2.5')
  # Photos (Read -> Camera): EasyOCR's text detector. --no-deps keeps it from pulling a second OpenCV and PyTorch.
  Pip @('python-bidi==0.6.12', 'pyyaml==6.0.3', 'scikit-image==0.26.0')
  & $venvPython -m pip install --quiet --no-deps 'easyocr==1.7.2'
  & $venvPython -c "import easyocr; easyocr.Reader(['en'], gpu=False, recognizer=False, verbose=False)" 2>$null
  $suwa = Join-Path $root 'tools\suwayomi'
  if (-not (Test-Path (Join-Path $suwa 'bin\Suwayomi-Server.jar'))) {
    Write-Host '== manga: Suwayomi (manga sources, includes Java)' -ForegroundColor Cyan
    # A fixed version with its checksum, so what is installed is what was tested. To update take both from the release page.
    $version = 'v2.4.2366'
    $name = "Suwayomi-Server-$version-windows-x64.zip"
    $zip = Join-Path $env:TEMP $name
    Invoke-WebRequest "https://github.com/Suwayomi/Suwayomi-Server/releases/download/$version/$name" -OutFile $zip
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne 'b955f374a8d94b8d1c2750ae28fa7eb2066b479957561b5ba9cf8ac993c8fc13') {
      Remove-Item $zip -Force
      throw 'The Suwayomi download does not match its checksum.'
    }
    $tmp = Join-Path $env:TEMP 'horu-suwayomi'
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive $zip -DestinationPath $tmp
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    New-Item -ItemType Directory -Force $suwa | Out-Null
    Copy-Item (Join-Path $inner.FullName '*') $suwa -Recurse -Force
    Remove-Item $tmp, $zip -Recurse -Force
  }
  Write-Host 'Manga sources come from an extension repository you add in Settings -> Manga (Horu ships none).'
}

if (& $want 'tts') {
  Write-Host '== tts: a computer voice for cards (Kokoro)' -ForegroundColor Cyan
  Pip @('kokoro-onnx==0.6.1', 'misaki[ja]==0.7.4', 'soundfile==0.14.0', 'edge-tts==7.3.1')
  $dir = Join-Path $root 'tools\tts'
  New-Item -ItemType Directory -Force $dir | Out-Null
  $files = @{
    'kokoro-v1.0.int8.onnx' = '6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb'
    'voices-v1.0.bin'       = 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d'
  }
  foreach ($name in $files.Keys) {
    $file = Join-Path $dir $name
    if (Test-Path $file) { continue }
    Invoke-WebRequest "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/$name" -OutFile $file
    if ((Get-FileHash $file -Algorithm SHA256).Hash -ne $files[$name]) {
      Remove-Item $file -Force
      throw "The download of $name does not match its checksum."
    }
  }
}

if (& $want 'claude') {
  Write-Host '== claude: Claude Code' -ForegroundColor Cyan
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    npm install -g @anthropic-ai/claude-code
    if ($LASTEXITCODE) { Write-Warning 'Installing Claude Code failed.' }
  }
  Write-Host 'Run `claude` once in a terminal and sign in. Then pick "Claude Code" under Settings -> Cards on the laptop.'
}

if (& $want 'ollama') {
  Write-Host '== ollama' -ForegroundColor Cyan
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) { winget install --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements }
    else { Write-Warning 'Install Ollama from ollama.com.' }
  }
  if (Get-Command ollama -ErrorAction SilentlyContinue) { ollama pull qwen3:8b }
  Write-Host 'Pick "Ollama on the laptop" under Settings -> Cards on the laptop.'
}

# ---------------------------------------------------------------- start
Write-Host '== start' -ForegroundColor Cyan
Start-Process -FilePath $exe
Start-Sleep -Seconds 4
try {
  $status = Invoke-RestMethod -Uri 'http://127.0.0.1:7317/api/status' -TimeoutSec 10
  Write-Host "Horu $($status.version) is running." -ForegroundColor Green
} catch {
  Write-Warning 'Horu did not answer yet - check data\horu.log'
}
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Chrome -> chrome://extensions -> Developer mode -> Load unpacked -> extension\dist'
Write-Host '  2. Tailscale on laptop and phone, then once: tailscale serve --bg 7317'
Write-Host '  3. Tray icon -> Connect phone... and scan the code in the app (Settings -> Laptop)'
Write-Host "Add modules later: scripts\install.ps1 -Modules whisper,manga"
