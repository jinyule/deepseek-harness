/**
 * Durable, interactive OAuth credential service for pi-ai providers.
 * @module @deepseek-ai/dsh-llm-pi-ai-oauth
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type {
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  Credential as PiAiCredential,
  CredentialInfo as PiAiCredentialInfo,
  CredentialStore,
  Models,
  Provider,
} from '@earendil-works/pi-ai'
import { z } from 'zod'
import type {
  PiAiOAuthAnswerRequest,
  PiAiOAuthCommandFailure,
  PiAiOAuthCommandResult,
  PiAiOAuthDescribeValue,
  PiAiOAuthLoginEvent,
  PiAiOAuthPromptId,
  PiAiOAuthPromptView,
  PiAiOAuthProviderRequest,
  PiAiOAuthProviderView,
  PiAiOAuthStartRequest,
} from './types.ts'

export type * from './types.ts'

/** Basename of the owner-only OAuth credential document. */
export const PI_AI_OAUTH_FILENAME = '.pi-ai-oauth.json'

/** Plugin configuration. */
export interface Config {
  /** Credential document path; defaults below the harness home. */
  path?: string
  /** Harness home used when `path` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Maximum wait for another process's refresh/login write lock, in milliseconds. */
  lockTimeoutMs?: number
}

/** Fully resolved storage policy. */
export interface PiAiOAuthSpec {
  readonly filename: string
  readonly lockTimeoutMs: number
}

/** Default cross-process wait for a provider-owned network refresh. */
const DEFAULT_LOCK_TIMEOUT_MS = 120_000

/**
 * Resolve plugin configuration once at construction.
 * @param config - optional credential path, harness home, and lock deadline.
 * @returns the absolute credential filename and validated lock policy.
 */
export function resolveSpec(config: Config): PiAiOAuthSpec {
  return {
    filename: resolve(config.path ?? join(resolveDshHome(config.dshHome), PI_AI_OAUTH_FILENAME)),
    lockTimeoutMs: config.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
  }
}

const apiKeyCredentialSchema = z.object({
  type: z.literal('api_key'),
  key: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
}).strict()

const oauthCredentialSchema = z.object({
  type: z.literal('oauth'),
  refresh: z.string().min(1),
  access: z.string().min(1),
  expires: z.number(),
}).loose()

const credentialSchema = z.discriminatedUnion('type', [apiKeyCredentialSchema, oauthCredentialSchema])
const documentSchema = z.object({
  version: z.literal(1),
  credentials: z.record(z.string(), credentialSchema),
}).strict()

/** Current durable document format; old or malformed formats fail at the file boundary. */
interface CredentialDocument {
  readonly version: 1
  readonly credentials: Record<string, PiAiCredential>
}

/** One prompt that can be answered exactly once. */
interface PendingPrompt {
  readonly id: PiAiOAuthPromptId
  readonly prompt: PiAiOAuthPrompt
  readonly settle: (answer: string) => void
}

/** Internal prompt facts needed to validate an answer. */
type PiAiOAuthPrompt = AuthPrompt & { readonly id: PiAiOAuthPromptId }

/** One active login owned until its upstream promise settles. */
interface LoginSession {
  readonly provider: string
  readonly controller: AbortController
  prompt: PendingPrompt | undefined
  done: Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Persistent pi-ai OAuth store and interactive login service. */
    piAiOAuth: PiAiOAuthService
  }
}

/** Whether a filesystem operation reports absence. */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** Refuse a secret document readable by group or other users. */
async function assertOwnerOnly(filename: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    const info = await stat(filename)
    if ((info.mode & 0o077) !== 0) {
      throw new Error(`llm-pi-ai-oauth: refusing ${filename}; OAuth credentials must have mode 0600`)
    }
  } catch (error) {
    if (!isENOENT(error)) throw error
  }
}

/** Parse one complete credential document without exposing its contents in diagnostics. */
function parseDocument(text: string, filename: string): CredentialDocument {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`llm-pi-ai-oauth: ${filename} is not valid JSON`)
  }
  const parsed = documentSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`llm-pi-ai-oauth: ${filename} is not a version 1 OAuth credential document`)
  }
  return parsed.data as CredentialDocument
}

/** Read a complete atomic snapshot, treating absence as an empty document. */
async function readDocument(filename: string): Promise<CredentialDocument> {
  await assertOwnerOnly(filename)
  try {
    return parseDocument(await readFile(filename, 'utf8'), filename)
  } catch (error) {
    if (!isENOENT(error)) throw error
    return { version: 1, credentials: {} }
  }
}

/** Stable command success. */
function accepted(): PiAiOAuthCommandResult {
  return { ok: true, value: { accepted: true } }
}

/** Stable command rejection. */
function rejected(code: PiAiOAuthCommandFailure['code'], message: string): PiAiOAuthCommandResult {
  return { ok: false, error: { code, message } }
}

/** Abort failure used by provider interactions. */
function abortError(): DOMException {
  return new DOMException('OAuth login was cancelled', 'AbortError')
}

/** Public prompt projection that deliberately omits its AbortSignal. */
function promptView(prompt: PiAiOAuthPrompt): PiAiOAuthPromptView {
  const common = {
    id: prompt.id,
    message: prompt.message,
    ...prompt.type === 'select' || prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
  }
  if (prompt.type === 'select') {
    return {
      ...common,
      type: 'select',
      options: prompt.options.map(option => ({
        id: option.id,
        label: option.label,
        ...option.description === undefined ? {} : { description: option.description },
      })),
    }
  }
  return { ...common, type: prompt.type }
}

/** Only HTTP(S) provider links may cross to a browser. */
function safeUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`llm-pi-ai-oauth: provider emitted unsupported ${url.protocol} login URL`)
  }
  return url.href
}

/** Project an upstream non-secret notification into the stable browser event. */
function loginEvent(event: AuthEvent): PiAiOAuthLoginEvent {
  switch (event.type) {
    case 'info':
      return {
        type: 'info',
        message: event.message,
        ...event.links === undefined ? {} : {
          links: event.links.map(link => ({
            url: safeUrl(link.url),
            ...link.label === undefined ? {} : { label: link.label },
          })),
        },
      }
    case 'auth_url':
      return {
        type: 'auth_url',
        url: safeUrl(event.url),
        ...event.instructions === undefined ? {} : { instructions: event.instructions },
      }
    case 'device_code':
      return {
        type: 'device_code',
        userCode: event.userCode,
        verificationUri: safeUrl(event.verificationUri),
        ...event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds },
        ...event.expiresInSeconds === undefined ? {} : { expiresInSeconds: event.expiresInSeconds },
      }
    case 'progress': return { type: 'progress', message: event.message }
    default: return event satisfies never
  }
}

/** Durable OAuth service and the exact CredentialStore injected into pi-ai. */
export class PiAiOAuthService extends TypertRemoteService implements CredentialStore {
  static Config: s<Config> = s.object({
    path: s.string(),
    dshHome: s.string(),
    lockTimeoutMs: s.number().step(1).min(1).default(DEFAULT_LOCK_TIMEOUT_MS),
  })

  private readonly spec: PiAiOAuthSpec
  private readonly models: Models
  private readonly providers: ReadonlyMap<string, Provider>
  private readonly logins = new Map<string, LoginSession>()
  private readonly storageOperations = new Set<Promise<unknown>>()
  private admissionOpen = true

  /**
   * @param ctx - Host context that owns storage, events, and Remote publication.
   * @param config - credential path and lock policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'piAiOAuth')
    this.spec = resolveSpec(config)
    this.models = builtinModels({ credentials: this })
    this.providers = new Map(
      this.models.getProviders().filter(provider => provider.auth.oauth !== undefined)
        .map(provider => [provider.id, provider]),
    )
  }

  /** Refuse new logins during teardown, cancel active flows, and await them. */
  protected [Service.init](): void {
    this.ctx.effect(() => async () => {
      this.admissionOpen = false
      for (const login of this.logins.values()) login.controller.abort()
      await Promise.all([...this.logins.values()].map(login => login.done))
      await Promise.allSettled(this.storageOperations)
    }, 'llm-pi-ai-oauth.loginDrain')
  }

  /**
   * Whether the installed pi-ai provider offers OAuth.
   * @param provider - pi-ai provider route id.
   * @returns whether this service can authenticate the route through OAuth.
   */
  supports(provider: string): boolean {
    return this.providers.has(provider)
  }

  /**
   * Read a stored credential snapshot without refreshing it.
   * @param providerId - pi-ai provider route id.
   * @returns a cloned credential, or `undefined` when none is stored.
   */
  async read(providerId: string): Promise<PiAiCredential | undefined> {
    const document = await readDocument(this.spec.filename)
    const credential = document.credentials[providerId]
    return credential === undefined ? undefined : structuredClone(credential)
  }

  /**
   * List non-secret metadata without resolving provider auth.
   * @returns stored provider ids and credential types.
   */
  async list(): Promise<readonly PiAiCredentialInfo[]> {
    const document = await readDocument(this.spec.filename)
    return Object.entries(document.credentials).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }))
  }

  /**
   * Serialize a provider mutation across processes. The callback remains under
   * the lock because pi-ai performs refresh there to prevent token rotation races.
   * @param providerId - pi-ai provider route id.
   * @param fn - provider-owned mutation, including any refresh exchange.
   * @returns the replacement credential or the unchanged stored value.
   */
  modify(
    providerId: string,
    fn: (current: PiAiCredential | undefined) => Promise<PiAiCredential | undefined>,
  ): Promise<PiAiCredential | undefined> {
    if (!this.admissionOpen) return Promise.reject(new Error('llm-pi-ai-oauth is disposed'))
    return this.trackStorage(this.modifyCredential(providerId, fn))
  }

  /** Durable implementation behind the admission and drain wrapper. */
  private async modifyCredential(
    providerId: string,
    fn: (current: PiAiCredential | undefined) => Promise<PiAiCredential | undefined>,
  ): Promise<PiAiCredential | undefined> {
    await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
    return withFileLock(this.spec.filename, async () => {
      const document = await readDocument(this.spec.filename)
      const current = document.credentials[providerId]
      const next = await fn(current === undefined ? undefined : structuredClone(current))
      if (next === undefined) return current === undefined ? undefined : structuredClone(current)
      const validated = credentialSchema.safeParse(next)
      if (!validated.success) throw new TypeError('llm-pi-ai-oauth: pi-ai produced an invalid credential')
      const credentials = { ...document.credentials, [providerId]: validated.data as PiAiCredential }
      await writeFileAtomic(
        this.spec.filename,
        `${JSON.stringify({ version: 1, credentials }, null, 2)}\n`,
        { mode: 0o600, dirMode: 0o700 },
      )
      this.ctx.emit('pi-ai-oauth/updated', providerId)
      return structuredClone(validated.data as PiAiCredential)
    }, { timeoutMs: this.spec.lockTimeoutMs })
  }

  /**
   * Delete one credential while serialized against refresh and login writes.
   * @param providerId - pi-ai provider route id.
   */
  delete(providerId: string): Promise<void> {
    if (!this.admissionOpen) return Promise.reject(new Error('llm-pi-ai-oauth is disposed'))
    return this.trackStorage(this.deleteCredential(providerId))
  }

  /** Durable deletion behind the admission and drain wrapper. */
  private async deleteCredential(providerId: string): Promise<void> {
    await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
    await withFileLock(this.spec.filename, async () => {
      const document = await readDocument(this.spec.filename)
      if (document.credentials[providerId] === undefined) return
      const credentials = Object.fromEntries(
        Object.entries(document.credentials).filter(([key]) => key !== providerId),
      )
      await writeFileAtomic(
        this.spec.filename,
        `${JSON.stringify({ version: 1, credentials }, null, 2)}\n`,
        { mode: 0o600, dirMode: 0o700 },
      )
      this.ctx.emit('pi-ai-oauth/updated', providerId)
    }, { timeoutMs: this.spec.lockTimeoutMs })
  }

  /**
   * Current OAuth provider and durable-login state.
   * @returns non-secret provider metadata and login status.
   */
  @Remote('describe')
  async describe(): Promise<PiAiOAuthDescribeValue> {
    const configured = new Set(
      (await this.list()).filter(info => info.type === 'oauth').map(info => info.providerId),
    )
    const providers: PiAiOAuthProviderView[] = [...this.providers.values()].map((provider) => {
      const oauth = provider.auth.oauth
      /* v8 ignore next -- providers was filtered by this exact relationship */
      if (oauth === undefined) throw new Error(`llm-pi-ai-oauth: ${provider.id} lost OAuth support`)
      return {
        provider: provider.id,
        displayName: provider.name,
        authName: oauth.name,
        ...oauth.loginLabel === undefined ? {} : { loginLabel: oauth.loginLabel },
        configured: configured.has(provider.id),
        oauthOnly: provider.auth.apiKey === undefined,
        loginActive: this.logins.has(provider.id),
      }
    })
    return { providers }
  }

  /**
   * Start one provider-owned login and return before its interaction settles.
   * @param request - provider whose OAuth flow should start.
   * @returns command acknowledgement or a stable state rejection.
   */
  @Remote('start')
  start(request: PiAiOAuthStartRequest): PiAiOAuthCommandResult {
    if (!this.admissionOpen) return rejected('login-absent', 'OAuth service is shutting down')
    if (!this.providers.has(request.provider)) {
      return rejected('unknown-provider', `Provider ${request.provider} does not offer OAuth`)
    }
    if (this.logins.has(request.provider)) {
      return rejected('login-active', `A login for ${request.provider} is already running`)
    }
    const login: LoginSession = {
      provider: request.provider,
      controller: new AbortController(),
      prompt: undefined,
      done: Promise.resolve(),
    }
    this.logins.set(request.provider, login)
    login.done = this.runLogin(login)
    this.ctx.emit('pi-ai-oauth/updated', request.provider)
    return accepted()
  }

  /**
   * Answer the exact outstanding prompt.
   * @param request - provider, opaque prompt id, and user answer.
   * @returns command acknowledgement or a stable prompt-state rejection.
   */
  @Remote('answer')
  answer(request: PiAiOAuthAnswerRequest): PiAiOAuthCommandResult {
    const login = this.logins.get(request.provider)
    if (login === undefined) return rejected('login-absent', `No login for ${request.provider} is running`)
    const pending = login.prompt
    if (pending === undefined) return rejected('prompt-absent', `Login for ${request.provider} is not awaiting input`)
    if (pending.id !== request.promptId) return rejected('prompt-mismatch', 'The login prompt changed; answer the current prompt')
    const value = pending.prompt.type === 'select' || pending.prompt.type === 'manual_code'
      ? request.value.trim()
      : request.value
    if (value.trim().length === 0) return rejected('invalid-answer', 'A login answer cannot be blank')
    if (pending.prompt.type === 'select' && !pending.prompt.options.some(option => option.id === value)) {
      return rejected('invalid-answer', 'The selected login option is not available')
    }
    pending.settle(value)
    return accepted()
  }

  /**
   * Cancel one active provider login.
   * @param request - provider whose login should be cancelled.
   * @returns command acknowledgement or a stable state rejection.
   */
  @Remote('cancel')
  cancel(request: PiAiOAuthProviderRequest): PiAiOAuthCommandResult {
    const login = this.logins.get(request.provider)
    if (login === undefined) return rejected('login-absent', `No login for ${request.provider} is running`)
    login.controller.abort()
    return accepted()
  }

  /**
   * Remove one stored OAuth credential through pi-ai's own logout path.
   * @param request - provider whose durable credential should be removed.
   * @returns command acknowledgement or a stable provider-state rejection.
   */
  @Remote('logout')
  async logout(request: PiAiOAuthProviderRequest): Promise<PiAiOAuthCommandResult> {
    if (!this.providers.has(request.provider)) {
      return rejected('unknown-provider', `Provider ${request.provider} does not offer OAuth`)
    }
    if (this.logins.has(request.provider)) {
      return rejected('login-active', `Cancel the active ${request.provider} login before signing out`)
    }
    await this.models.logout(request.provider)
    return accepted()
  }

  /** Run and settle one background login without leaking an unhandled rejection. */
  private async runLogin(login: LoginSession): Promise<void> {
    try {
      await this.models.login(login.provider, 'oauth', this.interaction(login))
      this.ctx.emit('pi-ai-oauth/login-event', login.provider, { type: 'success' })
    } catch (error) {
      if (login.controller.signal.aborted || (error as { name?: unknown }).name === 'AbortError') {
        this.ctx.emit('pi-ai-oauth/login-event', login.provider, { type: 'cancelled' })
      } else {
        const message = error instanceof Error ? error.message : String(error)
        this.ctx.emit('pi-ai-oauth/login-event', login.provider, { type: 'failure', message })
      }
    } finally {
      login.prompt = undefined
      if (this.logins.get(login.provider) === login) this.logins.delete(login.provider)
      this.ctx.emit('pi-ai-oauth/updated', login.provider)
    }
  }

  /** Provider interaction whose answers arrive through the Remote `answer` method. */
  private interaction(login: LoginSession): AuthInteraction {
    return {
      signal: login.controller.signal,
      prompt: prompt => this.awaitPrompt(login, prompt),
      notify: (event) => { this.ctx.emit('pi-ai-oauth/login-event', login.provider, loginEvent(event)) },
    }
  }

  /** Publish one prompt and resolve it exactly once from answer or cancellation. */
  private awaitPrompt(login: LoginSession, prompt: AuthPrompt): Promise<string> {
    if (login.controller.signal.aborted || prompt.signal?.aborted === true) return Promise.reject(abortError())
    if (login.prompt !== undefined) {
      return Promise.reject(new Error(`llm-pi-ai-oauth: ${login.provider} opened overlapping prompts`))
    }
    const owned: PiAiOAuthPrompt = { ...prompt, id: randomUUID() as PiAiOAuthPromptId }
    return new Promise<string>((resolve, reject) => {
      let settled = false
      const finish = (answer: string | undefined, error?: Error): void => {
        if (settled) return
        settled = true
        login.controller.signal.removeEventListener('abort', cancel)
        prompt.signal?.removeEventListener('abort', cancel)
        if (login.prompt?.id === owned.id) login.prompt = undefined
        if (error !== undefined) reject(error)
        else resolve(answer as string)
      }
      const cancel = (): void => { finish(undefined, abortError()) }
      login.prompt = { id: owned.id, prompt: owned, settle: (answer) => { finish(answer) } }
      login.controller.signal.addEventListener('abort', cancel, { once: true })
      prompt.signal?.addEventListener('abort', cancel, { once: true })
      this.ctx.emit('pi-ai-oauth/login-event', login.provider, { type: 'prompt', prompt: promptView(owned) })
    })
  }

  /** Track one admitted storage mutation until both success and failure settle. */
  private trackStorage<T>(operation: Promise<T>): Promise<T> {
    this.storageOperations.add(operation)
    void operation.finally(() => { this.storageOperations.delete(operation) }).catch(() => undefined)
    return operation
  }
}

/** Cordis loader plugin name. */
export const name = 'llm-pi-ai-oauth'
/** Mount the durable OAuth service. */
export default PiAiOAuthService
