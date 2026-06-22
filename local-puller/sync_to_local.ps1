[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Windows 本地备份拉取与自适应删增同步脚本 (sync_to_local.ps1)

$LocalBackupDir = "D:\Backup\VPS_Backup"
$VpsOrigin = "http://23.254.235.234:9999"
$Token = "df856a4ae9c4b1ebcd52473568a499bf"

if (-not (Test-Path $LocalBackupDir)) {
    New-Item -ItemType Directory -Force -Path $LocalBackupDir | Out-Null
}

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "         Shield-Backup 本地冷备份自适应删增同步" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

$ListUrl = "$VpsOrigin/api/backups/list?token=$Token"
Write-Host ">>> 正在连接 VPS 获取活跃快照列表..." -ForegroundColor Yellow
try {
    $Files = Invoke-RestMethod -Uri $ListUrl -Method Get
} catch {
    Write-Host "❌ 无法连接到 VPS 或 API Token 验证错误！" -ForegroundColor Red
    Write-Host "错误信息: $_" -ForegroundColor Red
    exit 1
}

$VpsFileNames = @()
foreach ($File in $Files) {
    $VpsFileNames += $File.Path
}

$DownloadCount = 0
foreach ($File in $Files) {
    $FileName = $File.Path
    if ($FileName -match "restore_system_" -or $FileName -match "restore_db_") {
        continue
    }

    $LocalPath = Join-Path $LocalBackupDir $FileName

    if (-not (Test-Path $LocalPath)) {
        Write-Host ">>> 发现新快照，正在下载: $FileName" -ForegroundColor Yellow
        $DownloadUrl = "$VpsOrigin/api/backups/download?file=$FileName&token=$Token"
        try {
            Invoke-WebRequest -Uri $DownloadUrl -OutFile $LocalPath
            $DownloadCount++
            Write-Host "  [OK] 下载成功 (大小: $([Math]::Round($File.Size / 1MB, 2)) MB)" -ForegroundColor Green
        } catch {
            Write-Host "  [ERROR] 下载文件失败！" -ForegroundColor Red
        }
    }
}

$DeleteCount = 0
if (Test-Path $LocalBackupDir) {
    $LocalFiles = Get-ChildItem -Path $LocalBackupDir -File
    foreach ($LocalFile in $LocalFiles) {
        $Name = $LocalFile.Name
        if ($Name -match "^db_hourly_" -or $Name -match "^system_") {
            if ($Name -notin $VpsFileNames) {
                Write-Host ">>> 快照在 VPS 上已被淘汰，本地同步删除: $Name" -ForegroundColor Red
                Remove-Item -Path $LocalFile.FullName -Force
                $DeleteCount++
            }
        }
    }
}

Write-Host ""
Write-Host "🎉 同步完成！新增下载 $DownloadCount 个快照，本地清理 $DeleteCount 个过期快照。" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Cyan
