# PowerShell 脚本：VPS 状态同步工具 (vps_knowledge/sync_vps.ps1)
# 作用：自动 SSH 连接 VPS 并刷新本地의 vps_blueprint.md 物理看板，免去手动记录

$ErrorActionPreference = "Stop"

# 定义文件路径
$blueprintPath = Join-Path $PSScriptRoot "vps_blueprint.md"
$sshConfigPath = Join-Path $PSScriptRoot "../.ssh/config"

Write-Host "====== 🔌 开始连接 VPS 收集物理状态 ======" -ForegroundColor Cyan

# 1. 定义在远端执行的原始 Bash 采集脚本
$remoteScript = @'
echo "===SYSINFO==="
uname -srm
uptime -p
free -h
df -h /

echo "===PORTS==="
ss -tuln

echo "===DOCKER==="
containers=$(docker ps -a -q)
if [ -n "$containers" ]; then
    docker inspect $containers --format '{{.Name}}||{{.State.Status}}||{{.Config.Image}}||{{.State.StartedAt}}||{{json .Config.Labels}}' 2>/dev/null
fi
'@

# 2. 执行管道重定向输入并捕获输出
try {
    # 终极解决方案：在远端使用 tr -d '\r' 接收管道流，彻底过滤 Windows 管道强行补回的回车符 (\r)
    # 这保证了发送给远端 bash 的命令绝对没有任何语法报错
    $sshOutput = $remoteScript | ssh -F $sshConfigPath vps "tr -d '\r' | bash"
} catch {
    Write-Error "❌ SSH 连接 VPS 失败，请检查您的网络连接、IP 或密钥配置！"
    exit 1
}

Write-Host "✅ 远端原始数据拉取成功，开始在本地解析整理..." -ForegroundColor Green

# 3. 初始化解析变量
$sysInfoSection = @()
$portsSection = @()
$dockerContainers = @()
$traefikRoutes = @()

$currentSection = ""

# 4. 逐行解析 SSH 返回的输出内容
foreach ($line in $sshOutput) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    
    if ($line.Trim() -eq "===SYSINFO===") { $currentSection = "sysinfo"; continue }
    if ($line.Trim() -eq "===PORTS===") { $currentSection = "ports"; continue }
    if ($line.Trim() -eq "===DOCKER===") { $currentSection = "docker"; continue }

    if ($currentSection -eq "sysinfo") {
        $sysInfoSection += $line.Trim()
    }
    elseif ($currentSection -eq "ports") {
        $portsSection += $line.Trim()
    }
    elseif ($currentSection -eq "docker") {
        # 分割提取的 Docker 字段，限制最多分割为 5 部分，防止 Traefik Label 中的 || 破坏字段分割数
        $parts = $line -split '\|\|', 5
        if ($parts.Length -eq 5) {
            $name = $parts[0].TrimStart('/') # 去除容器名前面的斜杠
            $status = $parts[1]
            $image = $parts[2]
            
            # 简化时间显示，仅截取日期与时分
            $startedAt = $parts[3]
            if ($startedAt -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}') {
                $startedAt = $Matches[0].Replace('T', ' ')
            }
            $labelsJson = $parts[4]

            # 存储容器基本状态
            $dockerContainers += [PSCustomObject]@{
                Name = $name
                Status = $status
                Image = $image
                StartedAt = $startedAt
            }

            # 解析标签寻找 Traefik 反代路由规则
            if ($labelsJson -and $labelsJson -ne "null") {
                try {
                    $labels = ConvertFrom-Json $labelsJson
                    foreach ($prop in $labels.psobject.Properties) {
                        # 查找类似于 traefik.http.routers.[名称].rule 的标签
                        if ($prop.Name -like "traefik.http.routers.*.rule") {
                            $routeRule = $prop.Value
                            $traefikRoutes += [PSCustomObject]@{
                                Route = $routeRule
                                Target = $name
                            }
                        }
                    }
                } catch {
                    # 标签解析 JSON 容错
                }
            }
        }
    }
}

# 6. 将解析后的数据拼装成规范的 Markdown 段落
$markdownBuffer = @()

# A. 系统资源看板
$markdownBuffer += "### 🖥️ 系统状态与硬件指标"
$markdownBuffer += "| 指标项 | 当前状态 |"
$markdownBuffer += "| :--- | :--- |"

foreach ($info in $sysInfoSection) {
    if ($info -match "^Linux") {
        $markdownBuffer += '| 内核版本 | `' + $info + '` |'
    } elseif ($info -match "^up") {
        $markdownBuffer += '| 运行时间 | `' + $info + '` |'
    } elseif ($info -match "^Mem:\s+(\S+)\s+(\S+)") {
        # 匹配 free -h 里的内存数据 (total, used)
        $total = $Matches[1]
        $used = $Matches[2]
        $markdownBuffer += "| 内存使用 | 已用 $used / 共 $total |"
    } elseif ($info -match "^\S+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+/$") {
        # 匹配 df -h / 里的磁盘数据 (size, used, percent)
        $size = $Matches[1]
        $used = $Matches[2]
        $percent = $Matches[4]
        $markdownBuffer += "| 磁盘容量 (根目录) | 已用 $used / 共 $size ($percent) |"
    }
}
$markdownBuffer += ""

# B. 暴露端口映射
$markdownBuffer += "### 🔌 宿主机 TCP 监听端口"
$markdownBuffer += "目前宿主机在公网/局域网实际开启监听的 TCP 端口列表（不含容器内部隔离端口）："
$markdownBuffer += ""
$markdownBuffer += "| 端口号 | 监听状态 | 常见服务参考 |"
$markdownBuffer += "| :--- | :--- | :--- |"

$uniquePorts = @()
foreach ($line in $portsSection) {
    if ($line -match 'tcp\s+LISTEN\s+\S+\s+\S+\s+(\S+):(\d+)\s+') {
        $port = $Matches[2]
        if ($port -notin $uniquePorts) {
            $uniquePorts += $port
        }
    }
}

$uniquePorts = $uniquePorts | Sort-Object {[int]$_}
foreach ($port in $uniquePorts) {
    $service = "未知/容器网关"
    if ($port -eq "22") { $service = "SSH 服务 (安全登录)" }
    elseif ($port -eq "80") { $service = "HTTP 网关 (Traefik)" }
    elseif ($port -eq "443") { $service = "HTTPS 安全网关 (Traefik)" }
    $markdownBuffer += "| **$port** | LISTEN | $service |"
}
$markdownBuffer += ""

# C. 容器存活状态
$markdownBuffer += "### 🐳 Docker 容器状态清单"
$markdownBuffer += "| 容器名称 | 运行状态 | 镜像版本 | 启动时间 |"
$markdownBuffer += "| :--- | :--- | :--- | :--- |"
foreach ($container in $dockerContainers) {
    $statusColor = $container.Status
    if ($container.Status -eq "running") {
        $statusColor = "🟢 running"
    } else {
        $statusColor = "🔴 $statusColor"
    }
    $markdownBuffer += '| `' + $container.Name + '` | ' + $statusColor + ' | `' + $container.Image + '` | ' + $container.StartedAt + ' |'
}
$markdownBuffer += ""

# D. Traefik 反向代理拓扑
$markdownBuffer += "### 🌐 Traefik 反向代理路由 (二级域名绑定)"
$markdownBuffer += "| 反代路由规则 (域名/路径) | 转发目标容器 |"
$markdownBuffer += "| :--- | :--- |"
if ($traefikRoutes.Count -eq 0) {
    $markdownBuffer += "| *(无反向代理路由规则，或均在静态配置文件中定义)* | - |"
} else {
    $traefikRoutes = $traefikRoutes | Sort-Object Target
    foreach ($route in $traefikRoutes) {
        $readableRoute = $route.Route -replace '\\`', '`'
        $markdownBuffer += '| `' + $readableRoute + '` | `' + $route.Target + '` |'
    }
}
$markdownBuffer += ""

$newStatusMarkdown = $markdownBuffer -join "`n"

# 7. 读取蓝图文件，精确定位锚点，并替换写入
if (Test-Path $blueprintPath) {
    $content = [System.IO.File]::ReadAllText($blueprintPath, [System.Text.Encoding]::UTF8)
    
    $pattern = "(?s)(<!-- DOCKER_STATUS_START -->\r?\n).*?(\r?\n<!-- DOCKER_STATUS_END -->)"
    $replacement = "`${1}$newStatusMarkdown`${2}"
    
    $newContent = [System.Text.RegularExpressions.Regex]::Replace($content, $pattern, $replacement)
    
    [System.IO.File]::WriteAllText($blueprintPath, $newContent, [System.Text.Encoding]::UTF8)
    
    Write-Host "====== 🎉 物理状态已完美同步至 vps_blueprint.md！ ====== " -ForegroundColor Green
} else {
    Write-Warning "⚠️ 未找到 vps_blueprint.md 文件，无法写入同步 data！"
}

