[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Windows 任务计划程序一键注册脚本 (setup_task.ps1)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host ">>> 正在申请管理员权限以注册每日开机任务..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File ""$PSCommandPath""" -Verb RunAs
    exit
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$SyncScriptPath = Join-Path $ScriptDir "sync_to_local.ps1"
$VbsScriptPath = Join-Path $ScriptDir "run_silent.vbs"

if (-not (Test-Path $SyncScriptPath)) {
    Write-Host "❌ 错误：在同一目录下未找到 sync_to_local.ps1 同步脚本！" -ForegroundColor Red
    Read-Host "按回车键退出..."
    exit 1
}
if (-not (Test-Path $VbsScriptPath)) {
    Write-Host "❌ 错误：在同一目录下未找到 run_silent.vbs 隐藏辅助脚本！" -ForegroundColor Red
    Read-Host "按回车键退出..."
    exit 1
}

$TaskName = "ShieldBackupSyncTask"
$Action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument """$VbsScriptPath"" ""$SyncScriptPath"""
$Trigger = New-ScheduledTaskTrigger -Daily -At "00:05"
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -User "NT AUTHORITY\SYSTEM" -Force | Out-Null

Write-Host "==================================================================" -ForegroundColor Green
Write-Host "🎉 成功！已将同步脚本注册至 Windows 任务计划程序中。" -ForegroundColor Green
Write-Host "任务名称: $TaskName" -ForegroundColor Gray
Write-Host "运行方式: 通过 run_silent.vbs 实现完全后台无闪烁静默同步。" -ForegroundColor Gray
Write-Host "运行时间: 每日 00:05 触发。开机若错过时间将立刻自动补运行。" -ForegroundColor Gray
Write-Host "==================================================================" -ForegroundColor Green
Read-Host "设置成功！按回车键退出..."
