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
  private readonly starts = new Set<Promise<AuthorizationUiActionResult>>()
  private readonly cancellations = new Map<AuthorizationAttemptId, Promise<AuthorizationUiActionResult>>()
  private loadRevision = 0
  private disposed = false
  private disposal: Promise<void> | undefined

  /**
   * @param remote - authorization client service supplied by the transport plugin.
   * @param t - locale-bound translator for locally owned failure copy.
   */
  constructor(
    private readonly remote: AuthorizationClient,
    private readonly t: Translate<AuthorizationKey>,
  ) {}

  /**
   * Read registered flows without replacing live attempt updates; only the newest read publishes metadata.
   * @returns whether the value-free snapshot was loaded.
   */
  async load(): Promise<AuthorizationUiActionResult> {
    if (this.isDisposed()) return { ok: false, message: this.t('unavailable') }
    const revision = ++this.loadRevision
    const current = this.store.getSnapshot()
    this.store.set({ status: 'loading', entries: current.entries, attempts: current.attempts })
    try {
      const response = await this.remote.list()
      if (!response.ok) {
        if (!this.isDisposed() && revision === this.loadRevision) {
          this.store.set({ ...this.store.getSnapshot(), status: 'error', error: response.error.message })
        }
        return failure(response)
      }
      if (this.isDisposed() || revision !== this.loadRevision) return ACTION_OK
      this.store.set({ status: 'ready', entries: response.value.entries, attempts: this.store.getSnapshot().attempts })
      return ACTION_OK
    } catch (error) {
      const message = error instanceof Error ? error.message : this.t('loadFailed')
      if (!this.isDisposed() && revision === this.loadRevision) {
        this.store.set({ ...this.store.getSnapshot(), status: 'error', error: message })
      }
      return { ok: false, message }
    }
  }

  /**
   * Start one flow and consume its private event queue; teardown rejects new starts and drains accepted ones.
   * @param key - credential record owned by the flow.
   * @param method - optional method declared by that flow.
   * @returns whether the attempt was admitted.
   */
  start(key: CredentialKey, method?: string): Promise<AuthorizationUiActionResult> {
    if (this.disposed) return Promise.resolve({ ok: false, message: this.t('unavailable') })
    const pending = Promise.withResolvers<AuthorizationUiActionResult>()
    this.starts.add(pending.promise)
    void this.startAttempt(key, method).then(pending.resolve, pending.reject)
    void pending.promise.then(() => { this.starts.delete(pending.promise) }, () => { this.starts.delete(pending.promise) })
    return pending.promise.catch(() => ({ ok: false, message: this.t('cancelFailed') }))
  }

  /** Register an admitted attempt, or cancel it before teardown releases the client. */
  private async startAttempt(key: CredentialKey, method: string | undefined): Promise<AuthorizationUiActionResult> {
    let response: Awaited<ReturnType<AuthorizationClient['start']>>
    try {
      response = await this.remote.start({ key, ...method === undefined ? {} : { method } })
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : this.t('startFailed') }
    }
    if (!response.ok) return failure(response)
    if (!response.value.ok) return failure(response.value)
    const attempt: AuthorizationAttemptView = {
      id: response.value.value.attemptId,
      status: 'running',
      notices: Object.freeze([]),
    }
    if (this.isDisposed()) {
      await this.cancelForDisposal(attempt.id)
      return ACTION_OK
    }
    this.replaceAttempt(key, attempt)
    this.pumps.set(attempt.id, this.pump(key, attempt.id))
    return ACTION_OK
  }

  /**
   * Submit one prompt response without replacing events received while its acknowledgment is pending.
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
      const current = this.store.getSnapshot().attempts[key]
      if (current?.id === attempt.id && current.prompt?.id === attempt.prompt.id) {
        this.replaceAttempt(key, { ...current, prompt: undefined })
      }
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
    if (this.disposed) return { ok: false, message: this.t('unavailable') }
    const attempt = this.store.getSnapshot().attempts[key]
    if (attempt === undefined) return ACTION_OK
    return this.cancelAttempt(attempt.id)
  }

  /** Coalesce cancellation of one accepted attempt through its completed response. */
  private cancelAttempt(attemptId: AuthorizationAttemptId): Promise<AuthorizationUiActionResult> {
    const current = this.cancellations.get(attemptId)
    if (current !== undefined) return current
    const pending = Promise.withResolvers<AuthorizationUiActionResult>()
    this.cancellations.set(attemptId, pending.promise)
    void this.requestCancellation(attemptId).then(pending.resolve, pending.reject)
    const completed = (): void => { this.cancellations.delete(attemptId) }
    void pending.promise.then(completed, completed)
    return pending.promise
  }

  /** Convert one cancellation response into the same action result the UI consumes. */
  private async requestCancellation(attemptId: AuthorizationAttemptId): Promise<AuthorizationUiActionResult> {
    try {
      const response = await this.remote.cancel({ attemptId })
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

  /**
   * Stop admission and await accepted starts, polls and cancellation responses.
   * @returns The shared cleanup promise; rejects after all cleanup settles if a cancellation failed.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.disposal = this.drain()
    return this.disposal
  }

  /** Complete accepted operations while the caller retains the authorization client. */
  private async drain(): Promise<void> {
    const attempts = Object.values(this.store.getSnapshot().attempts)
    for (const controller of this.polls.values()) controller.abort()
    const cancelling = new Set([
      ...this.cancellations.values(),
      ...attempts.filter(attempt => attempt.status === 'running').map(attempt => this.cancelAttempt(attempt.id)),
    ])
    const results = await Promise.allSettled([
      ...this.starts,
      ...this.pumps.values(),
      ...[...cancelling].map(async (task) => {
        const result = await task
        if (!result.ok) throw new Error(result.message)
      }),
    ])
    this.polls.clear()
    this.pumps.clear()
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (failures.length > 0) throw new AggregateError(failures, this.t('cancelFailed'))
  }

  /** A successful late start owns its cancellation even after the page has stopped. */
  private async cancelForDisposal(attemptId: AuthorizationAttemptId): Promise<void> {
    const result = await this.cancelAttempt(attemptId)
    if (!result.ok) throw new Error(result.message)
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
