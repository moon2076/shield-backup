# ==============================================================================
# Windows 本地备份解密助手 (decrypt_local.ps1)
# 作用：帮助您在 Windows 电脑上一键解密并解压来自 Telegram 或云盘的 .enc 加密备份包
# ==============================================================================

# 设置错误处理
$ErrorActionPreference = "Stop"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "         Shield-Backup 本地数据包一键解密工具" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. 引导用户选择加密备份文件
Add-Type -AssemblyName System.Windows.Forms
$FileBrowser = New-Object System.Windows.Forms.OpenFileDialog -Property @{
    InitialDirectory = [System.IO.Path]::Combine($env:USERPROFILE, "Downloads")
    Filter = "加密备份文件 (*.enc)|*.enc|所有文件 (*.*)|*.*"
    Title = "请选择您要解密的加密备份文件 (.enc)"
}

$ShowDialog = $FileBrowser.ShowDialog()
if ($ShowDialog -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Warning "⚠️ 您取消了文件选择，解密退出。"
    exit
}

$EncryptedFile = $FileBrowser.FileName
$TargetFolder = Split-Path $EncryptedFile

# 2. 读取解密密码
$Password = Read-Host -Prompt "🔑 请输入您的备份加密密码 (BACKUP_PASSWORD)"
if ([string]::IsNullOrWhiteSpace($Password)) {
    Write-Error "❌ 密码不能为空！"
    exit
}

# 定义输出解密压缩包的目标路径
$DecryptedTarGz = Join-Path $TargetFolder ((Get-Item $EncryptedFile).BaseName + ".tar.gz")
$RestoreFolder = Join-Path $TargetFolder ((Get-Item $EncryptedFile).BaseName + "_restored")

Write-Host "`n>>> 正在调用 OpenSSL 进行解密..." -ForegroundColor Yellow

# 3. 检查本地是否安装了 OpenSSL (通常 Git for Windows 会自带 openssl.exe)
$OpenSSLPath = "openssl"
if (-not (Get-Command $OpenSSLPath -ErrorAction SilentlyContinue)) {
    # 尝试在 Git 默认安装目录里寻找
    $GitOpenSSL = "C:\Program Files\Git\usr\bin\openssl.exe"
    if (Test-Path $GitOpenSSL) {
        $OpenSSLPath = $GitOpenSSL
    } else {
        Write-Error "❌ 未在您的系统上找到 OpenSSL！`n请安装 Git for Windows (它内置了 OpenSSL)，或者手动将 OpenSSL 安装路径添加至系统环境变量。"
        exit
    }
}

try {
    # 执行解密命令，pbkdf2 加密算法与备份脚本严格一致
    & $OpenSSLPath enc -d -aes-256-cbc -salt -pbkdf2 -pass pass:"$Password" -in $EncryptedFile -out $DecryptedTarGz
    Write-Host "✅ 解密成功！已生成标准压缩包: $DecryptedTarGz" -ForegroundColor Green
} catch {
    Write-Error "❌ 解密失败！请检查密码是否正确，或者备份文件是否损坏。"
    exit
}

# 4. 尝试解压 .tar.gz 文件
Write-Host "`n>>> 正在为您解压数据包..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $RestoreFolder | Out-Null

if (Get-Command "tar" -ErrorAction SilentlyContinue) {
    try {
        # 使用 Windows 10/11 内置的 tar 命令进行解压
        & tar -xzf $DecryptedTarGz -C $RestoreFolder
        Write-Host "🎉 解压完成！所有备份数据已还原至以下目录：" -ForegroundColor Green
        Write-Host "📂 $RestoreFolder" -ForegroundColor Cyan
        
        # 询问是否清理中间的 .tar.gz 文件
        $CleanUp = Read-Host -Prompt "是否删除解密出的临时包 ($((Get-Item $DecryptedTarGz).Name))？ (Y/N)"
        if ($CleanUp -eq "Y" -or $CleanUp -eq "y") {
            Remove-Item $DecryptedTarGz -Force
            Write-Host "🗑️ 临时压缩包已清理。" -ForegroundColor Gray
        }
    } catch {
        Write-Warning "⚠️ 调用系统 tar 解压失败。不过您的文件已解密成功，您可以使用 7-Zip 或 WinRAR 手动解压 $DecryptedTarGz 文件。"
    }
} else {
    Write-Warning "⚠️ 未找到系统 tar 命令。您的文件已解密成功，请使用 7-Zip 或 WinRAR 手动解压 $DecryptedTarGz 文件。"
}
Write-Host "`n====== 任务结束，感谢使用！ ======" -ForegroundColor Cyan
