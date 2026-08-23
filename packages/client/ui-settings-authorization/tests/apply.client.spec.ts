import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it, vi } from 'vitest'
import { AuthorizationSection } from '../src/client/AuthorizationSection.tsx'
import { apply, inject } from '../src/client/index.ts'

/** Mount the section's replaceable client services. */
async function bench(isLoopback: boolean): Promise<{ ctx: Context; slots: SlotRegistry; locale: LocaleRuntime }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  const slots = ctx.get('slots') as SlotRegistry
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('connection', { isLoopback } as never)
  ctx.provide('authorizationClient', {
    list: vi.fn(async () => ({ ok: true, value: { entries: [] } })),
    cancel: vi.fn(async () => ({ ok: true, value: { ok: true, value: { accepted: true } } })),
  } as never)
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  return { ctx, slots, locale }
}

describe('ui-settings-authorization apply', () => {
  it('declares the exact services it consumes', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'authorizationClient'])
  })

  it('registers a locale-following Accounts section only for a loopback page', async () => {
    const local = await bench(true)
    const fiber = local.ctx.plugin({ inject: [...inject], apply })
    await fiber
    const entry = local.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(AuthorizationSection)
    expect(entry.options).toMatchObject({ id: 'accounts', order: 12 })
    expect(resolveSlotLabel(entry.options.label)).toBe('账号')
    const injected = (entry.inject as () => { t(key: string): string; hooks: object })()
    expect(injected.t('nav')).toBe('账号')
    expect(injected.hooks).toBeDefined()
    local.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Accounts')
    await fiber.dispose()
    expect(local.slots.entries('settings.section')).toEqual([])

    const remote = await bench(false)
    await remote.ctx.plugin({ inject: [...inject], apply })
    expect(remote.slots.entries('settings.section')).toEqual([])
    await local.ctx.fiber.dispose()
    await remote.ctx.fiber.dispose()
  })
})
