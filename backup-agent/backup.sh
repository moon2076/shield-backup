#!/bin/bash
# ==============================================================================
# Shield-Backup 高级去中心化灾备脚本 - 容器内运行 (backup.sh)
# 作用：支持分级备份（db 或 sys 参数）：
#       db: 备份 SQLite 数据库及用户自选项目相对路径文件。
#       sys: 备份 stacks 项目下的系统配置（排除日志、数据库及自选文件）。
# ==============================================================================

export TZ="Asia/Taipei"
CURRENT_TIME=$(date "+%Y-%m-%d %H:%M:%S")
DATE_STAMP=$(date "+%Y%m%d_%H%M%S")
MONTH_STAMP=$(date "+%Y%m")

BACKUP_TYPE=$1
if [ -z "$BACKUP_TYPE" ]; then
    BACKUP_TYPE="all" # 默认执行全部备份（为了向后兼容）
fi

echo "=================================================================="
echo "[$CURRENT_TIME] Shield-Backup 灾备任务启动，类型: $BACKUP_TYPE"
echo "=================================================================="

# ------------------------------------------------------------------------------
# 1. 执行数据库与自选文件备份 (db)
# ------------------------------------------------------------------------------
if [ "$BACKUP_TYPE" = "db" ] || [ "$BACKUP_TYPE" = "all" ]; then
    echo ">>> 开始执行 [数据库及自选项目热备] 流程..."

    # 创建临时 stacks 备份工作目录
    STACKS_BAK_DIR="/tmp/stacks_backup"
    rm -rf "$STACKS_BAK_DIR"
    mkdir -p "$STACKS_BAK_DIR"

    # A. 核心 SQLite 数据库一致性热克隆
    if [ -f "/vaultwarden_data/db.sqlite3" ]; then
        mkdir -p "$STACKS_BAK_DIR/vaultwarden/data"
        sqlite3 /vaultwarden_data/db.sqlite3 ".backup $STACKS_BAK_DIR/vaultwarden/data/db.sqlite3"
        if [ $? -eq 0 ]; then
            echo "  [OK] Vaultwarden 数据库一致性克隆成功"
        else
            echo "  [ERROR] Vaultwarden 数据库克隆失败！"
        fi
    fi

    if [ -f "/lldap_data/users.db" ]; then
        mkdir -p "$STACKS_BAK_DIR/ldap/data"
        sqlite3 /lldap_data/users.db ".backup $STACKS_BAK_DIR/ldap/data/users.db"
        if [ $? -eq 0 ]; then
            echo "  [OK] LLDAP 数据库一致性克隆成功"
        else
            echo "  [ERROR] LLDAP 数据库克隆失败！"
        fi
    fi

    # B. 读取用户自选相对路径并拷贝
    if [ -n "$CUSTOM_BACKUP_PATHS" ]; then
        IFS=';' read -ra PATHS <<< "$CUSTOM_BACKUP_PATHS"
        for rel_path in "${PATHS[@]}"; do
            rel_path=$(echo "$rel_path" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^\///')
            if [ -z "$rel_path" ]; then
                continue
            fi
            
            host_src="/host/opt/stacks/$rel_path"
            dest_target="$STACKS_BAK_DIR/$rel_path"
            
            if [ -e "$host_src" ]; then
                mkdir -p "$(dirname "$dest_target")"
                cp -a "$host_src" "$dest_target"
                echo "  [OK] 提取自选资产成功: $rel_path"
            else
                echo "  [WARN] 未找到自选资产文件或目录: $rel_path ($host_src)"
            fi
        done
    fi

    # C. 打包与强对称加密
    DB_PKG_NAME="db_hourly_${DATE_STAMP}.tar.gz.enc"
    DB_PKG_PATH="/tmp/$DB_PKG_NAME"

    if [ -z "$BACKUP_PASSWORD" ]; then
        echo "  [ERROR] 未配置加密主密码 BACKUP_PASSWORD！"
    else
        tar -cz -C "$STACKS_BAK_DIR" . 2>/dev/null | openssl enc -aes-256-cbc -salt -pbkdf2 -pass pass:"$BACKUP_PASSWORD" -out "$DB_PKG_PATH"

        if [ $? -eq 0 ] && [ -f "$DB_PKG_PATH" ]; then
            echo "  [OK] 加密热备数据包生成成功: $DB_PKG_NAME"
            echo "[BACKUP_FILE_CREATED] $DB_PKG_PATH"
        else
            echo "  [ERROR] 数据库与热备资产打包加密失败！"
        fi
    fi
    rm -rf "$STACKS_BAK_DIR"
fi

# ------------------------------------------------------------------------------
# 2. 执行系统全盘配置备份 (sys)
# ------------------------------------------------------------------------------
if [ "$BACKUP_TYPE" = "sys" ] || [ "$BACKUP_TYPE" = "all" ]; then
    echo ">>> 开始执行 [系统全盘配置备份] 流程..."

    # 生成排除名单 (只排除日志、核心数据库、自选文件，排除历史备份与压缩包，以及备份自身的 config，防止嵌套备份和大文件残留)
    EXCLUDE_ARGS=()
    EXCLUDE_ARGS+=("--exclude=*.log")
    EXCLUDE_ARGS+=("--exclude=vaultwarden/data/db.sqlite3" "--exclude=ldap/data/users.db")
    EXCLUDE_ARGS+=("--exclude=backup-agent/config/local_backup" "--exclude=./backup-agent/config/local_backup")
    EXCLUDE_ARGS+=("--exclude=*.tar.gz" "--exclude=*.tar.gz.enc" "--exclude=*.enc")
    EXCLUDE_ARGS+=("--exclude=./*.tar.gz" "--exclude=./*.tar.gz.enc" "--exclude=./*.enc")

    if [ -n "$CUSTOM_BACKUP_PATHS" ]; then
        IFS=';' read -ra PATHS <<< "$CUSTOM_BACKUP_PATHS"
        for rel_path in "${PATHS[@]}"; do
            rel_path=$(echo "$rel_path" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^\///')
            if [ -n "$rel_path" ]; then
                EXCLUDE_ARGS+=("--exclude=$rel_path" "--exclude=./$rel_path")
            fi
        done
    fi


    # 每次执行均生成精确到秒的全量配置快照（废弃增量备份，.snar 文件无法在容器重建后持久化）
    SYS_PKG_NAME="system_full_${DATE_STAMP}.tar.gz.enc"
    SYS_PKG_PATH="/tmp/$SYS_PKG_NAME"
    echo "  正在执行 [系统全量配置归档]..."

    if [ -z "$BACKUP_PASSWORD" ]; then
        echo "  [ERROR] 未配置加密主密码 BACKUP_PASSWORD！"
    else
        tar "${EXCLUDE_ARGS[@]}" -cz -C /source_stacks . 2>/dev/null | openssl enc -aes-256-cbc -salt -pbkdf2 -pass pass:"$BACKUP_PASSWORD" -out "$SYS_PKG_PATH"

        if [ $? -eq 0 ] && [ -f "$SYS_PKG_PATH" ]; then
            echo "  [OK] 系统加密配置包打包成功: $SYS_PKG_NAME"
            echo "[BACKUP_FILE_CREATED] $SYS_PKG_PATH"
        else
            echo "  [ERROR] 系统加密配置打包失败！"
        fi
    fi
fi

# ------------------------------------------------------------------------------
# 3. 执行容器 Docker 镜像打包归档 (img)
# ------------------------------------------------------------------------------
if [ "$BACKUP_TYPE" = "img" ]; then
    echo ">>> 开始执行 [运行容器 Docker 镜像打包] 流程..."
    IMG_BAK_DIR="/tmp/docker_images"
    rm -rf "$IMG_BAK_DIR"
    mkdir -p "$IMG_BAK_DIR"

    # 获取所有当前正在运行的容器所使用的镜像并去重
    IMAGES=$(docker ps --format "{{.Image}}" | sort -u)
    
    if [ -z "$IMAGES" ]; then
        echo "  [WARN] 未检测到任何运行中的容器，跳过镜像打包。"
    else
        for img in $IMAGES; do
            # 将镜像名中的非法字符（如 : 或 /）替换为下划线，作为文件名
            safe_name=$(echo "$img" | sed 's/[\/:]/_/g')
            echo "  正在导出镜像: $img -> ${safe_name}.tar ..."
            docker save -o "$IMG_BAK_DIR/${safe_name}.tar" "$img" 2>/dev/null
            if [ $? -eq 0 ]; then
                echo "    [OK] 导出成功"
            else
                echo "    [ERROR] 导出失败: $img"
            fi
        done

        # 打包加密：将包名从只精确到月 (system_images_YYYYMM.tar.gz.enc) 改为精确到秒 (system_images_YYYYMMDD_HHMMSS.tar.gz.enc)
        # 这样可以防止多次备份发生重名覆盖，也能让 Rclone 正常同步，并且符合 GFS 的时间戳解析规范
        IMG_PKG_NAME="system_images_${DATE_STAMP}.tar.gz.enc"
        IMG_PKG_PATH="/tmp/$IMG_PKG_NAME"

        if [ -z "$BACKUP_PASSWORD" ]; then
            echo "  [ERROR] 未配置加密主密码 BACKUP_PASSWORD！"
        else
            tar -cz -C "$IMG_BAK_DIR" . 2>/dev/null | openssl enc -aes-256-cbc -salt -pbkdf2 -pass pass:"$BACKUP_PASSWORD" -out "$IMG_PKG_PATH"

            if [ $? -eq 0 ] && [ -f "$IMG_PKG_PATH" ]; then
                echo "  [OK] 加密镜像归档包生成成功: $IMG_PKG_NAME"
                echo "[BACKUP_FILE_CREATED] $IMG_PKG_PATH"
            else
                echo "  [ERROR] 镜像包打包加密失败！"
            fi
        fi
    fi
    rm -rf "$IMG_BAK_DIR"
fi

echo "=================================================================="
echo "[$CURRENT_TIME] 备份打包与分发传输任务执行完毕！"
echo "=================================================================="
