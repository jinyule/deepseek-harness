/**
 * Browser wire-codec plugin for the loopback authorization channel. Keeping
 * these codecs in the Host plugin's client half lets both peers validate the
 * same protocol without making the channel part of the general Remote BFF.
 * @module @deepseek-ai/dsh-authorization-remote/client
 */

export {
  AUTHORIZATION_RPC_CHANNEL,
  authorizationRequestSchemas,
  authorizationValueSchemas,
} from '../api.ts'
export type { AuthorizationRpcEndpoint, AuthorizationRpcMap } from '../api.ts'

/** The codec contribution has no client lifecycle work of its own. */
export function apply(): void {}
