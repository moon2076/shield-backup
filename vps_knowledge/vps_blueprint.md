# VPS 架构总览与服务联动索引 (VPS Global Blueprint & Service Index)

本文件是此 VPS 运行项目的主控总览。它定义了全局网络与安全的大纲视图，并提供了所有已部署子服务的“依赖波及关联”导航索引。

> [!IMPORTANT]
> **开发规程提醒**：任何 AI 代理进场必须首先通读本总览。在对任何项目进行修改时，必须查阅本页的“联动依赖与波及警告”，并同时阅读、修改和写回更正关联的子项目文档。

---

## 🎯 静态全局设计大纲 (Global System Architecture)
* **全局流量网关**：由 **Traefik** 统一托管宿主机公网 `80/443` 端口，实现 SSL 证书自动托管与内部路由分发。
* **全局统一身份认证**：以 **LLDAP** 作为全局唯一账户凭证数据库，**Authelia** 拦截 Traefik 的外部流量并对其进行 SSO 单点登录控制。
* **数据持久化与高权限管理**：
  * 所有持久化文件统一存放在宿主机 `/opt/stacks` 对应服务的目录下，方便管理与整体迁移。
  * **Duplicati** 拥有根目录上帝挂载权限，实现对物理宿主机文件系统的全盘加密备份。
  * **FileBrowser** 挂载宿主机根目录以实现全局文件 Web 管理。

---

## 📂 已部署服务分包索引 (Service Directory & Impact Matrix)
下表列出了当前 VPS 部署的所有 Stacks 子服务。请在开发或运维时，点击对应的 **子服务说明文档** 链接进行精读：

| 子服务说明文档 | VPS 物理目录 | 联动依赖与修改波及警告 (Impact Warning) |
| :--- | :--- | :--- |
| 🌐 [**traefik.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/traefik.md) | `/opt/stacks/traefik-authelia` | **流量网关**：托管全局 HTTPS 入口。所有容器的公网映射均依赖 Traefik Label。修改 Traefik 会直接影响**全域服务的外网可达性**。 |
| 🔒 [**authelia.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/authelia.md) | `/opt/stacks/traefik-authelia` | **SSO 认证**：依赖 **LLDAP** 校验用户，被 **Traefik** 作为拦截器调用。修改 Authelia 可能会直接导致**全域服务登录死锁**。 |
| 🗄️ [**lldap.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/lldap.md) | `/opt/stacks/ldap` | **身份源**：提供 `ldap://lldap:3890` 查询。被 **Authelia** 和 **homepage-bridge** 强依赖。修改其组结构或字段会导致**全员无法登录**。 |
| 🖥️ [**homepage.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/homepage.md) | `/opt/stacks/homepage` | **导航面板**：依赖 **homepage-bridge** 的 API 提供头像与壁纸。内网直连 **Portainer:9000** / **Netdata:19999**。修改 CSS/JS 会联动影响 **homepage-bridge**。 |
| 🔗 [**homepage-bridge.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/homepage_bridge.md) | `/opt/stacks/homepage-bridge` | **联动网桥**：受 Authelia SSO 保护，内网直连 **LLDAP:3890**。提供头像/壁纸管理与密码自服务修改。修改其 API 会导致**主页美化及密码自修服务瘫痪**。 |
| 🐳 [**portainer.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/portainer.md) | `/opt/stacks/portainer` | **Docker面板**：读写挂载本地 Docker 套接字。被 **Homepage** 直连内网 API 以读取容器数量指标。 |
| 📦 [**dockge.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/dockge.md) | `/opt/stacks/dockge` | **Compose管理**：挂载宿主机 `/opt/stacks` 目录。在此修改配置会直接改变物理 VPS 上的 Stacks 配置，需严格操作。 |
| 🔑 [**vaultwarden.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/vaultwarden.md) | `/opt/stacks/vaultwarden` | **密码管理**：受 Authelia 网关拦截保护，存储加密密码库。 |
| 💾 [**duplicati.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/duplicati.md) | `/opt/stacks/backup` | **异地备份**：以 `root` 权限将宿主机根目录 `/` 映射为 `/source` 进行整盘直接备份。配置加密密钥泄漏会使备份失效。 |
| 🛡️ [**backup_agent.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/backup_agent.md) | `/opt/stacks/backup-agent` | **灾备控制大厅**：只读挂载关键 SQLite 进行高频备份，结合 Go/React 大厅面板，提供细粒度导入还原、多存储池自愈拉回及冷备助手流水审计。 |
| 📁 [**filebrowser.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/filebrowser.md) | `/opt/stacks/filebrowser` | **文件管理器**：挂载宿主机根目录 `/` 映射为 `/srv`，受 Authelia SSO 拦截，具有全盘文件读写与物理删除权。 |
| 📈 [**netdata.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/netdata.md) | `/opt/stacks/netdata` | **性能探针**：`privileged` 监控宿主机硬件。被 **Homepage** 内网直连拉取硬件性能看板。 |
| ☁️ [**cloudflare_ddns.md**](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/cloudflare_ddns.md) | `/opt/stacks/cloudflare-ddns` | **域名动态解析**：单向外发 API 流量更新 Cloudflare DNS 指向。 |

---

## 📊 动态物理状态看板 (Dynamic Live Physical State)
> [!IMPORTANT]
> **警告**：本章节的所有内容均由本地自动同步脚本 `sync_vps.ps1` 连接 VPS 采集并自动更新覆写。**请勿在此章节手动撰写任何内容**。

<!-- DOCKER_STATUS_START -->
### 🖥️ 系统状态与硬件指标
| 指标项 | 当前状态 |
| :--- | :--- |
| 内核版本 | `Linux 6.1.0-43-amd64 x86_64` |
| 运行时间 | `up 2 weeks, 7 hours, 24 minutes` |
| 内存使用 | 已用 1.1Gi / 共 1.9Gi |
| 磁盘容量 (根目录) | 已用 19G / 共 34G (60%) |

### 🔌 宿主机 TCP 监听端口
目前宿主机在公网/局域网实际开启监听的 TCP 端口列表（不含容器内部隔离端口）：

| 端口号 | 监听状态 | 常见服务参考 |
| :--- | :--- | :--- |
| **22** | LISTEN | SSH 服务 (安全登录) |
| **80** | LISTEN | HTTP 网关 (Traefik) |
| **443** | LISTEN | HTTPS 安全网关 (Traefik) |

### 🐳 Docker 容器状态清单
| 容器名称 | 运行状态 | 镜像版本 | 启动时间 |
| :--- | :--- | :--- | :--- |
| `vaultwarden` | 🟢 running | `ghcr.io/dani-garcia/vaultwarden:1.36.0` | 2026-05-28 14:44 |
| `cloudflare-ddns` | 🟢 running | `favonia/cloudflare-ddns:latest` | 2026-05-25 13:03 |
| `traefik` | 🟢 running | `traefik:v2.11` | 2026-05-25 12:57 |
| `authelia` | 🟢 running | `authelia/authelia:latest` | 2026-05-25 12:54 |
| `homepage-bridge` | 🟢 running | `homepage-bridge-homepage-bridge` | 2026-05-22 20:38 |
| `netdata` | 🟢 running | `netdata/netdata:latest` | 2026-05-22 20:38 |
| `filebrowser` | 🟢 running | `filebrowser/filebrowser:latest` | 2026-05-22 20:38 |
| `homepage` | 🟢 running | `ghcr.io/gethomepage/homepage:latest` | 2026-05-22 20:38 |
| `duplicati` | 🟢 running | `lscr.io/linuxserver/duplicati:latest` | 2026-05-22 20:38 |
| `lldap` | 🟢 running | `lldap/lldap:latest` | 2026-05-22 20:38 |
| `portainer` | 🟢 running | `portainer/portainer-ee:latest` | 2026-05-22 20:38 |
| `dockge` | 🟢 running | `louislam/dockge:1` | 2026-05-22 20:38 |

### 🌐 Traefik 反向代理路由 (二级域名绑定)
| 反代路由规则 (域名/路径) | 转发目标容器 |
| :--- | :--- |
| `Host(`auth.xxxiong.top`)` | `authelia` |
| `Host(`dockge.xxxiong.top`)` | `dockge` |
| `Host(`backup.xxxiong.top`)` | `duplicati` |
| `Host(`files.xxxiong.top`)` | `filebrowser` |
| `Host(`xxxiong.top`) || Host(`dashboard.xxxiong.top`)` | `homepage` |
| `Host(`xxxiong.top`) && (PathPrefix(`/custom-api`) || Path(`/profile`) || Path(`/password`) || Path(`/wallpaper`))` | `homepage-bridge` |
| `Host(`ldap.xxxiong.top`)` | `lldap` |
| `Host(`monitor.xxxiong.top`)` | `netdata` |
| `Host(`portainer.xxxiong.top`)` | `portainer` |
| `Host(`traefik.xxxiong.top`)` | `traefik` |
| `Host(`vaultwarden.xxxiong.top`) && PathPrefix(`/admin`)` | `vaultwarden` |
| `Host(`vaultwarden.xxxiong.top`)` | `vaultwarden` |

<!-- DOCKER_STATUS_END -->

---

## 🛡️ Shield-Backup 去中心化灾备底座说明

为了保证在最极端情况（如 VPS 物理损毁、服务商挂掉）下的绝对可恢复性，整个系统引入了 **双轨去中心化灾备设计**。

### 1. 备份机制：平时高频与全量加密备份
* **每小时高频热备份**：
  * **目标**：Vaultwarden（`db.sqlite3`）与 LLDAP（`users.db`）SQLite 数据库。
  * **机制**：通过在本地目录 `/opt/stacks/backup-agent` 运行的定制化 Alpine 容器，每小时动态利用 `sqlite3 .backup` 执行一致性热拷贝。
  * **传输**：
    * **云盘加密驱动 (Rclone Crypt)**：使用 `rclone.conf` 中定义的 [encrypted-remote] 加密远端，将解密态的备份文件推送到云端。Rclone 会在本地对其文件名和内容进行 AES-256-GCM 强加密后上传。
    * **Telegram 密道 (TG Bot)**：将备份包在容器内使用 `openssl` 与您的专属密码（`BACKUP_PASSWORD`）进行高强度对称加密后，调用 Telegram API 投递到您的私密频道，实现安全的异地备份并作为运行日志监控。
* **每月全量独立归档包**：
  * **目标**：打包整个 `/opt/stacks` （排除临时与本地备份目录）的全部配置文件和 SQLite 数据库。
  * **机制**：每月 1 号自动打包，进行 AES-256 加密归档。生成完全独立的归档文件并多云存储。

### 2. 本地物理冷备份：Windows 自动拉取
为了贯彻 3-2-1 备份原则中的“本地冷拷贝”，您可以使用我们编写的本地同步工具：
* **[sync_to_local.ps1 (本地自动同步)](file:///d:/Work_Project/VPS_RN/backup-agent/sync_to_local.ps1)**：
  在您的 Windows 电脑上将此脚本配置为 Windows 定时任务（如每日运行），它会自动调用您本地配置的 Rclone，将云端的加密备份增量拷贝拉回本地硬盘存储。
* **[decrypt_local.ps1 (本地解密助手)](file:///d:/Work_Project/VPS_RN/backup-agent/decrypt_local.ps1)**：
  当您需要单独在本地读取备份时，在本地电脑上执行此脚本，它会引导您选择本地的 `.enc` 包，输入密码，一键调用 Git 中的 OpenSSL 完成解密并解压为可读的 SQLite 数据库。

### 3. 去中心化一键灾难恢复 (一秒复原)
当发生灾难性故障、VPS 彻底损毁时，新宿主机上**不需要运行任何复杂的控制台容器**，直接依靠去中心化的命令行脚本完成还原：
* **恢复材料**：您已同步至本地硬盘的最新 `.tar.gz.enc` 备份包以及保存在本地的 **[restore.sh (去中心化一键恢复)](file:///d:/Work_Project/VPS_RN/backup-agent/restore.sh)** 脚本。
* **一键恢复命令**：
  在新装的 VPS 宿主机上，将这两个文件上传至服务器（如 `/tmp` 目录），以 root 权限运行：
  ```bash
  sudo bash restore.sh /tmp/full_system_backup_YYYYMM.tar.gz.enc
  ```
  脚本会**完全离线地**自动在宿主机上安装 Docker/Compose 运行环境、自动解密还原数据结构到宿主机的 `/opt/stacks` 中、自动创建 `proxy` 网络拓扑，并按正确的依赖顺序直接拉起全部容器服务。所有项目开箱即用，免去所有繁杂的手动对接！

