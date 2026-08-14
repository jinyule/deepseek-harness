// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PiAiOAuthLoginEvent, PiAiOAuthPromptId } from '@deepseek-ai/dsh-llm-pi-ai-oauth/types'
import { PiAiOAuthLogin } from '../src/client/PiAiOAuthLogin.tsx'
import type { PiAiOAuthClient } from '../src/client/PiAiOAuthLogin.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const accepted = { ok: true as const, value: { ok: true as const, value: { accepted: true as const } } }

describe('PiAiOAuthLogin', () => {
  it('answers the provider-owned browser choice and exposes the authorization URL', async () => {
    let listener: ((provider: string, event: PiAiOAuthLoginEvent) => void) | undefined
    const start = vi.fn(() => Promise.resolve(accepted))
    const answer = vi.fn(() => Promise.resolve(accepted))
    const client: PiAiOAuthClient = {
      remote: {
        describe: vi.fn(() => Promise.resolve({ ok: true as const, value: { providers: [] } })),
        start,
        answer,
        cancel: vi.fn(() => Promise.resolve(accepted)),
        logout: vi.fn(() => Promise.resolve(accepted)),
      },
      onLoginEvent: (next) => { listener = next; return () => { listener = undefined } },
    }
    const changed = vi.fn()
    render(<PiAiOAuthLogin
      provider={{
        provider: 'openai-codex',
        displayName: 'OpenAI Codex',
        authName: 'OpenAI (ChatGPT Plus/Pro)',
        configured: false,
        oauthOnly: true,
        loginActive: false,
      }}
      client={client}
      t={key => en[key]}
      readOnly={false}
      onChanged={changed}
    />)

    fireEvent.click(screen.getByRole('button', { name: en.oauthSignIn }))
    expect(start).toHaveBeenCalledWith({ provider: 'openai-codex' })

    const promptId = 'prompt-1' as PiAiOAuthPromptId
    act(() => {
      listener?.('openai-codex', {
        type: 'prompt',
        prompt: {
          id: promptId,
          type: 'select',
          message: 'Choose sign-in method',
          options: [{ id: 'browser', label: 'Browser' }, { id: 'device_code', label: 'Device code' }],
        },
      })
    })
    const browser = screen.getByRole('button', { name: 'Browser' }) as HTMLButtonElement
    await waitFor(() => { expect(browser.disabled).toBe(false) })
    fireEvent.click(browser)
    await waitFor(() => {
      expect(answer).toHaveBeenCalledWith({ provider: 'openai-codex', promptId, value: 'browser' })
    })

    act(() => {
      listener?.('openai-codex', { type: 'auth_url', url: 'https://auth.example/authorize' })
    })
    expect(screen.getByRole('link', { name: en.oauthOpenBrowser }).getAttribute('href'))
      .toBe('https://auth.example/authorize')

    act(() => { listener?.('openai-codex', { type: 'success' }) })
    expect(screen.getByText(en.oauthConnected)).toBeTruthy()
    expect(changed).toHaveBeenCalled()
  })
})
