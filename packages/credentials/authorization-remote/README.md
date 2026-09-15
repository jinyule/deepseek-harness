---
description: "Authenticated browser projection of generic authorization flows, with value-free account state and bounded interactive attempts."
kind: "package-reference"
---

# @deepseek-ai/dsh-authorization-remote

English | [中文](README.zh.md)

## Summary

Use this package to expose installed provider sign-in flows to an authenticated browser without exposing credential values. Its Host half owns the private channel and its browser half provides `ctx.authorizationClient`. A browser can list account state, start and cancel an attempt, receive notices or prompts, answer a prompt, and remove a writable local record. Choose it when a Web composition needs generic OAuth, device-code, or API-key interaction. Attempts are process-local, bounded by time and response-size limits.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package after the authorization, credential, Connection, and WebServer services. The Connection entry must inject WebServer so custom authenticated channels can own routes in the caller fiber. Provider plugins continue to own their login protocol and register flows through `ctx.authorization`.

### When to choose it

Choose it for a browser surface that must drive provider authorization through one provider-neutral protocol. A non-browser application can consume `dsh-authorization` directly and skip this projection.

### Minimal configuration

```yaml
- id: authorization
  name: '@deepseek-ai/dsh-authorization'
- id: authorization-remote
  name: '@deepseek-ai/dsh-authorization-remote'
```

| Field | Default | Meaning |
|---|---|---|
| `pollTimeoutMs` | `15000` | Maximum empty-poll duration before an idle event |
| `orphanTimeoutMs` | `60000` | Inactivity duration before a running attempt is cancelled |
| `completedRetentionMs` | `60000` | Maximum retention of an unconsumed terminal event |
| `maxPromptResponseBytes` | `65536` | Maximum UTF-8 size of one prompt response |

`pollTimeoutMs` must be shorter than `orphanTimeoutMs`. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-authorization-remote) is the exhaustive source for accepted fields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Connection authenticates the private `/authorization` channel with its Host, Origin, and signed browser-session checks. The service assigns opaque attempt and prompt identifiers, serializes each attempt's event queue, validates all request and response values, and removes credential payloads from account descriptions. HTTP(S) is the only link scheme sent to a browser. Shutdown stops admission, aborts provider work, settles pending polls and prompts, and waits for flow continuations.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host service, attempt lifecycle, and channel dispatch |
| [`src/api.ts`](src/api.ts) | Channel name and strict endpoint codecs |
| [`src/types.ts`](src/types.ts) | Value-free browser protocol types |
| [`src/client/index.ts`](src/client/index.ts) | Browser service and strict channel caller |
| — | No runtime invariant companion is published; one service table owns attempts, polls, and prompts, and behavior tests exercise their relationships. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Authorization capability](../authorization/README.md) — provider flow registration and interaction vocabulary.
- [Credential subsystem](../../../docs/subsystems/credentials.md) — storage, authorization, and provider relationships.
- [Accounts settings section](../../client/ui-settings-authorization/README.md) — the bundled presentation.

-----

<a id="model-experience"></a>
## Model Experience

None, as authorization is a configuration-time conversation with a human and no channel value reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the lifetime and authority of the browser interaction.

- **Authenticated browsers only** — Connection rejects requests without a valid browser session or with a disallowed Host or Origin.
- **Attempts are not durable** — losing the owning page beyond the orphan timeout requires a new attempt.
- **Forgetting is not revocation** — removing a local record does not notify its issuer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
