/**
 * Browser client for the authenticated authorization channel. The Host and
 * browser halves share strict codecs inside this dual-face plugin, while UI
 * plugins consume only the replaceable Cordis service.
 * @module @deepseek-ai/dsh-authorization-remote/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import {
  AUTHORIZATION_RPC_CHANNEL,
  authorizationRequestSchemas,
  authorizationValueSchemas,
  type AuthorizationRpcEndpoint,
  type AuthorizationRpcMap,
} from '../api.ts'
import type {
  AuthorizationActionResult,
  AuthorizationAccountList,
  AuthorizationAnswerRequest,
  AuthorizationAttemptRequest,
  AuthorizationForgetRequest,
  AuthorizationPollResult,
  AuthorizationStartRequest,
  AuthorizationStartResult,
} from '../types.ts'

export {
  AUTHORIZATION_RPC_CHANNEL,
  authorizationRequestSchemas,
  authorizationValueSchemas,
} from '../api.ts'
export type { AuthorizationRpcEndpoint, AuthorizationRpcMap } from '../api.ts'

/** Private authorization methods provided to browser presentation plugins. */
export interface AuthorizationClient {
  /**
   * List installed authorization flows.
   * @returns registered flows and value-free credential state.
   */
  list(): Promise<RpcResult<AuthorizationAccountList>>
  /**
   * Start an authorization attempt.
   * @param request - credential key and optional method.
   * @returns attempt admission result.
   */
  start(request: AuthorizationStartRequest): Promise<RpcResult<AuthorizationStartResult>>
  /**
   * Wait for the next event from one attempt.
   * @param request - opaque attempt identity.
   * @param signal - optional caller cancellation.
   * @returns next ordered attempt event.
   */
  poll(request: AuthorizationAttemptRequest, signal?: AbortSignal): Promise<RpcResult<AuthorizationPollResult>>
  /**
   * Answer the active prompt for an attempt.
   * @param request - opaque attempt, prompt, and response value.
   * @returns prompt acceptance result.
   */
  answer(request: AuthorizationAnswerRequest): Promise<RpcResult<AuthorizationActionResult>>
  /**
   * Cancel an active attempt.
   * @param request - opaque attempt identity.
   * @returns cancellation acceptance result.
   */
  cancel(request: AuthorizationAttemptRequest): Promise<RpcResult<AuthorizationActionResult>>
  /**
   * Delete a writable local credential record.
   * @param request - writable credential key.
   * @returns local deletion result.
   */
  forget(request: AuthorizationForgetRequest): Promise<RpcResult<AuthorizationActionResult>>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser-facing authorization methods mounted from the Host plugin. */
    authorizationClient: AuthorizationClient
  }
}

/** Required service: the browser Connection carrier. */
export const inject = ['connection']

/**
 * Publish the authenticated authorization client.
 * @param ctx - client root context carrying the Connection service.
 */
export function apply(ctx: Context): void {
  ctx.provide('authorizationClient', createAuthorizationClient(ctx.get('connection') as ConnectionHandle))
}

/** Build one typed endpoint caller over the private channel. */
function createAuthorizationClient(connection: ConnectionHandle): AuthorizationClient {
  const invoke = async <Endpoint extends AuthorizationRpcEndpoint>(
    endpoint: Endpoint,
    request: AuthorizationRpcMap[Endpoint]['request'],
    signal?: AbortSignal,
  ): Promise<RpcResult<AuthorizationRpcMap[Endpoint]['value']>> => {
    try {
      const payload = authorizationRequestSchemas[endpoint].parse(request)
      const result = await connection.rpc.call(AUTHORIZATION_RPC_CHANNEL, endpoint, payload, signal)
      if (!result.ok) return result
      return { ok: true, value: authorizationValueSchemas[endpoint].parse(result.value) }
    } catch {
      return {
        ok: false,
        error: { code: 'internal', message: 'Authorization request failed.', details: {} },
      }
    }
  }

  return {
    list: () => invoke('list', {}),
    start: request => invoke('start', request),
    poll: (request, signal) => invoke('poll', request, signal),
    answer: request => invoke('answer', request),
    cancel: request => invoke('cancel', request),
    forget: request => invoke('forget', request),
  }
}
