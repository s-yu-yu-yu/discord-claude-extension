param(
  [ValidateSet('install', 'uninstall', 'status', 'export-extension', 'stop')][string]$Action,
  [string]$Root, [string]$NodePath, [string]$Distro, [string]$LinuxUser,
  [string]$SearchPath, [string]$ClaudeConfigDir
)
$ErrorActionPreference = 'Stop'
if (!$Distro -or !$LinuxUser) { throw 'WSL distribution and Linux user are required.' }
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Distro + "`n" + $LinuxUser))).Replace('-', '').Substring(0, 12) }
finally { $sha.Dispose() }
$taskName = 'DiscordClaudeBridge-WSL-' + $hash
$stateDir = Join-Path $env:LOCALAPPDATA $taskName
$runner = Join-Path $stateDir 'run-wsl-bridge.ps1'
$settingsFile = Join-Path $stateDir 'launch.json'
function Quote-PS([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
if ($Action -eq 'export-extension') {
  $source = Join-Path (Split-Path $PSScriptRoot -Parent) 'extension'
  $target = Join-Path $stateDir 'extension'
  # Keep the Windows path stable so Chrome retains the extension ID and index.
  if (Test-Path $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Recurse
  Write-Output "Chrome extension: $target"
} elseif ($Action -eq 'install') {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $taskName }
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'run-wsl-bridge.ps1') -Destination $runner -Force
  @{ Root=$Root; NodePath=$NodePath; Distro=$Distro; LinuxUser=$LinuxUser; SearchPath=$SearchPath; ClaudeConfigDir=$ClaudeConfigDir } | ConvertTo-Json | Set-Content -LiteralPath $settingsFile -Encoding UTF8
  $script = '& ' + (Quote-PS $runner)
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  $actionSpec = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + $encoded) -WorkingDirectory $stateDir
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $taskName -Action $actionSpec -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Enable-ScheduledTask -TaskName $taskName | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-Output "Registered $taskName ($Distro / $LinuxUser). Log: $stateDir\bridge.log"
} elseif ($Action -eq 'stop') {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    Stop-ScheduledTask -TaskName $taskName
  }
} elseif ($Action -eq 'uninstall') {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  # Retain the exported extension and logs; remove only this task's launcher.
  foreach ($file in @($runner, $settingsFile)) { if (Test-Path $file) { Remove-Item -LiteralPath $file } }
  Write-Output "Removed $taskName"
} else {
  Write-Output "Task: $taskName ($Distro / $LinuxUser). Log: $stateDir\bridge.log"
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (!$task) { Write-Output 'not registered'; exit 0 }
  $task | Select-Object TaskName, State
  Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, LastTaskResult
}
