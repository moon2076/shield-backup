# Traefik 反向代理与网关服务说明 (Traefik Gateway Service)

[Traefik](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/traefik.md) 是整个 VPS 网络架构的唯一“入关口”。它充当系统的全局反向代理（Reverse Proxy）与边缘网关（Edge Router），拦截所有公网 `80` (HTTP) 和 `443` (HTTPS) 流量，并自动为全站二级域名完成 TLS/SSL 证书的申请、安装与热更新。

---

## 📂 部署与物理路径对照

* **宿主机部署 Stack 目录**：`/opt/stacks/traefik-authelia/` (与 Authelia 同在一个 compose 文件中部署)
* **持久化挂载卷与配置文件**：
  * `/opt/infra/traefik:/etc/traefik` (挂载 Traefik 主配置目录，内部包含 `traefik.yml` 静态配置以及动态路由配置目录)
  * `/opt/infra/traefik/acme.json:/letsencrypt/acme.json` (自动申请的 SSL 证书明文私钥存储文件。**此文件在宿主机上必须保持 600 权限**，否则 Traefik 会因私钥不安全直接拒绝启动)
  * `/var/run/docker.sock:/var/run/docker.sock:ro` (以 **只读 (ro)** 方式挂载 Docker 套接字，允许 Traefik 监听 Docker API 自动侦测容器 Labels 的变化并生成路由表)
* **网络与物理端口**：
  * 接入共享外部网络 `proxy`（Traefik 使用此网络直接与后端业务容器通信，绕过宿主机网络，安全隔离）。
  * 独占宿主机物理网卡端口：`80` (HTTP，自动重定向到 443) 和 `443` (HTTPS 统一加密入口)。
  * **管理面板域名**：`https://traefik.xxxiong.top`

---

## 🔒 动态路由、中间件与 SSL 自动证书机制

### 1. Docker Provider 自动路由生成
Traefik 通过只读挂载 Docker 套接字，自动解析后端容器上标记的以 `traefik.http.routers.*` 开头的 Labels。一旦有新容器上线且被打上了该标签，Traefik 会在几毫秒内热生成对应的域名反代规则和 upstream 转发端口，无需重启网关。

### 2. TLS 自动卸载与 Let's Encrypt 证书续期
* **Wildcard 证书自动托管**：Traefik 静态配置文件中使用 `dnsChallenge` 模式对接 Cloudflare，通过 DNS-01 验证（自动向您的 Cloudflare 账户写入一条临时的 TXT 解析记录完成所有权验证），实现对 `*.xxxiong.top` 泛域名证书的自动申请与定期静默续期。
* 证书存储在 `/letsencrypt/acme.json` 下，保证了全域所有子服务的 HTTPS 加密连接都是有效且受浏览器信任的。

---

## 🚨 修改与波及影响警告 (Deployment & Dependency Risks)

1. **“一损俱损”的致命总闸**：
   * Traefik 是整个 VPS 的流量命门。一旦 Traefik 容器崩溃、配置语法错误或端口冲突（如 80/443 被其他不规范容器强占），**全系统所有外网服务将瞬间失联**。
2. **acme.json 权限锁死限制**：
   * 每当备份、拷贝或恢复 `/opt/infra/traefik/acme.json` 时，其在宿主机上的文件权限**必须为 600**（`chmod 600 acme.json`），且所有者为 `root`。如果权限过大（如 644/777），Traefik 会报错 `permissions 777 for /letsencrypt/acme.json are too open, required 600` 并强制退出。
3. **Docker 套接字安全约束**：
   * 虽然为了安全使用了 `:ro`（只读）挂载，但掌握 `/var/run/docker.sock` 的只读读取权依然有可能在特定情况下被利用。切勿为了方便让任何第三方不信任容器挂载此套接字。
