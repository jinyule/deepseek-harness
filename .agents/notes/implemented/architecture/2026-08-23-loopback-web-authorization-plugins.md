# Agent Note: Loopback Web authorization plugins

Status: implemented

English | [中文](2026-08-23-loopback-web-authorization-plugins.zh.md)

## Problem

The credential-record and authorization-flow seams made pi-ai logins executable in process, including OpenAI Codex OAuth, but the Web product still had no caller that could carry notices, links, device codes, or prompts between a provider flow and the human who started it. Adding a Codex button to Models would solve one route while making a generic seam depend on one provider and one presentation. Exposing `authorization.begin()` through the existing Typert `/api` BFF would be generic, but that BFF deliberately admits configured trusted LAN hosts; trusted network origin is not user authentication for an operation that can create, replace, or delete account credentials.

## Decision

Complete the capability entirely through plugins and assembly. No core service, agent-loop path, settings owner, Models editor, generic API gateway, or pi-ai flow implementation changes.

`dsh-authorization-remote` is the Host interaction plugin. It projects registered flows over a private Connection channel named `/authorization`, whose handler declares `authority: loopback`. Its client half contributes the strict request and response codecs through the browser module table, so both peers validate the same protocol while the channel remains outside Typert `/api`. The protocol exposes credential presence, kind, and writability but never a record value or opaque grant payload. Attempts and prompts use random opaque ids; only HTTP(S) notice links survive projection; prompt replies are size-bounded; one attempt owns at most one poll and one prompt. Inactivity, page teardown, and Host teardown all have explicit cancellation and quiescence behavior.

`dsh-client-authorization` consumes Connection plus those codecs and provides `ctx.authorizationClient`. It preserves carrier failures, keeps business failures typed, and converts malformed or thrown transport behavior to one value-free internal failure. UI plugins therefore depend on a Cordis service rather than the channel carrier or Host class.

`dsh-client-ui-settings-authorization` contributes an independent **Accounts** section through `settings.section`. The section registers only for a loopback Connection, lists every installed flow, renders its declared methods and neutral interaction vocabulary, and supports cancellation and local record removal. It has no provider-id or OAuth branches. `llm-pi-ai` already registers every installed pi-ai login flow unconditionally, so OpenAI Codex appears through the same row mechanism as key entry, subscription login, and device-code providers.

The Web bundle mounts the existing authorization seam and these three plugins. Account acquisition belongs in Accounts rather than Models: a flow may exist before a provider profile, one account can outlive model configuration, and credential lifecycle is not model-list editing. The settings core remains an outlet owner; this section is an ordinary contribution.

## Alternatives considered

- **Expose authorization methods on Typert `/api`.** It would reuse the BFF and generated client, but its trusted-host authority is intentionally broader than loopback. Adding authorization there would make LAN trust sufficient to mutate account credentials.
- **Add controls to the Models plugin.** It would avoid a new section but couple credential acquisition to provider-profile editing and require provider-specific behavior where the generic flow vocabulary already exists.
- **Teach the settings core or authorization seam about Web.** Either would invert ownership: the core should expose contribution points, and the seam should describe a conversation without selecting its carrier or presentation.
- **Implement only Codex OAuth.** pi-ai already supplies a catalog of login implementations. A Codex-only route would duplicate that adapter and leave every other provider flow unreachable.
- **Automatically open every provider URL.** A visible link keeps browser navigation a user action, works for device-code flows, and avoids letting provider output cause unsolicited navigation.

## Consequences

The assembled Web app can acquire and forget provider credentials without adding secret readback. OpenAI Codex OAuth is available from Settings → Accounts through the pi-ai-provided ChatGPT login, while Models continues to own only provider and model configuration. New provider login protocols need only register another flow; the Host transport and UI remain unchanged.

Remote browsers do not see Accounts. This is a deliberate refusal until a remote-user identity and authorization policy exists. Attempts remain process-local, and forgetting a record remains local deletion rather than issuer revocation, matching the underlying seam's recorded limitations.

No active Agent Note is superseded. The credential-record and authorization-flow note remains the authority for the generic seams and pi-ai adapters; this note replaces only its previously deferred browser-surface statement. Nothing is archived.

## Testing

The Host suite covers flow listing, every endpoint, strict request rejection, value-free projection, safe-link filtering, prompt validation and size limits, concurrent polls and attempts, orphan and retention timers, carrier cancellation, and shutdown. The browser client suite pins every channel call, carrier-failure preservation, and malformed-value containment. The UI store and component suites cover ordered event reduction, prompt withdrawal, cancellation, disposal, record removal, loopback registration, localization, styling, and error states. Package invariants and assembled Web snapshots cover plugin discovery and visible navigation. All three new packages are held to per-file 100% source coverage.
