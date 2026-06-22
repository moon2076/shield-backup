# Vaultwarden 密码管理器说明 (Vaultwarden Service)

[Vaultwarden](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/vaultwarden.md) 是全系统敏感资产（密码、密钥、安全备注）的安全存储库。它是 Bitwarden API 的轻量级 Rust 开源实现，负责提供用户本地的密码保险箱同步与存储服务。

---

## 📂 部署与物理路径对照

* **宿主机部署 Stack 目录**：`/opt/stacks/vaultwarden/` (核心文件：`docker-compose.yml`)
* **持久化卷挂载**：
  * `./data:/data` (持久化挂载目录，内部包含密码库的 SQLite 数据库 `db.sqlite3`、系统配置文件、以及所有的附件与密钥存储)
* **网络与访问**：
  * 接入共享外部网络 `proxy`。
  * **主应用域名**：`https://vaultwarden.xxxiong.top`
  * **管理域名路由**：`https://vaultwarden.xxxiong.top/admin`
  * **安全网关拦截**：本域名受 Authelia SSO `one_factor` 重度拦截保护。

---

## 🚨 修改与波及影响警告 (Deployment & Dependency Risks)

1. **密码库数据的备份依赖 (SQLite `db.sqlite3`)**：
   * 所有加密的密码账密均存储在宿主机 `/opt/stacks/vaultwarden/data/db.sqlite3` 文件中。
   * 此文件是**全站资产的重中之重**。Duplicati 备份任务必须确保以绝对只读形式实时捕获该数据，一旦此文件损坏且备份失效，所有主密码和派生密码将永久丢失！
2. **WebSockets 联动配置**：
   * Vaultwarden 依赖 WebSockets（容器内 3012 端口或自带整合模式）实现移动端和浏览器插件的实时密码修改推送。在 Traefik 配置中，必须确保 WebSocket 连接被正确转发，否则会导致移动端或浏览器插件无法及时同步改动，提示“同步失败”。
3. **管理后台 (/admin) 的物理关闭或强拦截限制**：
   * 密码管理器后端的管理员后台（`/admin`）包含了全局用户邀请、密码库强行删除等高危操作。必须确保该路径不可被任意访问。建议在 `.env` 中通过 `ADMIN_TOKEN` 配置密码，或者通过 Traefik 规则直接对 `/admin` 进行阻断或二次验证，保障密码库底座绝对安全。
