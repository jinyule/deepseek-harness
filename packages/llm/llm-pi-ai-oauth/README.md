# @deepseek-ai/dsh-llm-pi-ai-oauth

English | [中文](README.zh.md)

Durable interactive OAuth credentials for pi-ai providers. The service mounts at `ctx.piAiOAuth`, implements pi-ai's `CredentialStore`, exposes provider-owned login through generated Remote methods, and forwards non-secret login progress to browser clients. `@deepseek-ai/dsh-llm-pi-ai` discovers the service dynamically: while it is mounted, OAuth-only catalog routes such as `openai-codex` appear in the configurable-provider directory and every pi-ai model collection receives this exact store.

The service uses pi-ai's installed provider definitions for login, token exchange, request authentication, and refresh. It does not duplicate OpenAI's authorization protocol or read another application's private credential file.

## Configuration

The default document is `$DSH_HOME/.pi-ai-oauth.json` (or `~/.dsh/.pi-ai-oauth.json` when `DSH_HOME` is unset):

```yaml
- id: llm-pi-ai-oauth
  name: '@deepseek-ai/dsh-llm-pi-ai-oauth'
  config:
    path: /srv/dsh/pi-ai-oauth.json
    dshHome: /srv/dsh
    lockTimeoutMs: 120000
```

`path` is optional and wins over `dshHome` and `DSH_HOME`. `dshHome` is used only when `path` is absent. `lockTimeoutMs` is the cross-process wait for a refresh or login that holds the writer lock.

The shipped base bundle mounts the plugin before `llm-pi-ai`. Headless API-key-only compositions may omit it; the adapter remains functional and omits OAuth-only providers from its configurable directory.

## Storage and concurrency

The version-1 JSON document stores one pi-ai credential per provider. The parser validates the durable type tag and required fields before returning any value. On POSIX, an existing document with group or other permission bits is refused before its contents are read; new and replaced files use mode `0600`, and created parent directories use `0700`.

`modify()` is the only write path pi-ai uses. It holds a cross-process sibling lock around the complete read–callback–replace cycle. This is deliberately wider than a local file edit: pi-ai refreshes an expired OAuth token inside that callback, so the lock must remain held across the network exchange or two processes could rotate the same refresh token. The plugin's configurable lock deadline defaults to two minutes; the shared atomic-write utility keeps its two-second default for ordinary local edits. Atomic rename lets reads stay lock-free while observing only complete old or new documents.

Login, refresh, and logout writes share the same lock. Teardown closes login and storage admission, aborts active provider flows, and waits for admitted operations to settle before the service leaves its Cordis fiber.

## Interactive login

Generated Remote methods expose `describe`, `start`, `answer`, `cancel`, and `logout` under `ctx.remote.piAiOAuth`. One provider may own one login at a time. `start` returns immediately and the provider's interaction continues through forwarded `pi-ai-oauth/login-event` events:

- `prompt` carries a select, text, secret, or manual-code prompt with an opaque prompt id. `answer` must name that exact id; stale and blank answers are rejected.
- `auth_url`, `device_code`, `info`, and `progress` carry non-secret instructions. Only HTTP(S) links cross to the client.
- `success`, `failure`, and `cancelled` settle the UI state. `pi-ai-oauth/updated` invalidates provider status after login, logout, refresh, or flow lifecycle changes.

Prompt answers never return in events. The browser-based OpenAI Codex flow races the provider's localhost callback against a manual-code prompt; when the callback wins, pi-ai aborts that prompt and the service removes it without requiring a second answer. Device-code login uses the same generic event and answer path.

The Web Models page joins this status with the LLM provider directory. An OAuth-only provider is not considered usable until its durable credential exists; its editor renders the provider's login choices instead of an API-key field. Dual-auth providers can still use either their existing API-key path or OAuth.

## Failure behavior

- Missing documents mean an empty store; malformed, obsolete-version, or over-permissive documents fail service operations explicitly.
- An unknown provider, overlapping login, stale prompt id, or invalid answer returns a stable business failure through Remote rather than throwing a transport error.
- Provider login and refresh failures preserve the stored credential unless pi-ai returns a replacement. Login failures are forwarded as non-secret UI text.
- A lock timeout leaves the document unchanged and never removes another process's lock. Orphan lock recovery remains an operator action because file age cannot prove that its owner stopped.

## Model Experience

None, as the service changes only provider authentication metadata and adds no model-visible request content.

#### KV Cache effect

No direct effect; credential resolution and refresh do not change the request prefix.

## Known Limitations and Deferred Work

- Importing `~/.codex/auth.json` or another application's private storage format.
- Reimplementing provider OAuth endpoints, scopes, refresh rules, or token-to-header conversion.
- Storing API-key references; the harness credentials seam and `llm-pi-ai` profiles continue to own that path.
