#!/bin/bash
# ==============================================================================
# Shield-Backup 灾难一键恢复脚本 - 宿主机运行 (restore.sh)
# 作用：1. 在全新 VPS 上，自动安装 Docker 与 Docker Compose 运行环境。
#       2. 解密并解压您的加密包，自适应释放相对路径至指定 Stacks 根目录中。
# 使用方法：
#   sudo bash restore.sh <备份文件.tar.gz.enc> [自定 Stacks 根目录路径，默认 /opt/stacks]
# 恢复策略提醒：
#   如果是还原系统配置文件，请先解密恢复 system_full 完整包，随后解密恢复最新的 system_inc 增量包即可。
# ==============================================================================

# 强行要求以 root 身份运行
if [ "$EUID" -ne 0 ]; then
    echo "❌ 错误：请使用 root 权限运行此脚本！(例如: sudo bash restore.sh ...)"
    exit 1
fi

BACKUP_FILE=$1
TARGET_DIR=${2:-/opt/stacks}

# 检查参数
if [ -z "$BACKUP_FILE" ]; then
    echo "=================================================================="
    echo "       Shield-Backup 一键灾备恢复向导 (Disaster Recovery)"
    echo "=================================================================="
    echo "使用格式："
    echo "  sudo bash restore.sh <备份文件路径.tar.gz.enc> [自定义 Stacks 目录路径]"
    echo ""
    echo "默认恢复目录："
    echo "  $TARGET_DIR"
    echo ""
    echo "恢复说明："
    echo "  1. 恢复高频热备数据 (db_hourly)：直接运行此脚本即可还原所有数据库与自选文件。"
    echo "  2. 重建整机系统配置 (system)：请先还原当月 system_full 完整包，再还原最新的 system_inc 增量包。"
    echo "=================================================================="
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ 错误：找不到指定的备份文件: $BACKUP_FILE"
    exit 1
fi

echo "=================================================================="
echo "🎯 开始执行 Shield-Backup 一键灾备恢复..."
echo "恢复目标物理目录: $TARGET_DIR"
echo "=================================================================="

# ------------------------------------------------------------------------------
# 1. 自动检测并安装 Docker & Docker Compose 底座
# ------------------------------------------------------------------------------
echo ">>> [步骤 1/3] 检查 Docker 与 Docker Compose 运行环境..."

if ! command -v docker &> /dev/null; then
    echo "  ⚠️ 未检测到 Docker，正在为您自动安装..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable --now docker
    rm -f get-docker.sh
    echo "  [OK] Docker 安装完毕！"
else
    echo "  [OK] Docker 已经安装，跳过"
fi

if ! docker compose version &> /dev/null; then
    echo "  ⚠️ 未检测到 docker-compose 插件，正在尝试使用包管理器安装..."
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
# 2. 解密并自适应释放备份数据 (进入指定的 Stacks 根目录)
# ------------------------------------------------------------------------------
echo ">>> [步骤 2/3] 解密并自适应还原数据..."

# 读取解密密码
read -s -p "🔑 请输入加密密码 (BACKUP_PASSWORD): " DECRYPT_PASSWORD
echo ""

if [ -z "$DECRYPT_PASSWORD" ]; then
    echo "❌ 错误：密码不能为空！"
    exit 1
fi

# 确保目标目录存在
mkdir -p "$TARGET_DIR"

echo "正在解密并解压数据至 $TARGET_DIR ..."
# 使用 openssl 解密，解压到指定 Stacks 根目录，包内相对路径会自动释放到正确的子目录下
openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass pass:"$DECRYPT_PASSWORD" -in "$BACKUP_FILE" | tar -xz -C "$TARGET_DIR"

if [ $? -eq 0 ]; then
    echo "  [OK] 数据解密与还原完成！"
    echo "  已还原项目骨架与资产结构："
    ls -la "$TARGET_DIR"
else
    echo "  ❌ 错误：数据解密失败！请检查密码是否正确，或者备份文件是否损坏。"
    exit 1
fi

# ------------------------------------------------------------------------------
# 3. 初始化 Docker 外部共享网络
# ------------------------------------------------------------------------------
echo ">>> [步骤 3/3] 检查并重建 Docker 外部共享虚拟网络..."

if ! docker network inspect proxy &> /dev/null; then
    echo "  正在创建全局反向代理网络 'proxy'..."
    docker network create proxy
    echo "  [OK] 网络 'proxy' 创建成功！"
else
    echo "  [OK] 网络 'proxy' 已经存在，跳过"
fi

echo "=================================================================="
echo "🎉 恭喜！一键还原已执行完毕！"
echo "请在新 VPS 的 Stacks 目录下运行以下命令拉起所有服务："
echo "  cd $TARGET_DIR && docker compose up -d"
echo "=================================================================="
