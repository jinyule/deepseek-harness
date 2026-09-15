import { Context } from '@deepseek-ai/cordis'
import type { AuthorizationInteraction, AuthorizationOutcome } from '@deepseek-ai/dsh-authorization'
import { credentialKey, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuthorizationRemoteService, { type Config } from '../src/index.ts'
import type {
  AuthorizationAttemptId,
  AuthorizationPollResult,
  AuthorizationStartResult,
} from '../src/types.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const OTHER = credentialKey('llm-pi-ai', 'anthropic')
const CONFIG: Config = {
  pollTimeoutMs: 20,
  orphanTimeoutMs: 100,
  completedRetentionMs: 50,
  maxPromptResponseBytes: 4,
}

interface Harness {
  readonly ctx: Context
  readonly fiber: ReturnType<Context['plugin']>
  readonly service: AuthorizationRemoteService
  readonly call: ConnectionRpcHandler
  readonly channel: string
  readonly credentials: {
    describeRecord: ReturnType<typeof vi.fn>
    deleteRecord: ReturnType<typeof vi.fn>
  }
}

interface HarnessOptions {
  readonly entry?: {
    readonly key: CredentialKey
    readonly label: string
    readonly methods: readonly { readonly id: string; readonly label: string }[]
    readonly inFlight: boolean
  }
  readonly begin?: (request: {
    readonly key: CredentialKey
    readonly method?: string
    readonly signal: AbortSignal
    readonly interaction: AuthorizationInteraction
  }) => Promise<AuthorizationOutcome>
  readonly writable?: boolean
}

const contexts: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

/** Mount the plugin over replaceable in-memory seams and capture its channel. */
async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const ctx = new Context()
  contexts.push(ctx)
  const entry = options.entry ?? {
    key: KEY,
    label: 'ChatGPT (Codex)',
    methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
    inFlight: false,
  }
  const credentials = {
    describeRecord: vi.fn(async (key: CredentialKey) => ({
      configured: key === KEY,
      kind: key === KEY ? 'grant' as const : undefined,
      writable: options.writable ?? true,
    })),
    deleteRecord: vi.fn(async () => {}),
  }
  ctx.provide('credentials', credentials as never)
  ctx.provide('authorization', {
    list: () => [entry],
    describe: (key: CredentialKey) => key === entry.key ? entry : undefined,
    begin: options.begin ?? (async () => ({ status: 'authorized' as const })),
  } as never)
  let call: ConnectionRpcHandler | undefined
  let channel: string | undefined
  const connection = {
    rpc: {
      handle: (registeredChannel: string, handler: ConnectionRpcHandler) => {
        call = handler
        channel = registeredChannel
        return async () => {}
      },
      intercept: () => async () => {},
    },
  } as unknown as HostConnectionHandle
  ctx.provide('connection', connection)
  ctx.provide('webServer', {} as never)
  const fiber = ctx.plugin(AuthorizationRemoteService, CONFIG)
  await fiber
  return {
    ctx,
    fiber,
    service: ctx.authorizationRemote,
    call: call!,
    channel: channel!,
    credentials,
  }
}

/** Extract a successful start result from the business envelope. */
function attemptOf(result: AuthorizationStartResult): AuthorizationAttemptId {
  if (!result.ok) throw new Error(result.error.message)
  return result.value.attemptId
}

/** Extract a successful polled event from the business envelope. */
function eventOf(result: AuthorizationPollResult): Extract<AuthorizationPollResult, { readonly ok: true }>['value'] {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe('authenticated authorization RPC', () => {
  it('registers its private channel, validates requests, and returns only credential metadata', async () => {
    const app = await harness()
    expect(app.channel).toBe('/authorization')

    await expect(app.call('missing', {}, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'bad-request', message: 'Invalid authorization request.' },
    })
    await expect(app.call('list', { extra: true }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
    await expect(app.call('list', {}, new AbortController().signal)).resolves.toEqual({
      ok: true,
      value: {
        entries: [{
          key: KEY,
          label: 'ChatGPT (Codex)',
          methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
          inFlight: false,
          credential: { configured: true, kind: 'grant', writable: true },
        }],
      },
    })
    expect(app.credentials.describeRecord).toHaveBeenCalledWith(KEY)

    const started = await app.call('start', { key: KEY }, new AbortController().signal)
    expect(started).toMatchObject({ ok: true, value: { ok: true } })
    if (!started.ok || typeof started.value !== 'object' || started.value === null) throw new Error('expected start')
    const startValue = started.value as { ok: true; value: { attemptId: AuthorizationAttemptId } }
    await expect(app.call('answer', {
      attemptId: startValue.value.attemptId,
      promptId: '00000000-0000-4000-8000-000000000001',
      value: 'x',
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true, value: { ok: false, error: { code: 'prompt-not-found' } },
    })
    await expect(app.call('cancel', {
      attemptId: startValue.value.attemptId,
    }, new AbortController().signal)).resolves.toMatchObject({ ok: true })
    await expect(app.call('forget', { key: KEY }, new AbortController().signal)).resolves.toMatchObject({ ok: true })
  })

  it('contains handler failures and reports caller cancellation without logging supplied values', async () => {
    const app = await harness()
    app.credentials.describeRecord.mockRejectedValueOnce(new Error('store-secret'))
    const warn = vi.spyOn(app.ctx.logger, 'warn').mockImplementation(() => app.ctx.logger)
    await expect(app.call('list', {}, new AbortController().signal)).resolves.toEqual({
      ok: false,
      error: { code: 'internal', message: 'Authorization request failed.', details: {} },
    })
    expect(warn).toHaveBeenCalledWith('authorization-remote: authenticated RPC request failed')

    const attemptId = attemptOf(app.service.start({ key: KEY }))
    const controller = new AbortController()
    controller.abort()
    await expect(app.call('poll', { attemptId }, controller.signal)).resolves.toEqual({
      ok: false,
      error: { code: 'cancelled', message: 'Authorization request was cancelled.', details: {} },
    })

    const polling = await harness({
      begin: ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
      }),
    })
    const active = attemptOf(polling.service.start({ key: KEY }))
    const withdrawn = new AbortController()
    const waiting = polling.service.poll({ attemptId: active }, withdrawn.signal)
    withdrawn.abort(new Error('caller left'))
    await expect(waiting).rejects.toThrow('caller left')
  })
})

describe('authorization attempt projection', () => {
  it('relays safe notices and a select prompt, validates its answer, and retires after settlement', async () => {
    const answer = Promise.withResolvers<string>()
    const app = await harness({
      begin: async ({ interaction }) => {
        interaction.notify({ message: 'Preparing' })
        interaction.notify({ message: 'Preparing code', code: 'EFGH' })
        interaction.notify({ message: 'Open', url: 'https://auth.example/start', code: 'ABCD' })
        interaction.notify({ message: 'Open without code', url: 'https://auth.example/continue' })
        interaction.notify({ message: 'Unsafe', url: 'file:///tmp/token' })
        interaction.notify({ message: 'Unsafe code', url: 'not a url', code: 'IJKL' })
        answer.resolve(await interaction.prompt({
          kind: 'select',
          message: 'Choose account',
          options: [
            { id: 'work', label: 'Work', description: 'Company account' },
            { id: 'personal', label: 'Personal' },
          ],
        }))
        return { status: 'authorized' }
      },
    })
    const attemptId = attemptOf(app.service.start({ key: KEY, method: 'oauth' }))
    const signal = new AbortController().signal

    expect(eventOf(await app.service.poll({ attemptId }, signal))).toEqual({ kind: 'notice', message: 'Preparing' })
    expect(eventOf(await app.service.poll({ attemptId }, signal))).toEqual({
      kind: 'notice', message: 'Preparing code', code: 'EFGH',
    })
    expect(eventOf(await app.service.poll({ attemptId }, signal))).toEqual({
      kind: 'notice', message: 'Open', url: 'https://auth.example/start', code: 'ABCD',
    })
    expect(eventOf(await app.service.poll({ attemptId }, signal))).toEqual({
      kind: 'notice', message: 'Open without code', url: 'https://auth.example/continue',
    })
    expect(eventOf(await app.service.poll({ attemptId }, signal))).toEqual({
      kind: 'notice', message: 'Unsafe', urlRejected: true,
    })
    expect(eventOf(await app.service.poll({ attemptId }, signal))).toEqual({
      kind: 'notice', message: 'Unsafe code', code: 'IJKL', urlRejected: true,
    })
    const prompt = eventOf(await app.service.poll({ attemptId }, signal))
    expect(prompt).toMatchObject({ kind: 'prompt', prompt: { kind: 'select', message: 'Choose account' } })
    if (prompt.kind !== 'prompt') throw new Error('expected prompt')

    expect(app.service.answer({ attemptId, promptId: prompt.prompt.id, value: 'other' })).toMatchObject({
      ok: false, error: { code: 'invalid-option' },
    })
    expect(app.service.answer({ attemptId, promptId: prompt.prompt.id, value: 'xxxxx' })).toMatchObject({
      ok: false, error: { code: 'invalid-option' },
    })
    expect(app.service.answer({ attemptId, promptId: prompt.prompt.id, value: 'work' })).toEqual({
      ok: true, value: { accepted: true },
    })
    await expect(answer.promise).resolves.toBe('work')
    expect(eventOf(await app.service.poll({ attemptId }, signal))).toEqual({ kind: 'settled', status: 'authorized' })
    await expect(app.service.poll({ attemptId }, signal)).resolves.toMatchObject({
      ok: false, error: { code: 'attempt-not-found' },
    })
  })

  it('bounds free-form answers and supports prompt withdrawal before terminal failure', async () => {
    const promptController = new AbortController()
    const app = await harness({
      begin: async ({ interaction }) => {
        const pending = interaction.prompt({
          kind: 'secret',
          message: 'Paste key',
          placeholder: 'secret',
          signal: promptController.signal,
        })
        await pending
        return { status: 'authorized' }
      },
    })
    const attemptId = attemptOf(app.service.start({ key: KEY }))
    const signal = new AbortController().signal
    const prompt = eventOf(await app.service.poll({ attemptId }, signal))
    if (prompt.kind !== 'prompt') throw new Error('expected prompt')
    expect(app.service.answer({ attemptId, promptId: prompt.prompt.id, value: '12345' })).toMatchObject({
      ok: false,
      error: { code: 'answer-too-large' },
    })
    promptController.abort('browser callback won')
    expect(eventOf(await app.service.poll({ attemptId }, signal))).toEqual({
      kind: 'prompt-withdrawn', promptId: prompt.prompt.id,
    })
    expect(eventOf(await app.service.poll({ attemptId }, signal))).toEqual({
      kind: 'failed', message: 'The provider could not complete sign-in.',
    })
  })

  it('fails overlapping and already-withdrawn provider prompts without wedging their attempt', async () => {
    const overlap = await harness({
      begin: async ({ interaction }) => {
        void interaction.prompt({ kind: 'text', message: 'First' }).catch(() => undefined)
        await interaction.prompt({ kind: 'text', message: 'Second' })
        return { status: 'authorized' }
      },
    })
    const overlapId = attemptOf(overlap.service.start({ key: KEY }))
    const signal = new AbortController().signal
    const first = eventOf(await overlap.service.poll({ attemptId: overlapId }, signal))
    expect(first).toMatchObject({ kind: 'prompt', prompt: { kind: 'text', message: 'First' } })
    if (first.kind !== 'prompt') throw new Error('expected first prompt')
    expect(eventOf(await overlap.service.poll({ attemptId: overlapId }, signal))).toEqual({
      kind: 'prompt-withdrawn', promptId: first.prompt.id,
    })
    expect(eventOf(await overlap.service.poll({ attemptId: overlapId }, signal))).toMatchObject({ kind: 'failed' })

    const withdrawn = await harness({
      begin: async ({ interaction }) => {
        await interaction.prompt({
          kind: 'text',
          message: 'Already gone',
          signal: AbortSignal.abort({ reason: 'callback won' }),
        })
        return { status: 'authorized' }
      },
    })
    const withdrawnId = attemptOf(withdrawn.service.start({ key: KEY }))
    expect(eventOf(await withdrawn.service.poll({ attemptId: withdrawnId }, signal))).toMatchObject({ kind: 'failed' })
  })

  it('returns stable admission, addressing, and forget failures', async () => {
    const busy = await harness({
      entry: {
        key: KEY,
        label: 'ChatGPT (Codex)',
        methods: [{ id: 'oauth', label: 'OAuth' }],
        inFlight: true,
      },
      writable: false,
    })
    expect(busy.service.start({ key: OTHER })).toMatchObject({ ok: false, error: { code: 'flow-not-found' } })
    expect(busy.service.start({ key: KEY, method: 'key' })).toMatchObject({ ok: false, error: { code: 'method-not-found' } })
    expect(busy.service.start({ key: KEY })).toMatchObject({ ok: false, error: { code: 'already-in-flight' } })
    expect(busy.service.answer({
      attemptId: '00000000-0000-4000-8000-000000000000' as never,
      promptId: '00000000-0000-4000-8000-000000000001' as never,
      value: 'x',
    })).toMatchObject({ ok: false, error: { code: 'attempt-not-found' } })
    expect(busy.service.cancel({ attemptId: '00000000-0000-4000-8000-000000000000' as never }))
      .toMatchObject({ ok: false, error: { code: 'attempt-not-found' } })
    await expect(busy.service.forget({ key: OTHER })).resolves.toMatchObject({ ok: false, error: { code: 'flow-not-found' } })
    await expect(busy.service.forget({ key: KEY })).resolves.toMatchObject({ ok: false, error: { code: 'already-in-flight' } })

    const readOnly = await harness({ writable: false })
    await expect(readOnly.service.forget({ key: KEY })).resolves.toMatchObject({
      ok: false, error: { code: 'record-read-only' },
    })
    const writable = await harness()
    await expect(writable.service.forget({ key: KEY })).resolves.toEqual({ ok: true, value: { accepted: true } })
    expect(writable.credentials.deleteRecord).toHaveBeenCalledWith(KEY)
  })

  it('enforces one poll, emits idle heartbeats, and cancels a running attempt', async () => {
    vi.useFakeTimers()
    const app = await harness({
      begin: ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
      }),
    })
    const attemptId = attemptOf(app.service.start({ key: KEY }))
    expect(app.service.answer({
      attemptId,
      promptId: '00000000-0000-4000-8000-000000000001' as never,
      value: 'x',
    })).toMatchObject({ ok: false, error: { code: 'prompt-not-found' } })
    const signal = new AbortController().signal
    const first = app.service.poll({ attemptId }, signal)
    await expect(app.service.poll({ attemptId }, signal)).resolves.toMatchObject({
      ok: false, error: { code: 'poll-in-flight' },
    })
    await vi.advanceTimersByTimeAsync(CONFIG.pollTimeoutMs)
    await expect(first).resolves.toEqual({ ok: true, value: { kind: 'idle' } })
    expect(app.service.cancel({ attemptId })).toEqual({ ok: true, value: { accepted: true } })
    await vi.runAllTimersAsync()
    await expect(app.service.poll({ attemptId }, signal)).resolves.toMatchObject({
      ok: false, error: { code: 'attempt-not-found' },
    })
  })

  it('cancels abandoned attempts and closes owned work during teardown', async () => {
    vi.useFakeTimers()
    const app = await harness({
      begin: ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
      }),
    })
    const abandoned = attemptOf(app.service.start({ key: KEY }))
    await vi.advanceTimersByTimeAsync(CONFIG.orphanTimeoutMs)
    expect(eventOf(await app.service.poll({ attemptId: abandoned }, new AbortController().signal)))
      .toEqual({ kind: 'settled', status: 'cancelled' })

    const running = attemptOf(app.service.start({ key: KEY }))
    const poll = app.service.poll({ attemptId: running }, new AbortController().signal)
    await app.fiber.dispose()
    await expect(poll).resolves.toMatchObject({ ok: false, error: { code: 'shutting-down' } })
    expect(app.service.start({ key: KEY })).toMatchObject({ ok: false, error: { code: 'shutting-down' } })
  })

  it('rejects a configuration whose poll heartbeat cannot precede abandonment', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('credentials', {} as never)
    ctx.provide('authorization', {} as never)
    ctx.provide('connection', {} as never)
    ctx.provide('webServer', {} as never)
    await expect(ctx.plugin(AuthorizationRemoteService, {
      ...CONFIG,
      pollTimeoutMs: CONFIG.orphanTimeoutMs,
    })).rejects.toThrow('pollTimeoutMs must be less than orphanTimeoutMs')
  })
})
