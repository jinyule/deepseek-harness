import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { installConnection, type ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { apply as applyAuthorizationClient, inject as authorizationClientInject } from '@deepseek-ai/dsh-authorization-remote/client'
import type { AuthorizationClient } from '@deepseek-ai/dsh-authorization-remote/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { expect, it, onTestFinished, vi } from 'vitest'
import { en } from '../src/client/locales.ts'
import { apply, inject } from '../src/client/index.ts'

it.each([['connection', false], ['root', false], ['connection', true], ['root', true]] as const)(
  'drains a late start through the real Cordis client chain during %s unload (cancel refused=%s)', async (target, refused) => {
    const starting = Promise.withResolvers<Awaited<ReturnType<AuthorizationClient['start']>>>()
    const cancelling = Promise.withResolvers<Awaited<ReturnType<AuthorizationClient['cancel']>>>()
    const attemptId = '00000000-0000-4000-8000-000000000001'
    const accepted = { ok: true, value: { ok: true, value: { accepted: true } } } as const
    const ctx = new Context()
    const errors: unknown[] = []
    const logged = vi.spyOn(ctx.logger, 'error').mockImplementation((error) => { errors.push(error); return ctx.logger })
    onTestFinished(async () => {
      starting.resolve({ ok: false, error: { code: 'cancelled', message: 'fixture stopped', details: {} } })
      cancelling.resolve(accepted)
      await ctx.fiber.dispose()
      logged.mockRestore()
    })
    const call = vi.fn<ConnectionHandle['rpc']['call']>((_channel, endpoint) => {
      if (endpoint === 'start') return starting.promise
      if (endpoint === 'cancel') return cancelling.promise
      throw new Error(`unexpected authorization operation ${endpoint}`)
    })
    const connection = ctx.plugin({ apply: (owner: Context) => { installConnection(owner, { transport: { rpc: { call } } }) } })
    await connection.await()
    await ctx.plugin({ inject: [...authorizationClientInject], apply: applyAuthorizationClient }).await()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('settings.section')[0]!
    const face = (entry.inject as () => { start(key: ReturnType<typeof credentialKey>): Promise<unknown> })()
    const start = face.start(credentialKey('test', 'account'))
    await vi.waitFor(() => { expect(call).toHaveBeenCalledOnce() })
    let disposed = false
    const disposing = (target === 'root' ? ctx.fiber.dispose() : connection.dispose()).then(() => { disposed = true })
    await setImmediate()
    expect(disposed).toBe(false)
    expect(locale.bind('settings.authorization')('cancelFailed')).toBe(en.cancelFailed)
    starting.resolve({ ok: true, value: { ok: true, value: { attemptId: attemptId as never } } })
    await vi.waitFor(() => { expect(call).toHaveBeenLastCalledWith('/authorization', 'cancel', { attemptId }, undefined) })
    await setImmediate()
    expect(disposed).toBe(false)
    cancelling.resolve(refused ? { ok: false, error: { code: 'internal', message: 'offline', details: {} } } : accepted)
    await Promise.all([start, disposing])
    if (refused) {
      expect(errors).toHaveLength(1)
      const failure = errors[0]
      expect(failure).toBeInstanceOf(AggregateError)
      if (!(failure instanceof AggregateError)) throw new Error('expected a reported cleanup failure')
      expect(failure.message).toBe(en.cancelFailed)
    } else expect(errors).toEqual([])
    expect(locale.bind('settings.authorization')('cancelFailed')).not.toBe(en.cancelFailed)
    expect(call.mock.calls.map(([, endpoint]) => endpoint)).toEqual(['start', 'cancel'])
  })
