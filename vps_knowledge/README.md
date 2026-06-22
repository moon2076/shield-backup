# AI 代理工作规范 (AI Agent Workflow & Protocol)

本规范定义了所有 AI 代理（包括大模型助手、自治子代理等）在此工作区进行开发与运维时必须严格遵守的行为准则，以保证跨会话协作的信息一致性与安全性。

---

## 🧭 核心工作流 (Core Lifecycle)

任何 AI 代理进场开始工作前，必须遵循**“全局视图优先、关联项目同时跟进、修改强制更正写回”**的开发闭环：

```mermaid
graph TD
    Start[新代理进场 / 新对话开始] --> ReadBlueprint[1. 优先阅读总览 vps_blueprint.md]
    ReadBlueprint --> ReadService[2. 精读对应的 services/子文档]
    ReadService --> CheckImpact[3. 检查总览中警告的 [联动波及项目]]
    CheckImpact --> ExecuteTask[4. 执行开发/运维任务]
    ExecuteTask --> WriteBack[5. 强行更正写回修改过的子文档/主总览]
    WriteBack --> Finish[结束迭代]
```

### 1. 全局总览优先 (Global View First)
* **动作**：AI 代理必须且首先深度阅读工作区根目录下的主白皮书：[vps_blueprint.md](file:///d:/Work_Project/VPS_RN/vps_knowledge/vps_blueprint.md)。
* **目的**：理解当前 VPS 整体网络流向、全局安全策略及动态运行指标。

### 2. 精准定位与联动跟进 (Targeted Reading & Impact Assessment)
* **定位**：定位当前开发任务关联的具体服务，并精读位于 `vps_knowledge/services/` 下的专属子说明文档（例如 [homepage.md](file:///d:/Work_Project/VPS_RN/vps_knowledge/services/homepage.md)）。
* **跟进**：仔细查阅主白皮书中该服务被标注的 **`联动依赖与波及警告`**。如果在修改此项目时会波及其他上下游项目（例如修改 LLDAP 可能会影响 Authelia），**必须同时读取**相关项目的说明文档，避免破坏服务之间的互联。

### 3. 修改必写回更正 (Mandatory Write-back & Correction)
* **动作**：当在 VPS 上成功实施了部署改动、配置文件修改或架构调整后，**必须立即对对应的子服务说明文档（或主白皮书）进行更正和写回**。
* **要求**：禁止将未登记的文件修改或依赖变动留到下一轮对话。保持“改动”与“文档描述”的绝对一致。

---

## 🔒 安全与只读红线 (Security & Read-Only Red Lines)

1. **绝对只读约束 (100% Read-Only Limit)**：
   * 在当前审计阶段下，代理团队在 VPS 上的所有连接行为必须保持 **100% 只读**。
   * 严禁执行任何写入、重启容器、删除文件、更改防火墙等会引起 VPS 物理变动的命令。
2. **零明文密码原则 (Zero Plaintext Secrets)**：
   * 本地文档和代码库中严禁记录任何真实的明文密码、私钥或 API Tokens。
   * 所有的说明和示例配置，在涉及敏感字段时必须使用占位符（如 `<FILTERED_LDAP_BIND_PASSWORD>`）进行脱敏处理。
