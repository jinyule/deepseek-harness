---
description: "通用授权流程的认证浏览器投影，提供不含值的账号状态和有界交互尝试。"
kind: "package-reference"
---

# @deepseek-ai/dsh-authorization-remote

[English](README.md) | 中文

## 概述

使用此包可以把已安装的提供方登录流程开放给已认证浏览器，而不暴露凭据值。它的 Host 半边拥有私有通道，browser 半边提供 `ctx.authorizationClient`。浏览器可以列出账号状态、启动和取消尝试、接收通知或问题、回答问题，以及删除可写的本地记录。当 Web 组合需要通用 OAuth、设备码或 API 密钥交互时选择它。尝试只存在于当前进程，并受时间和回答大小限制。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在授权、凭据、Connection 和 WebServer 服务之后挂载此包。Connection 条目必须注入 WebServer，使自定义认证通道可以在调用方 fiber 中拥有路由。提供方插件仍然拥有其登录协议，并通过 `ctx.authorization` 注册流程。

### 何时选择它

当浏览器界面必须通过一个与提供方无关的协议驱动授权时选择它。非浏览器应用可以直接使用 `dsh-authorization`，并跳过此投影。

### 最小配置

```yaml
- id: authorization
  name: '@deepseek-ai/dsh-authorization'
- id: authorization-remote
  name: '@deepseek-ai/dsh-authorization-remote'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `pollTimeoutMs` | `15000` | 空轮询返回 idle 事件前的最长持续时间 |
| `orphanTimeoutMs` | `60000` | 运行中尝试因不活动而取消前的持续时间 |
| `completedRetentionMs` | `60000` | 未消费终止事件的最长保留时间 |
| `maxPromptResponseBytes` | `65536` | 单次问题回答的最大 UTF-8 大小 |

`pollTimeoutMs` 必须短于 `orphanTimeoutMs`。[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-authorization-remote)是所有已接受字段的完整来源。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

Connection 使用 Host、Origin 和签名浏览器会话检查认证私有 `/authorization` 通道。服务分配不透明的尝试和问题标识符，串行化每个尝试的事件队列，验证所有请求和响应值，并从账号描述中移除凭据载荷。浏览器只能收到 HTTP(S) 链接。关闭时会停止接纳、终止提供方工作、完成待处理的轮询和问题，并等待流程延续结束。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 服务、尝试生命周期和通道分派 |
| [`src/api.ts`](src/api.ts) | 通道名称和严格端点编解码器 |
| [`src/types.ts`](src/types.ts) | 不含值的浏览器协议类型 |
| [`src/client/index.ts`](src/client/index.ts) | 浏览器服务与严格通道调用方 |
| — | 不发布运行时不变量伴生插件；一个服务表拥有尝试、轮询和问题，行为测试验证它们的关系。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [授权能力](../authorization/README.zh.md) — 提供方流程注册和交互词汇。
- [凭据子系统](../../../docs/subsystems/credentials.zh.md) — 存储、授权和提供方关系。
- [账号设置区段](../../client/ui-settings-authorization/README.zh.md) — 随附的展示界面。

-----

<a id="model-experience"></a>
## 模型体验

无，因为授权是与人的配置期对话，任何通道值都不会进入模型请求。

#### KV 缓存影响

无；此包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义浏览器交互的生命周期和权限范围。

- **仅限已认证浏览器** — Connection 会拒绝没有有效浏览器会话或 Host、Origin 不允许的请求。
- **尝试不持久化** — 拥有页面失联超过孤儿超时后，需要启动新尝试。
- **忘记不等于撤销** — 删除本地记录不会通知其签发方。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
