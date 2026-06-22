#!/bin/bash
# ⚠️ 此脚本已废弃，请使用 one_click_restore.sh 替代。
# 此文件保留仅供参考，不再维护。
# 新脚本路径: 项目根目录/one_click_restore.sh
# ==============================================================================
# VPS 终极灾难一键恢复脚本 (restore.sh)
# 作用：在新装的全新 VPS 上，自动安装 Docker/Compose 运行环境，
#       解密并释放您的全量加密备份包，还原整个系统的骨架配置与数据库，一键拉起所有服务。
# 使用方法：
#   sudo bash restore.sh <您的全量备份加密包文件路径.tar.gz.enc>
# ==============================================================================

# 强行要求以 root 身份运行
if [ "$EUID" -ne 0 ]; then
    echo "❌ 错误：请使用 root 权限运行此脚本！(例如: sudo bash restore.sh ...)"
    exit 1
fi

BACKUP_FILE=$1

# 检查参数
if [ -z "$BACKUP_FILE" ]; then
    echo "=================================================================="
    echo "       VPS 终极一键恢复向导 (Disaster Recovery Guide)"
    echo "=================================================================="
    echo "使用格式："
    echo "  sudo bash restore.sh <备份文件路径.tar.gz.enc>"
    echo ""
    echo "示例："
    echo "  sudo bash restore.sh /tmp/full_system_backup_202606.tar.gz.enc"
    echo "=================================================================="
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ 错误：找不到指定的备份文件: $BACKUP_FILE"
    exit 1
fi

echo "=================================================================="
echo "🎯 开始执行 VPS 系统灾难一键恢复..."
echo "=================================================================="

# ------------------------------------------------------------------------------
# 1. 自动检测并安装 Docker & Docker Compose 底座
# ------------------------------------------------------------------------------
echo ">>> [步骤 1/4] 检查 Docker 与 Docker Compose 运行环境..."

if ! command -v docker &> /dev/null; then
    echo "  ⚠️ 未检测到 Docker，正在为您自动拉取官方脚本进行安装..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable --now docker
    rm -f get-docker.sh
    echo "  [OK] Docker 安装完毕！"
else
    echo "  [OK] Docker 已经安装，跳过"
fi

if ! docker compose version &> /dev/null; then
    echo "  ⚠️ 未检测到 docker-compose 插件，正在自动尝试使用包管理器安装..."
    # 适配 Debian/Ubuntu 和 CentOS/Rocky Linux
    if command -v apt-get &> /dev/null; then
        apt-get update && apt-get install -y docker-compose-plugin
    elif command -v dnf &> /dev/null; then
        dnf install -y docker-compose-plugin
    fi
    
    if ! docker compose version &> /dev/null; then
        echo "  ❌ 错误：Docker Compose 自动安装失败，请手动安装后重试。"
        exit 1
    fi
    echo "  [OK] Docker Compose 插件安装完毕！"
else
    echo "  [OK] Docker Compose 已经安装，跳过"
fi

# ------------------------------------------------------------------------------
# 2. 解密并释放备份数据
# ------------------------------------------------------------------------------
echo ">>> [步骤 2/4] 解密并还原系统数据骨架..."

# 读取解密密码
read -s -p "🔑 请输入您在备份时设置的加密密码 (BACKUP_PASSWORD): " DECRYPT_PASSWORD
echo ""

if [ -z "$DECRYPT_PASSWORD" ]; then
    echo "❌ 错误：密码不能为空！"
    exit 1
fi

# 准备系统根目录
mkdir -p /opt/stacks

echo "正在解密并解压数据至 /opt/stacks/ ..."
# 使用 openssl 解密，pbkdf2 与备份时的算法严格一致，然后通过管道直接解压到 /opt/stacks
openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass pass:"$DECRYPT_PASSWORD" -in "$BACKUP_FILE" | tar -xz -C /opt/stacks/

if [ $? -eq 0 ]; then
    echo "  [OK] 数据解密与还原完成！"
    echo "  已还原项目列表："
    ls -l /opt/stacks
else
    echo "  ❌ 错误：数据解密失败！请检查密码是否正确，或者备份文件是否损坏。"
    exit 1
fi

# ------------------------------------------------------------------------------
# 3. 初始化 Docker 外部共享网络
# ------------------------------------------------------------------------------
echo ">>> [步骤 3/4] 初始化 Docker 虚拟网络拓扑..."

# 检查 proxy 外部网络是否存在，若不存在则创建它
if ! docker network inspect proxy &> /dev/null; then
    echo "  正在创建全局反向代理网络 'proxy'..."
    docker network create proxy
    echo "  [OK] 网络 'proxy' 创建成功！"
else
    echo "  [OK] 网络 'proxy' 已经存在，跳过"
fi

# ------------------------------------------------------------------------------
# 4. 按依赖顺序拉起所有服务
#    因为全局服务依赖 Traefik 路由和 LLDAP/Authelia 身份认证底座，
#    必须首先启动这几个核心网关，最后启动应用。
# ------------------------------------------------------------------------------
echo ">>> [步骤 4/4] 正在拉起 VPS 容器服务..."

# 先拉起流量网关与身份验证底座
CORE_STACKS=("traefik-authelia" "ldap")

for stack in "${CORE_STACKS[@]}"; do
    if [ -d "/opt/stacks/$stack" ]; then
        echo "  正在拉起核心底座: $stack ..."
        cd "/opt/stacks/$stack"
        docker compose up -d
        if [ $? -ne 0 ]; then
            echo "  ❌ 警告：核心服务 $stack 启动失败，请检查配置！"
        fi
    fi
done

# 稍微等待 5 秒，让身份库和网关完全初始化
echo "  等待 5 秒让核心网关就绪..."
sleep 5

# 再拉起其他所有应用
ALL_STACKS=$(ls /opt/stacks)
for stack in $ALL_STACKS; do
    # 排除核心服务（刚才已经拉起）和备份代理（避免直接循环启动）
    if [[ "$stack" != "traefik-authelia" && "$stack" != "ldap" && "$stack" != "backup-agent" ]]; then
        if [ -d "/opt/stacks/$stack" ] && [ -f "/opt/stacks/$stack/compose.yaml" -o -f "/opt/stacks/$stack/docker-compose.yml" ]; then
            echo "  正在拉起服务: $stack ..."
            cd "/opt/stacks/$stack"
            docker compose up -d
            if [ $? -ne 0 ]; then
                echo "  ❌ 警告：服务 $stack 启动失败！"
            fi
        fi
    fi
done

echo "=================================================================="
echo "🎉 恭喜！一键灾难恢复已全部执行完毕！"
echo "您可以尝试在浏览器中访问您的域名验证服务是否已完美重现。"
echo "=================================================================="
