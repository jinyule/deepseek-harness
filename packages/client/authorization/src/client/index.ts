/**
 * Browser authorization transport plugin. It projects the private loopback
 * Connection channel as a replaceable Cordis service, so presentation plugins
 * consume typed methods rather than importing wire runtime.
 * @module @deepseek-ai/dsh-client-authorization/client
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  AUTHORIZATION_RPC_CHANNEL,
  authorizationRequestSchemas,
  authorizationValueSchemas,
  type AuthorizationRpcEndpoint,
  type AuthorizationRpcMap,
} from '@deepseek-ai/dsh-authorization-remote/client'
import type {
  AuthorizationActionResult,
  AuthorizationAccountList,
  AuthorizationAnswerRequest,
  AuthorizationAttemptRequest,
  AuthorizationForgetRequest,
  AuthorizationPollResult,
  AuthorizationStartRequest,
  AuthorizationStartResult,
} from '@deepseek-ai/dsh-authorization-remote/types'
import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'

/** Private authorization methods provided to browser presentation plugins. */
export interface AuthorizationClient {
  list(): Promise<RpcResult<AuthorizationAccountList>>
  start(request: AuthorizationStartRequest): Promise<RpcResult<AuthorizationStartResult>>
  poll(request: AuthorizationAttemptRequest, signal?: AbortSignal): Promise<RpcResult<AuthorizationPollResult>>
  answer(request: AuthorizationAnswerRequest): Promise<RpcResult<AuthorizationActionResult>>
  cancel(request: AuthorizationAttemptRequest): Promise<RpcResult<AuthorizationActionResult>>
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
 * Publish the loopback authorization client.
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
