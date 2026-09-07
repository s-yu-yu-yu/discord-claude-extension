param([Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $env:LOCALAPPDATA 'DiscordClaudeBridge'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'bridge.log'
if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) {
  Move-Item -Force $log ($log + '.previous')
}
# Merge native stderr into the log without treating diagnostic output as a PS failure.
$ErrorActionPreference = 'Continue'
& $NodePath (Join-Path $root 'bridge\src\index.js') --config (Join-Path $root 'bridge\config.json') >> $log 2>&1
exit $LASTEXITCODE
