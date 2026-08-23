/** Provider-account settings presentation. */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import type { AuthorizationPromptView } from '@deepseek-ai/dsh-authorization-remote/types'
import type { AuthorizationSettingsStore } from './store.ts'
import type { en } from './locales.ts'
import css from './AuthorizationSection.module.css'

/** Injected dependencies of the authorization settings section. */
export interface AuthorizationSectionInjected {
  readonly controller: AuthorizationSettingsStore
  readonly hooks: {
    readonly accounts: AuthorizationSettingsStore['store']
  }
  readonly t: (key: keyof typeof en) => string
}

/** Props delivered by the settings slot outlet. */
export type AuthorizationSectionProps = Partial<InjectFace<AuthorizationSectionInjected>>

/** Render a prompt input with state scoped to its opaque prompt id. */
function PromptForm({
  prompt,
  submitting,
  t,
  onSubmit,
}: {
  readonly prompt: AuthorizationPromptView
  readonly submitting: boolean
  readonly t: AuthorizationSectionInjected['t']
  readonly onSubmit: (value: string) => void
}): ReactNode {
  const [value, setValue] = useState('')
  const submit = (): void => { if (value.length > 0) onSubmit(value) }
  return (
    <div className={css.prompt}>
      <label className={css.promptLabel} htmlFor={`authorization-prompt-${prompt.id}`}>{prompt.message}</label>
      <div className={css.promptActions}>
        {prompt.kind === 'select'
          ? (
            <select
              id={`authorization-prompt-${prompt.id}`}
              className={css.select}
              value={value}
              disabled={submitting}
              onChange={(event) => { setValue(event.target.value) }}
            >
              <option value="">{t('selectPlaceholder')}</option>
              {prompt.options.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          )
          : (
            <Input
              id={`authorization-prompt-${prompt.id}`}
              value={value}
              type={prompt.kind === 'secret' ? 'password' : 'text'}
              autoComplete="off"
              disabled={submitting}
              {...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }}
              onChange={(event) => { setValue(event.target.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
            />
          )}
        <Button variant="primary" size="sm" disabled={submitting || value.length === 0} onClick={submit}>
          {t('continue')}
        </Button>
      </div>
    </div>
  )
}

/** Render the authorization settings content column. */
export function AuthorizationSection(props: AuthorizationSectionProps): ReactNode {
  const { controller, useAccounts, t } = props
  if (controller === undefined || useAccounts === undefined || t === undefined) return null
  return <Loaded controller={controller} useAccounts={useAccounts} t={t} />
}

function Loaded({ controller, useAccounts, t }: InjectFace<AuthorizationSectionInjected>): ReactNode {
  const state = useAccounts(snapshot => snapshot)
  const [actionKey, setActionKey] = useState<string | undefined>(undefined)
  const [actionError, setActionError] = useState<string | undefined>(undefined)

  useEffect(() => { if (state.status === 'idle') void controller.load() }, [controller, state.status])

  const run = (key: CredentialKey, action: () => Promise<{ ok: boolean; message?: string }>): void => {
    setActionKey(key)
    setActionError(undefined)
    void action().then((result) => {
      if (!result.ok) setActionError(result.message)
    }).finally(() => { setActionKey(undefined) })
  }

  return (
    <section className={css.section} aria-labelledby="authorization-settings-title">
      <h2 id="authorization-settings-title" className={css.title}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {state.status === 'loading' && state.entries.length === 0 ? <p className={css.muted}>{t('loading')}</p> : null}
      {state.status === 'error'
        ? (
          <div className={css.error} role="alert">
            <span>{state.error}</span>
            <Button size="sm" variant="outline" onClick={() => { void controller.load() }}>{t('retry')}</Button>
          </div>
        )
        : null}
      {actionError === undefined ? null : <p className={css.errorText} role="alert">{actionError}</p>}
      {state.status === 'ready' && state.entries.length === 0 ? <p className={css.muted}>{t('empty')}</p> : null}
      <ul className={css.rows}>
        {state.entries.map((entry) => {
          const attempt = state.attempts[entry.key]
          const running = attempt?.status === 'running'
          const acting = actionKey === entry.key
          return (
            <li key={entry.key} className={css.card} data-authorization-account={entry.key}>
              <div className={css.header}>
                <div className={css.identity}>
                  <span className={css.name}>{entry.label}</span>
                  <span className={css.key}>{entry.key}</span>
                  <span className={entry.credential.configured ? css.configured : css.missing}>
                    {entry.credential.configured ? t('configured') : t('missing')}
                  </span>
                </div>
                {entry.credential.configured && entry.credential.writable && !running
                  ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={acting}
                      onClick={() => { run(entry.key, () => controller.forget(entry.key)) }}
                    >
                      {acting ? t('forgetting') : t('forget')}
                    </Button>
                  )
                  : null}
              </div>
              {entry.inFlight && !running ? <p className={css.muted}>{t('busyElsewhere')}</p> : null}
              <div className={css.methods}>
                {entry.methods.map(method => (
                  <Button
                    key={method.id}
                    size="sm"
                    variant="primary"
                    disabled={entry.inFlight || running || acting}
                    onClick={() => { run(entry.key, () => controller.start(entry.key, method.id)) }}
                  >
                    {entry.methods.length === 1 ? method.label : `${t('signIn')}: ${method.label}`}
                  </Button>
                ))}
                {running
                  ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={acting}
                      onClick={() => { run(entry.key, () => controller.cancel(entry.key)) }}
                    >
                      {acting ? t('cancelling') : t('cancel')}
                    </Button>
                  )
                  : null}
              </div>
              {attempt?.notices.map((notice, index) => (
                <div key={`${attempt.id}:${String(index)}`} className={css.notice}>
                  <span>{notice.message}</span>
                  {notice.url === undefined
                    ? null
                    : <a href={notice.url} target="_blank" rel="noreferrer">{t('openLink')}</a>}
                  {notice.code === undefined
                    ? null
                    : <span className={css.code}><span>{t('code')}:</span> <code>{notice.code}</code></span>}
                  {notice.urlRejected === true ? <span className={css.warning}>{t('unsafeLink')}</span> : null}
                </div>
              ))}
              {attempt?.prompt === undefined
                ? null
                : (
                  <PromptForm
                    key={attempt.prompt.id}
                    prompt={attempt.prompt}
                    submitting={acting}
                    t={t}
                    onSubmit={(value) => { run(entry.key, () => controller.answer(entry.key, value)) }}
                  />
                )}
              {attempt?.status === 'authorized' ? <p className={css.success}>{t('authorized')}</p> : null}
              {attempt?.status === 'cancelled' ? <p className={css.muted}>{t('cancelled')}</p> : null}
              {attempt?.status === 'failed'
                ? <p className={css.errorText} role="alert">{attempt.error ?? t('failed')}</p>
                : null}
              {entry.credential.configured ? <p className={css.hint}>{t('forgetHint')}</p> : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
