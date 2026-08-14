# Agent Note：pi-ai OAuth 是应用级凭据能力

Status: implemented

[English](2026-08-14-pi-ai-oauth-credential-service.md) | 中文

## 问题

pi-ai 为包括 OpenAI Codex 在内的多个提供方持有完整 OAuth 实现，但其库刻意把凭据持久化与登录交互留给宿主应用。默认的 `InMemoryCredentialStore` 会在重启时丢失登录状态，不能跨进程协调 token 轮换，也无法让远程 Web 客户端回答提供方自带的提示。

把 Codex 当作 API-key 路由不能补上这个缺口。订阅凭据会过期，pi-ai 必须在串行化的 `CredentialStore.modify()` 调用内刷新它；OpenAI Codex 认证还会从已存 OAuth 字段派生提供方专属请求标头。读取 Codex CLI 的私有 `auth.json` 会把 harness 耦合到另一个应用的存储格式，却没有为其他 pi-ai OAuth 提供方提供通用能力。

## 决策

提供方原生 OAuth 是一项覆盖三个角色的独立应用能力：

- `@deepseek-ai/dsh-llm-pi-ai-oauth` 定义并提供 `PiAiOAuthService`，即持久化 pi-ai `CredentialStore` 与 `piAiOAuth` Remote namespace。
- `@deepseek-ai/dsh-llm-pi-ai` 为请求认证消费这一个精确服务实例，并在发布可配置提供方目录时使用其受支持提供方集合。
- API Remote 组合与 Web「模型」包消费生成的命令和转发事件，用于交互式登录、状态与退出。

base bundle 会在 `llm-pi-ai` 前挂载 provider。该依赖在适配器包边界保持可选：省略 OAuth 的组合仍能服务 API-key 提供方，只隐藏无法认证的 catalog 路由。

提供方授权 URL、scope、PKCE 或设备码协议、token 交换、刷新，以及从凭据转换成请求认证，继续由 pi-ai 负责。harness 不复制这些规则，也不导入其他应用的凭据文档。

## 持久化存储

provider 默认把带版本的 JSON 文档保存在 `$DSH_HOME/.pi-ai-oauth.json`。解析器只在确认凭据 tag 与必需字段后才返回值。现有 POSIX 文档只要带有 group 或 other 权限位，就会在读取内容前被拒绝；新文件使用 `0600`，新建目录使用 `0700`。

读取观察无需加锁的原子快照。每次修改与删除都获取 `dsh-atomic-write` 提供的同级文件锁，读取当前文档，再原子替换。`modify()` 会在回调运行期间继续持锁，因为 pi-ai 在该回调内执行网络 token 刷新；这可以阻止并发进程轮换同一个 refresh token。OAuth 插件为网络刷新使用可配置的两分钟等锁时限；该工具对其他调用方的普通两秒默认值保持不变。

已存文档是该能力拥有的唯一持久化凭据副本。Remote 描述只公开提供方 id、凭据类型、已配置状态与提供方显示元数据。OAuth access token、refresh token、提示答案和手工代码都不会出现在 Remote 事件、settings、session 事件或模型可见内容中。

## 交互式登录

一个提供方只能拥有一个活动登录。`start` 接纳后台 pi-ai 登录，`answer` 只解析当前公布的不透明 prompt id，`cancel` 取消流程，`logout` 通过 pi-ai 委托移除。稳定的命令失败会描述未知提供方、重叠登录、过期提示和无效答案，而不会把它们转换成传输失败。

提供方通知以封闭事件联合跨线传输：HTTP(S) 授权链接、设备码、信息进度、不含答案的提示描述，以及终态成功、失败或取消。通用提示路径支持选择、文本、秘密与手工代码交互。out-of-band callback 胜出时，提供方可以取消仍在等待的提示；服务会清除该提示，让登录完成，无需第二次回答。

Web「模型」编辑器会在双认证提供方旁显示 OAuth 控件，并用它替换仅 OAuth 提供方的 API-key 输入。仅 OAuth 提供方只有在持久化存储报告已配置后，才能被物化成可用 settings。登录生命周期与凭据写入会发出失效事件，使客户端重新读取权威状态，而不会把按钮完成当作已经持久化的证据。

## 生命周期

服务卸载会先关闭准入，再取消活动提供方流程。它会等待所有已经准入的登录与存储操作收敛，然后离开 Cordis fiber。存储准入既覆盖活动模型请求发起的刷新，也覆盖登录与退出写入，因此卸载不会在服务离开后遗弃一次原子替换。

适配器通过动态注入观察服务挂载与卸载。OAuth 可用性变化时，它会替换目录事实；凭据存储实例身份变化时，它会创建新的 pi-ai collection。已有请求保留自己捕获的 collection；后续请求使用当前服务。

## 备选方案

- **导入 Codex CLI 凭据。** 这会局限于单个提供方、把 harness 绑定到私有外部文件格式，并让退出与刷新由谁拥有变得含糊。
- **把粘贴的订阅 token 作为 API key 持久化。** 这会丢失刷新语义，也绕过 pi-ai 从 OAuth 凭据到请求认证的转换。
- **在 harness 中直接实现 OpenAI OAuth。** 这会复制已由安装的 pi-ai 提供方拥有并测试的协议细节，也不能为其他提供方建立可复用能力。
- **只使用进程内 mutex。** 它能防止单个进程内重复刷新，却仍允许两个 harness 进程同时轮换同一 refresh token。

## 模型体验

该能力不增加模型可见提示、工具或 session 事件。其影响仅限于 pi-ai 请求前的认证。所选提供方与模型继续通过既有 LLM 请求路径记入日志；凭据材料绝不会进入模型 transcript。

## 测试

单元测试覆盖严格存储解析与文件权限、与跨进程兼容的修改串行化、状态投影、提供方发现、提示转发、取消，以及 Remote UI 交互。适配器测试通过伪 OAuth 存储发送 OpenAI Codex 请求，并断言 pi-ai 的 bearer 与 account 标头，而不在输出中暴露凭据。真实 keyless Web 组合会在 accessibility golden 中记录仅 OAuth 提供方卡片。手工发布验证会在本地 Web 产品中完成浏览器登录，检查 owner-only 持久化，使用同一 harness home 重启，再执行一次真实 Codex 模型 turn。

## 影响

- 随产品发布的组合可以通过 pi-ai 维护的实现认证 OAuth 提供方，在重启后保留登录，并跨 harness 进程协调刷新。
- 挂载该能力的部署会拥有一份独立秘密文档，必须保持 owner-only 权限；孤儿锁不能自动回收，因为文件年龄无法证明进程已经退出。
- 刷新可能在一次网络请求期间持续持有写锁，使该提供方存储的并发调用串行化。可配置时限限制等待时间，但在交换缓慢或卡住时可能拒绝工作。
- 浏览器登录界面刻意保持通用。若提供方交互无法用现有提示与进度联合表达，就必须扩展该能力，而不是在 `llm-pi-ai` 中绕过它。
