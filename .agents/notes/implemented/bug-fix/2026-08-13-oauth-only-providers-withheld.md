# Agent Note: The configurable-provider directory withholds unsupported OAuth-only providers

Status: implemented

English | [中文](2026-08-13-oauth-only-providers-withheld.zh.md)

## Problem

The pi-ai catalog includes routes with different authentication methods. Most accept an API key, while `openai-codex` accepts OAuth only. A configurable-provider directory that lists every catalog route can therefore offer a route the current application composition cannot authenticate.

The directory also serves as the address of stored profiles. Filtering a route out merely because the current composition cannot authenticate its catalog default would strand an existing profile: the user could no longer inspect, edit, or delete it.

## Decision

The directory offers a catalog route when either authentication path is present in the current composition:

- the installed pi-ai provider declares an API-key method; or
- the optional `piAiOAuth` service reports that it supports the route.

`llm-pi-ai` observes `piAiOAuth` through dynamic Cordis injection. Mounting or unmounting that service atomically replaces the directory registration, so an API-key-only headless composition remains valid while the shipped base composition can offer OAuth-only routes.

The profile half of the directory union remains unconditional. Any route named by resolved settings stays visible regardless of catalog support or current OAuth availability. Catalog membership still determines the `declared` marker; authentication availability does not change what pi-ai has installed.

Request resolution follows the same optional capability. Every pi-ai model collection receives the exact mounted OAuth credential store. Without it, the adapter retains pi-ai's in-memory default and an OAuth-only route is not offered from the directory. A profile with an explicit `apiKeyEnv` remains serviceable because the adapter adds that API-key method to the routed provider.

## Alternatives considered

**Publish every installed catalog route unconditionally.** This makes the directory independent of composition, but advertises OAuth-only routes in deployments that have no persistent store or login interaction and therefore cannot authenticate them.

**Require the OAuth service in every `llm-pi-ai` composition.** This would make the catalog uniform, but forces credential persistence and interactive login into API-key-only headless deployments that do not need either capability.

**Hide stored profiles whenever their catalog authentication is unavailable.** This keeps the picker limited to currently usable routes, but strands configuration the user still needs to inspect, edit, or delete. Stored profile visibility therefore remains independent of catalog offering.

## Consequences

The shipped base bundle mounts `@deepseek-ai/dsh-llm-pi-ai-oauth`, so `openai-codex` appears in the Models provider picker and uses interactive subscription-account login. Compositions that omit the service continue to withhold `openai-codex` automatically. Dual-auth providers remain available through their API-key method even when OAuth is absent.

The directory does not claim that a provider is currently authenticated. OAuth status comes from the OAuth service, while API-key status comes from the credentials service; the Models page joins those facts separately.

## Testing

Package tests cover both compositions: without the OAuth service, `openai-codex` is absent while API-key providers remain; with the service mounted, it appears. A stored `openai-codex` profile remains visible in either composition. The keyless Web composition snapshot selects `openai-codex` from the real provider picker and records the subscription login controls without starting external authorization.
