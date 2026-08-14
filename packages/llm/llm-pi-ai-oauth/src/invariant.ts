/** Package-owned invariant companion. @module @deepseek-ai/dsh-llm-pi-ai-oauth/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-pi-ai-oauth'

/** Cordis companion plugin name. */
export const name = 'llm-pi-ai-oauth-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: pi-ai owns the provider/auth relationship, while the
 * strict durable parser rejects credentials that do not satisfy its tags.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['piAiOAuth'] })

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
