# Cloudflare-DDNS 动态域名解析说明 (Cloudflare-DDNS Service)

[Cloudflare-DDNS](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/cloudflare_ddns.md) 是全系统外网访问的“指路人”。它在后台静默运行，定期获取 VPS 最新的公网 IP 地址，并通过 Cloudflare API 自动更新您的域名解析记录，确保域名始终精准指向当前的 VPS 实例。

---

## 📂 部署与物理路径对照

* **宿主机部署 Stack 目录**：`/opt/stacks/cloudflare-ddns/` (核心文件：`docker-compose.yml`)
* **卷挂载**：无 (纯无状态容器)
* **网络与访问**：
  * 接入共享外部网络 `proxy`，单向出站 HTTPS 流量，容器内部不对外开放任何 TCP 监听端口。

---

## ⚙️ 核心联动与环境变量

本服务完全依赖于容器环境变量实现与 Cloudflare 的 API 交互：
* **`SUBDOMAINS`**：需要自动动态同步的二级域名（例如 `auth`, `dashboard`, `ldap` 等，或配置为通配符 `*.xxxiong.top`）。
* **`API_KEY` 或 `PROXIED`**：用户脱敏的 Cloudflare API 访问凭证。

---

## 🚨 修改与波及影响警告 (Deployment & Dependency Risks)

1. **IP 无法同步导致“全网失联”**：
   * 尽管本服务极其简单，但它是域名访问的根基。如果 Cloudflare API Token 过期、网络欠费被停机，或者本容器因故障异常退出，**一旦您的 VPS 发生重新拨号或公网 IP 变动，全系统所有的二级域名解析都将瞬间失效**，外网将无法再次连接 VPS。
2. **API 调用限流与封禁警告**：
   * 默认情况下，容器会以固定的安全时间间隔（如每 5 分钟）轮询一次公网 IP。请勿将其轮询间隔缩短到极低的值（如每几秒一次），否则会触发 Cloudflare API 的请求频率限制（Rate Limit），导致 API Token 被临时封禁。
