# Agent Note: Web 授权插件

Status: implemented

[English](2026-08-23-web-authorization-plugins.md) | 中文

## Problem

凭据记录与授权 flow seam 已使 pi-ai 登录可在进程内执行，其中包括 OpenAI Codex OAuth，但 Web 产品仍没有调用方能在提供方 flow 与发起它的人之间传递 notice、链接、设备码或 prompt。给 Models 加一个 Codex 按钮只能解决一条路由，还会让通用 seam 依赖某个提供方和某个呈现。通过既有 Typert `/api` BFF 暴露 `authorization.begin()` 虽然通用，却会为一项 Connection 可以通过已认证、插件自有通道承载的功能扩展生成式应用 API 及其所有权。

## Decision

完全通过插件与组装补齐能力。不修改核心服务、agent-loop 路径、settings 所有者、Models 编辑器、通用 API gateway 或 pi-ai flow 实现。

`dsh-authorization-remote` 是双面交互插件。它的 Host 半边通过名为 `/authorization` 的私有 Connection 通道投影已注册 flow；browser 半边校验相同 codec，并提供 `ctx.authorizationClient`。Connection 会对每条自定义通道应用 Host、Origin 与签名浏览器会话认证，同时通道仍位于 Typert `/api` 之外。协议暴露凭据存在性、类别与可写性，但绝不暴露记录值或不透明 grant payload。attempt 与 prompt 使用随机不透明 id；只有 HTTP(S) notice 链接能通过投影；prompt 回答有大小上限；一次尝试最多拥有一个 poll 和一个 prompt。不活动、页面 teardown 与 Host teardown 都有明确的取消和静止行为。

浏览器客户端会保留 carrier 故障、保持业务故障有类型，并将畸形值或抛错的传输收敛为不含值的内部故障。UI 插件依赖其 Cordis 服务，而不是通道载体或 Host 类。将两个协议端放在同一个双面插件中，也避免了客户端功能包导入另一个功能包的运行时代码。

`dsh-client-ui-settings-authorization` 通过 `settings.section` 贡献独立的**账号**分区。该分区对每个经 Connection 认证的浏览器开放，列出每个已安装 flow，渲染其声明的方法与中立交互词汇，并支持取消和移除本地记录。它不含 provider id 或 OAuth 分支。`llm-pi-ai` 已无条件注册每个已安装的 pi-ai 登录 flow，因此 OpenAI Codex 与密钥录入、订阅登录和设备码提供方通过同一种行机制出现。

Web 组合包挂载既有授权 seam 与两个新插件。账号取得归“账号”而非 Models：flow 可以先于 provider profile 存在，一个账号可以比模型配置活得更久，凭据生命周期也不是编辑模型列表。settings 核心仍然只拥有 outlet；该分区是普通贡献。

## Alternatives considered

- **在 Typert `/api` 上暴露授权方法。** 这可以复用生成式 BFF，却会要求应用 API 拥有插件专属交互协议。私有 Connection 通道无需修改该 API，也能获得相同的浏览器认证。
- **把控件加入 Models 插件。** 这样不需要新分区，却会把凭据取得耦合到 provider profile 编辑，还会在通用 flow 词汇已经存在时引入提供方专属行为。
- **让 settings 核心或 authorization seam 理解 Web。** 两者都会颠倒所有权：核心应暴露贡献点，seam 应描述对话而不选择其载体或呈现。
- **只实现 Codex OAuth。** pi-ai 已提供登录实现目录。Codex 专用路径会重复该适配器，并让其他每个提供方 flow 继续不可触达。
- **自动打开每个提供方 URL。** 可见链接让浏览器导航保持为用户操作，兼容设备码 flow，也避免提供方输出触发未经请求的导航。

## Consequences

组装后的 Web 应用可以取得和遗忘提供方凭据，无需增加 secret 回读。OpenAI Codex OAuth 通过 pi-ai 提供的 ChatGPT 登录出现在“设置 → 账号”，Models 继续只拥有提供方与模型配置。新的提供方登录协议只需注册另一个 flow；Host 传输与 UI 保持不变。

当远端浏览器的 Host 与 Origin 满足 Connection 策略且已完成认证时，也可以使用“账号”。尝试仍只属于进程，遗忘记录仍只是本地删除而非签发方吊销，与底层 seam 已记录的限制一致。

没有任何活动 Agent Note 被取代。凭据记录与授权 flow note 继续作为通用 seam 与 pi-ai 适配器的权威；本 note 只替代其中先前暂缓的浏览器界面说明。没有内容需要归档。

## Testing

Host 套件覆盖 flow 列表、每个 endpoint、严格请求拒绝、不含值的投影、安全链接过滤、prompt 校验与大小上限、并发 poll 与尝试、遗弃和保留 timer、carrier 取消与 shutdown。浏览器客户端套件钉住每次通道调用、carrier 故障保留与畸形值遏制。UI store 和组件套件覆盖有序事件归约、prompt 撤回、取消、dispose、移除记录、已认证注册、本地化、样式与错误状态。组装 Web 快照覆盖插件发现及可见导航，真实浏览器登录则覆盖提供方自有 OAuth 重定向与已存储 grant。两个新增包的每个源码文件均受 100% 覆盖率约束。
