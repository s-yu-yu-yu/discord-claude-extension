$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'launch.json') -Raw | ConvertFrom-Json
$log = Join-Path $PSScriptRoot 'bridge.log'
if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) { Move-Item -Force $log ($log + '.previous') }
$linuxEnv = @('PATH=' + $config.SearchPath)
if ($config.ClaudeConfigDir) { $linuxEnv += 'CLAUDE_CONFIG_DIR=' + $config.ClaudeConfigDir }
$wslArgs = @('--distribution', $config.Distro, '--user', $config.LinuxUser, '--cd', $config.Root, '--exec', '/usr/bin/env') + $linuxEnv + @($config.NodePath, ($config.Root + '/scripts/wsl-bridge.mjs'), '--config', ($config.Root + '/bridge/config.json'))
function Quote-WindowsArg([string]$value) {
  return '"' + (($value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}
# Construct the native command line explicitly: PowerShell 5.1 loses embedded
# quotes when splatting arguments into a native executable.
$arguments = ($wslArgs | ForEach-Object { Quote-WindowsArg $_ }) -join ' '
$child = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wsl.exe') -ArgumentList $arguments -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError (Join-Path $PSScriptRoot 'bridge.error.log')
exit $child.ExitCode
