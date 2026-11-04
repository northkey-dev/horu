# Stops Horu and removes the autostart entry. Your data (data\) and Anki cards stay.
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'tools\launcher\Horu.exe'
if (Test-Path $exe) { & $exe --stop }
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Horu' -ErrorAction SilentlyContinue
Write-Host 'Horu stopped and removed from autostart.'
