# Agent Note: pi-ai OAuth is an application credential capability

Status: implemented

English | [中文](2026-08-14-pi-ai-oauth-credential-service.zh.md)

## Problem

pi-ai owns complete OAuth implementations for several providers, including OpenAI Codex, but its library deliberately leaves credential persistence and login interaction to the host application. Its default `InMemoryCredentialStore` loses login state at restart, cannot coordinate token rotation across processes, and gives a remote Web client no way to answer provider-owned prompts.

Treating Codex as an API-key route does not solve that gap. The subscription credential expires, pi-ai must refresh it inside a serialized `CredentialStore.modify()` call, and OpenAI Codex authentication also derives provider-specific request headers from the stored OAuth fields. Reading Codex CLI's private `auth.json` would couple the harness to another application's storage format without supplying a general capability for other pi-ai OAuth providers.

## Decision

Provider-native OAuth is a separate application capability spanning three roles:

- `@deepseek-ai/dsh-llm-pi-ai-oauth` defines and provides `PiAiOAuthService`, the durable pi-ai `CredentialStore` and the `piAiOAuth` Remote namespace.
- `@deepseek-ai/dsh-llm-pi-ai` consumes the exact service instance for request authentication and uses its supported-provider set when publishing the configurable-provider directory.
- the API Remote assembly and Web Models package consume its generated commands and forwarded events for interactive login, status, and logout.

The base bundle mounts the provider before `llm-pi-ai`. The dependency remains optional at the adapter package boundary: a composition that omits OAuth still serves API-key providers and withholds only catalog routes it cannot authenticate.

pi-ai remains the authority for provider authorization URLs, scopes, PKCE or device-code protocol, token exchange, refresh, and conversion from credential to request authentication. The harness does not copy those rules and does not import another application's credential document.

## Durable storage

The provider stores a versioned JSON document at `$DSH_HOME/.pi-ai-oauth.json` by default. The parser accepts only known credential tags and required fields before returning a value. Existing POSIX documents with group or other permission bits are refused before their contents are read; new files use mode `0600` and created directories use `0700`.

Reads observe lock-free atomic snapshots. Every modification and deletion takes the sibling file lock from `dsh-atomic-write`, reads the current document, and atomically replaces it. `modify()` keeps the lock while its callback runs because pi-ai performs network token refresh inside that callback. This prevents concurrent processes from rotating the same refresh token. The OAuth plugin uses a configurable two-minute lock deadline for network refreshes; the utility's ordinary two-second default remains unchanged for other callers.

The stored document is the only persistent credential copy owned by this capability. Remote descriptions expose only provider id, credential type, configured state, and provider display metadata. OAuth access tokens, refresh tokens, prompt answers, and manual codes do not appear in Remote events, settings, session events, or model-visible content.

## Interactive login

One provider can own one active login. `start` admits a background pi-ai login, `answer` resolves only the currently advertised opaque prompt id, `cancel` aborts the flow, and `logout` delegates removal through pi-ai. Stable command failures describe unknown providers, overlapping logins, stale prompts, and invalid answers without converting them into transport failures.

Provider notifications cross the wire as a closed event union: HTTP(S) authorization links, device codes, informational progress, answer-free prompt descriptions, and terminal success, failure, or cancellation. The generic prompt path supports select, text, secret, and manual-code interactions. A provider can abort an outstanding prompt when an out-of-band callback wins; the service clears that prompt and lets the login finish without requiring a second answer.

The Web Models editor renders OAuth controls beside dual-auth providers and instead of the API-key input for OAuth-only providers. An OAuth-only provider cannot be materialized as usable settings until the durable store reports it configured. Login lifecycle and credential writes emit invalidation events so clients reload authoritative status rather than treating button completion as persistence evidence.

## Lifecycle

Service teardown closes admission before cancelling active provider flows. It waits for all admitted login and storage operations to settle before leaving the Cordis fiber. Storage admission covers refreshes initiated by active model requests as well as login and logout writes, so teardown does not abandon an atomic replacement after service disposal.

The adapter observes service mount and unmount through dynamic injection. It replaces directory facts when OAuth availability changes and creates a new pi-ai collection when the credential-store identity changes. Existing requests retain their captured collection; subsequent requests use the current service.

## Alternatives considered

- **Import Codex CLI credentials.** This would be provider-specific, bind the harness to a private external file format, and make ownership of logout and refresh ambiguous.
- **Persist a pasted subscription token as an API key.** This loses refresh semantics and bypasses pi-ai's OAuth credential-to-request-auth conversion.
- **Implement OpenAI OAuth directly in the harness.** This duplicates protocol details already owned and tested by the installed pi-ai provider and would not establish a reusable capability for other providers.
- **Use only an in-process mutex.** It prevents duplicate refresh inside one process but leaves two harness processes able to rotate the same refresh token.

## Model experience

The capability adds no model-visible prompts, tools, or session events. Its effect is confined to authentication before a pi-ai request. The selected provider and model remain logged through the existing LLM request path; credential material never enters the model transcript.

## Testing

Unit tests cover strict storage parsing and file mode, cross-process-compatible mutation serialization, status projection, provider discovery, prompt forwarding, cancellation, and Remote UI interactions. Adapter tests send an OpenAI Codex request through a fake OAuth store and assert pi-ai's bearer and account headers without exposing the credential in output. The real keyless Web composition records the OAuth-only provider card in its accessibility golden. Manual release validation completes browser login against the local Web product, verifies owner-only persistence, restarts against the same harness home, and performs an actual Codex model turn.

## Consequences

- The shipped product can authenticate pi-ai OAuth providers through their maintained implementations, persist login across restarts, and coordinate refresh across harness processes.
- Deployments that mount the capability own a separate secret document and must preserve its owner-only permissions; a stale lock cannot be reclaimed automatically because file age does not prove process death.
- A refresh may hold the writer lock across a network request, serializing concurrent callers for that provider store. The configurable deadline bounds the wait but can reject work during a slow or stuck exchange.
- The browser login surface is intentionally generic. A provider-specific interaction that cannot be expressed as the current prompt and progress union requires extending the capability rather than bypassing it in `llm-pi-ai`.
