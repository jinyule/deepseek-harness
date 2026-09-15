/**
 * Remote interaction surface for the generic authorization capability. Each
 * browser starts an opaque attempt and long-polls only that attempt's notices
 * and prompts; provider-specific OAuth and API-key logic stays in the flow
 * plugins that registered with `ctx.authorization`.
 * @module @deepseek-ai/dsh-authorization-remote
 */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type {
  AuthorizationInteraction,
  AuthorizationNotice,
  AuthorizationPrompt,
} from '@deepseek-ai/dsh-authorization'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import {
  AUTHORIZATION_RPC_CHANNEL,
  authorizationRequestSchemas,
  authorizationValueSchemas,
  type AuthorizationRpcEndpoint,
} from './api.ts'
import type {
  AuthorizationAccountList,
  AuthorizationActionResult,
  AuthorizationAnswerRequest,
  AuthorizationAttemptEvent,
  AuthorizationAttemptId,
  AuthorizationAttemptRequest,
  AuthorizationForgetRequest,
  AuthorizationPollResult,
  AuthorizationPromptId,
  AuthorizationPromptView,
  AuthorizationRemoteFailureCode,
  AuthorizationRemoteRejected,
  AuthorizationStartRequest,
  AuthorizationStartResult,
} from './types.ts'

export type * from './types.ts'
export * from './api.ts'

/** Deployment policy for long-poll and abandoned-attempt lifetimes. */
export interface Config {
  /** Maximum duration of one empty poll before an `idle` event. */
  readonly pollTimeoutMs: number
  /** Inactivity duration after which a running browser attempt is cancelled. */
  readonly orphanTimeoutMs: number
  /** Maximum retention of an unconsumed terminal event. */
  readonly completedRetentionMs: number
  /** Maximum UTF-8 size of one text, secret, or select response. */
  readonly maxPromptResponseBytes: number
}

interface PendingPoll {
  readonly resolve: (result: AuthorizationPollResult) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly signal: AbortSignal
  readonly onAbort: () => void
}

interface PendingPrompt {
  readonly id: AuthorizationPromptId
  readonly view: AuthorizationPromptView
  readonly resolve: (value: string) => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal | undefined
  readonly onAbort: (() => void) | undefined
}

interface AttemptState {
  readonly id: AuthorizationAttemptId
  readonly key: CredentialKey
  readonly controller: AbortController
  readonly events: AuthorizationAttemptEvent[]
  running: Promise<void>
  poll: PendingPoll | undefined
  prompt: PendingPrompt | undefined
  orphanTimer: ReturnType<typeof setTimeout> | undefined
  completedTimer: ReturnType<typeof setTimeout> | undefined
  terminal: boolean
}

const OK: AuthorizationActionResult = Object.freeze({ ok: true, value: Object.freeze({ accepted: true }) })
const AUTHORIZATION_ENDPOINTS: ReadonlySet<string> = new Set([
  'list',
  'start',
  'poll',
  'answer',
  'cancel',
  'forget',
])

/** Narrow a Connection endpoint before selecting its protocol schema. */
function isAuthorizationEndpoint(endpoint: string): endpoint is AuthorizationRpcEndpoint {
  return AUTHORIZATION_ENDPOINTS.has(endpoint)
}

/** Reject malformed private-channel input without echoing any supplied value. */
function badRequest(): Awaited<ReturnType<ConnectionRpcHandler>> {
  return {
    ok: false,
    error: {
      code: 'bad-request',
      message: 'Invalid authorization request.',
      details: { issues: [] },
    },
  }
}

/** Build a frozen successful business result. */
function success<T>(value: T): { readonly ok: true; readonly value: T } {
  return Object.freeze({ ok: true, value })
}

/** Build a stable browser-safe business failure. */
function rejected(code: AuthorizationRemoteFailureCode, message: string): AuthorizationRemoteRejected {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) })
}

/** Convert an AbortSignal reason to an Error without stringifying objects. */
function abortError(signal: AbortSignal, fallback: string): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error(typeof signal.reason === 'string' ? signal.reason : fallback)
}

/** Keep only links a browser can open without changing schemes. */
function safeNotice(notice: AuthorizationNotice): AuthorizationAttemptEvent {
  if (notice.url === undefined) {
    return { kind: 'notice', message: notice.message, ...notice.code === undefined ? {} : { code: notice.code } }
  }
  try {
    const url = new URL(notice.url)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return {
        kind: 'notice',
        message: notice.message,
        url: url.toString(),
        ...notice.code === undefined ? {} : { code: notice.code },
      }
    }
  } catch {
    // Invalid URLs and disallowed schemes share one safe omission on the wire.
  }
  return {
    kind: 'notice',
    message: notice.message,
    ...notice.code === undefined ? {} : { code: notice.code },
    urlRejected: true,
  }
}

/** Remove the Host-only signal and assign an opaque prompt identity. */
function promptView(prompt: AuthorizationPrompt, id: AuthorizationPromptId): AuthorizationPromptView {
  if (prompt.kind === 'select') {
    return {
      id,
      kind: 'select',
      message: prompt.message,
      options: prompt.options.map(option => ({
        id: option.id,
        label: option.label,
        ...option.description === undefined ? {} : { description: option.description },
      })),
    }
  }
  return {
    id,
    kind: prompt.kind,
    message: prompt.message,
    ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    authorizationRemote: AuthorizationRemoteService
  }
}

/** Browser-facing projection of registered authorization flows. */
export class AuthorizationRemoteService extends Service {
  static inject = ['authorization', 'credentials', 'connection', 'webServer']

  /** Configurable long-poll and retention limits. */
  static Config: s<Config> = s.object({
    pollTimeoutMs: s.number().step(1).min(1).default(15_000),
    orphanTimeoutMs: s.number().step(1).min(1).default(60_000),
    completedRetentionMs: s.number().step(1).min(1).default(60_000),
    maxPromptResponseBytes: s.number().step(1).min(1).default(65_536),
  })

  private readonly attempts = new Map<AuthorizationAttemptId, AttemptState>()
  private closing = false

  /**
   * @param ctx - Host context carrying the authorization and credential seams.
   * @param config - resolved long-poll and retention policy.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'authorizationRemote')
    if (config.pollTimeoutMs >= config.orphanTimeoutMs) {
      throw new TypeError('authorization-remote: pollTimeoutMs must be less than orphanTimeoutMs')
    }
  }

  /** Own shutdown after the Remote service stops admitting new work. */
  protected [Service.init](): void {
    this.ctx.effect(() => this.ctx.connection.rpc.handle(
      AUTHORIZATION_RPC_CHANNEL,
      this.dispatch,
    ), 'authorization-remote: authenticated RPC channel')
    this.ctx.effect(() => async () => { await this.shutdown() }, 'authorization-remote: attempt lifecycle')
  }

  /**
   * List every registered flow with record presence and writability.
   * @returns secret-free account rows in flow registration order.
   */
  async list(): Promise<AuthorizationAccountList> {
    const entries = await Promise.all(this.ctx.authorization.list().map(async entry => ({
      ...entry,
      credential: await this.ctx.credentials.describeRecord(entry.key),
    })))
    return { entries }
  }

  /**
   * Start one browser-owned attempt without holding the Remote request open.
   * @param request - credential key and optional registered method.
   * @returns opaque attempt identity or a stable admission failure.
   */
  start(request: AuthorizationStartRequest): AuthorizationStartResult {
    if (this.closing) return rejected('shutting-down', 'The authorization surface is shutting down.')
    const entry = this.ctx.authorization.describe(request.key)
    if (entry === undefined) return rejected('flow-not-found', 'This sign-in flow is no longer available.')
    if (request.method !== undefined && !entry.methods.some(method => method.id === request.method)) {
      return rejected('method-not-found', 'This sign-in method is no longer available.')
    }
    if (entry.inFlight) return rejected('already-in-flight', 'A sign-in attempt is already running for this account.')

    const id = randomUUID() as AuthorizationAttemptId
    const state: AttemptState = {
      id,
      key: request.key,
      controller: new AbortController(),
      events: [],
      running: Promise.resolve(),
      poll: undefined,
      prompt: undefined,
      orphanTimer: undefined,
      completedTimer: undefined,
      terminal: false,
    }
    this.attempts.set(id, state)
    this.touch(state)
    state.running = this.run(state, request.method)
    return success(Object.freeze({ attemptId: id }))
  }

  /**
   * Read the next ordered update, returning `idle` at the configured heartbeat.
   * @param request - opaque attempt identity.
   * @param signal - Remote caller lifetime; abort withdraws only this poll.
   * @returns the next event or a stable addressing/concurrency failure.
   */
  poll(request: AuthorizationAttemptRequest, signal: AbortSignal): Promise<AuthorizationPollResult> {
    const state = this.attempts.get(request.attemptId)
    if (state === undefined) {
      return Promise.resolve(rejected('attempt-not-found', 'This sign-in attempt is no longer available.'))
    }
    if (state.poll !== undefined) {
      return Promise.resolve(rejected('poll-in-flight', 'This sign-in attempt already has an active poll.'))
    }
    this.touch(state)
    const event = state.events.shift()
    if (event !== undefined) return Promise.resolve(this.delivered(state, event))
    if (signal.aborted) return Promise.reject(abortError(signal, 'authorization poll aborted'))

    return new Promise<AuthorizationPollResult>((resolve, reject) => {
      const onAbort = (): void => {
        this.clearPoll(state)
        reject(abortError(signal, 'authorization poll aborted'))
      }
      const timer = setTimeout(() => {
        this.clearPoll(state)
        resolve(success({ kind: 'idle' }))
      }, this.config.pollTimeoutMs)
      state.poll = { resolve, reject, timer, signal, onAbort }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Answer the active prompt after checking both opaque identities.
   * @param request - attempt, prompt, and exact human response.
   * @returns acknowledgement or a stale-prompt failure.
   */
  answer(request: AuthorizationAnswerRequest): AuthorizationActionResult {
    const state = this.attempts.get(request.attemptId)
    if (state === undefined) return rejected('attempt-not-found', 'This sign-in attempt is no longer available.')
    const pending = state.prompt
    if (pending === undefined || pending.id !== request.promptId) {
      return rejected('prompt-not-found', 'This sign-in question is no longer active.')
    }
    if (pending.view.kind === 'select'
      && !pending.view.options.some(option => option.id === request.value)) {
      return rejected('invalid-option', 'Choose one of the offered sign-in options.')
    }
    if (Buffer.byteLength(request.value, 'utf8') > this.config.maxPromptResponseBytes) {
      return rejected('answer-too-large', 'This sign-in response is too large.')
    }
    this.touch(state)
    this.detachPrompt(state)
    pending.resolve(request.value)
    return OK
  }

  /**
   * Cancel one browser-owned attempt.
   * @param request - opaque attempt identity.
   * @returns acknowledgement or an unknown-attempt failure.
   */
  cancel(request: AuthorizationAttemptRequest): AuthorizationActionResult {
    const state = this.attempts.get(request.attemptId)
    if (state === undefined) return rejected('attempt-not-found', 'This sign-in attempt is no longer available.')
    state.controller.abort(new Error('authorization attempt cancelled by its browser'))
    this.withdrawPrompt(state, new Error('authorization attempt cancelled'))
    return OK
  }

  /**
   * Delete the local record for a registered flow; this does not revoke it at
   * the issuer.
   * @param request - registered credential key to forget.
   * @returns acknowledgement or a flow, activity, or writability failure.
   */
  async forget(request: AuthorizationForgetRequest): Promise<AuthorizationActionResult> {
    const entry = this.ctx.authorization.describe(request.key)
    if (entry === undefined) return rejected('flow-not-found', 'This sign-in flow is no longer available.')
    if (entry.inFlight) return rejected('already-in-flight', 'Cancel the running sign-in attempt first.')
    const info = await this.ctx.credentials.describeRecord(request.key)
    if (!info.writable) return rejected('record-read-only', 'This credential record is read-only.')
    await this.ctx.credentials.deleteRecord(request.key)
    return OK
  }

  /** Validate and dispatch one request from the authenticated Connection channel. */
  private readonly dispatch: ConnectionRpcHandler = async (endpoint, payload, signal) => {
    if (!isAuthorizationEndpoint(endpoint)) return badRequest()
    const parsed = authorizationRequestSchemas[endpoint].safeParse(payload)
    if (!parsed.success) return badRequest()
    try {
      const value = await this.invokeEndpoint(endpoint, parsed.data, signal)
      return { ok: true, value: authorizationValueSchemas[endpoint].parse(value) }
    } catch {
      if (signal.aborted) {
        return { ok: false, error: { code: 'cancelled', message: 'Authorization request was cancelled.', details: {} } }
      }
      this.ctx.logger.warn('authorization-remote: authenticated RPC request failed')
      return { ok: false, error: { code: 'internal', message: 'Authorization request failed.', details: {} } }
    }
  }

  /** Invoke one already validated endpoint without weakening its input type at the wire boundary. */
  private invokeEndpoint(
    endpoint: AuthorizationRpcEndpoint,
    request: unknown,
    signal: AbortSignal,
  ): unknown {
    switch (endpoint) {
      case 'list': return this.list()
      case 'start': return this.start(authorizationRequestSchemas.start.parse(request))
      case 'poll': return this.poll(authorizationRequestSchemas.poll.parse(request), signal)
      case 'answer': return this.answer(authorizationRequestSchemas.answer.parse(request))
      case 'cancel': return this.cancel(authorizationRequestSchemas.cancel.parse(request))
      case 'forget': return this.forget(authorizationRequestSchemas.forget.parse(request))
      /* v8 ignore next -- endpoint was narrowed from the closed runtime allowlist. */
      default: return endpoint satisfies never
    }
  }

  /** Run the generic seam and convert its terminal state to one safe event. */
  private async run(state: AttemptState, method: string | undefined): Promise<void> {
    try {
      const outcome = await this.ctx.authorization.begin({
        key: state.key,
        ...method === undefined ? {} : { method },
        signal: state.controller.signal,
        interaction: this.interaction(state),
      })
      this.finish(state, { kind: 'settled', status: outcome.status })
    } catch {
      this.ctx.logger.warn('authorization-remote: sign-in attempt for "%s" failed', state.key)
      this.finish(state, { kind: 'failed', message: 'The provider could not complete sign-in.' })
    }
  }

  /** Build the per-attempt interaction handed to the provider-owned flow. */
  private interaction(state: AttemptState): AuthorizationInteraction {
    return {
      notify: (notice) => { this.enqueue(state, safeNotice(notice)) },
      prompt: prompt => this.ask(state, prompt),
    }
  }

  /** Publish one prompt and await its one answer or Host-side withdrawal. */
  private ask(state: AttemptState, prompt: AuthorizationPrompt): Promise<string> {
    if (state.prompt !== undefined) {
      return Promise.reject(new Error('authorization-remote: a flow opened overlapping prompts'))
    }
    if (prompt.signal?.aborted === true) {
      return Promise.reject(abortError(prompt.signal, 'authorization prompt withdrawn'))
    }
    const id = randomUUID() as AuthorizationPromptId
    const view = promptView(prompt, id)
    return new Promise<string>((resolve, reject) => {
      const signal = prompt.signal
      if (signal === undefined) {
        state.prompt = { id, view, resolve, reject, signal, onAbort: undefined }
      } else {
        const onAbort = (): void => {
          this.withdrawPrompt(state, abortError(signal, 'authorization prompt withdrawn'))
        }
        state.prompt = { id, view, resolve, reject, signal, onAbort }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      this.enqueue(state, { kind: 'prompt', prompt: view })
    })
  }

  /** End an attempt, withdrawing any obsolete question before its terminal event. */
  private finish(state: AttemptState, event: AuthorizationAttemptEvent): void {
    /* v8 ignore next -- one run has one terminal continuation; the guard contains a misbehaving thenable. */
    if (state.terminal) return
    state.terminal = true
    /* v8 ignore next -- start arms this timer before run can reach its first terminal continuation. */
    if (state.orphanTimer !== undefined) clearTimeout(state.orphanTimer)
    state.orphanTimer = undefined
    this.withdrawPrompt(state, new Error('authorization attempt settled'))
    if (this.closing) return
    this.enqueue(state, event)
    if (this.attempts.has(state.id)) {
      state.completedTimer = setTimeout(() => { this.remove(state) }, this.config.completedRetentionMs)
    }
  }

  /** Queue an event or satisfy the one active poll immediately. */
  private enqueue(state: AttemptState, event: AuthorizationAttemptEvent): void {
    /* v8 ignore next -- late provider callbacks after teardown or attempt retirement are contained here. */
    if (this.closing || !this.attempts.has(state.id)) return
    const pending = state.poll
    if (pending === undefined) {
      state.events.push(event)
      return
    }
    this.clearPoll(state)
    pending.resolve(this.delivered(state, event))
  }

  /** Return one event and retire the attempt after its terminal update. */
  private delivered(state: AttemptState, event: AuthorizationAttemptEvent): AuthorizationPollResult {
    if (event.kind === 'settled' || event.kind === 'failed') this.remove(state)
    return success(event)
  }

  /** Reset abandonment timing only while the attempt is running. */
  private touch(state: AttemptState): void {
    if (state.terminal) return
    if (state.orphanTimer !== undefined) clearTimeout(state.orphanTimer)
    state.orphanTimer = setTimeout(() => {
      state.controller.abort(new Error('authorization browser stopped polling'))
      this.withdrawPrompt(state, new Error('authorization browser stopped polling'))
    }, this.config.orphanTimeoutMs)
  }

  /** Remove an active poll's timer and abort listener. */
  private clearPoll(state: AttemptState): void {
    const pending = state.poll
    if (pending === undefined) return
    clearTimeout(pending.timer)
    pending.signal.removeEventListener('abort', pending.onAbort)
    state.poll = undefined
  }

  /** Detach the active prompt without settling its promise. */
  private detachPrompt(state: AttemptState): PendingPrompt | undefined {
    const pending = state.prompt
    if (pending === undefined) return undefined
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener('abort', pending.onAbort)
    }
    state.prompt = undefined
    return pending
  }

  /** Reject and retract the active prompt. */
  private withdrawPrompt(state: AttemptState, error: Error): void {
    const pending = this.detachPrompt(state)
    if (pending === undefined) return
    this.enqueue(state, { kind: 'prompt-withdrawn', promptId: pending.id })
    pending.reject(error)
  }

  /** Forget one attempt and all of its timers. */
  private remove(state: AttemptState): void {
    /* v8 ignore next -- internal cleanup paths may converge and removal is idempotent. */
    if (!this.attempts.delete(state.id)) return
    if (state.completedTimer !== undefined) clearTimeout(state.completedTimer)
    this.clearPoll(state)
  }

  /** Close admission, cancel every owned attempt, and reach quiescence. */
  private async shutdown(): Promise<void> {
    /* v8 ignore next -- Cordis owns this disposer once, but cleanup remains idempotent. */
    if (this.closing) return
    this.closing = true
    const states = [...this.attempts.values()]
    for (const state of states) {
      state.controller.abort(new Error('authorization surface stopped'))
      this.withdrawPrompt(state, new Error('authorization surface stopped'))
      const pending = state.poll
      if (pending !== undefined) {
        this.clearPoll(state)
        pending.resolve(rejected('shutting-down', 'The authorization surface is shutting down.'))
      }
    }
    await Promise.all(states.map(state => state.running))
    for (const state of states) this.remove(state)
  }
}

export default AuthorizationRemoteService
