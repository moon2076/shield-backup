# FileBrowser 网页文件管理器说明 (FileBrowser Service)

[FileBrowser](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/filebrowser.md) 是全系统管理物理宿主机文件的便捷 Web 窗口。它以超级管理员 `root` 特权运行，并在容器内部以读写模式挂载了宿主机的根目录，供用户通过网页进行文件浏览、代码编辑、文件上传与物理删除。

---

## 📂 部署与物理路径对照

* **宿主机部署 Stack 目录**：`/opt/stacks/filebrowser/` (核心文件：`docker-compose.yml`)
* **致命级高特权挂载**：
  * `/:/srv` (以 **读写模式** 将物理宿主机的根目录 `/` 直接映射为容器内的 `/srv`！这允许您在网页上直接浏览和修改 VPS 的系统文件、容器挂载目录和代码文件)
  * `./filebrowser.db:/database/filebrowser.db` (持久化挂载文件，存储 FileBrowser 的用户、权限及设置数据库)
  * `./filebrowser.json:/.filebrowser.json` (配置文件)
* **网络与访问**：
  * 接入共享外部网络 `proxy`。
  * **管理面板域名**：`https://files.xxxiong.top` (受 Authelia SSO 强拦截保护)

---

## 🚨 致命修改与波及影响警告 (Critical Warning & Deployment Risks)

1. **直接物理文件损毁（全盘覆灭风险）**：
   * 本服务在容器内将 `/srv` 指向宿主机的 `/`。
   * 任何在网页控制台对 `/srv` 下文件的 `Delete`、`Edit` 操作，都是**在对物理 VPS 根目录进行直接的物理删改**！
   * 严禁在 FileBrowser 中意外删减宿主机的系统关键目录（如 `/etc`、`/boot`、`/usr` 或容器堆栈 `/opt/stacks`），否则将**直接导致 VPS 崩溃死机且无法开机**！
2. **SSO 拦截的绝对防线要求**：
   * 鉴于本服务具有接管整盘物理文件的特权，在 Traefik 中本服务的路由规则**必须 100% 挂载 Authelia SSO 中间件** (`authelia@docker`)。
   * 如果意外在 Docker Labels 中移除了中间件，或者 Authelia 网关发生泄露漏洞，外网任何人都可以通过该面板直接下载或删除您的私钥、配置文件，进而彻底黑掉您的服务器！
3. **数据库损坏预防**：
   * `./filebrowser.db` 存储了该面板的用户账户设置。一旦损坏或丢失，会导致登录凭证失效、配置丢失，需重新初始化。
