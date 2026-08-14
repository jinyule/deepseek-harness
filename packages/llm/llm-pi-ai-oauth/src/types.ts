/**
 * Client-safe request, status, and event vocabulary for pi-ai OAuth.
 * @module @deepseek-ai/dsh-llm-pi-ai-oauth/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identity of one outstanding provider-owned login prompt. */
export type PiAiOAuthPromptId = Branded<'PiAiOAuthPromptId'>

/** One provider whose installed pi-ai definition offers OAuth. */
export interface PiAiOAuthProviderView {
  /** pi-ai provider route id. */
  readonly provider: string
  /** Human-facing provider name. */
  readonly displayName: string
  /** Human-facing OAuth method name. */
  readonly authName: string
  /** Provider-supplied sign-in call to action, when one exists. */
  readonly loginLabel?: string
  /** Whether a durable OAuth credential currently exists. */
  readonly configured: boolean
  /** Whether this provider has no API-key alternative. */
  readonly oauthOnly: boolean
  /** Whether one login flow is currently running. */
  readonly loginActive: boolean
}

/** Current OAuth provider directory. */
export interface PiAiOAuthDescribeValue {
  /** Installed OAuth providers in pi-ai catalog order. */
  readonly providers: readonly PiAiOAuthProviderView[]
}

/** Start the provider-owned OAuth login flow. */
export interface PiAiOAuthStartRequest {
  readonly provider: string
}

/** Answer the one prompt currently owned by a login flow. */
export interface PiAiOAuthAnswerRequest {
  readonly provider: string
  readonly promptId: PiAiOAuthPromptId
  /** User-entered answer. Secret and one-time-code values are never echoed in events. */
  readonly value: string
}

/** Address a running login flow or stored credential. */
export interface PiAiOAuthProviderRequest {
  readonly provider: string
}

/** Stable acknowledgement for an accepted command. */
export interface PiAiOAuthCommandValue {
  readonly accepted: true
}

/** A requested provider or login state does not admit the command. */
export interface PiAiOAuthCommandFailure {
  readonly code:
    | 'unknown-provider'
    | 'login-active'
    | 'login-absent'
    | 'prompt-absent'
    | 'prompt-mismatch'
    | 'invalid-answer'
  readonly message: string
}

/** Result of a login, answer, cancellation, or logout command. */
export type PiAiOAuthCommandResult =
  | { readonly ok: true; readonly value: PiAiOAuthCommandValue }
  | { readonly ok: false; readonly error: PiAiOAuthCommandFailure }

/** Provider-owned link safe to expose during a login flow. */
export interface PiAiOAuthLinkView {
  readonly url: string
  readonly label?: string
}

/** One select option in a provider-owned login prompt. */
export interface PiAiOAuthPromptOptionView {
  readonly id: string
  readonly label: string
  readonly description?: string
}

/** Prompt forwarded from the provider without any answer value. */
export type PiAiOAuthPromptView = {
  readonly id: PiAiOAuthPromptId
  readonly message: string
  readonly placeholder?: string
} & ({
  readonly type: 'select'
  readonly options: readonly PiAiOAuthPromptOptionView[]
} | {
  readonly type: 'text' | 'secret' | 'manual_code'
})

/** Non-secret progress from one provider-owned OAuth login. */
export type PiAiOAuthLoginEvent =
  | { readonly type: 'info'; readonly message: string; readonly links?: readonly PiAiOAuthLinkView[] }
  | { readonly type: 'auth_url'; readonly url: string; readonly instructions?: string }
  | { readonly type: 'device_code'; readonly userCode: string; readonly verificationUri: string; readonly intervalSeconds?: number; readonly expiresInSeconds?: number }
  | { readonly type: 'progress'; readonly message: string }
  | { readonly type: 'prompt'; readonly prompt: PiAiOAuthPromptView }
  | { readonly type: 'success' }
  | { readonly type: 'failure'; readonly message: string }
  | { readonly type: 'cancelled' }

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Reports non-secret progress from one provider-owned login to local and Remote listeners.
     * @mode emit
     * @param provider - pi-ai provider route id.
     * @param event - non-secret login progress.
     */
    'pi-ai-oauth/login-event'(provider: string, event: PiAiOAuthLoginEvent): void
    /**
     * Invalidates status after one provider's durable credential or login lifecycle changes.
     * @mode emit
     * @param provider - pi-ai provider whose durable or login state changed.
     */
    'pi-ai-oauth/updated'(provider: string): void
  }
}
