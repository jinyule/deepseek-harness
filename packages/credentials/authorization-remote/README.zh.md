# @deepseek-ai/dsh-authorization-remote

[English](README.md) | 中文

面向 [`dsh-authorization`](../authorization/README.zh.md) 的回环 Web 交互插件。它列出已注册 flow 及不含值的凭据状态，发起由浏览器拥有且 id 不透明的尝试，通过有序长轮询传递 notice 与 `text`／`secret`／`select` prompt，接收 prompt 回答、取消尝试，并遗忘可写的本地记录。OAuth、设备码与 API 密钥等提供方专属行为仍归注册 flow 的插件所有；本包只投影通用交互词汇。

Host 在 `/authorization` 注册一条 `authority: loopback` 的私有 Connection 通道。它刻意不向通用 Typert `/api` BFF 添加方法：受信任的局域网主机可以使用该 API，但在产品具备真正的远端用户认证之前，账号登录界面只能提供给通过回环连接的浏览器。本包的 client 半边把同一套严格请求与响应 codec 贡献给浏览器模块表。任何响应都不含凭据值与不透明 grant payload；跨通道的只有配置状态、记录类别和可写性。notice 链接仅允许 HTTP(S)，prompt 回答有可配置的 UTF-8 字节上限，畸形值会被拒绝且不会被回显或写入日志。

尝试只存活于 Host 进程。每次尝试都有不透明的 attempt 与 prompt id，最多存在一个活动 poll 与 prompt，并受不活动超时和结算后有界保留约束。浏览器 teardown 会取消其仍在运行的尝试；Host teardown 会停止接纳、终止全部执行、拒绝待处理工作，并等待 flow 延续体静止。`forget` 只删除本地记录，不声称已在提供方侧吊销。

配置项控制空 poll 心跳（`pollTimeoutMs`）、遗弃尝试超时（`orphanTimeoutMs`）、终态事件保留时长（`completedRetentionMs`）和 prompt 回答最大尺寸（`maxPromptResponseBytes`）。心跳必须短于遗弃超时。

## 模型体验

无，因为授权是配置期与人的对话，任何通道值都不会抵达模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **仅限回环** —— 在存在带用户认证的远端 authority 之前，远端浏览器不能使用该通道，也看不到“账号”分区。
- **尝试不可持久** —— 刷新拥有它的页面，或让页面失联超过遗弃超时，都会取消尝试；用户需要重新开始。
- **遗忘不等于吊销** —— 移除本地记录不会通知其签发方。
