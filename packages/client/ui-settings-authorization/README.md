---
description: "Generic Accounts section for provider sign-in, interactive authorization, and local credential removal."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-authorization

English | [中文](README.zh.md)

## Summary

Use this package to add an Accounts section to Web Settings. Authenticated users can see value-free account state, start any installed sign-in method, follow safe notices, answer text, secret, or selection prompts, cancel an attempt, and forget a writable local credential. Choose it for a provider-neutral settings surface: provider plugins supply the rows and protocols, so OpenAI Codex OAuth and other pi-ai flows require no provider-specific UI branch. The dual-face remote plugin supplies its browser service.

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

Mount the section after slots, locale, and the browser authorization client. The Web bundle already assembles those dependencies with the provider-owned authorization flows.

### When to choose it

Choose it when Web Settings should manage provider login separately from model route configuration. A custom surface can inject `authorizationClient` directly and skip this presentation.

### Minimal configuration

The plugin has no configuration fields:

```yaml
- id: authorization-remote
  name: '@deepseek-ai/dsh-authorization-remote'
- id: ui-settings-authorization
  name: '@deepseek-ai/dsh-client-ui-settings-authorization'
```

The resulting Accounts section renders every registered flow. Removing a record deletes local credential state only and does not claim issuer revocation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers localized copy and one `settings.section` slot. Account discovery preserves live attempt updates, and only the newest discovery request updates account metadata. An answer acknowledgment clears only its original attempt's original prompt. Plugin unload closes start admission, awaits pending starts and their required cancellations, and drains polls and existing cancellations before reporting cleanup failures. Localized copy remains registered until cleanup finishes. The component renders only the generic authorization vocabulary; it contains no OpenAI, Codex, OAuth, or pi-ai-specific condition.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Locale and settings-slot registration |
| [`src/client/store.ts`](src/client/store.ts) | Account state and attempt polling controller |
| [`src/client/AuthorizationSection.tsx`](src/client/AuthorizationSection.tsx) | Generic Accounts presentation |
| [`src/client/locales.ts`](src/client/locales.ts) | English and Chinese browser copy |
| — | No runtime invariant companion is published; slot registration fails at its owner, and one observable store owns the page state. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Remote authorization channel](../../credentials/authorization-remote/README.md) — Host interaction and lifecycle limits.
- [Provider guide](../../../docs/user/guide/providers.md) — sign-in and model-route workflow.
- [Slot subsystem](../../../docs/subsystems/slots.md) — settings contribution and injection rules.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders a browser configuration UI and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the UI's attempt and removal behavior.

- **Current-process attempts only** — a closed browser cannot await RPC cleanup; failed cancellations can leave the Host attempt active until its orphan timeout.
- **No issuer revocation** — the removal action forgets only the local credential record.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
