# Portainer 容器管理平台说明 (Portainer Service)

[Portainer EE](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/portainer.md) 是整个 VPS 容器化集群的图形化运维控制台。它通过读写挂载本地 Docker 守护进程套接字，提供对容器、镜像、网络、挂载卷及容器日志的全面管理与监控。

---

## 📂 部署与物理路径对照

* **宿主机部署 Stack 目录**：`/opt/stacks/portainer/` (核心文件：`docker-compose.yml`)
* **持久化卷挂载**：
  * `/var/run/docker.sock:/var/run/docker.sock` (以 **读写模式** 挂载 Docker 套接字，这是 Portainer 能够拉起、停止或修改宿主机上任何容器的权力来源)
  * `/opt/portainer/data:/data` (持久化挂载目录，内部存储 Portainer 自身的系统设置、OIDC 凭证配置及本地数据库)
* **网络与访问**：
  * 接入共享外部网络 `proxy`。
  * **内网 API 端口**：`9000` (内网提供 HTTP API，主要用于 Homepage 绕过 SSO 拦截来拉取运行状态指标)
  * **管理面板域名**：`https://portainer.xxxiong.top` (由 Traefik 提供反代，并受 Authelia 拦截保护)

---

## 🔒 SSO 联动与高特权安全防线

### 1. 欢迎页 API 联动 (Widget Integration)
* **联动机制**：在 Homepage 的 `services.yaml` 中，Portainer 卡片被配置为 `url: http://portainer:9000`。
* **脱敏 Key**：Homepage 通过一个脱敏的 API Token (Key) 与 Portainer 内网 API 通信，拉取当前的容器总数、存活数和异常数并渲染为 Widget。

### 2. OIDC 统一登录对接 (建议)
* Portainer (商业/EE版) 支持标准的 OIDC (OpenID Connect) 协议。它可以直接与 **Authelia SSO** 进行对接，使用户登录 Portainer 时无需输入独立密码，直接通过 Authelia 验证并拉取 LDAP 用户身份。

---

## 🚨 修改与波及影响警告 (Deployment & Dependency Risks)

1. **Docker 套接字的高特权风险**：
   * 本容器挂载了读写权限的 `/var/run/docker.sock`。掌握了此套接字等于**拥有了整个 VPS 宿主机的 root 控制权**。如果 Portainer 的登录端口被泄露或被绕过，攻击者可以通过在此拉起一个特权容器来轻松提权夺取物理宿主机的主机控制权。
2. **密码与授权同步警告**：
   * 如果配置了 OIDC 对接，LLDAP 中用户的组属性变更（例如用户被踢出 `admins` 组）会在下一次登录 Portainer 时同步生效，这可能导致管理员突然失去对 Portainer 控制台的修改权限。
3. **备份依赖**：
   * 必须确保 `/opt/portainer/data` 被 Duplicati 纳入增量备份中，因为该目录包含了您所有 Docker 终点和 API Keys 的存储配置，丢失后会导致整个控制面板需要重新初始化。
