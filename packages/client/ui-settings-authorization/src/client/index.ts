/** Authorization settings section, browser half. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: supplies the authorizationClient service declaration.
import type {} from '@deepseek-ai/dsh-client-authorization/client'
// Type-only: supplies the settings section slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: supplies ctx.locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { AuthorizationSection } from './AuthorizationSection.tsx'
import type { AuthorizationSectionInjected } from './AuthorizationSection.tsx'
import { AuthorizationSettingsStore } from './store.ts'
import { en, zh, type AuthorizationKey } from './locales.ts'

export type { AuthorizationSectionInjected, AuthorizationSectionProps } from './AuthorizationSection.tsx'
export type { AuthorizationSettingsState, AuthorizationAttemptView } from './store.ts'
export type { AuthorizationKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Provider account sign-in and local credential management. */
    'settings.authorization': AuthorizationKey
  }
}

const NS = 'settings.authorization'

/** Required services: slots, copy, Connection authority, and the authorization client. */
export const inject = ['slots', 'locale', 'connection', 'authorizationClient']

/** Register the independent Accounts section over the authorization service. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-authorization: dictionaries')
  if (!(ctx.get('connection') as ConnectionHandle).isLoopback) return
  const controller = new AuthorizationSettingsStore(ctx.authorizationClient)
  const t = ctx.locale.bind(NS) as AuthorizationSectionInjected['t']
  const injected = (): AuthorizationSectionInjected => ({
    controller,
    hooks: { accounts: controller.store },
    t,
  })
  ctx.effect(() => async () => { await controller.dispose() }, 'ui-settings-authorization: controller lifecycle')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'accounts',
    order: 12,
    label: () => t('nav'),
    inject: injected,
  }, AuthorizationSection))
}
