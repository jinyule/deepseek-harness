---
description: "用于提供方登录、交互式授权和本地凭据删除的通用账号设置区段。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-authorization

[English](README.md) | 中文

## 概述

使用此包可以向 Web 设置添加账号区段。已认证用户可以查看不含值的账号状态、启动任何已安装的登录方法、打开安全通知、回答文本、机密或选择问题、取消尝试，以及忘记可写的本地凭据。当设置界面应与提供方无关时选择它：提供方插件供应账号行和协议，因此 OpenAI Codex OAuth 和其他 pi-ai 流程都不需要提供方专用 UI 分支。双面远程插件会提供其浏览器服务。

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

在 slots、locale 和浏览器授权客户端之后挂载此区段。Web bundle 已经把这些依赖与提供方拥有的授权流程组装在一起。

### 何时选择它

当 Web 设置应将提供方登录与模型路由配置分开管理时选择它。自定义界面可以直接注入 `authorizationClient`，并跳过此展示包。

### 最小配置

此插件没有配置字段：

```yaml
- id: authorization-remote
  name: '@deepseek-ai/dsh-authorization-remote'
- id: ui-settings-authorization
  name: '@deepseek-ai/dsh-client-ui-settings-authorization'
```

生成的账号区段会渲染所有已注册流程。删除记录只会删除本地凭据状态，不表示已向签发方撤销授权。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

插件注册本地化文案和一个 `settings.section` slot。其控制器拥有单一可观察快照，只长轮询当前页面启动的尝试，在结算后重新加载账号状态，并在拆卸时终止且等待活动轮询。组件只渲染通用授权词汇；它没有 OpenAI、Codex、OAuth 或 pi-ai 专用条件。

| 文件 | 作用 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | locale 和设置 slot 注册 |
| [`src/client/store.ts`](src/client/store.ts) | 账号状态和尝试轮询控制器 |
| [`src/client/AuthorizationSection.tsx`](src/client/AuthorizationSection.tsx) | 通用账号展示 |
| [`src/client/locales.ts`](src/client/locales.ts) | 英文和中文浏览器文案 |
| — | 不发布运行时不变量伴生插件；slot 注册在其所有者处失败，一个可观察 store 拥有页面状态。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [远程授权通道](../../credentials/authorization-remote/README.zh.md) — Host 交互和生命周期限制。
- [提供方指南](../../../docs/user/guide/providers.zh.md) — 登录和模型路由工作流。
- [Slot 子系统](../../../docs/subsystems/slots.zh.md) — 设置贡献和注入规则。

-----

<a id="model-experience"></a>
## 模型体验

无，因为此包渲染浏览器配置 UI，不注册任何面向模型的内容。

#### KV 缓存影响

无；此包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义 UI 的尝试和删除行为。

- **仅限当前进程的尝试** — 页面拆卸或孤儿超时后，需要启动新登录尝试。
- **不撤销签发方授权** — 删除操作只会忘记本地凭据记录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
