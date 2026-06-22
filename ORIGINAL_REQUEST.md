# Original User Request

## Initial Request — 2026-06-05T22:04:50+08:00

深入探索并梳理 VPS (23.254.235.234) 上所有已部署项目（位于 /opt/stacks/ 下 of Stacks）的内部配置、相互配合联动机制以及挂载卷结构，排除敏感凭证后，将这些深入的架构图谱和技术关联持久化编撰到本地白皮书中。

Working directory: d:\Work_Project\VPS_RN
Integrity mode: development

## Requirements

### R1. VPS 服务部署现状与应用级配置剖析
* 深入调查 `/opt/stacks/` 目录下所有 Stacks 的 `docker-compose.yml`。
* 读取并深入剖析核心联动服务的专用配置文件（例如 Authelia 的 `configuration.yml` 中涉及 LLDAP 接口与路由部分，以及 Traefik 的主要配置项）。
* 针对 `homepage` 等高度依赖自定义配置的项目，必须读取并解析其内部配置文件（如 `services.yaml`, `widgets.yaml`, `bookmarks.yaml` 等），厘清其与宿主机及其他服务的数据桥接关系。
* 严禁拉取或在本地记录任何敏感的明文密码、私钥、API Tokens。

### R2. 项目间联动与联动机制解析
* 厘清并记录以下核心服务之间的互联与调用关系：
  1. Authelia 与 LLDAP 的 SSO 单点登录对接与用户目录联动机制。
  2. Traefik 与 Authelia 的认证保护对接逻辑（如 ForwardAuth/Middleware 拦截重定向配置）。
  3. Homepage 与其他服务（如 Portainer, Netdata, Vaultwarden 等）的 API 指标拉取联动配置。
  4. Duplicati 的备份策略及备份覆盖目录。
* 分析各容器网络隔离拓扑，说明哪些容器互联，哪些处于隔离状态。

### R3. 本地架构白皮书持久化与指引更新
* 将上述梳理出的“服务能力、挂载卷、网络拓扑、系统间联动调用链”以结构化的 Markdown 写入本地的 `vps_knowledge/vps_blueprint.md` 新增的“已部署服务深度解析与联动”章节。
* 绘制出服务联动网络拓扑图（Mermaid 流程图形式）。

### R4. VPS 只读安全约束（Read-Only Constraint）
* **强安全性要求**：多智能体团队在 VPS 上的所有行为必须是 **100% 只读**的。
* 严禁执行任何会改变 VPS 状态的操作，包括但不限于：创建/修改/删除文件或目录、重启/更改 Docker 容器、修改网络规则、安装/删除 systemd 服务或系统软件包等。

## Acceptance Criteria

### 文档完备性与准确性
- [ ] 本地 `vps_knowledge/vps_blueprint.md` 中包含每个已部署 Stacks 的能力、网络、卷挂载 and 依赖配置。
- [ ] 文档中清晰指明 Authelia-LLDAP 对接、Traefik-Authelia 拦截、以及 Homepage API 桥接的具体工作原理与联动配置位置。
- [ ] 文档包含一个用 Mermaid 渲染的内部网络与服务联动交互拓扑图。
- [ ] 所有拉取到的配置分析中不包含任何敏感的明文凭证，且本地不存在敏感明文配置文件备份。

### 安全与无损验证
- [ ] 验证 VPS 上的所有项目配置、容器状态和原始文件在任务执行前后未发生任何物理变动（文件修改时间、容器启动时间等保持一致）。
