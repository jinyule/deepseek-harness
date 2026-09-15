import { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const ATTEMPT = '00000000-0000-4000-8000-000000000000' as never
const PROMPT = '00000000-0000-4000-8000-000000000001' as never

/** Provide one fake Connection and install the browser bridge. */
function harness(result: (endpoint: string) => RpcResult<unknown>): {
  readonly ctx: Context
  readonly call: ReturnType<typeof vi.fn>
} {
  const ctx = new Context()
  const call = vi.fn(async (_channel: string, endpoint: string) => result(endpoint))
  ctx.provide('connection', { rpc: { call } } as unknown as ConnectionHandle)
  apply(ctx)
  return { ctx, call }
}

describe('authorization client bridge', () => {
  it('projects every method through the private channel and validates returned values', async () => {
    const app = harness((endpoint) => {
      switch (endpoint) {
        case 'list':
          return { ok: true, value: { entries: [] } }
        case 'start':
          return { ok: true, value: { ok: true, value: { attemptId: ATTEMPT } } }
        case 'poll':
          return { ok: true, value: { ok: true, value: { kind: 'idle' } } }
        default:
          return { ok: true, value: { ok: true, value: { accepted: true } } }
      }
    })
    const signal = new AbortController().signal

    await expect(app.ctx.authorizationClient.list()).resolves.toEqual({ ok: true, value: { entries: [] } })
    await expect(app.ctx.authorizationClient.start({ key: KEY, method: 'oauth' })).resolves.toMatchObject({ ok: true })
    await expect(app.ctx.authorizationClient.poll({ attemptId: ATTEMPT }, signal)).resolves.toMatchObject({ ok: true })
    await expect(app.ctx.authorizationClient.answer({ attemptId: ATTEMPT, promptId: PROMPT, value: 'code' }))
      .resolves.toMatchObject({ ok: true })
    await expect(app.ctx.authorizationClient.cancel({ attemptId: ATTEMPT })).resolves.toMatchObject({ ok: true })
    await expect(app.ctx.authorizationClient.forget({ key: KEY })).resolves.toMatchObject({ ok: true })

    expect(app.call.mock.calls).toEqual([
      ['/authorization', 'list', {}, undefined],
      ['/authorization', 'start', { key: KEY, method: 'oauth' }, undefined],
      ['/authorization', 'poll', { attemptId: ATTEMPT }, signal],
      ['/authorization', 'answer', { attemptId: ATTEMPT, promptId: PROMPT, value: 'code' }, undefined],
      ['/authorization', 'cancel', { attemptId: ATTEMPT }, undefined],
      ['/authorization', 'forget', { key: KEY }, undefined],
    ])
  })

  it('preserves carrier failures and contains malformed input, output, and thrown transports', async () => {
    const denied = harness(() => ({
      ok: false,
      error: { code: 'cancelled', message: 'cancelled', details: {} },
    }))
    await expect(denied.ctx.authorizationClient.list()).resolves.toEqual({
      ok: false,
      error: { code: 'cancelled', message: 'cancelled', details: {} },
    })

    const malformed = harness(() => ({ ok: true, value: { token: 'must-not-cross' } }))
    await expect(malformed.ctx.authorizationClient.start({ key: KEY })).resolves.toEqual({
      ok: false,
      error: { code: 'internal', message: 'Authorization request failed.', details: {} },
    })
    await expect(malformed.ctx.authorizationClient.poll({ attemptId: 'not-a-uuid' as never })).resolves.toEqual({
      ok: false,
      error: { code: 'internal', message: 'Authorization request failed.', details: {} },
    })
    expect(malformed.call).toHaveBeenCalledTimes(1)

    const throwing = harness(() => { throw new Error('offline') })
    await expect(throwing.ctx.authorizationClient.list()).resolves.toEqual({
      ok: false,
      error: { code: 'internal', message: 'Authorization request failed.', details: {} },
    })
  })
})
