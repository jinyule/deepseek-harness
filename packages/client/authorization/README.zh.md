# @deepseek-ai/dsh-client-authorization

[English](README.md) | 中文

回环授权通道的浏览器传输插件。它消费 Connection 服务和 [`dsh-authorization-remote`](../../credentials/authorization-remote/README.zh.md) 的 codec 贡献，再以 `ctx.authorizationClient` 提供带类型的 `list`、`start`、`poll`、`answer`、`cancel` 与 `forget` 方法。呈现插件依赖这项 Cordis 服务，无需 import 传输载体或 Host 实现。

发出的请求与 carrier 成功返回的值都会接受校验。Connection 故障会原样保留；畸形输入、畸形输出和抛错的传输会变成通用内部故障，且不暴露传入或返回的值。业务拒绝仍留在其带类型的授权结果内，因此 UI 能把 flow 不可用、prompt 过期、尝试并发、回答过大或记录只读与传输故障区分开。

## 模型体验

无，因为本包只提供浏览器配置服务。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **不含呈现** —— 本包只暴露方法；组合内的 Web UI 由 [`dsh-client-ui-settings-authorization`](../ui-settings-authorization/README.zh.md) 所有。
- **受 Connection 生命周期影响** —— reset 会中断活动 poll；是否重试或取消尝试由拥有它的呈现层决定。
