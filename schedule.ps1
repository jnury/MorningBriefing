# Registers (or re-registers) the daily 05:00 Morning Briefing task.
# Run once from an elevated PowerShell in the repo root:
#   powershell -ExecutionPolicy Bypass -File .\schedule.ps1

$ErrorActionPreference = 'Stop'

$repo = $PSScriptRoot
$node = (Get-Command node).Source
$taskName = 'MorningBriefing'

$action = New-ScheduledTaskAction -Execute $node -Argument 'generate.mjs' -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At 5:00am

# StartWhenAvailable = catch up after a missed 05:00 (e.g. PC was off).
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Generate and publish the daily morning briefing' -Force

Write-Host "Scheduled task '$taskName' registered for 05:00 daily (StartWhenAvailable)."
