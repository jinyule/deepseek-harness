# @deepseek-ai/dsh-client-ui-settings-authorization

[English](README.md) | 中文

Web 设置中的独立**账号**分区。浏览器插件注册一个本地化 `settings.section` 贡献，并渲染 `ctx.authorizationClient` 暴露的每个 flow：提供方标签与凭据状态、已安装的登录方式、有序 notice 与安全外链、设备码、文本／机密／选择 prompt、取消、终态以及移除本地凭据。它不含任何针对 OpenAI、Codex、OAuth 或 pi-ai 的分支；新增提供方 flow 只会改变通用授权服务提供的行，无需修改本组件。

该分区只在当前 Connection 为回环时注册。加载与操作故障留在页面局部，每个浏览器只轮询自己发起的尝试，teardown 会终止自己的 poll，并请求 Host 取消仍在运行的尝试。成功登录后会重新载入不含值的账号状态。**遗忘本地凭据**只对已配置且可写的记录出现，并明确说明它不会吊销提供方访问权。

在 Web 组合中，[`dsh-authorization`](../../credentials/authorization/README.zh.md)、[`dsh-authorization-remote`](../../credentials/authorization-remote/README.zh.md)、[`dsh-client-authorization`](../authorization/README.zh.md)、本包与提供方自有的 flow 插件共同构成完整 Cordis 组装。因此 `llm-pi-ai` 无需修改设置核心或模型编辑器，就能提供 OpenAI Codex OAuth 与其他所有已安装的 pi-ai 登录。

## 模型体验

无，因为本包只渲染浏览器配置 UI，不注册任何面向模型的接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **尝试只属于当前进程** —— 页面刷新、teardown 或遗弃超时后都需要重新开始登录。
- **不执行签发方吊销** —— 移除操作只遗忘本地凭据记录。
- **没有远端浏览器回退** —— 非回环 Settings 会省略该分区，而不是显示 Host 必须拒绝的控件。
