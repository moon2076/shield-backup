# Windows 本地冷备定时下载脚本 (sync_to_local.ps1)
# 作用：定时通过安全 API Token 从远程 VPS 上自动下载拉取最新快照到本地硬盘

$LocalBackupDir = "D:\Work_Project\VPS_RN\VPS_Backup"
$VpsOrigin = "https://shield-backup.xxxiong.top"
$Token = "df856a4ae9c4b1ebcd52473568a499bf"

if (-not (Test-Path $LocalBackupDir)) {
    New-Item -ItemType Directory -Path $LocalBackupDir | Out-Null
}

Write-Host ">>> 正在从远程 VPS 安全通道下载最新热备加密包..." -ForegroundColor Cyan
try {
    # 直接请求最新的快照包，免遭 Authelia 拦截
    $DownloadUrl = "$VpsOrigin/api/backups/download?file=latest&token=$Token"
    
    # 获取响应以提取真实文件名
    $Response = Invoke-WebRequest -Uri $DownloadUrl -Method Get -OutFile "$LocalBackupDir\latest_temp.enc" -PassThru
    
    $ContentDisposition = $Response.Headers["Content-Disposition"]
    $FileName = "vps_backup_latest.tar.gz.enc"
    if ($ContentDisposition -and $ContentDisposition -match "filename=(.+)") {
        $FileName = $Matches[1].Trim()
    }
    
    # 覆盖式安全写入
    if (Test-Path "$LocalBackupDir\$FileName") {
        Remove-Item "$LocalBackupDir\$FileName" -Force
    }
    Rename-Item -Path "$LocalBackupDir\latest_temp.enc" -NewName $FileName
    
    Write-Host "🎉 恭喜！最新加密备份包已成功安全同步至: $LocalBackupDir\$FileName" -ForegroundColor Green
} catch {
    Write-Host "❌ 自动拉取失败！请检查 VPS 连通状态或 API Token 是否被重置。错误信息: $_" -ForegroundColor Red
}