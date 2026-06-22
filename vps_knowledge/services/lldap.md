# LLDAP 轻量级身份目录服务说明 (LLDAP Service)

[LLDAP](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/lldap.md) 是全系统唯一且最核心的用户数据库。它提供了一个轻量级的 LDAP 用户目录服务，统一存储并对外（主要是 Authelia 和 homepage-bridge）分发用户账户、组以及密码凭证。

---

## 📂 部署与物理路径对照

* **宿主机部署 Stack 目录**：`/opt/stacks/ldap/` (核心文件：`docker-compose.yml`)
* **持久化卷挂载**：
  * `./data:/data` (持久化挂载目录，内部包含核心配置 `lldap_config.toml` 以及存储所有用户数据的 SQLite 数据库 `users.db`)
* **网络与访问**：
  * 接入共享外部网络 `proxy`。
  * **内网核心端口**：`3890` (LDAP 明文/STARTTLS 通信端口)，供 Authelia 及 homepage-bridge 容器内网进行身份校验。
  * **管理面板域名**：`https://ldap.xxxiong.top` (由 Traefik 反代提供 Web 管理后台，同样受 Authelia 拦截保护)

---

## ⚙️ 目录结构与联动配置

* **基本 DN (Base DN)**：`dc=xxxiong,dc=top`
* **用户组织单元 (OU)**：`ou=people` (例如用户 root 在 LDAP 中的完整 DN 为 `uid=root,ou=people,dc=xxxiong,dc=top`)
* **用户组组织单元 (OU)**：`ou=groups` (包含组如 `admins`，`app_portainer` 等，用以进行细粒度的应用授权控制)
* **对接联动**：
  * **Authelia 对接**：Authelia 通过 `address: ldap://lldap:3890` 内网连接本服务。使用管理员账号 `uid=admin_control,ou=people,dc=xxxiong,dc=top` 作为 Bind DN，查询用户组和邮箱属性。
  * **Homepage-Bridge 对接**：Bridge 在处理用户资料拉取、头像显示、密码修改时，通过内网直接与 `ldap://lldap:3890` 发生连接，调用 LDAP 的 `Modify` 请求更改本服务本地的 `users.db` 数据库。

---

## 🚨 修改与波及影响警告 (Deployment & Dependency Risks)

1. **“一损俱损”的核心命脉**：
   * LLDAP 是全系统的登录根基。如果 LLDAP 容器停止运行，或者由于配置文件损坏导致 `3890` 端口无法访问，**Authelia 单点登录将立刻瘫痪**，全域所有需要登录的服务将全部陷入死锁，无法提供访问。
2. **管理员凭证绑定限制**：
   * `uid=admin_control` 账户的密码必须在 LLDAP 内部和 Authelia、Homepage-Bridge 的环境变量中保持**绝对同步**。一旦更改，如果没有同步更新这些关联服务的环境变量，SSO 校验和自修面板将瞬间报错。
3. **数据文件安全 (users.db)**：
   * 宿主机 `/opt/stacks/ldap/data/users.db` 是唯一的物理用户库文件。Duplicati 备份任务必须将其纳入每日的重点异地备份名单，一旦该文件损坏且无备份，全系统用户数据将彻底丢失。
