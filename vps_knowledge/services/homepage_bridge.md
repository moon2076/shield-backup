# Homepage-Bridge 自研辅助网桥说明 (Homepage-Bridge Service)

[Homepage-Bridge](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/homepage_bridge.md) 是一个专门为了扩展主面板美化和用户个人资料/密码修改而自研定制的 Python 辅助容器。它与 `homepage` 以及 `LLDAP` 存在高度的联动依赖。

---

## 📂 部署与物理路径对照

* **宿主机部署 Stack 目录**：`/opt/stacks/homepage-bridge/` (核心文件：`docker-compose.yml`, `Dockerfile`, `app.py`)
* **持久化卷挂载**（对其它服务的强依赖挂载）：
  * `/opt/homepage/config:/homepage-config:ro` (以 **只读 (ro)** 方式挂载 Homepage 配置文件，用于配合或热读取设置)
  * `/opt/homepage/images:/wallpapers` (挂载图片目录，用于存储用户在 bridge 面板上传的自定义壁纸)
  * `/opt/homepage/db:/app/db` (本地 SQLite 数据，存储壁纸的特效值如模糊度、亮度、轮播时间、天气绑定等数据)
* **网络与访问**：
  * 接入 `proxy` 外部网络。
  * 受 Traefik HTTPS 路由及 Authelia SSO 拦截保护。当外部用户访问 `/profile`, `/password`, `/wallpaper` 时，Traefik 会自动调用 Authelia 中间件验证会话。

---

## ⚙️ 核心路由与联动能力 (app.py API)

该网桥容器的核心控制逻辑在 `app.py` 中，对外暴露了以下 API 接口供 Homepage 客户端的 `custom.js` 或用户浏览器调用：

### 1. 壁纸与特效管理 (Aesthetic Engine)
* **`/custom-api/images` & `/custom-api/images/upload`**：获取壁纸列表及允许用户上传自定义壁纸图片。图片将直接持久化保存在 `/wallpapers`（宿主机物理路径为 `/opt/homepage/images`）。
* **`/custom-api/effects/all` & `/custom-api/effects/save`**：获取并保存每张壁纸的专属 CSS 滤镜特效（如模糊 `blur`，亮度 `brightness`，缩放 `scale`，过场过渡时间 `transition`）。数据保存在本地 SQLite `db` 中。
* **`/custom-api/wallpaper/effects`**：被 `custom.js` 异步调用，用以向 Homepage 页面反馈当前正在生效的壁纸特效变量（并计算下一个轮播图切换定时器所需的 `next_refresh_in` 时间）。
* **`/custom-api/wallpaper`**：输出当前生效的壁纸图片流（作为 Homepage 页面 `body::before` 伪元素的背景图）。

### 2. 用户自服务与 LDAP 密码热修改 (User Self-Service & LDAP Write)
当用户通过 Authelia SSO 登录后，访问网桥暴露的前端接口时，Bridge 会通过内网与 LLDAP 容器发生以下联动：
* **`/custom-api/userinfo`**：
  * **联动机制**：由于在 Traefik 中间件配置了 `authResponseHeaders` 转发，Authelia 校验会话通过后会在 Request Header 中注入 `Remote-User`。
  * **行为**：Bridge 读取 `Remote-User` 请求头获取当前登录的用户名，然后通过内网连接 `ldap://lldap:3890`（使用 `LDAP_BIND_DN` 与 `LDAP_BIND_PASS` 管理员账号登录 LLDAP），以只读方式查询该用户在 LDAP 中的 `displayName`、`mail` 以及 Base64 格式的头像图片，并返回给浏览器用于渲染主页头像和信息。
* **`/custom-api/update_password`**：
  * **联动机制**：提供安全的密码自修面板（前端位于 `/password`）。
  * **行为**：用户在此输入新旧密码后，网桥后端使用该用户的 LDAP DN 和旧密码尝试与 LLDAP 建立 LDAP 绑定（验证旧密码是否正确）。验证成功后，网桥将通过 LDAP 修改操作（LDAP Modify）向 `lldap:3890` **写入新密码**！
  * **波及结果**：密码修改成功后会**热更新 LLDAP 用户库**，导致 Authelia 缓存的会话在失效后要求用户使用新密码登录，同时 Portainer（如果配置了 LDAP）等一切联动身份源的项目全部被同步热更新密码。
* **`/custom-api/update_profile` & `/custom-api/update_avatar`**：
  * 允许用户修改自己的显示姓名和上传自定义头像。网桥同样会通过 LDAP 连接将这些改动写入 LLDAP，从而使用户主页上的头像发生热更新。

---

## 🚨 修改与波及影响警告 (Deployment & Dependency Risks)

1. **LDAP 凭证强依赖**：
   * 网桥启动的环境变量中包含 `LDAP_BIND_DN` 和 `LDAP_BIND_PASS`。如果 LLDAP 面板重置了管理员密码，必须**同步修改** `homepage-bridge` 容器的环境变量，否则主页头像、修改资料和修改密码自服务将全部不可用。
2. **Volumes 路径对应**：
   * 本服务挂载的 `/wallpapers` 必须与 `homepage` 容器能够访问的图片资源路径存在物理映射，否则用户在 bridge 上传了壁纸后，Homepage 容器因找不到物理文件将显示 404 挂图。
3. **SSO 中间件保障**：
   * 路由规则 `Host('xxxiong.top') && (Path('/profile') || Path('/password') || Path('/wallpaper'))` 必须在 Traefik 中挂载 `authelia@docker` 中间件。如果漏配了中间件，任何未经授权的外网访问都可以直接访问这些修改资料和壁纸界面，甚至导致 LDAP 信息泄露！
