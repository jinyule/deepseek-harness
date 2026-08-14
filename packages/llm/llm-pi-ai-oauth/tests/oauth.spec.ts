import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import PiAiOAuthService, { resolveSpec } from '../src/index.ts'
import type { PiAiOAuthLoginEvent } from '../src/types.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function harness(): Promise<{ ctx: Context; service: PiAiOAuthService; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pi-oauth-'))
  roots.push(root)
  const path = join(root, 'oauth.json')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(PiAiOAuthService, { path, lockTimeoutMs: 2_000 })
  return { ctx, service: ctx.piAiOAuth, path }
}

describe('PiAiOAuthService', () => {
  it('resolves the owner-only document below the selected harness home', () => {
    expect(resolveSpec({ dshHome: '/private/dsh', lockTimeoutMs: 7 })).toEqual({
      filename: join('/private/dsh', '.pi-ai-oauth.json'),
      lockTimeoutMs: 7,
    })
  })

  it('lists OpenAI Codex as OAuth-only without exposing credential values', async () => {
    const { service } = await harness()
    const view = await service.describe()
    expect(view.providers.find(provider => provider.provider === 'openai-codex')).toMatchObject({
      displayName: 'OpenAI Codex',
      authName: 'OpenAI (ChatGPT Plus/Pro)',
      configured: false,
      oauthOnly: true,
      loginActive: false,
    })
  })

  it('persists a valid credential at mode 0600 and serializes competing modifiers', async () => {
    const { service, path } = await harness()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let secondEntered = false
    const first = service.modify('fixture', async () => {
      entered.resolve(undefined)
      await release.promise
      return { type: 'api_key', key: 'first' }
    })
    await entered.promise
    const second = service.modify('fixture', async (current) => {
      secondEntered = true
      expect(current).toEqual({ type: 'api_key', key: 'first' })
      return { type: 'api_key', key: 'second' }
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(secondEntered).toBe(false)
    release.resolve(undefined)
    await Promise.all([first, second])

    expect(await service.read('fixture')).toEqual({ type: 'api_key', key: 'second' })
    const document = JSON.parse(await readFile(path, 'utf8')) as { version: number }
    expect(document.version).toBe(1)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('rejects malformed and wider-permission durable documents before serving them', async () => {
    const { service, path } = await harness()
    await writeFile(path, '{}\n', { mode: 0o600 })
    await expect(service.list()).rejects.toThrow('not a version 1 OAuth credential document')

    if (process.platform !== 'win32') {
      await writeFile(path, '{"version":1,"credentials":{}}\n', { mode: 0o644 })
      await chmod(path, 0o644)
      await expect(service.list()).rejects.toThrow('must have mode 0600')
    }
  })

  it('removes a stored OAuth credential through provider logout', async () => {
    const { service } = await harness()
    await service.modify('openai-codex', async () => ({
      type: 'oauth',
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 60_000,
    }))
    expect((await service.describe()).providers.find(provider => provider.provider === 'openai-codex')?.configured)
      .toBe(true)

    await expect(service.logout({ provider: 'openai-codex' })).resolves
      .toEqual({ ok: true, value: { accepted: true } })
    await expect(service.read('openai-codex')).resolves.toBeUndefined()
  })

  it('owns one cancellable provider login and forwards its first prompt', async () => {
    const { ctx, service } = await harness()
    const events: PiAiOAuthLoginEvent[] = []
    ctx.on('pi-ai-oauth/login-event', (provider, event) => {
      if (provider === 'openai-codex') events.push(event)
    })

    expect(service.start({ provider: 'openai-codex' })).toEqual({ ok: true, value: { accepted: true } })
    expect(service.start({ provider: 'openai-codex' })).toMatchObject({
      ok: false,
      error: { code: 'login-active' },
    })
    await vi.waitFor(() => {
      const event = events.find(candidate => candidate.type === 'prompt')
      expect(event?.type).toBe('prompt')
      if (event?.type !== 'prompt') return
      expect(event.prompt.type).toBe('select')
      if (event.prompt.type !== 'select') return
      expect(event.prompt.options.map(option => option.id)).toEqual(expect.arrayContaining(['browser', 'device_code']))
    })
    expect(service.cancel({ provider: 'openai-codex' })).toEqual({ ok: true, value: { accepted: true } })
    await vi.waitFor(async () => {
      const provider = (await service.describe()).providers.find(item => item.provider === 'openai-codex')
      expect(provider?.loginActive).toBe(false)
      expect(events).toContainEqual({ type: 'cancelled' })
    })
  })

  it('cancels active login work and closes mutation admission at teardown', async () => {
    const { ctx, service } = await harness()
    expect(service.start({ provider: 'openai-codex' })).toEqual({ ok: true, value: { accepted: true } })
    expect((await service.describe()).providers.find(provider => provider.provider === 'openai-codex')?.loginActive)
      .toBe(true)

    await ctx.fiber.dispose()

    expect((await service.describe()).providers.find(provider => provider.provider === 'openai-codex')?.loginActive)
      .toBe(false)
    expect(service.start({ provider: 'openai-codex' })).toMatchObject({
      ok: false,
      error: { code: 'login-absent' },
    })
    await expect(service.modify('openai-codex', async current => current))
      .rejects.toThrow('llm-pi-ai-oauth is disposed')
  })
})
