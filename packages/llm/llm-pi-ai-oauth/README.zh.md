# @deepseek-ai/dsh-llm-pi-ai-oauth

[English](README.md) | 中文

为 pi-ai 提供方提供可持久化的交互式 OAuth 凭据。服务挂载在 `ctx.piAiOAuth`，实现 pi-ai 的 `CredentialStore`，通过生成的 Remote 方法公开提供方自带的登录流程，并把不含秘密的登录进度转发给浏览器客户端。`@deepseek-ai/dsh-llm-pi-ai` 会动态发现该服务：服务挂载期间，`openai-codex` 等仅 OAuth catalog 路由会进入可配置提供方目录，每个 pi-ai 模型集合也会接收这个同一存储。

登录、token 交换、请求认证与刷新均使用 pi-ai 已安装的提供方定义。该服务不重复实现 OpenAI 授权协议，也不读取其他应用的私有凭据文件。

## 配置

默认文档是 `$DSH_HOME/.pi-ai-oauth.json`；未设置 `DSH_HOME` 时为 `~/.dsh/.pi-ai-oauth.json`：

```yaml
- id: llm-pi-ai-oauth
  name: '@deepseek-ai/dsh-llm-pi-ai-oauth'
  config:
    path: /srv/dsh/pi-ai-oauth.json
    dshHome: /srv/dsh
    lockTimeoutMs: 120000
```

`path` 是可选项，优先于 `dshHome` 与 `DSH_HOME`；`dshHome` 只在没有 `path` 时使用。`lockTimeoutMs` 是等待另一个持有刷新或登录写锁的进程的时限。

随产品发布的 base bundle 会在 `llm-pi-ai` 之前挂载本插件。仅使用 API 密钥的 headless 组合可以省略它；适配器仍可工作，只是不在可配置目录中列出仅 OAuth 提供方。

## 存储与并发

版本 1 JSON 文档为每个提供方保存一项 pi-ai 凭据。持久化解析器会验证类型 tag 与必需字段，再返回任何值。在 POSIX 上，现有文档只要带有 group 或 other 权限位，就会在读取内容之前被拒绝；新建与替换文件使用 `0600`，新建父目录使用 `0700`。

`modify()` 是 pi-ai 使用的唯一写入路径。它在完整的「读取—回调—替换」周期外持有跨进程同级锁。这个范围刻意宽于普通本地文件编辑：pi-ai 会在该回调中通过网络刷新过期 OAuth token，若交换期间不继续持锁，两个进程可能同时轮换同一个 refresh token。插件的锁等待时限可配置，默认两分钟；共享 atomic-write 工具对普通本地编辑仍保持两秒默认值。原子 rename 让读取无需加锁，同时只能看到完整旧文档或完整新文档。

登录、刷新与退出写入使用同一把锁。卸载时，服务先关闭登录与存储准入，取消活动提供方流程，再等待已经准入的操作完成，最后离开 Cordis fiber。

## 交互式登录

生成的 Remote 方法在 `ctx.remote.piAiOAuth` 下提供 `describe`、`start`、`answer`、`cancel` 与 `logout`。一个提供方同一时间只能拥有一个登录。`start` 会立即返回，提供方交互通过转发的 `pi-ai-oauth/login-event` 继续：

- `prompt` 携带选择、文本、秘密或手工代码提示以及不透明 prompt id。`answer` 必须点名这个精确 id；过期或空白答案会被拒绝。
- `auth_url`、`device_code`、`info` 与 `progress` 携带不含秘密的指引；只有 HTTP(S) 链接可以进入客户端。
- `success`、`failure` 与 `cancelled` 收敛界面状态。登录、退出、刷新或流程生命周期变化后，`pi-ai-oauth/updated` 会使提供方状态失效并重新读取。

提示答案绝不会出现在事件中。OpenAI Codex 的浏览器流程会让提供方的 localhost 回调与手工代码提示竞速；回调胜出时，pi-ai 会取消该提示，服务随即移除它，无需用户再回答一次。设备码登录也使用同一套通用事件与回答路径。

Web「模型」页面会把该状态与 LLM 提供方目录联接。仅 OAuth 提供方只有在持久化凭据存在后才被视为可用；编辑器会显示提供方登录选项，而不是 API 密钥字段。双认证提供方仍可选择原有 API 密钥路径或 OAuth。

## 失败行为

- 文档缺失表示空存储；文档格式错误、版本过时或权限过宽时，服务操作会明确失败。
- 未知提供方、重叠登录、过期 prompt id 与无效答案通过 Remote 返回稳定业务失败，而不是抛出传输错误。
- 提供方登录或刷新失败时，除非 pi-ai 返回替换值，否则保留已存凭据；登录失败只向界面转发不含秘密的文本。
- 等锁超时不会改动文档，也不会删除其他进程的锁。孤儿锁恢复仍由操作员处理，因为文件年龄无法证明原持有者已经停止。

## 模型体验

无。本服务只改变提供方认证元数据，不增加模型可见的请求内容。

#### KV Cache 影响

无直接影响；凭据解析与刷新不会改变请求前缀。

## 已知限制与延后工作

- 导入 `~/.codex/auth.json` 或其他应用的私有存储格式。
- 重新实现提供方 OAuth 端点、scope、刷新规则或 token 到请求标头的转换。
- 存储 API 密钥引用；该路径仍由 harness 凭据 seam 与 `llm-pi-ai` profile 拥有。
