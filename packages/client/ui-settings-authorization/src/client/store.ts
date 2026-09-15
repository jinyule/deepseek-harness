/** Browser object layer for the authorization settings section. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AuthorizationClient } from '@deepseek-ai/dsh-authorization-remote/client'
import type {
  AuthorizationAccountView,
  AuthorizationAttemptEvent,
  AuthorizationAttemptId,
  AuthorizationPromptView,
} from '@deepseek-ai/dsh-authorization-remote/types'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthorizationKey } from './locales.ts'

/** Visible state of one attempt started by this page. */
export interface AuthorizationAttemptView {
  readonly id: AuthorizationAttemptId
  readonly status: 'running' | 'authorized' | 'cancelled' | 'failed'
  readonly notices: readonly Extract<AuthorizationAttemptEvent, { kind: 'notice' }>[]
  readonly prompt?: AuthorizationPromptView | undefined
  readonly error?: string
}

/** Immutable page snapshot. */
export interface AuthorizationSettingsState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly entries: readonly AuthorizationAccountView[]
  readonly attempts: Readonly<Record<string, AuthorizationAttemptView>>
  readonly error?: string
}

/** Settled action result rendered by the section. */
export type AuthorizationUiActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

const ACTION_OK: AuthorizationUiActionResult = Object.freeze({ ok: true })

const INITIAL: AuthorizationSettingsState = Object.freeze({
  status: 'idle',
  entries: Object.freeze([]),
  attempts: Object.freeze({}),
})

/** Convert a transport or business failure to presentation-safe text. */
function failure(result: { readonly error: { readonly message: string } }): AuthorizationUiActionResult {
  return { ok: false, message: result.error.message }
}

/** Browser controller for account discovery and attempt polling. */
export class AuthorizationSettingsStore {
  /** Observable account and attempt state consumed by the section. */
  readonly store: SnapshotStore<AuthorizationSettingsState> = createSnapshotStore(INITIAL)
  private readonly polls = new Map<AuthorizationAttemptId, AbortController>()
  private readonly pumps = new Map<AuthorizationAttemptId, Promise<void>>()
  private disposed = false

  /**
   * @param remote - authorization client service supplied by the transport plugin.
   * @param t - locale-bound translator for locally owned failure copy.
   */
  constructor(
    private readonly remote: AuthorizationClient,
    private readonly t: Translate<AuthorizationKey>,
  ) {}

  /**
   * Read all registered flows and their current credential state.
   * @returns whether the value-free snapshot was loaded.
   */
  async load(): Promise<AuthorizationUiActionResult> {
    if (this.isDisposed()) return { ok: false, message: this.t('unavailable') }
    const current = this.store.getSnapshot()
    this.store.set({ status: 'loading', entries: current.entries, attempts: current.attempts })
    try {
      const response = await this.remote.list()
      if (!response.ok) {
        this.store.set({ status: 'error', entries: current.entries, attempts: current.attempts, error: response.error.message })
        return failure(response)
      }
      if (this.isDisposed()) return ACTION_OK
      this.store.set({ status: 'ready', entries: response.value.entries, attempts: current.attempts })
      return ACTION_OK
    } catch (error) {
      const message = error instanceof Error ? error.message : this.t('loadFailed')
      if (!this.isDisposed()) {
        this.store.set({ status: 'error', entries: current.entries, attempts: current.attempts, error: message })
      }
      return { ok: false, message }
    }
  }

  /**
   * Start one flow and begin consuming its private event queue.
   * @param key - credential record owned by the flow.
   * @param method - optional method declared by that flow.
   * @returns whether the attempt was admitted.
   */
  async start(key: CredentialKey, method?: string): Promise<AuthorizationUiActionResult> {
    try {
      const response = await this.remote.start({ key, ...method === undefined ? {} : { method } })
      if (!response.ok) return failure(response)
      if (!response.value.ok) return failure(response.value)
      const attempt: AuthorizationAttemptView = {
        id: response.value.value.attemptId,
        status: 'running',
        notices: Object.freeze([]),
      }
      this.replaceAttempt(key, attempt)
      this.pumps.set(attempt.id, this.pump(key, attempt.id))
      return ACTION_OK
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : this.t('startFailed') }
    }
  }

  /**
   * Submit one prompt response.
   * @param key - credential record whose attempt owns the prompt.
   * @param value - exact response entered by the user.
   * @returns whether the active prompt accepted the response.
   */
  async answer(key: CredentialKey, value: string): Promise<AuthorizationUiActionResult> {
    const attempt = this.store.getSnapshot().attempts[key]
    if (attempt?.prompt === undefined) return { ok: false, message: this.t('promptInactive') }
    try {
      const response = await this.remote.answer({
        attemptId: attempt.id,
        promptId: attempt.prompt.id,
        value,
      })
      if (!response.ok) return failure(response)
      if (!response.value.ok) return failure(response.value)
      this.replaceAttempt(key, { ...attempt, prompt: undefined })
      return ACTION_OK
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : this.t('answerFailed') }
    }
  }

  /**
   * Cancel the page-owned attempt for one flow.
   * @param key - credential record whose attempt should stop.
   * @returns whether the cancellation request was accepted.
   */
  async cancel(key: CredentialKey): Promise<AuthorizationUiActionResult> {
    const attempt = this.store.getSnapshot().attempts[key]
    if (attempt === undefined) return ACTION_OK
    try {
      const response = await this.remote.cancel({ attemptId: attempt.id })
      if (!response.ok) return failure(response)
      if (!response.value.ok) return failure(response.value)
      return ACTION_OK
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : this.t('cancelFailed') }
    }
  }

  /**
   * Delete one local credential record without claiming issuer revocation.
   * @param key - writable record to remove.
   * @returns whether deletion and the following snapshot reload succeeded.
   */
  async forget(key: CredentialKey): Promise<AuthorizationUiActionResult> {
    try {
      const response = await this.remote.forget({ key })
      if (!response.ok) return failure(response)
      if (!response.value.ok) return failure(response.value)
      return await this.load()
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : this.t('forgetFailed') }
    }
  }

  /** Stop polls and ask the Host to cancel every still-running attempt. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const attempts = Object.values(this.store.getSnapshot().attempts)
    for (const controller of this.polls.values()) controller.abort()
    await Promise.all([
      ...this.pumps.values(),
      ...attempts
        .filter(attempt => attempt.status === 'running')
        .map(attempt => this.remote.cancel({ attemptId: attempt.id }).catch(() => undefined)),
    ])
    this.polls.clear()
    this.pumps.clear()
  }

  /** Read disposal after async suspension without relying on stale control-flow narrowing. */
  private isDisposed(): boolean {
    return this.disposed
  }

  /** Consume ordered events until the attempt reaches a terminal state. */
  private async pump(key: CredentialKey, attemptId: AuthorizationAttemptId): Promise<void> {
    const controller = new AbortController()
    this.polls.set(attemptId, controller)
    try {
      while (!this.disposed && !controller.signal.aborted) {
        const response = await this.remote.poll({ attemptId }, controller.signal)
        if (!response.ok) {
          this.failAttempt(key, response.error.message)
          return
        }
        if (!response.value.ok) {
          this.failAttempt(key, response.value.error.message)
          return
        }
        if (this.applyEvent(key, response.value.value)) {
          await this.load()
          return
        }
      }
    } catch (error) {
      if (!this.disposed && !controller.signal.aborted) {
        this.failAttempt(key, error instanceof Error ? error.message : this.t('updatesStopped'))
      }
    } finally {
      this.polls.delete(attemptId)
      this.pumps.delete(attemptId)
    }
  }

  /** Apply one ordered event and report whether it was terminal. */
  private applyEvent(key: CredentialKey, event: AuthorizationAttemptEvent): boolean {
    const attempt = this.store.getSnapshot().attempts[key]
    if (attempt === undefined) return true
    switch (event.kind) {
      case 'idle': return false
      case 'notice':
        this.replaceAttempt(key, { ...attempt, notices: Object.freeze([...attempt.notices, event]) })
        return false
      case 'prompt':
        this.replaceAttempt(key, { ...attempt, prompt: event.prompt })
        return false
      case 'prompt-withdrawn':
        if (attempt.prompt?.id === event.promptId) this.replaceAttempt(key, { ...attempt, prompt: undefined })
        return false
      case 'settled':
        this.replaceAttempt(key, { ...attempt, status: event.status, prompt: undefined })
        return true
      case 'failed':
        this.replaceAttempt(key, { ...attempt, status: 'failed', prompt: undefined, error: event.message })
        return true
      /* v8 ignore next 2 -- AuthorizationAttemptEvent is closed at this typed same-process call. */
      default:
        return event satisfies never
    }
  }

  /** Mark one attempt failed without changing other page state. */
  private failAttempt(key: CredentialKey, message: string): void {
    const attempt = this.store.getSnapshot().attempts[key]
    if (attempt !== undefined) {
      this.replaceAttempt(key, { ...attempt, status: 'failed', prompt: undefined, error: message })
    }
  }

  /** Replace one keyed attempt while preserving the page's other facts. */
  private replaceAttempt(key: CredentialKey, attempt: AuthorizationAttemptView): void {
    if (this.disposed) return
    const state = this.store.getSnapshot()
    this.store.set({
      ...state,
      attempts: Object.freeze({ ...state.attempts, [key]: Object.freeze(attempt) }),
    })
  }
}
