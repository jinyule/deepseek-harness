# @deepseek-ai/dsh-client-ui-settings-authorization

English | [中文](README.zh.md)

Independent **Accounts** section for Web Settings. The browser plugin registers one localized `settings.section` contribution and renders every flow exposed by `ctx.authorizationClient`: provider label and credential state, the installed sign-in methods, ordered notices and safe external links, device codes, text/secret/select prompts, cancellation, terminal status, and local credential removal. It contains no OpenAI, Codex, OAuth, or pi-ai-specific branching; adding another provider flow changes the rows supplied by the generic authorization service rather than this component.

The section registers only when the current Connection is loopback. Loading and action failures stay local to the page, each browser polls only attempts it started, and teardown aborts its polls and asks the Host to cancel still-running attempts. A successful sign-in reloads value-free account state. **Forget local credential** appears only for configured writable records and states that it does not revoke provider access.

For the Web bundle, [`dsh-authorization`](../../credentials/authorization/README.md), [`dsh-authorization-remote`](../../credentials/authorization-remote/README.md), [`dsh-client-authorization`](../authorization/README.md), this package, and provider-owned flow plugins form the complete Cordis composition. `llm-pi-ai` therefore supplies OpenAI Codex OAuth and every other installed pi-ai login without a change to the settings core or model editor.

## Model Experience

None, as this package renders a browser configuration UI and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Current-process attempts only** — page reload, teardown, or orphan timeout requires starting the sign-in again.
- **No issuer revocation** — the removal action forgets only the local credential record.
- **No remote-browser fallback** — non-loopback Settings omits the section instead of showing controls that the Host must reject.
