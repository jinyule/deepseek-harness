/**
 * Browser-safe authorization RPC protocol. The schemas validate both sides of
 * the private authenticated channel without exposing credential record values.
 * @module @deepseek-ai/dsh-authorization-remote/api
 */

import { z } from 'zod'
import type {
  AuthorizationAccountList,
  AuthorizationActionResult,
  AuthorizationAnswerRequest,
  AuthorizationAttemptEvent,
  AuthorizationAttemptId,
  AuthorizationAttemptRequest,
  AuthorizationForgetRequest,
  AuthorizationPollResult,
  AuthorizationPromptId,
  AuthorizationPromptView,
  AuthorizationRemoteFailure,
  AuthorizationStartRequest,
  AuthorizationStartResult,
} from './types.ts'

/** Logical Connection channel reserved for authenticated authorization interactions. */
export const AUTHORIZATION_RPC_CHANNEL = '/authorization'

/** Methods carried by the private authorization channel. */
export type AuthorizationRpcEndpoint = 'list' | 'start' | 'poll' | 'answer' | 'cancel' | 'forget'

/** Request and business-value types for every authorization endpoint. */
export interface AuthorizationRpcMap {
  list: { readonly request: Record<string, never>; readonly value: AuthorizationAccountList }
  start: { readonly request: AuthorizationStartRequest; readonly value: AuthorizationStartResult }
  poll: { readonly request: AuthorizationAttemptRequest; readonly value: AuthorizationPollResult }
  answer: { readonly request: AuthorizationAnswerRequest; readonly value: AuthorizationActionResult }
  cancel: { readonly request: AuthorizationAttemptRequest; readonly value: AuthorizationActionResult }
  forget: { readonly request: AuthorizationForgetRequest; readonly value: AuthorizationActionResult }
}

const credentialKeySchema = z.string().regex(/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/)
const attemptIdSchema = z.uuid() as unknown as z.ZodType<AuthorizationAttemptId>
const promptIdSchema = z.uuid() as unknown as z.ZodType<AuthorizationPromptId>

const remoteFailureSchema = z.object({
  code: z.enum([
    'flow-not-found',
    'method-not-found',
    'already-in-flight',
    'attempt-not-found',
    'poll-in-flight',
    'prompt-not-found',
    'invalid-option',
    'answer-too-large',
    'record-read-only',
    'shutting-down',
  ]),
  message: z.string(),
}).strict() as z.ZodType<AuthorizationRemoteFailure>

const promptSchema = z.discriminatedUnion('kind', [
  z.object({
    id: promptIdSchema,
    kind: z.literal('text'),
    message: z.string(),
    placeholder: z.string().optional(),
  }).strict(),
  z.object({
    id: promptIdSchema,
    kind: z.literal('secret'),
    message: z.string(),
    placeholder: z.string().optional(),
  }).strict(),
  z.object({
    id: promptIdSchema,
    kind: z.literal('select'),
    message: z.string(),
    options: z.array(z.object({
      id: z.string(),
      label: z.string(),
      description: z.string().optional(),
    }).strict()),
  }).strict(),
]) as unknown as z.ZodType<AuthorizationPromptView>

const eventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idle') }).strict(),
  z.object({
    kind: z.literal('notice'),
    message: z.string(),
    url: z.string().optional(),
    code: z.string().optional(),
    urlRejected: z.literal(true).optional(),
  }).strict(),
  z.object({ kind: z.literal('prompt'), prompt: promptSchema }).strict(),
  z.object({ kind: z.literal('prompt-withdrawn'), promptId: promptIdSchema }).strict(),
  z.object({ kind: z.literal('settled'), status: z.enum(['authorized', 'cancelled']) }).strict(),
  z.object({ kind: z.literal('failed'), message: z.string() }).strict(),
]) as unknown as z.ZodType<AuthorizationAttemptEvent>

const actionResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.object({ accepted: z.literal(true) }).strict() }).strict(),
  z.object({ ok: z.literal(false), error: remoteFailureSchema }).strict(),
]) as z.ZodType<AuthorizationActionResult>

/** Strict request schemas keyed by channel endpoint. */
export const authorizationRequestSchemas: {
  readonly [Endpoint in AuthorizationRpcEndpoint]: z.ZodType<AuthorizationRpcMap[Endpoint]['request']>
} = {
  list: z.object({}).strict(),
  start: z.object({
    key: credentialKeySchema,
    method: z.string().min(1).optional(),
  }).strict() as unknown as z.ZodType<AuthorizationStartRequest>,
  poll: z.object({ attemptId: attemptIdSchema }).strict(),
  answer: z.object({
    attemptId: attemptIdSchema,
    promptId: promptIdSchema,
    value: z.string(),
  }).strict(),
  cancel: z.object({ attemptId: attemptIdSchema }).strict(),
  forget: z.object({ key: credentialKeySchema }).strict() as unknown as z.ZodType<AuthorizationForgetRequest>,
}

/** Strict business-value schemas keyed by channel endpoint. */
export const authorizationValueSchemas: {
  readonly [Endpoint in AuthorizationRpcEndpoint]: z.ZodType<AuthorizationRpcMap[Endpoint]['value']>
} = {
  list: z.object({
    entries: z.array(z.object({
      key: credentialKeySchema,
      label: z.string(),
      methods: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
      inFlight: z.boolean(),
      credential: z.object({
        configured: z.boolean(),
        kind: z.enum(['api-key', 'grant']).optional(),
        writable: z.boolean(),
      }).strict(),
    }).strict()),
  }).strict() as unknown as z.ZodType<AuthorizationAccountList>,
  start: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: z.object({ attemptId: attemptIdSchema }).strict() }).strict(),
    z.object({ ok: z.literal(false), error: remoteFailureSchema }).strict(),
  ]),
  poll: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: eventSchema }).strict(),
    z.object({ ok: z.literal(false), error: remoteFailureSchema }).strict(),
  ]),
  answer: actionResultSchema,
  cancel: actionResultSchema,
  forget: actionResultSchema,
}
