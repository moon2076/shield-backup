#!/bin/bash
# ==============================================================================
# Shield-Backup 终极一键全自动还原与灾备脚本 (one_click_restore.sh)
# 作用：从零拉起空白 VPS，自动安装 Docker，自动扫描解密释放配置、导入镜像、还原数据库，
#       并自动导入面板配置，一键恢复所有业务。
# 使用方法：
#   sudo bash one_click_restore.sh [备份目录，默认当前目录] [--non-interactive]
#   或通过环境变量传入密码：
#   sudo BACKUP_PASSWORD=xxxx bash one_click_restore.sh /path/to/backups --non-interactive
# ==============================================================================

# 强行要求以 root 身份运行
if [ "$EUID" -ne 0 ]; then
    echo "❌ 错误：请使用 root 权限运行此脚本！(例如: sudo bash one_click_restore.sh ...)"
    exit 1
fi

export TZ="Asia/Taipei"
CURRENT_TIME=$(date "+%Y-%m-%d %H:%M:%S")

# 解析参数
BACKUP_DIR="."
NON_INTERACTIVE=false

for arg in "$@"; do
    if [ "$arg" = "--non-interactive" ]; then
        NON_INTERACTIVE=true
    elif [ -d "$arg" ]; then
        BACKUP_DIR="$arg"
    fi
done

# 转换为绝对路径
BACKUP_DIR=$(cd "$BACKUP_DIR" && pwd)

echo "=================================================================="
echo "🎯 [$CURRENT_TIME] Shield-Backup 终极一键全自动恢复向导"
echo "   备份扫描目录: $BACKUP_DIR"
echo "=================================================================="

# ------------------------------------------------------------------------------
# 步骤 0: 扫描目录，自动识别并分类所有备份文件
# ------------------------------------------------------------------------------
echo ">>> [步骤 0] 正在扫描并分类备份文件..."

SYSTEM_FULL_FILE=$(ls -t "$BACKUP_DIR"/system_full_*.tar.gz.enc 2>/dev/null | head -n 1)
SYSTEM_IMG_FILE=$(ls -t "$BACKUP_DIR"/system_images_*.tar.gz.enc 2>/dev/null | head -n 1)
DB_HOURLY_FILE=$(ls -t "$BACKUP_DIR"/db_hourly_*.tar.gz.enc 2>/dev/null | head -n 1)
SETTINGS_FILE=$(ls -t "$BACKUP_DIR"/shield_backup_settings.enc 2>/dev/null | head -n 1)

# 向后兼容检测 (如果找不到 system_full_*，但有 system_inc_*)
if [ -z "$SYSTEM_FULL_FILE" ]; then
    SYSTEM_FULL_FILE=$(ls -t "$BACKUP_DIR"/system_inc_*.tar.gz.enc 2>/dev/null | head -n 1)
fi

echo "  📁 系统配置归档包: $([ -n "$SYSTEM_FULL_FILE" ] && echo "$(basename "$SYSTEM_FULL_FILE")" || echo "❌ 未找到")"
echo "  🐳 Docker 镜像包:  $([ -n "$SYSTEM_IMG_FILE" ] && echo "$(basename "$SYSTEM_IMG_FILE")" || echo "❌ 未找到（恢复时将从网络拉取）")"
echo "  🗃️ 数据库热备包:   $([ -n "$DB_HOURLY_FILE" ] && echo "$(basename "$DB_HOURLY_FILE")" || echo "❌ 未找到")"
echo "  ⚙️ 控制中心设置包: $([ -n "$SETTINGS_FILE" ] && echo "$(basename "$SETTINGS_FILE")" || echo "❌ 未找到")"

if [ -z "$SYSTEM_FULL_FILE" ] && [ -z "$DB_HOURLY_FILE" ] && [ -z "$SETTINGS_FILE" ]; then
    echo "❌ 错误：在目录 [$BACKUP_DIR] 中未检测到任何有效的备份包，无法继续恢复。"
    exit 1
fi

# ------------------------------------------------------------------------------
# 步骤 3 & 1: 输入并验证密码
# ------------------------------------------------------------------------------
echo ""
echo ">>> [步骤 1] 身份凭证校验与加密层检测..."

DECRYPT_PASSWORD=""
if [ -n "$BACKUP_PASSWORD" ]; then
    DECRYPT_PASSWORD="$BACKUP_PASSWORD"
    echo "  [INFO] 自动采用环境变量中传入的密码进行校验..."
fi

# 选择一个用来测试解密的文件
TEST_FILE=""
if [ -n "$SYSTEM_FULL_FILE" ]; then
    TEST_FILE="$SYSTEM_FULL_FILE"
elif [ -n "$DB_HOURLY_FILE" ]; then
    TEST_FILE="$DB_HOURLY_FILE"
else
    TEST_FILE="$SETTINGS_FILE"
fi

while true; do
    if [ -z "$DECRYPT_PASSWORD" ]; then
        read -s -p "🔑 请输入备份时设置的加密主密码 (BACKUP_PASSWORD): " DECRYPT_PASSWORD
        echo ""
    fi

    if [ -z "$DECRYPT_PASSWORD" ]; then
        echo "❌ 错误：密码不能为空！"
        if [ "$NON_INTERACTIVE" = true ]; then exit 1; fi
        continue
    fi

    # 校验密码是否能正确解密头部 (头 1MB，测试是否能通过 tar 列出文件或者解出有效内容)
    if [[ "$(basename "$TEST_FILE")" == *"settings.enc" ]]; then
        # settings.enc 不是 tar.gz，只是纯 json 加密，直接用 openssl 校验
        if openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass pass:"$DECRYPT_PASSWORD" -in "$TEST_FILE" &>/dev/null; then
            echo "  [OK] 密码校验成功！"
            break
        fi
    else
        # 针对 tar.gz.enc，用 head + openssl + tar -t 快速校验密码
        if head -c 1048576 "$TEST_FILE" | openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass pass:"$DECRYPT_PASSWORD" 2>/dev/null | tar -t &>/dev/null; then
            echo "  [OK] 密码校验成功！"
            break
        fi
    fi

    echo "❌ 错误：解密校验失败！密码不正确，或者文件阻碍解密。"
    # 检测是否可能是 rclone Crypt 格式 (文件前 8 字节为 RCLONE\x00\x00)
    HEADER_HEX=$(head -c 8 "$TEST_FILE" | xxd -p 2>/dev/null || od -tx1 -An "$TEST_FILE" | head -n 1 | tr -d ' ' | cut -c 1-16)
    if [[ "$HEADER_HEX" == *"52434c4f4e4500"* ]]; then
        echo "  ⚠️ 检测到文件头部含有 rclone Crypt 特征码。"
        echo "  这表明您直接复制了云端经 rclone Crypt 二次加密的原始块。"
        echo "  请先在宿主机配置 rclone，并使用 'rclone copy' 或 'rclone sync' 从 crypt 远端下载解密后的文件。"
    fi

    if [ "$NON_INTERACTIVE" = true ]; then
        echo "❌ 非交互模式下解密校验失败，程序退出。"
        exit 1
    fi
    DECRYPT_PASSWORD="" # 清空密码，重新循环输入
done

# ------------------------------------------------------------------------------
# 步骤 2: 展示恢复范围确认表
# ------------------------------------------------------------------------------
if [ "$NON_INTERACTIVE" = false ]; then
    echo ""
    echo "=================================================================="
    echo "📋 恢复范围预览与确认 (Restore Preview)"
    echo "=================================================================="
    echo "即将执行以下恢复流程："
    [ -n "$SYSTEM_FULL_FILE" ] && echo "  1. 🛠️  系统骨架配置还原：释放 $(basename "$SYSTEM_FULL_FILE") 至 /opt/stacks"
    [ -n "$SYSTEM_IMG_FILE" ] && echo "  2. 🐳  本地 Docker 镜像导入：解密并 docker load $(basename "$SYSTEM_IMG_FILE")"
    [ -n "$SETTINGS_FILE" ] && echo "  3. ⚙️  控制中心设置还原：还原 settings.json/rclone.conf 并恢复调度规则"
    [ -n "$DB_HOURLY_FILE" ] && echo "  4. 🗃️  数据库热备覆盖还原：覆盖 Vaultwarden/LLDAP 等核心 SQLite 数据"
    echo "  5. 🔄  自动按依赖顺序启动所有 Docker compose 容器项目"
    echo "=================================================================="
    read -p "❓ 确认执行恢复吗？(y/n): " CONFIRM_RESTORE
    if [ "$CONFIRM_RESTORE" != "y" ] && [ "$CONFIRM_RESTORE" != "Y" ]; then
        echo "❌ 恢复操作已取消。"
        exit 0
    fi
fi

# ------------------------------------------------------------------------------
# 步骤 4: 检测并安装 Docker & Docker Compose
# ------------------------------------------------------------------------------
echo ""
echo ">>> [步骤 4] 检查 Docker 与 Docker Compose 运行环境..."

if ! command -v docker &> /dev/null; then
    echo "  ⚠️ 未检测到 Docker，正在自动下载并安装官方最新版本..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable --now docker
    rm -f get-docker.sh
    echo "  [OK] Docker 运行底座安装完毕！"
else
    echo "  [OK] Docker 已经安装，跳过"
fi

if ! docker compose version &> /dev/null; then
    echo "  ⚠️ 未检测到 docker compose 插件，正在尝试使用包管理器安装..."
    if command -v apt-get &> /dev/null; then
        apt-get update && apt-get install -y docker-compose-plugin
    elif command -v dnf &> /dev/null; then
        dnf install -y docker-compose-plugin
    elif command -v yum &> /dev/null; then
        yum install -y docker-compose-plugin
    fi
    
    if ! docker compose version &> /dev/null; then
        echo "  ❌ 错误：Docker Compose 插件自动安装失败，请手动安装后重试。"
        exit 1
    fi
    echo "  [OK] Docker Compose 插件安装完毕！"
else
    echo "  [OK] Docker Compose 插件已经安装，跳过"
fi

# ------------------------------------------------------------------------------
# 步骤 5: 解密还原配置全量包 -> /opt/stacks
# ------------------------------------------------------------------------------
if [ -n "$SYSTEM_FULL_FILE" ]; then
    echo ""
    echo ">>> [步骤 5] 正在解密并还原系统配置骨架到 /opt/stacks ..."
    mkdir -p /opt/stacks
    
    openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass pass:"$DECRYPT_PASSWORD" -in "$SYSTEM_FULL_FILE" | tar -xz -C /opt/stacks
    
    if [ $? -eq 0 ]; then
        echo "  [OK] 系统配置释放成功！"
    else
        echo "  ❌ 错误：解压还原系统配置失败！"
        exit 1
    fi
fi

# ------------------------------------------------------------------------------
# 步骤 6: 创建 Docker proxy 网络
# ------------------------------------------------------------------------------
echo ""
echo ">>> [步骤 6] 初始化全局共享反向代理网络 'proxy'..."
if ! docker network inspect proxy &>/dev/null; then
    docker network create proxy
    echo "  [OK] Docker 外部网络 'proxy' 创建成功"
else
    echo "  [OK] Docker 外部网络 'proxy' 已经存在，跳过"
fi

# ------------------------------------------------------------------------------
# 步骤 7: 导入 Docker 镜像包
# ------------------------------------------------------------------------------
LOAD_IMAGES=false
if [ -n "$SYSTEM_IMG_FILE" ]; then
    if [ "$NON_INTERACTIVE" = true ]; then
        LOAD_IMAGES=true
    else
        echo ""
        read -p "❓ 检测到配套的本地镜像打包文件，是否导入本地镜像？(y/n) [推荐在离线或国内镜像站受限时导入]: " IMG_INPUT
        if [ "$IMG_INPUT" = "y" ] || [ "$IMG_INPUT" = "Y" ]; then
            LOAD_IMAGES=true
        fi
    fi
fi

if [ "$LOAD_IMAGES" = true ]; then
    echo ""
    echo ">>> [步骤 7] 正在解密并加载本地 Docker 镜像，此步骤较慢，请耐心等待..."
    TMP_IMG_DIR="/tmp/restore_docker_images"
    rm -rf "$TMP_IMG_DIR"
    mkdir -p "$TMP_IMG_DIR"
    
    openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass pass:"$DECRYPT_PASSWORD" -in "$SYSTEM_IMG_FILE" | tar -xz -C "$TMP_IMG_DIR"
    if [ $? -eq 0 ]; then
        find "$TMP_IMG_DIR" -type f -name "*.tar" | while read -r img_tar; do
            echo "  正在加载镜像: $(basename "$img_tar") ..."
            docker load -i "$img_tar"
        done
        echo "  [OK] 本地镜像全部导入成功！"
    else
        echo "  ❌ 错误：本地镜像解密解包失败，将跳过导入，容器拉起时将从公网下载镜像。"
    fi
    rm -rf "$TMP_IMG_DIR"
fi

# ------------------------------------------------------------------------------
# 步骤 8: 按依赖顺序拉起所有服务
# ------------------------------------------------------------------------------
echo ""
echo ">>> [步骤 8] 正在按依赖顺序拉起容器服务..."

# A. 优先拉起核心底座 (网关反代、用户身份等)
CORE_STACKS=("traefik-authelia" "ldap")
for stack in "${CORE_STACKS[@]}"; do
    if [ -d "/opt/stacks/$stack" ]; then
        echo "  正在启动核心底座项目: $stack ..."
        (cd "/opt/stacks/$stack" && docker compose up -d)
    fi
done

echo "  等待 5 秒让核心网关初始化..."
sleep 5

# B. 启动普通应用 (排除核心底座和 backup-agent 自身)
if [ -d "/opt/stacks" ]; then
    for stack_path in /opt/stacks/*; do
        if [ -d "$stack_path" ]; then
            stack=$(basename "$stack_path")
            if [[ "$stack" != "traefik-authelia" && "$stack" != "ldap" && "$stack" != "backup-agent" && "$stack" != "backup_agent" ]]; then
                if [ -f "$stack_path/compose.yaml" ] || [ -f "$stack_path/docker-compose.yml" ]; then
                    echo "  正在启动服务项目: $stack ..."
                    (cd "$stack_path" && docker compose up -d)
                fi
            fi
        fi
    done
fi

# C. 最后拉起 backup-agent 控制中心
if [ -d "/opt/stacks/backup-agent" ] || [ -d "/opt/stacks/backup_agent" ]; then
    agent_dir="/opt/stacks/backup-agent"
    if [ ! -d "$agent_dir" ]; then agent_dir="/opt/stacks/backup_agent"; fi
    echo "  正在启动控制中心: $(basename "$agent_dir") ..."
    (cd "$agent_dir" && docker compose up -d)
fi

# ------------------------------------------------------------------------------
# 步骤 9: 等待 shield-backup 就绪
# ------------------------------------------------------------------------------
echo ""
echo ">>> [步骤 9] 正在等待控制中心 (backup-agent) web api 启动就绪..."
API_READY=false
for i in $(seq 1 30); do
    if curl -s http://localhost:9999/api/status &>/dev/null; then
        API_READY=true
        echo "  [OK] 控制中心就绪！"
        break
    fi
    sleep 2
done

if [ "$API_READY" = false ]; then
    echo "  ⚠️ 警告：控制中心未在 60 秒内响应，跳过控制中心配置的自动导入。后续您可以手动在网页端导入。"
fi

# ------------------------------------------------------------------------------
# 步骤 10: 自动导入 shield_backup_settings.enc
# ------------------------------------------------------------------------------
if [ "$API_READY" = true ] && [ -n "$SETTINGS_FILE" ]; then
    echo ""
    echo ">>> [步骤 10] 正在自动将面板设置导入新启动的控制中心..."
    
    # 调用 API 进行解密和缓存
    IMPORT_RESP=$(curl -s -F "password=$DECRYPT_PASSWORD" -F "file=@$SETTINGS_FILE" http://localhost:9999/api/settings/import)
    
    if echo "$IMPORT_RESP" | grep -q "available"; then
        # 成功，向 confirm 发送确认，选择导入所有模块
        CONFIRM_RESP=$(curl -s -X POST -H "Content-Type: application/json" \
            -d '{"selected_modules":["rclone","local_pull_manifest","backup_password","custom_paths","gfs_backup_rules","system_settings","task_history_logs","labels","server_backup_list"]}' \
            http://localhost:9999/api/settings/import/confirm)
            
        if echo "$CONFIRM_RESP" | grep -q '"status":"ok"'; then
            echo "  [OK] 控制中心设置与 rclone 存储池配置已成功恢复！"
        else
            echo "  ❌ 警告：控制中心导入确认失败: $CONFIRM_RESP"
        fi
    else
        echo "  ❌ 警告：控制中心设置包解密失败: $IMPORT_RESP"
    fi
fi

# ------------------------------------------------------------------------------
# 步骤 11: 解密还原数据库热备包 (db_hourly_*.tar.gz.enc)
# ------------------------------------------------------------------------------
if [ -n "$DB_HOURLY_FILE" ]; then
    echo ""
    echo ">>> [步骤 11] 正在解密并覆盖还原核心 SQLite 数据库/资产..."
    
    RESTORE_WORK="/tmp/restore_db_sandbox"
    rm -rf "$RESTORE_WORK"
    mkdir -p "$RESTORE_WORK"
    
    openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass pass:"$DECRYPT_PASSWORD" -in "$DB_HOURLY_FILE" | tar -xz -C "$RESTORE_WORK"
    
    if [ $? -eq 0 ]; then
        echo "  解密提取成功，开始覆盖写回物理卷..."
        
        # 遍历还原区中每一个文件，并找到其归属容器
        find "$RESTORE_WORK" -type f | while read -r temp_file; do
            rel_path="${temp_file#$RESTORE_WORK/}"
            real_host_path="/opt/stacks/$rel_path"
            
            echo "  📄 处理数据库/资产: $rel_path"
            
            TARGET_CONTAINER=""
            # 扫描挂载卷
            CONTAINERS=$(docker ps -a --format '{{.ID}} {{.Names}}')
            while read -r container_info; do
                if [ -z "$container_info" ]; then continue; fi
                c_id=$(echo "$container_info" | cut -d' ' -f1)
                c_name=$(echo "$container_info" | cut -d' ' -f2)
                
                mounts=$(docker inspect -f '{{range .Mounts}}{{.Source}}{{end}}' "$c_id")
                for mount_src in $mounts; do
                    if [[ "$real_host_path" == "$mount_src"* ]]; then
                        TARGET_CONTAINER="$c_name"
                        break 2
                    fi
                done
            done <<< "$CONTAINERS"
            
            # 兜底匹配策略
            if [ -z "$TARGET_CONTAINER" ]; then
                if [[ "$rel_path" == "vaultwarden/"* ]]; then
                    if docker ps -a --format '{{.Names}}' | grep -q "vaultwarden"; then
                        TARGET_CONTAINER="vaultwarden"
                    fi
                elif [[ "$rel_path" == "ldap/"* ]]; then
                    if docker ps -a --format '{{.Names}}' | grep -q "lldap"; then
                        TARGET_CONTAINER="lldap"
                    elif docker ps -a --format '{{.Names}}' | grep -q "ldap"; then
                        TARGET_CONTAINER="ldap"
                    fi
                fi
            fi
            
            if [ -n "$TARGET_CONTAINER" ]; then
                echo "    [DETECT] 智能识别到归属容器: $TARGET_CONTAINER，开始安全写入..."
                docker stop "$TARGET_CONTAINER" &>/dev/null
                mkdir -p "$(dirname "$real_host_path")"
                cp -af "$temp_file" "$real_host_path"
                docker start "$TARGET_CONTAINER" &>/dev/null
                echo "    [OK] 安全回写并重新加载成功"
            else
                echo "    [WARN] 未检测到关联的运行容器，直接写入文件..."
                mkdir -p "$(dirname "$real_host_path")"
                cp -af "$temp_file" "$real_host_path"
                echo "    [OK] 文件写入成功"
            fi
        done
        echo "  [OK] 数据库及热备资产全量还原完毕！"
    else
        echo "  ❌ 错误：解密数据库热备包失败！"
    fi
    rm -rf "$RESTORE_WORK"
fi

# ------------------------------------------------------------------------------
# 步骤 12: 输出恢复摘要
# ------------------------------------------------------------------------------
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "<您的公网IP>")
echo ""
echo "=================================================================="
echo "🎉 恭喜您！Shield-Backup 终极一键灾难恢复全部完成！"
echo "=================================================================="
echo "恢复时间: $(date "+%Y-%m-%d %H:%M:%S")"
echo "控制中心临时后台: http://${PUBLIC_IP}:9999"
echo "已恢复运行的项目:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo "=================================================================="
echo "💡 提示: 控制中心已恢复全部设置，您可以登录控制中心后台查看运行状态。"
echo "=================================================================="
