# Authelia 单点登录 (SSO) 认证服务说明 (Authelia Service)

[Authelia](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/authelia.md) 是整个 VPS 服务栈的安全哨兵。它提供全局的单点登录 (SSO) 统一验证面板，并通过与 Traefik 网关的前置集成，为所有受保护的应用提供双因子/单因子（MFA/1FA）认证屏障。

---

## 📂 部署与物理路径对照

* **宿主机部署 Stack 目录**：`/opt/stacks/traefik-authelia/` (与 Traefik 在同一个 docker-compose 中定义)
* **持久化配置挂载目录**：`/opt/infra/authelia` (映射到容器内的 `/config`)
  * **主配置文件**：`/opt/infra/authelia/configuration.yml` (包含核心的认证后端、Session、访问控制及安全秘钥设置)
* **网络与访问**：
  * 接入共享外部网络 `proxy`。
  * **内网拦截验证端口**：`9091` (内网提供 `/api/verify` 的 ForwardAuth 验证端点，只对 Traefik 网网关开放，宿主机不对外映射)
  * **登录面板域名**：`https://auth.xxxiong.top`

---

## 🔒 核心拦截逻辑与 SSO 对接机制

### 1. ForwardAuth 前置流量拦截
Authelia 采用微服务无侵入式鉴权。其核心工作链为：
* **Traefik 中间件配置**：
  在 Traefik 中声明一个名为 `authelia@docker` 的中间件，指定鉴权地址为 `http://authelia:9091/api/verify?rd=https://auth.xxxiong.top`。
* **Headers 传递与用户信息注入**：
  当用户会话合法且授权通过时，Authelia 自动在 `HTTP 200` 响应头中注入用户信息属性，由 Traefik 传递给下游应用（例如 `Remote-User`, `Remote-Groups`, `Remote-Email`, `Remote-Name`）。这些 Header 是下游应用（如 Portainer）进行自动认证的核心。

### 2. 对接 LLDAP 身份源
* 认证后端使用内网 `ldap://lldap:3890`。
* 用户在 Authelia 输入登录表单后，Authelia 自动查询 `ou=people` 目录下的用户和密码。
* 登录成功后，Authelia 拉取用户的 LDAP 属性并分配 Cookie 会话，该 Session 会话保存在本地 SQLite 数据库 `/config/db.sqlite3`（物理路径为 `/opt/infra/authelia/db.sqlite3`）中。

### 3. 基于 LLDAP 组的细粒度访问控制 (Access Control)
在 `/opt/infra/authelia/configuration.yml` 的 `access_control` 段落中，详细划分了每个子域名的进入权限：
* **全域管理员组**：在 LLDAP 中加入了 `admins` 组的用户，允许进入所有的 `*.xxxiong.top` 子域名。
* **应用权限隔离**：根据域名限制对应的 LLDAP 组名：
  - 访问 `portainer.xxxiong.top` 必须属于 `app_portainer` 组。
  - 访问 `backup.xxxiong.top` 必须属于 `app_backup` 组。
  - 未在相应组的用户在完成密码登录后，会被 Authelia 返回 `403 Forbidden` 拦截页面。

---

## 🚨 修改与波及影响警告 (Deployment & Dependency Risks)

1. **“锁死全域”的网关故障**：
   * 修改 `/opt/infra/authelia/configuration.yml` 时，必须极其小心其 YAML 缩进。一旦 Authelia 出现配置语法错误而无法启动，或者 `9091` 端口连接超时，**所有挂载了 `authelia@docker` 中间件的二级域名（Portainer, Dockge, Vaultwarden 等）都将瞬间报错 502/504 无法访问**。
2. **Session 密钥一致性**：
   * 配置文件中的 `jwt_secret`、`encryption_key` 和 `session.secret` 等防篡改密钥必须持久化保持，不要随意更改。如果更改，会导致所有当前在线的用户 Cookie 失效被强行踢出登录。
3. **LDAP 连接漂移**：
   * 如果 LLDAP 被移至了不同的 Docker 网络、或者修改了 Bind 账号名，必须**同步更正** Authelia 中的 `ldap` 配置，否则会导致 SSO 瘫痪。
