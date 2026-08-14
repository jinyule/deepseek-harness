# Agent Note：可配置提供方目录不提供当前组合不支持的仅 OAuth 提供方

Status: implemented

[English](2026-08-13-oauth-only-providers-withheld.md) | 中文

## 问题

pi-ai catalog 中的路由使用不同认证方式。大多数接受 API 密钥，而 `openai-codex` 只接受 OAuth。因此，若可配置提供方目录列出全部 catalog 路由，就可能提供当前应用组合无法认证的路由。

该目录同时也是已存 profile 的地址。仅因当前组合无法认证 catalog 默认值就过滤一条路由，会让已有 profile 滞留：用户将无法再检查、编辑或删除它。

## 决策

当前组合中存在下列任一认证路径时，目录就提供对应 catalog 路由：

- 已安装的 pi-ai 提供方声明 API-key 方法；或
- 可选的 `piAiOAuth` 服务报告支持该路由。

`llm-pi-ai` 通过 Cordis 动态注入观察 `piAiOAuth`。挂载或卸载该服务时，插件会原子替换目录注册，因此仅使用 API 密钥的 headless 组合仍然有效，而随产品发布的 base 组合可以提供仅 OAuth 路由。

目录联合中的 profile 一半保持无条件。resolved settings 点名的任何路由都保持可见，不受 catalog 支持或当前 OAuth 可用性影响。`declared` 标记仍由 catalog 成员身份决定；认证可用性不会改变 pi-ai 安装了什么。

请求解析使用同一项可选能力。每个 pi-ai 模型集合都会收到当前挂载的同一 OAuth 凭据存储；服务缺席时，适配器保留 pi-ai 的内存默认存储，并且不在目录中提供仅 OAuth 路由。显式带有 `apiKeyEnv` 的 profile 仍可服务，因为适配器会为 routed provider 补上该 API-key 方法。

## 备选方案

**无条件发布每个已安装 catalog 路由。** 这会让目录不依赖组合，但也会在既无持久化存储、也无登录交互的部署中宣传仅 OAuth 路由，而这些部署无法认证它们。

**要求每个 `llm-pi-ai` 组合都挂载 OAuth 服务。** 这会使 catalog 保持一致，却把凭据持久化与交互式登录强加给不需要这两项能力的仅 API-key headless 部署。

**认证不可用时隐藏对应的已存 profile。** 这会让选择器只保留当前可用路由，却会把用户仍需检查、编辑或删除的配置搁置。因此，已存 profile 的可见性保持独立于 catalog 提供规则。

## 影响

随产品发布的 base bundle 会挂载 `@deepseek-ai/dsh-llm-pi-ai-oauth`，因此 `openai-codex` 会出现在「模型」提供方选择器中，并使用交互式订阅账号登录。省略该服务的组合仍会自动隐藏 `openai-codex`。双认证提供方即使没有 OAuth，也继续通过 API-key 方法保持可用。

目录不声称提供方当前已经认证。OAuth 状态来自 OAuth 服务，API-key 状态来自 credentials 服务；「模型」页面会分别联接这些事实。

## 测试

包测试覆盖两种组合：OAuth 服务缺席时，`openai-codex` 不出现而 API-key 提供方仍在；服务挂载后，它会出现。已存的 `openai-codex` profile 在任一组合中都保持可见。keyless Web 组合快照会从真实提供方选择器中选中 `openai-codex`，记录订阅登录控件，但不会启动外部授权。
