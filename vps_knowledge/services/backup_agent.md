# Shield-Backup 可视化灾备控制大厅与物理热备服务说明

[Shield-Backup](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/backup_agent.md) 是整个 VPS 系统的“灾备底座与控制大厅”。它由**轻量级物理备份守护进程**以及**现代化控制面板 (Go 后端 + React 前端)** 共同构成。该系统在源端实现强加密，并结合 Telegram 私密频道与多云存储（OneDrive、Google Drive、PikPak）实现去中心化的灾难一键瞬间恢复。

---

## 📂 部署与物理路径对照

* **宿主机部署 Stack 目录**：`/opt/stacks/backup-agent/` (核心文件：`compose.yaml`)
* **关键内部组件物理路径**：
  * `/opt/stacks/backup-agent/compose.yaml`：控制容器的系统环境，限制 CPU 占比 20%、内存最大 300MB。
  * `/opt/stacks/backup-agent/server/`：Go 语言控制中心服务端，监听宿主机 `9999` 端口，提供大厅 API 交互和任务管理。
  * `/opt/stacks/backup-agent/web/`：React 前端可视化大厅（经编译后静态挂载至服务端）。
  * `/opt/stacks/backup-agent/backup.sh`：容器内高频热备份主脚本，每小时自动被控制后台调用。
  * `/opt/stacks/backup-agent/config/`：存放运行时配置，如 `rclone.conf` (云盘授权凭证)、`settings.json` (包含主加密密码)、`local_pull_logs.json` (冷备同步流水)。
* **持久化卷挂载说明**：
  * `/opt/stacks/vaultwarden/data:/vaultwarden_data:ro` (只读挂载，获取密码库 SQLite 文件)
  * `/opt/stacks/ldap/data:/lldap_data:ro` (只读挂载，获取用户目录 SQLite 文件)
  * `/opt/stacks:/source_stacks:ro` (只读挂载，每月 1 号执行全量 stacks 配置打包归档)
  * `./config:/config` (读写挂载，存放控制后台配置文件和凭证)

---

## ⚙️ 核心架构与运行机制

### 1. 多通道强加密备份 (双轨备份)
* **高频热备**：控制中心每小时调用 `backup.sh` 对 Vaultwarden 与 LLDAP 的 SQLite 进行一致性备份。
  * **Telegram 密道**：在本地使用对称密钥（`BACKUP_PASSWORD`）将一致性副本强加密为 `.enc` 压缩包，调用 Telegram API 投递到您的私密频道，实现安全的异地物理隔离。
  * **多云同步 (Rclone Crypt)**：使用 `rclone.conf` 将备份文件加密传输至 OneDrive, GDrive, PikPak 云盘，保障云端服务商无法得知文件结构和读取内容。
* **每月全量独立归档包**：每月 1 号自动打包 `/opt/stacks` 的所有配置文件，经过 AES-256 对称加密后分发至云端和 Telegram 频道。

### 2. 局部恢复与细粒度导入还原
控制后台提供高度灵活的“系统配置导入还原”机制。通过上传加密备份包并输入主密码，支持对 `rclone.conf`、冷备拉取清单、本地主密码、GFS 规则、任务历史日志以及服务器备份列表等 8 个不同维度的独立模块进行**多选局部还原与合并**。

### 3. 多云端负载均衡自愈下载
当在新 VPS 宿主机上恢复系统，或缺失本地物理备份时，控制后台可以根据“服务器备份列表”，并发扫描微软 OneDrive、Google Drive 和 PikPak。系统根据**贪心负载均衡算法**将缺失的文件指派给已分摊字节最小的健康存储池，并发分流执行下载拉回自愈。

### 4. 客户端冷备助手同步
Windows 本地电脑运行 `sync_to_local.ps1` 增量将云端备份同步至本地磁盘（完成 3-2-1 备份）。客户端上报的心跳流水通过控制大厅的安全 Token 比对，独立持久化在 `/config/local_pull_logs.json` 中并在仪表盘看板中展示。

---

## 🚨 联动依赖与修改波及警告 (Impact Warning)

> [!IMPORTANT]
> 1. **大厅对外路由波及**：
>    可视化控制后台大厅服务在容器内监听 `9999` 端口，受 **Traefik** 网关保护，可通过 `https://backup.xxxiong.top` 进行访问。
> 2. **SSO 身份源联动**：
>    大厅服务目前并未开放公网任意访问，可以结合 **Authelia SSO** 进行安全拦截保护。
> 3. **API Token 联动波及**：
>    本地 Windows 冷备客户端 `sync_to_local.ps1` 同步心跳时，会携带 `DownloadToken` 访问控制大厅的 `/api/local-pull/manifest`。**如果您在设置中刷新或更改了 Token，必须将新 Token 同步更新至本地客户端的 PS1 脚本中**，否则会导致客户端提示 401 授权错误并拒绝同步。

---

## 🔧 常见维护操作

1. **`BACKUP_PASSWORD` 密钥保管**：
   - 所有的 `.enc` 加密备份文件均依靠该密码解密。请在您的本地安全地方（如打印纸张、密码本等）离线记录该主密码。**一旦丢失，历史所有加密包将成为无法复原的死文件。**
2. **只读 `:ro` 生产保护**：
   - 本服务容器对 `/opt/stacks` 的挂载强制为只读（`:ro`）。这意味着备份容器在物理层面上没有任何权限修改您的数据库和生产数据，杜绝了备份程序被侵入或出错导致生产数据被误删/破坏的概率。
