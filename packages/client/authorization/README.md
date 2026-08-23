# @deepseek-ai/dsh-client-authorization

English | [中文](README.zh.md)

Browser transport plugin for the loopback authorization channel. It consumes the Connection service and the codec contribution from [`dsh-authorization-remote`](../../credentials/authorization-remote/README.md), then provides `ctx.authorizationClient` with typed `list`, `start`, `poll`, `answer`, `cancel`, and `forget` methods. Presentation plugins depend on that Cordis service instead of importing the transport carrier or Host implementation.

Both outbound requests and successful carrier values are validated. Connection failures are preserved; malformed input, malformed output, and thrown transports become a generic internal failure without exposing supplied or returned values. Business rejections remain inside their typed authorization result, so a UI can distinguish an unavailable flow, stale prompt, concurrent attempt, oversized answer, or read-only record from a transport failure.

## Model Experience

None, as this package only supplies a browser configuration service.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No presentation** — this package exposes methods only; [`dsh-client-ui-settings-authorization`](../ui-settings-authorization/README.md) owns the bundled Web UI.
- **Connection lifetime applies** — a reset interrupts the active poll; the owning presentation decides whether to retry or cancel the attempt.
