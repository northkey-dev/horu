Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server/src/main.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*_worker.py*' -or $_.CommandLine -like '*Suwayomi-Server.jar*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Milliseconds 800
$d = Join-Path $PSScriptRoot '..\..\data-e2e'
Get-ChildItem $d | Where-Object { $_.Name -ne 'dict' -and $_.Name -ne 'suwayomi' } | Remove-Item -Recurse -Force
Invoke-RestMethod -Uri 'http://127.0.0.1:8765' -Method Post -Body '{"action":"deleteDecks","version":6,"params":{"decks":["Horu E2E Test"],"cardsToo":true}}' | Out-Null
'reset done'
