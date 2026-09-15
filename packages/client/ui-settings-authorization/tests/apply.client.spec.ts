import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import { AuthorizationSection } from '../src/client/AuthorizationSection.tsx'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'

/** Mount the section's replaceable client services. */
async function bench(): Promise<{ ctx: Context; slots: SlotRegistry; locale: LocaleRuntime }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('authorizationClient', {
    list: vi.fn(async () => ({ ok: true, value: { entries: [] } })),
    start: vi.fn(async () => ({ ok: false, error: { code: 'internal', message: 'unavailable', details: {} } })),
    poll: vi.fn(),
    answer: vi.fn(),
    cancel: vi.fn(async () => ({ ok: true, value: { ok: true, value: { accepted: true } } })),
    forget: vi.fn(async () => ({ ok: true, value: { ok: true, value: { accepted: true } } })),
  } as never)
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  return { ctx, slots, locale }
}

describe('ui-settings-authorization apply', () => {
  it('keeps the Host Loader entry inert', () => {
    expect(applyHost).not.toThrow()
  })

  it('declares the exact services it consumes', () => {
    expect(inject).toEqual(['slots', 'locale', 'authorizationClient'])
  })

  it('registers a locale-following Accounts section for an authenticated page', async () => {
    const local = await bench()
    const fiber = local.ctx.plugin({ inject: [...inject], apply })
    await fiber
    const entry = local.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(AuthorizationSection)
    expect(entry.options).toMatchObject({ id: 'accounts', order: 12 })
    expect(resolveSlotLabel(entry.options.label)).toBe('账号')
    const injected = (entry.inject as () => {
      hooks: object
      load(): Promise<unknown>
      start(key: ReturnType<typeof credentialKey>, method?: string): Promise<unknown>
      answer(key: ReturnType<typeof credentialKey>, value: string): Promise<unknown>
      cancel(key: ReturnType<typeof credentialKey>): Promise<unknown>
      forget(key: ReturnType<typeof credentialKey>): Promise<unknown>
    })()
    expect(injected.hooks).toBeDefined()
    expect(typeof injected.load).toBe('function')
    const key = credentialKey('llm-pi-ai', 'openai-codex')
    await injected.load()
    await injected.start(key, 'oauth')
    await injected.answer(key, 'answer')
    await injected.cancel(key)
    await injected.forget(key)
    expect(entry.locale).toBe('settings.authorization')
    local.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Accounts')
    await fiber.dispose()
    expect(local.slots.entries('settings.section')).toEqual([])
    await local.ctx.fiber.dispose()
  })
})
