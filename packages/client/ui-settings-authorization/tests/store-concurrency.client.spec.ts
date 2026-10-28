import { setImmediate } from 'node:timers/promises'
import type { AuthorizationClient } from '@deepseek-ai/dsh-authorization-remote/client'
import type { AuthorizationAttemptEvent, AuthorizationAttemptId, AuthorizationPromptId } from '@deepseek-ai/dsh-authorization-remote/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { en } from '../src/client/locales.ts'
import { AuthorizationSettingsStore } from '../src/client/store.ts'

const KEY = credentialKey('test', 'first')
const OTHER = credentialKey('test', 'second')
const FIRST = '00000000-0000-4000-8000-000000000001' as AuthorizationAttemptId
const SECOND = '00000000-0000-4000-8000-000000000002' as AuthorizationAttemptId
const PROMPT = '00000000-0000-4000-8000-000000000003' as AuthorizationPromptId
const NEXT_PROMPT = '00000000-0000-4000-8000-000000000004' as AuthorizationPromptId
type ListResult = Awaited<ReturnType<AuthorizationClient['list']>>
type StartResult = Awaited<ReturnType<AuthorizationClient['start']>>
type PollResult = Awaited<ReturnType<AuthorizationClient['poll']>>
type ActionResult = Awaited<ReturnType<AuthorizationClient['cancel']>>

const ACCEPTED: ActionResult = { ok: true, value: { ok: true, value: { accepted: true } } }
const LISTED: ListResult = { ok: true, value: { entries: [] } }
const REFUSED = { ok: false, error: { code: 'internal', message: 'offline', details: {} } } as const

function admitted(attemptId: AuthorizationAttemptId): StartResult {
  return { ok: true, value: { ok: true, value: { attemptId } } }
}

function event(value: AuthorizationAttemptEvent): PollResult {
  return { ok: true, value: { ok: true, value } }
}

/** Keep each poll pending until its event is supplied or the controller aborts it. */
function bench() {
  const releases: (() => void)[] = []
  const replies: ReturnType<typeof Promise.withResolvers<PollResult>>[] = []
  const list = vi.fn<AuthorizationClient['list']>(async () => LISTED)
  const start = vi.fn<AuthorizationClient['start']>(async () => admitted(FIRST))
  const answer = vi.fn<AuthorizationClient['answer']>(async () => ACCEPTED)
  const cancel = vi.fn<AuthorizationClient['cancel']>(async () => ACCEPTED)
  const poll = vi.fn<AuthorizationClient['poll']>((_request, signal) => {
    const reply = Promise.withResolvers<PollResult>()
    replies.push(reply)
    const aborted = (): void => { reply.reject(new Error('poll stopped')) }
    signal?.addEventListener('abort', aborted, { once: true })
    return reply.promise.finally(() => { signal?.removeEventListener('abort', aborted) })
  })
  const client = { list, start, poll, answer, cancel, forget: vi.fn<AuthorizationClient['forget']>(async () => ACCEPTED) }
  const store = new AuthorizationSettingsStore(client, makeTranslate(en))
  onTestFinished(async () => {
    for (const release of releases) release()
    await store.dispose().catch(() => {})
  })
  return { store, client, replies, release: (callback: () => void) => { releases.push(callback) } }
}

describe('authorization settings concurrent replies', () => {
  it.each(['success', 'refusal', 'throw'] as const)('preserves prompts and newly admitted attempts when a pending list ends with %s', async (outcome) => {
    const b = bench()
    const listing = Promise.withResolvers<ListResult>()
    b.client.list.mockReturnValueOnce(listing.promise)
    b.release(() => { listing.resolve(LISTED) })
    await b.store.start(KEY)
    const load = b.store.load()
    b.replies[0]!.resolve(event({ kind: 'prompt', prompt: { id: PROMPT, kind: 'text', message: 'Code' } }))
    await vi.waitFor(() => { expect(b.store.store.getSnapshot().attempts[KEY]?.prompt?.id).toBe(PROMPT) })
    b.client.start.mockResolvedValueOnce(admitted(SECOND))
    await b.store.start(OTHER)
    if (outcome === 'throw') listing.reject(new Error('list stopped'))
    else listing.resolve(outcome === 'success' ? LISTED : REFUSED)
    await load
    expect(b.store.store.getSnapshot().attempts[KEY]?.prompt?.id).toBe(PROMPT)
    expect(b.store.store.getSnapshot().attempts[OTHER]?.id).toBe(SECOND)
  })

  it.each(['success', 'refusal', 'throw'] as const)('ignores an older list %s after a newer list and permits a later refresh', async (outcome) => {
    const b = bench()
    const older = Promise.withResolvers<ListResult>()
    const newer = Promise.withResolvers<ListResult>()
    b.release(() => { older.resolve(LISTED); newer.resolve(LISTED) })
    b.client.list.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const first = b.store.load()
    const second = b.store.load()
    newer.resolve(LISTED)
    await second
    const ready = b.store.store.getSnapshot()
    if (outcome === 'throw') older.reject(new Error('older list stopped'))
    else older.resolve(outcome === 'success' ? { ok: true, value: { entries: [{
      key: KEY, label: 'Old account', methods: [], inFlight: false, credential: { configured: false, writable: true },
    }] } } : REFUSED)
    await first
    expect(b.store.store.getSnapshot()).toEqual(ready)
    b.client.list.mockResolvedValueOnce({ ok: true, value: { entries: [{
      key: OTHER, label: 'Fresh account', methods: [], inFlight: false, credential: { configured: true, writable: true },
    }] } })
    await b.store.load()
    expect(b.store.store.getSnapshot().entries[0]?.key).toBe(OTHER)
  })

  it.each(['success', 'refusal', 'throw'] as const)('does not publish a list %s after disposal', async (outcome) => {
    const b = bench()
    const listing = Promise.withResolvers<ListResult>()
    b.release(() => { listing.resolve(LISTED) })
    b.client.list.mockReturnValueOnce(listing.promise)
    const load = b.store.load()
    await b.store.dispose()
    const snapshot = b.store.store.getSnapshot()
    if (outcome === 'throw') listing.reject(new Error('late list stopped'))
    else listing.resolve(outcome === 'success' ? LISTED : REFUSED)
    await load
    expect(b.store.store.getSnapshot()).toEqual(snapshot)
  })

  it.each(['prompt', 'notice', 'authorized', 'cancelled', 'failed', 'replacement'] as const)('preserves a poll %s received before an older answer acknowledgment', async (update) => {
    const b = bench()
    const acknowledgment = Promise.withResolvers<ActionResult>()
    b.release(() => { acknowledgment.resolve(ACCEPTED) })
    await b.store.start(KEY)
    b.replies[0]!.resolve(event({ kind: 'prompt', prompt: { id: PROMPT, kind: 'text', message: 'First code' } }))
    await vi.waitFor(() => { expect(b.store.store.getSnapshot().attempts[KEY]?.prompt?.id).toBe(PROMPT) })
    b.client.answer.mockReturnValueOnce(acknowledgment.promise)
    const answer = b.store.answer(KEY, 'value')
    const next: AuthorizationAttemptEvent = update === 'prompt'
      ? { kind: 'prompt', prompt: { id: NEXT_PROMPT, kind: 'text', message: 'Next code' } }
      : update === 'notice'
        ? { kind: 'notice', message: 'Response accepted' }
        : update === 'failed' ? { kind: 'failed', message: 'Provider stopped' }
          : { kind: 'settled', status: update === 'cancelled' ? 'cancelled' : 'authorized' }
    b.replies[1]!.resolve(event(next))
    await vi.waitFor(() => {
      const attempt = b.store.store.getSnapshot().attempts[KEY]!
      if (update === 'prompt') expect(attempt.prompt?.id).toBe(NEXT_PROMPT)
      else if (update === 'notice') expect(attempt.notices).toHaveLength(1)
      else expect(attempt.status).toBe(update === 'replacement' ? 'authorized' : update)
    })
    if (update === 'replacement') {
      b.client.start.mockResolvedValueOnce(admitted(SECOND))
      await b.store.start(KEY)
    }
    const before = b.store.store.getSnapshot().attempts[KEY]!
    acknowledgment.resolve(ACCEPTED)
    await answer
    expect(b.store.store.getSnapshot().attempts[KEY]).toEqual(update === 'notice' ? { ...before, prompt: undefined } : before)
  })

  it('waits for a pending start and its exact cancellation, shares disposal completion, and closes start admission', async () => {
    const b = bench()
    const starting = Promise.withResolvers<StartResult>()
    const cancelling = Promise.withResolvers<ActionResult>()
    b.release(() => { starting.resolve(admitted(FIRST)); cancelling.resolve(ACCEPTED) })
    b.client.start.mockReturnValueOnce(starting.promise)
    b.client.cancel.mockReturnValueOnce(cancelling.promise)
    const start = b.store.start(KEY)
    const first = b.store.dispose()
    const second = b.store.dispose()
    let disposed = false
    void first.then(() => { disposed = true })
    await setImmediate()
    expect(disposed).toBe(false)
    await expect(b.store.start(OTHER)).resolves.toMatchObject({ ok: false })
    await expect(b.store.cancel(KEY)).resolves.toMatchObject({ ok: false })
    expect(b.client.start).toHaveBeenCalledOnce()
    starting.resolve(admitted(FIRST))
    await vi.waitFor(() => { expect(b.client.cancel).toHaveBeenCalledExactlyOnceWith({ attemptId: FIRST }) })
    await setImmediate()
    expect(disposed).toBe(false)
    cancelling.resolve(ACCEPTED)
    await Promise.all([start, first, second])
    expect(b.client.poll).not.toHaveBeenCalled()
    expect(b.store.dispose()).toBe(first)
  })

  it.each(['refusal', 'business refusal', 'throw'] as const)('waits for a pending start %s without cancelling an unadmitted attempt', async (outcome) => {
    const b = bench()
    const starting = Promise.withResolvers<StartResult>()
    b.release(() => { starting.resolve(REFUSED) })
    b.client.start.mockReturnValueOnce(starting.promise)
    const start = b.store.start(KEY)
    const disposing = b.store.dispose()
    let disposed = false
    void disposing.then(() => { disposed = true })
    await setImmediate()
    expect(disposed).toBe(false)
    if (outcome === 'throw') starting.reject(new Error('start stopped'))
    else starting.resolve(outcome === 'refusal' ? REFUSED : { ok: true, value: {
      ok: false, error: { code: 'already-in-flight', message: 'busy' },
    } })
    await expect(start).resolves.toMatchObject({ ok: false })
    await disposing
    expect(b.client.cancel).not.toHaveBeenCalled()
  })

  it('joins an existing cancellation while aborting and draining its poll', async () => {
    const b = bench()
    const cancelling = Promise.withResolvers<ActionResult>()
    b.release(() => { cancelling.resolve(ACCEPTED) })
    await b.store.start(KEY)
    b.client.cancel.mockReturnValueOnce(cancelling.promise)
    const cancellation = b.store.cancel(KEY)
    const disposing = b.store.dispose()
    let disposed = false
    void disposing.then(() => { disposed = true })
    await setImmediate()
    expect(disposed).toBe(false)
    expect(b.client.cancel).toHaveBeenCalledExactlyOnceWith({ attemptId: FIRST })
    cancelling.resolve(ACCEPTED)
    await Promise.all([cancellation, disposing])
  })

  it.each(['transport', 'business', 'throw', 'non-error'] as const)('reports a late admitted start cancellation %s after draining it', async (failure) => {
    const b = bench()
    const starting = Promise.withResolvers<StartResult>()
    b.release(() => { starting.resolve(REFUSED) })
    b.client.start.mockReturnValueOnce(starting.promise)
    if (failure === 'transport') b.client.cancel.mockResolvedValueOnce(REFUSED)
    else if (failure === 'business') b.client.cancel.mockResolvedValueOnce({
      ok: true, value: { ok: false, error: { code: 'attempt-not-found', message: 'gone' } },
    })
    else b.client.cancel.mockRejectedValueOnce(failure === 'throw' ? new Error('cancel stopped') : null)
    const start = b.store.start(KEY)
    const disposed = b.store.dispose().then(() => undefined, (error: unknown) => error)
    starting.resolve(admitted(FIRST))
    await expect(start).resolves.toMatchObject({ ok: false })
    expect(await disposed).toBeInstanceOf(AggregateError)
    expect(b.client.cancel).toHaveBeenCalledExactlyOnceWith({ attemptId: FIRST })
    expect(b.client.poll).not.toHaveBeenCalled()
  })

  it('waits for other cancellations and polls before reporting a cleanup failure', async () => {
    const b = bench()
    const cancelling = Promise.withResolvers<ActionResult>()
    b.release(() => { cancelling.resolve(ACCEPTED) })
    await b.store.start(KEY)
    b.client.start.mockResolvedValueOnce(admitted(SECOND))
    await b.store.start(OTHER)
    b.client.cancel.mockResolvedValueOnce(REFUSED).mockReturnValueOnce(cancelling.promise)
    let disposed = false
    const result = b.store.dispose().then(() => undefined, (error: unknown) => { disposed = true; return error })
    await setImmediate()
    expect(disposed).toBe(false)
    cancelling.resolve(ACCEPTED)
    expect(await result).toBeInstanceOf(AggregateError)
    expect(b.client.cancel).toHaveBeenCalledTimes(2)
  })
})
