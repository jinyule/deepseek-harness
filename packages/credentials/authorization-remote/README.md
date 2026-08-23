# @deepseek-ai/dsh-authorization-remote

English | [中文](README.zh.md)

Loopback Web interaction plugin for [`dsh-authorization`](../authorization/README.md). It lists registered flows with value-free credential state, starts one opaque browser-owned attempt, carries notices and `text`/`secret`/`select` prompts through ordered long polling, accepts prompt answers, cancels attempts, and forgets writable local records. Provider-specific OAuth, device-code, and API-key behavior remains in the plugin that registered the flow; this package only projects the generic interaction vocabulary.

The Host registers a private Connection channel at `/authorization` with `authority: loopback`. It deliberately does not add methods to the general Typert `/api` BFF: trusted LAN hosts may use that API, but an account sign-in surface must be available only to a browser connected over loopback until the product has real remote-user authentication. The package's client half contributes the same strict request and response codecs to the browser module table. Credential values and opaque grant payloads are absent from every response; only configured state, record kind, and writability cross the channel. Notice links are limited to HTTP(S), prompt responses have a configurable UTF-8 byte limit, and malformed values fail without being echoed or logged.

Attempts live only in the Host process. Each gets opaque attempt and prompt ids, at most one active poll and prompt, an inactivity timeout, and bounded retention after settlement. Browser teardown cancels its active attempts; Host teardown stops admission, aborts all runs, rejects pending work, and waits for flow continuations to quiesce. `forget` deletes only the local record and does not claim provider-side revocation.

Configuration controls the empty-poll heartbeat (`pollTimeoutMs`), abandoned-attempt timeout (`orphanTimeoutMs`), terminal-event retention (`completedRetentionMs`), and maximum prompt response size (`maxPromptResponseBytes`). The heartbeat must be shorter than the orphan timeout.

## Model Experience

None, as authorization is a configuration-time conversation with a human and no channel value reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Loopback only** — remote browsers cannot use the channel or see the Accounts section until a user-authenticated remote authority exists.
- **Attempts are not durable** — reloading the owning page or losing it beyond the orphan timeout cancels the attempt; the user starts again.
- **Forgetting is not revocation** — removing a local record does not notify its issuer.
