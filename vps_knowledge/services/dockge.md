# Dockge 堆栈管理台服务说明 (Dockge Service)

[Dockge](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/dockge.md) 是全系统管理所有 Docker Compose 堆栈（Stacks）的核心控制面板。它提供了一个美观且易用的 Web 界面，供用户编写、编辑、部署、管理和监控宿主机上 `/opt/stacks` 目录下的所有 Compose 容器。

---

## 📂 部署与物理路径对照

* **宿主机部署 Stack 目录**：`/opt/stacks/dockge/` (核心文件：`docker-compose.yml`)
* **核心高特权挂载**：
  * `/var/run/docker.sock:/var/run/docker.sock` (以 **读写模式** 挂载 Docker 套接字，用于控制容器的 lifecycle)
  * `/opt/stacks:/opt/stacks` (以 **读写模式** 直接挂载物理宿主机上所有 Stacks 的源文件目录！这使 Dockge 能直接读取、新增、修改或删除物理硬盘上的任何 `compose.yaml` 或 `.env` 文件)
  * `/opt/dockge/data:/app/data` (持久化挂载目录，内部存储 Dockge 自身的系统数据)
* **网络与访问**：
  * 接入共享外部网络 `proxy`。
  * **管理面板域名**：`https://dockge.xxxiong.top` (受 Authelia SSO 保护，普通用户被强制拦截)

---

## 🚨 致命修改与波及影响警告 (Critical Warning & Deployment Risks)

1. **直接物理文件篡改风险 (宿主机 `/opt/stacks` 越权风险)**：
   * 本容器**最危险且最重要**的配置是挂载了 `/opt/stacks:/opt/stacks`。
   * 任何在 Dockge 后台进行的 `Edit`、`Save` 或 `Delete` 动作，都是在**直接修改物理宿主机上的原始代码文件**！
   * 如果 AI 代理或用户在 Dockge 中意外删除了某个 Stack，物理磁盘上的整个项目目录及其不包含卷映射的数据文件会被**彻底、物理性地抹除**！必须对此操作保持高度敬畏。
2. **Docker 套接字特权劫持**：
   * 读写挂载 `/var/run/docker.sock` 是极其危险的提权路径。如果 Dockge 的前端受到越权访问（如 Authelia 被绕过），攻击者不仅可以接管所有堆栈，还能通过在 Dockge 里新建一个挂载了物理宿主机 `/` 根目录的特权容器，从而在几秒内攻陷整台 VPS 的 root 系统。
3. **网络与配置冲突预警**：
   * 在使用 Dockge 部署新的 Stack 时，必须确保其容器名称、暴露端口以及网络别名不要与现有的 Traefik 或 Authelia 发生冲突。如果强行拉起一个抢占 `80/443` 或 `9091` 的容器，会导致全局网关立刻崩溃。
