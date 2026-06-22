#!/bin/bash
# ⚠️ 此脚本已废弃，请使用 one_click_restore.sh 替代。
# 此文件保留仅供参考，不再维护.
# 新脚本路径: 项目根目录/one_click_restore.sh
# ==============================================================================
# Shield-Backup 一键数据库及自选项目热备恢复脚本 - 宿主机运行 (restore_db.sh)
# 作用：1. 解密并解包 db_hourly 加密备份。
#       2. 智能扫描备份中的文件，通过 docker inspect 自动查明它们所属的运行容器。
#       3. 自动停止对应容器 -> 覆盖还原核心 SQLite 数据库/自选配置文件 -> 重启容器加载数据。
# 使用方法：
#   sudo bash restore_db.sh <备份文件.tar.gz.enc> [自定义 Stacks 目录，默认 /opt/stacks]
# ==============================================================================

# 强制以 root 权限运行
if [ "$EUID" -ne 0 ]; then
    echo "❌ 错误：请使用 root 权限运行此脚本！(例如: sudo bash restore_db.sh ...)"
    exit 1
fi

BACKUP_FILE=$1
TARGET_DIR=${2:-/opt/stacks}

if [ -z "$BACKUP_FILE" ]; then
    echo "=================================================================="
    echo "       Shield-Backup 一键数据库单独恢复向导 (Database Recovery)"
    echo "=================================================================="
    echo "使用格式："
    echo "  sudo bash restore_db.sh <备份文件路径.tar.gz.enc> [自定义 Stacks 目录]"
    echo ""
    echo "默认恢复 Stacks 目录："
    echo "  $TARGET_DIR"
    echo ""
    echo "恢复说明："
    echo "  1. 脚本解密提取备份包中的所有相对路径文件。"
    echo "  2. 自动检测并临时停止所有映射了这些文件路径的 Docker 容器。"
    echo "  3. 安全回写核心 SQLite 数据库/配置文件并重新启动容器，实现无缝热加载。"
    echo "=================================================================="
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ 错误：未找到指定的备份文件: $BACKUP_FILE"
    exit 1
fi

echo "=================================================================="
echo "🎯 开始执行 Shield-Backup 数据库一键安全还原..."
echo "宿主机 Stacks 根目录: $TARGET_DIR"
echo "=================================================================="

# ------------------------------------------------------------------------------
# 1. 解密并释放至临时还原区
# ------------------------------------------------------------------------------
RESTORE_WORK="/tmp/restore_db_sandbox"
rm -rf "$RESTORE_WORK"
mkdir -p "$RESTORE_WORK"

read -s -p "🔑 请输入加密密码 (BACKUP_PASSWORD): " DECRYPT_PASSWORD
echo ""

if [ -z "$DECRYPT_PASSWORD" ]; then
    echo "❌ 错误：密码不能为空！"
    rm -rf "$RESTORE_WORK"
    exit 1
fi

echo "正在解密备份包至临时沙箱..."
openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass pass:"$DECRYPT_PASSWORD" -in "$BACKUP_FILE" | tar -xz -C "$RESTORE_WORK"

if [ $? -ne 0 ]; then
    echo "❌ 错误：解密解包失败！请检查密码是否正确，或文件是否损坏。"
    rm -rf "$RESTORE_WORK"
    exit 1
fi

echo "  [OK] 数据解密提取成功"

# ------------------------------------------------------------------------------
# 2. 遍历提取到的文件，自动识别并还原
# ------------------------------------------------------------------------------
echo ">>> 正在分析待恢复文件归属的 Docker 容器..."

# 递归寻找临时目录下的所有普通文件
find "$RESTORE_WORK" -type f | while read -r temp_file; do
    # 计算当前文件相对于还原临时目录的相对路径
    rel_path=$(realPath="${temp_file#$RESTORE_WORK/}"; echo "$realPath")
    # 宿主机上文件应该存放的实际路径
    real_host_path="$TARGET_DIR/$rel_path"
    
    echo ""
    echo "📄 处理文件: $rel_path"
    echo "  目标物理路径: $real_host_path"
    
    # 检测宿主机上该路径归属哪个容器
    # 扫描所有运行中的容器卷映射
    TARGET_CONTAINER=""
    CONTAINERS=$(docker ps -a --format '{{.ID}} {{.Names}}')
    
    while read -r container_info; do
        if [ -z "$container_info" ]; then
            continue
        fi
        c_id=$(echo "$container_info" | cut -d' ' -f1)
        c_name=$(echo "$container_info" | cut -d' ' -f2)
        
        # 检查该容器的挂载源是否包含了我们待还原文件的物理路径
        mounts=$(docker inspect -f '{{range .Mounts}}{{.Source}}{{end}}' "$c_id")
        for mount_src in $mounts; do
            # 如果待还原物理路径以挂载源为前缀，说明归属此容器
            if [[ "$real_host_path" == "$mount_src"* ]]; then
                TARGET_CONTAINER="$c_name"
                break 2
            fi
        done
    done <<< "$CONTAINERS"
    
    # 兜底匹配策略：如果未查到挂载映射，按目录关键字模糊匹配容器名
    if [ -z "$TARGET_CONTAINER" ]; then
        if [[ "$rel_path" == "vaultwarden/"* ]]; then
            # 检查是否有 vaultwarden 容器
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
    
    # 执行安全回写还原
    if [ -n "$TARGET_CONTAINER" ]; then
        echo "  [DETECT] 智能识别到归属容器: $TARGET_CONTAINER"
        
        # 1. 停止容器
        echo "  正在安全停止容器 $TARGET_CONTAINER ..."
        docker stop "$TARGET_CONTAINER" &>/dev/null
        
        # 2. 拷贝覆盖文件
        mkdir -p "$(dirname "$real_host_path")"
        cp -af "$temp_file" "$real_host_path"
        # 修正所属权限（若容器需要特定权限，如 sqlite 数据库）
        # 这里默认保留原容器映射文件权限或使用 cp 继承
        echo "  [OK] 数据安全回写物理盘"
        
        # 3. 重启容器
        echo "  正在重新启动容器 $TARGET_CONTAINER ..."
        docker start "$TARGET_CONTAINER" &>/dev/null
        echo "  [OK] 容器已重新加载运行"
    else
        echo "  [WARN] 未检测到关联的 Docker 容器，仅执行文件回写"
        mkdir -p "$(dirname "$real_host_path")"
        cp -af "$temp_file" "$real_host_path"
        echo "  [OK] 数据回写物理盘"
    fi
done

# 清理沙箱
rm -rf "$RESTORE_WORK"

echo ""
echo "=================================================================="
echo "🎉 恭喜！数据库及自选配置资产已全部智能安全还原完毕！"
echo "=================================================================="
