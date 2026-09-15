// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationSection } from '../src/client/AuthorizationSection.tsx'
import { en } from '../src/client/locales.ts'
import { AuthorizationSettingsStore, type AuthorizationSettingsState } from '../src/client/store.ts'

const CODEX = credentialKey('llm-pi-ai', 'openai-codex')
const ANTHROPIC = credentialKey('llm-pi-ai', 'anthropic')
const OPENAI = credentialKey('llm-pi-ai', 'openai')
const GOOGLE = credentialKey('llm-pi-ai', 'google')
const ATTEMPT = '00000000-0000-4000-8000-000000000000' as never
const PROMPT = '00000000-0000-4000-8000-000000000001' as never
const SELECT_PROMPT = '00000000-0000-4000-8000-000000000002' as never
const unusedHook = (() => { throw new Error('unused standard hook') }) as never
const standardProps: GlobalStandardProps = {
  usePanelInfo: selector => selector({ activePanelId: null }),
  useSessions: unusedHook,
  useSessionPendingInteraction: unusedHook,
  useWorkspaces: unusedHook,
  useResource: unusedHook,
}

interface TestController extends AuthorizationSettingsStore {
  readonly loadSpy: ReturnType<typeof vi.fn>
  readonly startSpy: ReturnType<typeof vi.fn>
  readonly answerSpy: ReturnType<typeof vi.fn>
  readonly cancelSpy: ReturnType<typeof vi.fn>
  readonly forgetSpy: ReturnType<typeof vi.fn>
}

afterEach(cleanup)

/** Controller with stable methods whose presentation calls can be observed. */
function controller(): TestController {
  const accepted = async () => ({ ok: true as const })
  const value = new AuthorizationSettingsStore({} as never, makeTranslate(en))
  const loadSpy = vi.fn(accepted)
  const startSpy = vi.fn(accepted)
  const answerSpy = vi.fn(accepted)
  const cancelSpy = vi.fn(accepted)
  const forgetSpy = vi.fn(accepted)
  vi.spyOn(value, 'load').mockImplementation(loadSpy)
  vi.spyOn(value, 'start').mockImplementation(startSpy)
  vi.spyOn(value, 'answer').mockImplementation(answerSpy)
  vi.spyOn(value, 'cancel').mockImplementation(cancelSpy)
  vi.spyOn(value, 'forget').mockImplementation(forgetSpy)
  return Object.assign(value, { loadSpy, startSpy, answerSpy, cancelSpy, forgetSpy })
}

/** Render the section over the controller's observable snapshot. */
function mount(value: AuthorizationSettingsStore) {
  return render(<AuthorizationSection
    {...standardProps}
    close={() => {}}
    useAccounts={bindSnapshotSelector(value.store)}
    load={() => value.load()}
    start={(key, method) => value.start(key, method)}
    answer={(key, answer) => value.answer(key, answer)}
    cancel={key => value.cancel(key)}
    forget={key => value.forget(key)}
    t={makeTranslate(en)}
  />)
}

describe('AuthorizationSection', () => {
  it('loads an idle store after the composed slot props mount', async () => {
    const value = controller()
    mount(value)
    await waitFor(() => { expect(value.loadSpy).toHaveBeenCalledOnce() })
  })

  it('renders lifecycle states and dispatches account and prompt actions', async () => {
    const value = controller()
    const entries = [
      {
        key: CODEX,
        label: 'ChatGPT (Codex)',
        methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
        inFlight: false,
        credential: { configured: true, kind: 'grant' as const, writable: true },
      },
      {
        key: ANTHROPIC,
        label: 'Anthropic',
        methods: [{ id: 'oauth', label: 'Subscription' }, { id: 'api-key', label: 'API key' }],
        inFlight: true,
        credential: { configured: false, writable: true },
      },
      {
        key: OPENAI,
        label: 'OpenAI',
        methods: [{ id: 'api-key', label: 'API key' }],
        inFlight: false,
        credential: { configured: false, writable: true },
      },
      {
        key: GOOGLE,
        label: 'Google',
        methods: [{ id: 'oauth', label: 'Google account' }],
        inFlight: false,
        credential: { configured: false, writable: true },
      },
    ] as const
    const ready: AuthorizationSettingsState = {
      status: 'ready',
      entries,
      attempts: {
        [CODEX]: {
          id: ATTEMPT,
          status: 'authorized',
          notices: [
            {
              kind: 'notice',
              message: 'Open the provider',
              url: 'https://auth.example',
              code: 'ABCD',
              urlRejected: true,
            },
            { kind: 'notice', message: 'Waiting' },
          ],
        },
        [ANTHROPIC]: { id: ATTEMPT, status: 'cancelled', notices: [] },
        [OPENAI]: { id: ATTEMPT, status: 'failed', notices: [] },
        [GOOGLE]: {
          id: ATTEMPT,
          status: 'running',
          notices: [],
          prompt: { id: PROMPT, kind: 'secret', message: 'Paste key', placeholder: 'secret' },
        },
      },
    }
    value.store.set(ready)
    mount(value)

    expect(screen.getByRole('heading', { name: en.title })).not.toBeNull()
    expect(screen.getByRole('link', { name: en.openLink }).getAttribute('href')).toBe('https://auth.example')
    expect(screen.getByText('ABCD')).not.toBeNull()
    expect(screen.getByText(en.unsafeLink)).not.toBeNull()
    expect(screen.getByText(en.busyElsewhere)).not.toBeNull()
    expect(screen.getByText(en.authorized)).not.toBeNull()
    expect(screen.getByText(en.cancelled)).not.toBeNull()
    expect(screen.getByText(en.failed)).not.toBeNull()
    expect(screen.getByRole('button', { name: `${en.signIn}: Subscription` }).hasAttribute('disabled')).toBe(true)

    value.forgetSpy.mockResolvedValueOnce({ ok: false, message: 'Cannot forget' })
    fireEvent.click(screen.getByRole('button', { name: en.forget }))
    await screen.findByText('Cannot forget')
    expect(value.forgetSpy).toHaveBeenCalledWith(CODEX)

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }))
    await waitFor(() => { expect(value.startSpy).toHaveBeenCalledWith(CODEX, 'oauth') })

    const input = screen.getByLabelText<HTMLInputElement>('Paste key')
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: 'secret-value' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(value.answerSpy).toHaveBeenCalledWith(GOOGLE, 'secret-value') })
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    await waitFor(() => { expect(value.cancelSpy).toHaveBeenCalledWith(GOOGLE) })

    act(() => {
      value.store.set({
        ...ready,
        attempts: {
          ...ready.attempts,
          [GOOGLE]: {
            id: ATTEMPT,
            status: 'running',
            notices: [],
            prompt: {
              id: SELECT_PROMPT,
              kind: 'select',
              message: 'Choose account',
              options: [{ id: 'work', label: 'Work' }],
            },
          },
        },
      })
    })
    fireEvent.change(screen.getByLabelText('Choose account'), { target: { value: 'work' } })
    fireEvent.click(screen.getByRole('button', { name: en.continue }))
    await waitFor(() => { expect(value.answerSpy).toHaveBeenCalledWith(GOOGLE, 'work') })

    act(() => {
      value.store.set({
        ...ready,
        attempts: {
          ...ready.attempts,
          [GOOGLE]: {
            id: ATTEMPT,
            status: 'running',
            notices: [],
            prompt: { id: PROMPT, kind: 'text', message: 'Paste code' },
          },
        },
      })
    })
    const text = screen.getByLabelText<HTMLInputElement>('Paste code')
    expect(text.type).toBe('text')
    fireEvent.keyDown(text, { key: 'Escape' })
    fireEvent.keyDown(text, { key: 'Enter' })
    expect(value.answerSpy).not.toHaveBeenCalledWith(GOOGLE, '')
  })

  it('renders loading, empty, and retryable error states', async () => {
    const value = controller()
    value.store.set({ status: 'loading', entries: [], attempts: {} })
    mount(value)
    expect(screen.getByText(en.loading)).not.toBeNull()

    act(() => { value.store.set({ status: 'ready', entries: [], attempts: {} }) })
    expect(screen.getByText(en.empty)).not.toBeNull()

    act(() => { value.store.set({ status: 'error', entries: [], attempts: {}, error: 'Load failed' }) })
    expect(screen.getByText('Load failed')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(value.loadSpy).toHaveBeenCalledOnce() })
  })
})
