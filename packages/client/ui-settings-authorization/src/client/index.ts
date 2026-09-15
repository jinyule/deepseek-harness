/** Authorization settings section, browser half. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: supplies the authorizationClient service declaration.
import type {} from '@deepseek-ai/dsh-authorization-remote/client'
// Type-only: supplies the settings section slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: supplies the renderer-owned ctx.slots service declaration.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
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

/** Required services: slots, copy, and the authorization client. */
export const inject = ['slots', 'locale', 'authorizationClient']

/** Register the independent Accounts section over the authorization service. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-authorization: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new AuthorizationSettingsStore(ctx.authorizationClient, t)
  const face: AuthorizationSectionInjected = {
    hooks: { accounts: controller.store },
    load: () => controller.load(),
    start: (key, method) => controller.start(key, method),
    answer: (key, value) => controller.answer(key, value),
    cancel: key => controller.cancel(key),
    forget: key => controller.forget(key),
  }
  ctx.effect(() => async () => { await controller.dispose() }, 'ui-settings-authorization: controller lifecycle')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'accounts',
    order: 12,
    label: () => t('nav'),
    locale: NS,
    inject: () => face,
  }, AuthorizationSection))
}
