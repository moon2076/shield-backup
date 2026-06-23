# Windows 本地备份拉取与自适应删增同步脚本 (sync_to_local.ps1)
param (
    [switch]$Silent = $false
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$LocalBackupDir = "D:\Backup\VPS_Backup"
$VpsOrigin = "https://shield-backup.xxxiong.top"
$Token = "b20dec16715f9a1066b14765b1e34c58"

if (-not (Test-Path $LocalBackupDir)) {
    New-Item -ItemType Directory -Force -Path $LocalBackupDir | Out-Null
}

if (-not $Silent) {
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host "         Shield-Backup 本地冷备份自适应增删同步" -ForegroundColor Cyan
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host ">>> 正在连接 VPS 请求比对逻辑差异清单大厅..." -ForegroundColor Yellow
}

$LocalFilesList = @()
if (Test-Path $LocalBackupDir) {
    $LocalFilesList = Get-ChildItem -Path $LocalBackupDir -File | ForEach-Object {
        [PSCustomObject]@{
            name = $_.Name
            size = $_.Length
        }
    }
}

$ManifestUrl = "$VpsOrigin/api/local-pull/manifest?token=$Token"
$Headers = @{ "Content-Type" = "application/json" }
$Body = @{ files = @($LocalFilesList) } | ConvertTo-Json -Depth 4

try {
    $Response = Invoke-RestMethod -Uri $ManifestUrl -Method Post -Headers $Headers -Body $Body
} catch {
    if (-not $Silent) {
        Write-Host "❌ 无法连接到 VPS 差异清单服务，或 API Token 验证错误！" -ForegroundColor Red
        Write-Host "错误信息: $_" -ForegroundColor Red
        Read-Host "按回车键退出..."
    }
    exit 1
}

$Downloads = $Response.downloads
$Deletes = $Response.deletes

# 1. 自动物理删除已移出队列的淘汰包
$DeleteCount = 0
if ($Deletes) {
    foreach ($FileToDelete in $Deletes) {
        $FilePath = Join-Path $LocalBackupDir $FileToDelete
        if (Test-Path $FilePath) {
            if (-not $Silent) { Write-Host ">>> 快照已在 VPS 清单中淘汰，正在删除本地物理包: $FileToDelete" -ForegroundColor Red }
            Remove-Item -Path $FilePath -Force
            $DeleteCount++
        }
    }
}

# 2. 流式 WebRequest 安全下载新增包
$DownloadCount = 0
$DownloadSize = 0
if ($Downloads) {
    foreach ($FileToDownload in $Downloads) {
        $FileName = $FileToDownload.Path
        $FileSize = $FileToDownload.Size
        $LocalPath = Join-Path $LocalBackupDir $FileName
        
        if (-not $Silent) { Write-Host ">>> 发现新增差异快照包，正在流式下载: $FileName ..." -ForegroundColor Yellow }
        $DownloadUrl = "$VpsOrigin/api/backups/download?file=$FileName&token=$Token"
        try {
            Invoke-WebRequest -Uri $DownloadUrl -OutFile $LocalPath
            $DownloadCount++
            $DownloadSize += $FileSize
            if (-not $Silent) { Write-Host "  [OK] 下载成功 (大小: $([Math]::Round($FileSize / 1MB, 2)) MB)" -ForegroundColor Green }
        } catch {
            if (-not $Silent) { Write-Host "  [ERROR] 下载文件 $FileName 失败！" -ForegroundColor Red }
        }
    }
}

# 3. 漂浮式系统通知（静默启动下仍会显示）
$NotifyMessage = ""
if ($DownloadCount -gt 0 -or $DeleteCount -gt 0) {
    $NotifyMessage = "冷备同步已成功完成！
新增下载了 $DownloadCount 个快照包 (共 $([Math]::Round($DownloadSize / 1MB, 2)) MB)。
本地物理清理了 $DeleteCount 个过期包。"
} else {
    $NotifyMessage = "冷备同步比对完毕。
本地已是最新状态，无差异快照需要拉取。"
}

function Show-Notification {
    param (
        [string]$Title,
        [string]$Message
    )
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $balloon = New-Object System.Windows.Forms.NotifyIcon
        $path = (Get-Process -id $pid).Path
        $balloon.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
        $balloon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $balloon.BalloonTipText = $Message
        $balloon.BalloonTipTitle = $Title
        $balloon.Visible = $true
        $balloon.ShowBalloonTip(5000)
        Start-Sleep -Seconds 2
        $balloon.Dispose()
    } catch {}
}

Show-Notification -Title "Shield-Backup 本地同步简报" -Message $NotifyMessage

if (-not $Silent) {
    Write-Host "🎉 同步完成！新增下载 $DownloadCount 个快照，本地清理 $DeleteCount 个过期快照。" -ForegroundColor Green
    Write-Host "==================================================================" -ForegroundColor Cyan
    Read-Host "按回车键退出..."
}
