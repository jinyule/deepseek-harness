/**
 * Browser-safe request and response vocabulary for authorization attempts.
 * This module contains types only; credential values and grant payloads never
 * cross this interface.
 * @module @deepseek-ai/dsh-authorization-remote/types
 */

import type { AuthorizationMethod, AuthorizationStatus } from '@deepseek-ai/dsh-authorization/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CredentialKey, CredentialRecordInfo } from '@deepseek-ai/dsh-credentials'

/** Opaque identity of one browser-owned authorization attempt. */
export type AuthorizationAttemptId = Branded<'AuthorizationAttemptId'>

/** Opaque identity of one question within an authorization attempt. */
export type AuthorizationPromptId = Branded<'AuthorizationPromptId'>

/** One authorization flow joined with its secret-free credential state. */
export interface AuthorizationAccountView {
  /** Record the flow obtains and owns. */
  readonly key: CredentialKey
  /** Provider-facing display name. */
  readonly label: string
  /** Available sign-in methods, most preferred first. */
  readonly methods: readonly AuthorizationMethod[]
  /** Whether any surface currently owns an attempt for this record. */
  readonly inFlight: boolean
  /** Presence, record kind, and writability without the record value. */
  readonly credential: CredentialRecordInfo
}

/** Current authorization rows in registration order. */
export interface AuthorizationAccountList {
  readonly entries: readonly AuthorizationAccountView[]
}

/** Start one flow through a selected method. */
export interface AuthorizationStartRequest {
  readonly key: CredentialKey
  readonly method?: string
}

/** Address one browser-owned attempt. */
export interface AuthorizationAttemptRequest {
  readonly attemptId: AuthorizationAttemptId
}

/** Answer the attempt's currently active prompt. */
export interface AuthorizationAnswerRequest extends AuthorizationAttemptRequest {
  readonly promptId: AuthorizationPromptId
  readonly value: string
}

/** Remove the local record written by one registered flow. */
export interface AuthorizationForgetRequest {
  readonly key: CredentialKey
}

/** Browser-safe prompt data; an AbortSignal remains on the Host. */
export type AuthorizationPromptView = {
  readonly id: AuthorizationPromptId
} & ({
  readonly kind: 'text' | 'secret'
  readonly message: string
  readonly placeholder?: string
} | {
  readonly kind: 'select'
  readonly message: string
  readonly options: readonly {
    readonly id: string
    readonly label: string
    readonly description?: string
  }[]
})

/** One ordered update from a running attempt. */
export type AuthorizationAttemptEvent =
  | { readonly kind: 'idle' }
  | {
    readonly kind: 'notice'
    readonly message: string
    readonly url?: string
    readonly code?: string
    /** True when a non-HTTP(S) link was omitted from the event. */
    readonly urlRejected?: true
  }
  | { readonly kind: 'prompt'; readonly prompt: AuthorizationPromptView }
  | { readonly kind: 'prompt-withdrawn'; readonly promptId: AuthorizationPromptId }
  | { readonly kind: 'settled'; readonly status: AuthorizationStatus }
  | { readonly kind: 'failed'; readonly message: string }

/** Stable business failures returned inside successful Remote transport calls. */
export type AuthorizationRemoteFailureCode =
  | 'flow-not-found'
  | 'method-not-found'
  | 'already-in-flight'
  | 'attempt-not-found'
  | 'poll-in-flight'
  | 'prompt-not-found'
  | 'invalid-option'
  | 'answer-too-large'
  | 'record-read-only'
  | 'shutting-down'

/** One stable business failure safe to render in a browser. */
export interface AuthorizationRemoteFailure {
  readonly code: AuthorizationRemoteFailureCode
  readonly message: string
}

/** Successful operation result. */
export interface AuthorizationRemoteSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected operation result. */
export interface AuthorizationRemoteRejected {
  readonly ok: false
  readonly error: AuthorizationRemoteFailure
}

/** Result of starting one authorization attempt. */
export type AuthorizationStartResult =
  | AuthorizationRemoteSuccess<{ readonly attemptId: AuthorizationAttemptId }>
  | AuthorizationRemoteRejected

/** Result of polling one attempt. */
export type AuthorizationPollResult =
  | AuthorizationRemoteSuccess<AuthorizationAttemptEvent>
  | AuthorizationRemoteRejected

/** Result of answering, cancelling, or forgetting. */
export type AuthorizationActionResult =
  | AuthorizationRemoteSuccess<{ readonly accepted: true }>
  | AuthorizationRemoteRejected
