# Duplicati 异地加密备份服务说明 (Duplicati Backup Service)

[Duplicati](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/duplicati.md) 是整个 VPS 系统的终极“灾备保障器”。它以超级管理员特权运行，定期对物理宿主机上的关键配置文件（特别是 `/opt/stacks` 与全局配置目录）进行增量备份、高强度 AES-256 加密，并安全自动上传至异地云存储。

---

## 📂 部署与物理路径对照

* **宿主机部署 Stack 目录**：`/opt/stacks/backup/` (核心文件：`docker-compose.yml`)
* **核心高特权卷挂载**：
  * `/:/source:ro`（以 **只读 (ro)** 模式将宿主机物理主机的根目录 `/` 挂载进容器的 `/source` 中。这使得 Duplicati 能无差别地跨越容器隔离，直接读取宿主机上的所有系统配置、Docker 挂载卷、数据库数据进行备份）
  * `./config:/config` (持久化挂载目录，内部包含 Duplicati 自身的备份任务设置、目标端 Token 秘钥以及其核心 SQLite 配置数据库 `/config/Duplicati-server.sqlite`)
* **网络与访问**：
  * 接入共享外部网络 `proxy`。
  * **管理面板域名**：`https://backup.xxxiong.top` (受 Authelia SSO 保护，普通用户被强制拦截)

---

## 🔒 备份策略与加密安全防线

1. **宿主机上帝备份模式**：
   由于容器环境变量中指定了 `PUID=0` (root) 且挂载了物理根目录 `/`，Duplicati 本质上在容器内拥有了物理宿主机的最高文件读取特权。在 Web 后台配置备份任务时，源文件路径指向内网的 `/source/opt/stacks` 及其他重要目录即可实现免代理的全盘无感备份。
2. **配置库密码加密 (`SETTINGS_ENCRYPTION_KEY`)**：
   在容器环境变量中配置了该加密 Key，用于保护其自身保存在 `/config` 下的 SQLite 数据库，确保异地存储的 API Tokens 和密码不会因面板配置库泄漏而暴露。

---

## 🚨 修改与波及影响警告 (Deployment & Dependency Risks)

1. **备份密钥丢失的灭顶之灾**：
   * 在 Duplicati 后台配置的备份任务中，包含了一个**“备份对称加密密钥 (Passphrase)”**。如果该密钥丢失，即使异地云端有完好的备份数据，也**绝对无法解密还原任何一个文件**！必须将该密钥与主密码一同妥善记录。
2. **SQLite 数据库损毁风险**：
   * `/opt/stacks/backup/config/Duplicati-server.sqlite` 存储了所有备份任务配置和历史块索引。如果该文件丢失且未备份，Duplicati 面板将需要完全重新配置，且需要花费数小时去重新扫描远端异地存储以重建索引。
3. **上帝挂载的只读安全**：
   * 确保 `/` 到 `/source` 的挂载为 `:ro`（只读），防止 Duplicati 出现程序漏洞或被攻陷后，攻击者利用该挂载去物理删除或改写宿主机的核心系统文件。
