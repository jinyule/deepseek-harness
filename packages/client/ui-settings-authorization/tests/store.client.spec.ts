import type { AuthorizationClient } from '@deepseek-ai/dsh-authorization-remote/client'
import type { AuthorizationAttemptRequest } from '@deepseek-ai/dsh-authorization-remote/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { AuthorizationSettingsStore } from '../src/client/store.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const ATTEMPT = '00000000-0000-4000-8000-000000000000' as never
const PROMPT = '00000000-0000-4000-8000-000000000001' as never
const ENTRY = {
  key: KEY,
  label: 'ChatGPT (Codex)',
  methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
  inFlight: false,
  credential: { configured: false, writable: true },
} as const

/** Successful carrier plus successful business result. */
function accepted(): Promise<never> {
  return Promise.resolve({ ok: true, value: { ok: true, value: { accepted: true } } } as never)
}

/** A complete replaceable client with overridable method mocks. */
function remote(overrides: Partial<AuthorizationClient> = {}): AuthorizationClient {
  return {
    list: vi.fn(async () => ({ ok: true, value: { entries: [ENTRY] } } as const)),
    start: vi.fn(async () => ({ ok: true, value: { ok: true, value: { attemptId: ATTEMPT } } } as const)),
    poll: vi.fn(async () => ({ ok: true, value: { ok: true, value: { kind: 'idle' } } } as const)),
    answer: vi.fn(accepted),
    cancel: vi.fn(accepted),
    forget: vi.fn(accepted),
    ...overrides,
  }
}

/** Store with the production English dictionary unless a test selects another locale. */
function settingsStore(client: AuthorizationClient): AuthorizationSettingsStore {
  return new AuthorizationSettingsStore(client, makeTranslate(en))
}

describe('AuthorizationSettingsStore', () => {
  it('loads entries and drives a notice, prompt answer, and successful settlement', async () => {
    const terminal = Promise.withResolvers<never>()
    const list = vi.fn(async () => ({ ok: true, value: { entries: [ENTRY] } } as const))
    const answer = vi.fn(accepted)
    let polls = 0
    const api = remote({
      list,
      answer,
      poll: vi.fn(() => {
        polls += 1
        if (polls === 1) {
          return Promise.resolve({
            ok: true,
            value: { ok: true, value: { kind: 'notice', message: 'Open', url: 'https://auth.example' } },
          }) as never
        }
        if (polls === 2) {
          return Promise.resolve({
            ok: true,
            value: {
              ok: true,
              value: { kind: 'prompt', prompt: { id: PROMPT, kind: 'text', message: 'Paste code' } },
            },
          }) as never
        }
        return terminal.promise
      }),
    })
    const store = settingsStore(api)

    await expect(store.load()).resolves.toEqual({ ok: true })
    expect(store.store.getSnapshot()).toMatchObject({ status: 'ready', entries: [ENTRY] })
    await expect(store.start(KEY, 'oauth')).resolves.toEqual({ ok: true })
    await vi.waitFor(() => {
      expect(store.store.getSnapshot().attempts[KEY]).toMatchObject({
        status: 'running',
        notices: [{ kind: 'notice', message: 'Open' }],
        prompt: { id: PROMPT, kind: 'text' },
      })
    })
    await expect(store.answer(KEY, 'code')).resolves.toEqual({ ok: true })
    expect(answer).toHaveBeenCalledWith({ attemptId: ATTEMPT, promptId: PROMPT, value: 'code' })

    terminal.resolve({
      ok: true,
      value: { ok: true, value: { kind: 'settled', status: 'authorized' } },
    } as never)
    await vi.waitFor(() => {
      expect(store.store.getSnapshot().attempts[KEY]?.status).toBe('authorized')
    })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('renders prompt withdrawal and contains poll transport, business, and thrown failures', async () => {
    const cases = [
      { ok: false, error: { code: 'internal', message: 'offline', details: {} } },
      { ok: true, value: { ok: false, error: { code: 'attempt-not-found', message: 'gone' } } },
    ] as const
    for (const response of cases) {
      const api = remote({ poll: vi.fn(async () => response as never) })
      const store = settingsStore(api)
      await store.start(KEY)
      await vi.waitFor(() => { expect(store.store.getSnapshot().attempts[KEY]?.status).toBe('failed') })
    }

    const throwing = settingsStore(remote({
      poll: vi.fn(async () => { throw new Error('stream stopped') }),
    }))
    await throwing.start(KEY)
    await vi.waitFor(() => {
      expect(throwing.store.getSnapshot().attempts[KEY]).toMatchObject({ status: 'failed', error: 'stream stopped' })
    })

    let polls = 0
    const withdrawn = settingsStore(remote({
      poll: vi.fn(async () => {
        polls += 1
        if (polls === 1) {
          return {
            ok: true,
            value: {
              ok: true,
              value: { kind: 'prompt', prompt: { id: PROMPT, kind: 'secret', message: 'Key' } },
            },
          } as never
        }
        if (polls === 2) {
          return { ok: true, value: { ok: true, value: { kind: 'prompt-withdrawn', promptId: PROMPT } } } as never
        }
        return { ok: true, value: { ok: true, value: { kind: 'failed', message: 'provider failed' } } } as never
      }),
    }))
    await withdrawn.start(KEY)
    await vi.waitFor(() => {
      expect(withdrawn.store.getSnapshot().attempts[KEY]).toMatchObject({
        status: 'failed', prompt: undefined, error: 'provider failed',
      })
    })
  })

  it('reports action failures and propagates the reload result after forgetting', async () => {
    const outerFailure = { ok: false, error: { code: 'internal', message: 'carrier', details: {} } } as const
    const businessFailure = {
      ok: true,
      value: { ok: false, error: { code: 'already-in-flight', message: 'busy' } },
    } as const
    const store = settingsStore(remote({
      start: vi.fn()
        .mockResolvedValueOnce(outerFailure)
        .mockResolvedValueOnce(businessFailure)
        .mockRejectedValueOnce(new Error('start threw')),
      forget: vi.fn()
        .mockResolvedValueOnce(outerFailure)
        .mockResolvedValueOnce(businessFailure)
        .mockResolvedValueOnce({ ok: true, value: { ok: true, value: { accepted: true } } })
        .mockRejectedValueOnce(new Error('forget threw')),
      list: vi.fn()
        .mockResolvedValueOnce(outerFailure)
        .mockResolvedValueOnce({ ok: true, value: { entries: [] } }),
    }))

    await expect(store.start(KEY)).resolves.toEqual({ ok: false, message: 'carrier' })
    await expect(store.start(KEY)).resolves.toEqual({ ok: false, message: 'busy' })
    await expect(store.start(KEY)).resolves.toEqual({ ok: false, message: 'start threw' })
    await expect(store.forget(KEY)).resolves.toEqual({ ok: false, message: 'carrier' })
    await expect(store.forget(KEY)).resolves.toEqual({ ok: false, message: 'busy' })
    await expect(store.forget(KEY)).resolves.toEqual({ ok: false, message: 'carrier' })
    await expect(store.forget(KEY)).resolves.toEqual({ ok: false, message: 'forget threw' })

    const loadThrows = settingsStore(remote({
      list: vi.fn(async () => { throw new Error('load threw') }),
    }))
    await expect(loadThrows.load()).resolves.toEqual({ ok: false, message: 'load threw' })
    expect(loadThrows.store.getSnapshot()).toMatchObject({ status: 'error', error: 'load threw' })
  })

  it('handles inactive answers and cancellation, then cancels running work on disposal', async () => {
    const outerFailure = { ok: false, error: { code: 'internal', message: 'carrier', details: {} } } as const
    const businessFailure = {
      ok: true,
      value: { ok: false, error: { code: 'prompt-not-found', message: 'stale' } },
    } as const
    const never = Promise.withResolvers<never>()
    const api = remote({
      poll: vi.fn((_request: AuthorizationAttemptRequest, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        void never.promise
      })),
      answer: vi.fn()
        .mockResolvedValueOnce(outerFailure)
        .mockResolvedValueOnce(businessFailure)
        .mockRejectedValueOnce(new Error('answer threw')),
      cancel: vi.fn()
        .mockResolvedValueOnce(outerFailure)
        .mockResolvedValueOnce(businessFailure)
        .mockRejectedValueOnce(new Error('cancel threw'))
        .mockResolvedValue({ ok: true, value: { ok: true, value: { accepted: true } } }),
    })
    const store = settingsStore(api)
    await expect(store.answer(KEY, 'code')).resolves.toMatchObject({ ok: false })
    await expect(store.cancel(KEY)).resolves.toEqual({ ok: true })
    await store.start(KEY)
    const state = store.store.getSnapshot()
    store.store.set({
      ...state,
      attempts: {
        ...state.attempts,
        [KEY]: { ...state.attempts[KEY]!, prompt: { id: PROMPT, kind: 'text', message: 'Code' } },
      },
    })
    await expect(store.answer(KEY, 'one')).resolves.toEqual({ ok: false, message: 'carrier' })
    await expect(store.answer(KEY, 'two')).resolves.toEqual({ ok: false, message: 'stale' })
    await expect(store.answer(KEY, 'three')).resolves.toEqual({ ok: false, message: 'answer threw' })
    await expect(store.cancel(KEY)).resolves.toEqual({ ok: false, message: 'carrier' })
    await expect(store.cancel(KEY)).resolves.toEqual({ ok: false, message: 'stale' })
    await expect(store.cancel(KEY)).resolves.toEqual({ ok: false, message: 'cancel threw' })
    await store.dispose()
    await expect(store.load()).resolves.toMatchObject({ ok: false })
    await store.dispose()
  })

  it('contains non-Error failures and ignores late work after disposal', async () => {
    const loading = Promise.withResolvers<never>()
    const late = settingsStore(remote({ list: vi.fn(() => loading.promise) }))
    const load = late.load()
    await Promise.resolve()
    await late.dispose()
    loading.resolve({ ok: true, value: { entries: [ENTRY] } } as never)
    await expect(load).resolves.toEqual({ ok: true })

    const failing = Promise.withResolvers<never>()
    const lateFailure = settingsStore(remote({ list: vi.fn(() => failing.promise) }))
    const failedLoad = lateFailure.load()
    await Promise.resolve()
    await lateFailure.dispose()
    failing.reject('not an Error')
    await expect(failedLoad).resolves.toEqual({
      ok: false,
      message: 'Authorization settings could not be loaded.',
    })

    const localized = new AuthorizationSettingsStore(
      remote({ list: vi.fn(async () => { throw null }) }),
      makeTranslate(zh),
    )
    await expect(localized.load()).resolves.toEqual({ ok: false, message: '无法加载授权设置。' })

    const nonErrors = settingsStore(remote({
      start: vi.fn(async () => { throw null }),
      answer: vi.fn(async () => { throw null }),
      cancel: vi.fn(async () => { throw null }),
      forget: vi.fn(async () => { throw null }),
      poll: vi.fn(async () => { throw null }),
    }))
    await expect(nonErrors.start(KEY)).resolves.toEqual({ ok: false, message: 'Sign-in could not be started.' })
    nonErrors.store.set({
      status: 'ready',
      entries: [ENTRY],
      attempts: {
        [KEY]: {
          id: ATTEMPT,
          status: 'running',
          notices: [],
          prompt: { id: PROMPT, kind: 'text', message: 'Code' },
        },
      },
    })
    await expect(nonErrors.answer(KEY, 'x')).resolves.toEqual({ ok: false, message: 'The answer could not be sent.' })
    await expect(nonErrors.cancel(KEY)).resolves.toEqual({ ok: false, message: 'Sign-in could not be cancelled.' })
    await expect(nonErrors.forget(KEY)).resolves.toEqual({ ok: false, message: 'The local credential could not be removed.' })

    const pollNonError = settingsStore(remote({
      poll: vi.fn(async () => { throw null }),
    }))
    await pollNonError.start(KEY)
    await vi.waitFor(() => {
      expect(pollNonError.store.getSnapshot().attempts[KEY]).toMatchObject({
        status: 'failed', error: 'Sign-in updates stopped.',
      })
    })

    const cancelling = settingsStore(remote({
      poll: vi.fn((_request: AuthorizationAttemptRequest, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('poll stopped')) }, { once: true })
      })),
      cancel: vi.fn(async () => { throw new Error('ignored during disposal') }),
    }))
    await cancelling.start(KEY)
    await cancelling.dispose()

    const internals = settingsStore(remote())
    const applyEvent = Reflect.get(internals, 'applyEvent') as (key: typeof KEY, event: object) => boolean
    const failAttempt = Reflect.get(internals, 'failAttempt') as (key: typeof KEY, message: string) => void
    expect(Reflect.apply(applyEvent, internals, [KEY, { kind: 'idle' }])).toBe(true)
    internals.store.set({
      status: 'ready',
      entries: [ENTRY],
      attempts: {
        [KEY]: {
          id: ATTEMPT,
          status: 'running',
          notices: [],
          prompt: { id: PROMPT, kind: 'text', message: 'Code' },
        },
      },
    })
    expect(Reflect.apply(applyEvent, internals, [KEY, { kind: 'idle' }])).toBe(false)
    expect(Reflect.apply(applyEvent, internals, [KEY, {
      kind: 'prompt-withdrawn', promptId: '00000000-0000-4000-8000-000000000099',
    }])).toBe(false)
    await expect(internals.cancel(KEY)).resolves.toEqual({ ok: true })
    Reflect.apply(failAttempt, internals, [credentialKey('llm-pi-ai', 'missing'), 'missing'])
    Reflect.apply(failAttempt, internals, [KEY, 'missing'])
    await internals.dispose()
    const replaceAttempt = Reflect.get(internals, 'replaceAttempt') as (key: typeof KEY, attempt: object) => void
    Reflect.apply(replaceAttempt, internals, [KEY, { id: ATTEMPT, status: 'running', notices: [] }])
  })
})
