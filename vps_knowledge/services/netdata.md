# Netdata 实时监控服务说明 (Netdata Service)

[Netdata](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/netdata.md) 是全系统的高精度实时性能看板。它以极高的特权模式运行，能够秒级收集并渲染宿主机 VPS 的 CPU、内存、网络流量、磁盘 I/O 以及每个容器的实时资源消耗。

---

## 📂 部署与物理路径对照

* **宿主机部署 Stack 目录**：`/opt/stacks/netdata/` (核心文件：`docker-compose.yml`)
* **特权级卷挂载与环境**：
  * `privileged: true` (以 **特权模式** 启动容器，允许其访问物理硬件接口)
  * `pid: host` (共享宿主机进程空间，使 Netdata 能全面监控 VPS 物理机上所有运行的进程状况)
  * `/:/host/root:ro,rslave` (将宿主机根目录以只读和 rslave 方式挂载，供 Netdata 探针遍历分析系统状态)
  * `netdataconfig`、`netdatalib`、`netdatacache` (命名卷，用于持久化 Netdata 自身的配置和历史指标缓存)
* **网络与访问**：
  * 接入共享外部网络 `proxy`。
  * **内网直连端口**：`19999` (内网 HTTP 端口，主要被 Homepage 面板用来直连拉取实时的 CPU/Memory 看板 Widget，绕过了 SSO)
  * **管理面板域名**：`https://monitor.xxxiong.top` (受 Authelia SSO 网关强拦截保护)

---

## 🚨 修改与波及影响警告 (Deployment & Dependency Risks)

1. **特权模式与安全防线**：
   * 本容器使用了 `privileged: true` 和 `pid: host`。这意味着 Netdata 容器**在安全隔离性上是极低的**。如果 Netdata 的 Web 端口暴露于公网且没有 Authelia SSO 中间件保护，外网攻击者可以通过 Netdata 监控接口发现您 VPS 上运行的所有具体进程名称、敏感环境变量和网络连接拓扑，产生巨大的信息泄露风险！
2. **内网 API Widget 联动断开预警**：
   * Homepage 仪表盘是通过内网地址 `http://netdata:19999` 直连来拉取性能指标的。如果 Netdata 容器名被更改，或者移出了 `proxy` 网络，**Homepage 的实时性能 Widget 将全部报错挂掉**。
3. **磁盘监控与 inode 告警**：
   * Netdata 会监控全盘磁盘读写。如果 Duplicati 执行备份任务，会导致 Netdata 的磁盘读写指标短时飙升，这属于正常现象。
