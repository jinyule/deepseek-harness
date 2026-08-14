/** Provider-native OAuth controls for one Models editor card. */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  PiAiOAuthCommandResult,
  PiAiOAuthLoginEvent,
  PiAiOAuthProviderView,
} from '@deepseek-ai/dsh-llm-pi-ai-oauth/types'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Generated Remote methods plus the forwarded login-event subscription. */
export interface PiAiOAuthClient {
  readonly remote: TypertClientRemote['piAiOAuth']
  /** Subscribe to non-secret login progress for all providers. */
  onLoginEvent(listener: (provider: string, event: PiAiOAuthLoginEvent) => void): () => void
}

/** Props for one provider's OAuth control. */
export interface PiAiOAuthLoginProps {
  readonly provider: PiAiOAuthProviderView
  readonly client: PiAiOAuthClient
  readonly t: (key: keyof typeof en) => string
  readonly readOnly: boolean
  /** Refresh the joined Models snapshot after durable state changes. */
  readonly onChanged: () => void
}

/** Convert the carrier-plus-business envelopes into one optional failure. */
function commandFailure(response: RemoteResult<PiAiOAuthCommandResult>): string | undefined {
  if (!response.ok) return response.error.message
  return response.value.ok ? undefined : response.value.error.message
}

/** Interactive OAuth login and logout surface. */
export function PiAiOAuthLogin({ provider, client, t, readOnly, onChanged }: PiAiOAuthLoginProps): ReactNode {
  const [active, setActive] = useState(provider.loginActive)
  const [prompt, setPrompt] = useState<Extract<PiAiOAuthLoginEvent, { type: 'prompt' }>['prompt']>()
  const [answer, setAnswer] = useState('')
  const [notice, setNotice] = useState<string>()
  const [link, setLink] = useState<{ url: string; label: string }>()
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setActive(provider.loginActive)
  }, [provider.loginActive])

  useEffect(() => client.onLoginEvent((eventProvider, event) => {
    if (eventProvider !== provider.provider) return
    switch (event.type) {
      case 'prompt':
        setPrompt(event.prompt)
        setAnswer('')
        setNotice(event.prompt.message)
        break
      case 'auth_url':
        setLink({ url: event.url, label: t('oauthOpenBrowser') })
        setNotice(event.instructions ?? t('oauthBrowserReady'))
        break
      case 'device_code':
        setLink({ url: event.verificationUri, label: t('oauthOpenVerification') })
        setNotice(`${t('oauthDeviceCode')}: ${event.userCode}`)
        break
      case 'info':
        setNotice(event.message)
        if (event.links?.[0] !== undefined) {
          setLink({ url: event.links[0].url, label: event.links[0].label ?? t('oauthOpenBrowser') })
        }
        break
      case 'progress':
        setNotice(event.message)
        break
      case 'success':
        setActive(false)
        setPrompt(undefined)
        setLink(undefined)
        setNotice(t('oauthConnected'))
        setFailure(undefined)
        onChanged()
        break
      case 'failure':
        setActive(false)
        setPrompt(undefined)
        setFailure(event.message)
        onChanged()
        break
      case 'cancelled':
        setActive(false)
        setPrompt(undefined)
        setNotice(t('oauthCancelled'))
        onChanged()
        break
      default: event satisfies never
    }
  }), [client, onChanged, provider.provider, t])

  const run = async (operation: () => Promise<RemoteResult<PiAiOAuthCommandResult>>): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const problem = commandFailure(await operation())
      if (problem !== undefined) setFailure(problem)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const start = (): void => {
    setActive(true)
    setPrompt(undefined)
    setLink(undefined)
    setNotice(t('oauthStarting'))
    void run(async () => {
      const response = await client.remote.start({ provider: provider.provider })
      if (commandFailure(response) !== undefined) setActive(false)
      return response
    })
  }

  const submitAnswer = (value: string): void => {
    if (prompt === undefined) return
    void run(async () => {
      const response = await client.remote.answer({ provider: provider.provider, promptId: prompt.id, value })
      if (commandFailure(response) === undefined) {
        setPrompt(undefined)
        setAnswer('')
      }
      return response
    })
  }

  return (
    <div className={styles['field']}>
      <span className={styles['fieldLabel']}>{provider.authName}</span>
      {provider.configured
        ? <p className={styles['advancedHint']}>{t('oauthConnected')}</p>
        : <p className={styles['advancedHint']}>{t('oauthRequired')}</p>}
      {!active
        ? (
          <button
            type="button"
            className={styles['secondaryButton']}
            disabled={readOnly || busy}
            onClick={provider.configured
              ? () => {
                void run(async () => {
                  const response = await client.remote.logout({ provider: provider.provider })
                  if (commandFailure(response) === undefined) onChanged()
                  return response
                })
              }
              : start}
          >
            {provider.configured ? t('oauthSignOut') : provider.loginLabel ?? t('oauthSignIn')}
          </button>
        )
        : (
          <button
            type="button"
            className={styles['secondaryButton']}
            disabled={busy}
            onClick={() => { void run(() => client.remote.cancel({ provider: provider.provider })) }}
          >
            {t('oauthCancel')}
          </button>
        )}
      {notice === undefined ? null : <p className={styles['advancedHint']} role="status">{notice}</p>}
      {link === undefined
        ? null
        : <a className={styles['secondaryButton']} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>}
      {prompt?.type === 'select'
        ? (
          <div className={styles['rowActions']}>
            {prompt.options.map(option => (
              <button
                key={option.id}
                type="button"
                className={styles['secondaryButton']}
                title={option.description}
                disabled={busy}
                onClick={() => { submitAnswer(option.id) }}
              >
                {option.label}
              </button>
            ))}
          </div>
        )
        : prompt === undefined
          ? null
          : (
            <div className={styles['field']}>
              <input
                className={styles['input']}
                type={prompt.type === 'secret' ? 'password' : 'text'}
                autoComplete="off"
                value={answer}
                placeholder={prompt.placeholder}
                aria-label={prompt.message}
                disabled={busy}
                onChange={(event) => { setAnswer(event.target.value) }}
              />
              <button
                type="button"
                className={styles['secondaryButton']}
                disabled={busy || answer.trim().length === 0}
                onClick={() => { submitAnswer(answer) }}
              >
                {t('oauthContinue')}
              </button>
            </div>
          )}
      {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
    </div>
  )
}
