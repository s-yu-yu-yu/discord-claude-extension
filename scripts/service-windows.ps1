param(
  [ValidateSet('install', 'uninstall', 'status')][string]$Action,
  [string]$Root,
  [string]$NodePath
)
$ErrorActionPreference = 'Stop'
$taskName = 'DiscordClaudeBridge'
if ($Action -eq 'install') {
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) { Stop-ScheduledTask -TaskName $taskName }
  $script = Join-Path $Root 'scripts\run-bridge.ps1'
  $arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "' + $script + '" -NodePath "' + $NodePath + '"'
  $actionSpec = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $arguments -WorkingDirectory $Root
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $taskName -Action $actionSpec -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-Output "Registered $taskName. Logs: $env:LOCALAPPDATA\DiscordClaudeBridge\bridge.log"
} elseif ($Action -eq 'uninstall') {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  Write-Output "Removed $taskName"
} else {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (!$task) { Write-Output 'not registered'; exit 0 }
  $task | Select-Object TaskName, State
  Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, LastTaskResult
}
