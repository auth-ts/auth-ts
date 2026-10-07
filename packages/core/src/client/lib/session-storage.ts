import { encodeBase64url } from "../../shared/base64url"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { decodeToken } from "./decode-token"

/** Use platform-protected storage for persistent credentials. */
export interface SessionStorage {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}

/** Verification handles expire and remain session-bound. */
export function rememberAttempt(
  internals: AuthClientInternals,
  purpose: keyof AuthClientInternals["attempts"],
  token: string,
  verified = false
) {
  if (!internals.sessionStore) return
  const sessionId = decodeToken(internals.tokenStore.get()?.token ?? "")?.claims
    .sid
  internals.attempts[purpose] = {
    token,
    expiresAt: Date.now() + (verified ? 60 * 60_000 : 10 * 60_000),
    ...(purpose !== "signIn" && typeof sessionId === "string"
      ? { sessionId }
      : {})
  }
}

/** Verification must stay on its initiating session. */
export function currentAttempt(
  internals: AuthClientInternals,
  purpose: keyof AuthClientInternals["attempts"]
) {
  const value = internals.attempts[purpose]
  if (!value || value.expiresAt <= Date.now()) return undefined
  const sessionId = decodeToken(internals.tokenStore.get()?.token ?? "")?.claims
    .sid
  if (purpose !== "signIn" && value.sessionId !== sessionId) return undefined
  return value.token
}

/** Credentials remain isolated by backend and account. */
export interface StoredSessions {
  active?: string
  multiUser: boolean
  accounts: Record<string, string>
}

/** Mutations serialize across clients sharing storage. */
export interface SessionStore {
  read(): Promise<StoredSessions>
  put(
    userId: string,
    token: string,
    multiUser: boolean,
    current: (data: StoredSessions) => boolean
  ): Promise<boolean>
  select(
    userId: string,
    token: string,
    current: (data: StoredSessions) => boolean
  ): Promise<boolean>
  remove(userId: string, token: string): Promise<void>
}

const queues = new Map<string, Promise<unknown>>()

/** Namespace keys remain compatible with secure stores. */
export function createSessionStore(
  storage: SessionStorage,
  baseURL: string,
  basePath: string
): SessionStore {
  const key = `auth-ts.sessions.${encodeBase64url(new URL(baseURL).origin + basePath)}`
  const read = async (): Promise<StoredSessions> => {
    const raw = await storage.getItem(key)
    if (raw) {
      try {
        const value: unknown = JSON.parse(raw)
        if (
          value &&
          typeof value === "object" &&
          "accounts" in value &&
          "multiUser" in value
        ) {
          const data = value as StoredSessions
          if (
            data.accounts &&
            typeof data.accounts === "object" &&
            !Array.isArray(data.accounts)
          ) {
            const accounts = Object.fromEntries(
              Object.entries(data.accounts).filter(
                ([, token]) => typeof token === "string" && token.length > 0
              )
            )
            return {
              accounts,
              multiUser: data.multiUser === true,
              ...(typeof data.active === "string" &&
              Object.hasOwn(accounts, data.active)
                ? { active: data.active }
                : {})
            }
          }
        }
      } catch {}
    }
    return { accounts: {}, multiUser: false }
  }
  const mutate = <T>(change: (data: StoredSessions) => T): Promise<T> => {
    const pending = (queues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const data = await read()
        const result = change(data)
        if (Object.keys(data.accounts).length)
          await storage.setItem(key, JSON.stringify(data))
        else await storage.removeItem(key)
        return result
      })
    queues.set(key, pending)
    void pending
      .finally(() => {
        if (queues.get(key) === pending) queues.delete(key)
      })
      .catch(() => {})
    return pending
  }
  return {
    async read() {
      await queues.get(key)?.catch(() => {})
      return read()
    },
    put(userId, token, multiUser, current) {
      return mutate((data) => {
        if (!current(data)) return false
        Object.defineProperty(data.accounts, userId, {
          value: token,
          enumerable: true,
          configurable: true,
          writable: true
        })
        data.active = userId
        data.multiUser = multiUser
        return true
      })
    },
    select(userId, token, current) {
      return mutate((data) => {
        if (!current(data) || data.accounts[userId] !== token) return false
        data.active = userId
        return true
      })
    },
    remove(userId, token) {
      return mutate((data) => {
        if (data.accounts[userId] !== token) return
        delete data.accounts[userId]
        if (data.active === userId) {
          if (data.multiUser) data.active = Object.keys(data.accounts)[0]
          else delete data.active
        }
      })
    }
  }
}
