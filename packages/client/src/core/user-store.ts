import type { AuthUser } from "@auth-ts/server"

/** Called with the current user whenever it changes. */
export type UserListener = (user: AuthUser | null) => void

/** Reacts to a change another tab made, before subscribers are notified. */
export type ExternalChangeListener = (user: AuthUser | null) => void

/** Holds the current user and notifies subscribers when it changes. */
export interface UserStore {
  get(): AuthUser | null
  set(user: AuthUser | null): void
  subscribe(listener: UserListener): () => void
  /** Reads the persisted user, used once on first access. */
  restore(): AuthUser | null
}

/**
 * Where the user mirror is kept between page loads.
 *
 * Implementation detail, deliberately not public API: it exists so an offline
 * page can still show who is signed in, and so a sign-out in one tab reaches the
 * others. It is a render hint and nothing more — the access token is never
 * stored here, and every actual authorization decision happens server-side
 * against the cookie.
 */
const STORAGE_KEY = "auth-ts.user"

function readStorage(): AuthUser | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    // Private browsing, disabled storage, or corrupt JSON. None of these are a
    // reason to fail: the mirror is an optimisation, not a source of truth.
    return null
  }
}

function writeStorage(user: AuthUser | null) {
  try {
    if (user)
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(user))
    else globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // Same reasoning as reading: never let storage break authentication.
  }
}

/**
 * Creates the user store.
 *
 * Construction touches nothing — no storage read, no listener, no network — so
 * importing the module is free and safe during server-side rendering. Everything
 * is wired lazily on first use.
 */
export function createUserStore(
  onExternalChange?: ExternalChangeListener
): UserStore {
  let user: AuthUser | null = null
  let restored = false
  const listeners = new Set<UserListener>()
  let storageListenerAttached = false

  const notify = () => {
    for (const listener of listeners) listener(user)
  }

  const attachStorageListener = () => {
    if (
      storageListenerAttached ||
      typeof globalThis.addEventListener !== "function"
    )
      return
    storageListenerAttached = true

    globalThis.addEventListener("storage", (event) => {
      const storageEvent = event as StorageEvent
      if (storageEvent.key !== STORAGE_KEY) return

      // Update memory and notify only — never fetch. Every open tab hitting the
      // refresh endpoint the moment one of them signs in is a stampede against
      // your own server.
      user = storageEvent.newValue
        ? (JSON.parse(storageEvent.newValue) as AuthUser)
        : null

      // The access token is per-tab memory, so the storage event does not cover
      // it. Without this, a tab informed of a sign-out elsewhere would render as
      // signed out while its cached token kept working against the data plane
      // until it expired.
      onExternalChange?.(user)
      notify()
    })
  }

  return {
    get: () => user,

    set(nextUser) {
      // Attached on first write, not only on subscribe: a tab that just calls
      // getToken still needs to hear about a sign-out in another tab, and it may
      // never subscribe to anything.
      attachStorageListener()
      user = nextUser
      restored = true
      writeStorage(nextUser)
      notify()
    },

    subscribe(listener) {
      attachStorageListener()
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },

    restore() {
      if (!restored) {
        user = readStorage()
        restored = true
        attachStorageListener()
      }

      return user
    }
  }
}
