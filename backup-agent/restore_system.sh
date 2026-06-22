#!/bin/bash
# ⚠️ 此脚本已废弃，请使用 one_click_restore.sh 替代。
# 此文件保留仅供参考，不再维护.
# 新脚本路径: 项目根目录/one_click_restore.sh
# ==============================================================================
# Shield-Backup 一键系统全量配置恢复脚本 - 宿主机运行 (restore_system.sh)
# 作用：1. 在全新机器上，自动安装 Docker 底座环境。
#       2. 解密备份包并释放至指定 Stacks 根目录（默认 /opt/stacks）。
#       3. 智能扫描所有恢复的子项目，并自动执行 docker compose up -d 一键完全复原！
# 使用方法：
#   sudo bash restore_system.sh <备份文件.tar.gz.enc> [自定义 Stacks 目录，默认 /opt/stacks]
# ==============================================================================

# 强制以 root 权限运行
if [ "$EUID" -ne 0 ]; then
    echo "❌ 错误：请使用 root 权限运行此脚本！(例如: sudo bash restore_system.sh ...)"
    exit 1
fi

BACKUP_FILE=$1
TARGET_DIR=${2:-/opt/stacks}

if [ -z "$BACKUP_FILE" ]; then
    echo "=================================================================="
    echo "       Shield-Backup 一键全系统灾难恢复向导 (System Recovery)"
    echo "=================================================================="
    echo "使用格式："
    echo "  sudo bash restore_system.sh <备份文件路径.tar.gz.enc> [自定义 Stacks 目录]"
    echo ""
    echo "默认恢复路径："
    echo "  $TARGET_DIR"
    echo ""
    echo "恢复机制："
    echo "  1. 脚本会自动解密并解压系统配置包释放到 $TARGET_DIR。"
    echo "  2. 如果解密恢复的是增量包，请确保同目录存在对应的月度全量包，脚本将自动串联恢复。"
    echo "  3. 还原完成后，脚本将自动扫描并运行所有已恢复项目的 Docker 容器，无需手动操作。"
    echo "=================================================================="
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ 错误：未找到指定的备份文件: $BACKUP_FILE"
    exit 1
fi

echo "=================================================================="
echo "🎯 开始执行 Shield-Backup 全系统一键完全复原..."
echo "恢复目标物理目录: $TARGET_DIR"
echo "=================================================================="

# ------------------------------------------------------------------------------
# 1. 自动检测并安装 Docker & Docker Compose
# ------------------------------------------------------------------------------
echo ">>> [步骤 1/4] 检查 Docker 与 Docker Compose 宿主机运行环境..."

if ! command -v docker &> /dev/null; then
    echo "  ⚠️ 未检测到 Docker，正在为您自动下载安装官方最新版..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable --now docker
    rm -f get-docker.sh
    echo "  [OK] Docker 运行底座安装完毕！"
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
        echo "  ❌ 错误：Docker Compose 插件自动安装失败，请手动安装后重试。"
        exit 1
      fi
    echo "  [OK] Docker Compose 插件安装完毕！"
else
    echo "  [OK] Docker Compose 插件已经安装，跳过"
fi

# ------------------------------------------------------------------------------
# 2. 解密并还原数据至 Stacks 目录
# ------------------------------------------------------------------------------
echo ">>> [步骤 2/4] 解密并自适应还原配置目录..."

read -s -p "🔑 请输入加密密码 (BACKUP_PASSWORD): " DECRYPT_PASSWORD
echo ""

if [ -z "$DECRYPT_PASSWORD" ]; then
    echo "❌ 错误：加密密码不能为空！"
    exit 1
fi

mkdir -p "$TARGET_DIR"

# 判断是否是累积增量备份包，如果是，需要首先解密还原同月的全量包底座
BASE_FILE=""
FILE_BASE_NAME=$(basename "$BACKUP_FILE")
if [[ "$FILE_BASE_NAME" =~ system_inc_([0-9]{8})_[0-9]{6} ]]; then
    MONTH_STAMP=$(echo "${BASH_REMATCH[1]}" | cut -c1-6)
    FULL_BACKUP_NAME="system_full_${MONTH_STAMP}.tar.gz.enc"
    DIR_NAME=$(dirname "$BACKUP_FILE")
    BASE_FILE="${DIR_NAME}/${FULL_BACKUP_NAME}"

    if [ -f "$BASE_FILE" ]; then
        echo "  发现依赖的月度全量备份底座: $FULL_BACKUP_NAME"
        echo "  正在解密还原月度全量包底座..."
        openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass pass:"$DECRYPT_PASSWORD" -in "$BASE_FILE" | tar -xz -C "$TARGET_DIR"
        if [ $? -ne 0 ]; then
            echo "  ❌ 错误：月度全量底座解密失败！请检查密码是否正确。"
            exit 1
        fi
        echo "  [OK] 月度全量底座还原成功"
    else
        echo "  ⚠️ 警告：检测到当前备份为增量包，但同目录下未找到对应的全量包: $FULL_BACKUP_NAME"
        echo "  将直接尝试解压当前包（可能导致文件缺失），是否继续？(y/n)"
        read -r CONTINUE_INPUT
        if [ "$CONTINUE_INPUT" != "y" ] && [ "$CONTINUE_INPUT" != "Y" ]; then
            echo "❌ 恢复操作已取消。"
            exit 1
        fi
    fi
fi

echo "正在解密当前备份包: $FILE_BASE_NAME ..."
openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass pass:"$DECRYPT_PASSWORD" -in "$BACKUP_FILE" | tar -xz -C "$TARGET_DIR"

if [ $? -eq 0 ]; then
    echo "  [OK] 配置数据解密还原成功！"
    
    # 2.5 自动检测并加载本地打包的 Docker 镜像，以实现 100% 离线免拉取恢复
    MONTH_STAMP=$(echo "${BASH_REMATCH[1]}" | cut -c1-6)
    DIR_NAME=$(dirname "$BACKUP_FILE")
    IMG_BACKUP_FILE=""
    if [ -n "$MONTH_STAMP" ]; then
        IMG_BACKUP_FILE="${DIR_NAME}/system_images_${MONTH_STAMP}.tar.gz.enc"
    fi

    # 如果无法提取月份，或者文件不存在，进行模糊匹配获取同目录最新的镜像包
    if [ ! -f "$IMG_BACKUP_FILE" ]; then
        IMG_BACKUP_FILE=$(ls -t "${DIR_NAME}"/system_images_*.tar.gz.enc 2>/dev/null | head -n 1)
    fi

    if [ -f "$IMG_BACKUP_FILE" ]; then
        echo ""
        echo "=================================================================="
        echo "🐳 检测到配套的本地应用 Docker 镜像打包文件: $(basename "$IMG_BACKUP_FILE")"
        echo "=================================================================="
        echo "是否在还原配置的同时，一键导入本地打包的 Docker 镜像？"
        echo "⚠️  (推荐：当您需要在断网、镜像站失效或恢复私有/自建镜像项目时，选择 y 可实现 100% 离线免拉取恢复)"
        read -p "是否一键导入镜像？(y/n): " LOAD_IMG_INPUT
        echo ""
        if [ "$LOAD_IMG_INPUT" = "y" ] || [ "$LOAD_IMG_INPUT" = "Y" ]; then
            echo ">>> 正在解密并导入 Docker 镜像，此过程需要数分钟，请耐心等待..."
            TMP_IMG_DIR="/tmp/restore_docker_images"
            rm -rf "$TMP_IMG_DIR"
            mkdir -p "$TMP_IMG_DIR"

            openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass pass:"$DECRYPT_PASSWORD" -in "$IMG_BACKUP_FILE" | tar -xz -C "$TMP_IMG_DIR"
            if [ $? -eq 0 ]; then
                find "$TMP_IMG_DIR" -type f -name "*.tar" | while read -r img_tar; do
                    echo "  正在加载本地镜像: $(basename "$img_tar") ..."
                    docker load -i "$img_tar"
                done
                echo "  [OK] 容器镜像本地导入成功！"
            else
                echo "  ❌ 错误：Docker 镜像解密失败！将跳过本步骤（容器启动将尝试从网络拉取）。"
            fi
            rm -rf "$TMP_IMG_DIR"
        fi
    fi
else
    echo "  ❌ 错误：数据解密解压失败！请检查加密密码或文件是否破损。"
    exit 1
fi

# ------------------------------------------------------------------------------
# 3. 初始化全局共享网络
# ------------------------------------------------------------------------------
echo ">>> [步骤 3/4] 检查并重建全局反向代理 Docker 网络 'proxy'..."

if ! docker network inspect proxy &> /dev/null; then
    echo "  正在创建外部共享网络 'proxy'..."
    docker network create proxy
    echo "  [OK] 网络 'proxy' 创建成功！"
else
    echo "  [OK] 网络 'proxy' 已经存在，跳过"
fi

# ------------------------------------------------------------------------------
# 4. 递归搜索各项目目录并自动一键拉起容器项目
# ------------------------------------------------------------------------------
echo ">>> [步骤 4/4] 智能扫描并一键拉起所有已恢复的容器项目..."

# 递归寻找包含 compose.yaml 或 docker-compose.yml 的目录并启动
find "$TARGET_DIR" -type f \( -name "compose.yaml" -o -name "docker-compose.yml" \) | while read -r compose_file; do
    stack_dir=$(dirname "$compose_file")
    
    # 过滤备份自身，防止在拉起其它容器时循环卡住（或者放最后启动）
    # 我们可以检测目录名是否包含 backup-agent
    if [[ "$stack_dir" =~ backup-agent ]]; then
        echo "  [SKIP] 暂不启动备份代理控制台: $stack_dir"
        continue
    fi
    
    echo "  🚀 发现项目: $stack_dir，正在启动拉起..."
    (cd "$stack_dir" && docker compose up -d)
    if [ $? -eq 0 ]; then
        echo "    [OK] 项目已成功在后台运行"
    else
        echo "    [ERROR] 项目启动失败，请后续检查日志"
    fi
done

# 最后单独拉起备份代理控制台，保持优雅
find "$TARGET_DIR" -type f \( -name "compose.yaml" -o -name "docker-compose.yml" \) | while read -r compose_file; do
    stack_dir=$(dirname "$compose_file")
    if [[ "$stack_dir" =~ backup-agent ]]; then
        echo "  🚀 正在最后启动备份控制中心: $stack_dir ..."
        (cd "$stack_dir" && docker compose up -d)
        break
    fi
done

echo "=================================================================="
echo "🎉 恭喜！一键系统完全复原成功！"
echo "所有项目容器、源码配置均已在全新机器上原样恢复并在后台正常运行！"
echo "=================================================================="
