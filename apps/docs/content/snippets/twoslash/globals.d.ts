import type {
  AdditionalFieldsSchema,
  Auth,
  AuthDatabase,
  AuthOptions,
  AuthTimestampMode,
  defineAuthDatabase as define,
  SendCodeContext,
  TokenResult
} from "@auth-ts/core"
import type {
  AuthClient,
  createAuthClient as createClient,
  isAuthError as isError
} from "@auth-ts/core/client"
import type { NeonPostgrestClient } from "@neondatabase/postgrest-js"
import type { QueryClient, UseQueryResult } from "@tanstack/react-query"
import type { AnyRootRoute } from "@tanstack/react-router"
import "@tanstack/react-start"

declare module "@tanstack/react-router" {
  interface FileRoutesByPath {
    "/api/auth/$": {
      id: "/api/auth/$"
      path: "/api/auth/$"
      fullPath: "/api/auth/$"
      preLoaderRoute: unknown
      parentRoute: AnyRootRoute
    }
  }
}

// Names docs fragments assume the reader has.
declare global {
  const auth: Auth
  const authClient: AuthClient
  const authDatabase: AuthDatabase
  // Partial, because fragments elide options with /* ... */.
  function createAuth<
    S extends AdditionalFieldsSchema = AdditionalFieldsSchema
  >(options: Partial<AuthOptions<S>>): Auth<S>
  function defineAuthDatabase<
    M extends AuthTimestampMode = "date",
    S extends AdditionalFieldsSchema = AdditionalFieldsSchema
  >(
    implementation: Partial<Parameters<typeof define<M, S>>[0]>
  ): ReturnType<typeof define<M, S>>
  const createAuthClient: typeof createClient
  const isAuthError: typeof isError
  const sendCode: (
    context: SendCodeContext & { email: string }
  ) => Promise<void>

  type Database = any
  const postgrest: NeonPostgrestClient<Database>
  const queryClient: QueryClient
  function useToken(): UseQueryResult<string | null>
  function confirmed<T>(action: () => Promise<T>): Promise<T>

  const request: Request
  const session: TokenResult
  const token: string
  const code: string
  const email: string
  const newEmail: string
  const phoneNumber: string
  const id: string
  const userId: string
  const url: string
  const cutoff: Date
  let lastCode: string

  const DATA_API_URL: string
  const SUPABASE_URL: string
  const SUPABASE_PUBLISHABLE_KEY: string

  function askForCode(): Promise<string>
  function showCountdown(seconds: number | undefined): void
  function organizationIdsFor(userId: string): Promise<string[]>
  function run(sql: string, params: unknown[]): Promise<any[]>
  const yourEmailProvider: {
    send(message: { to: string; subject: string; text: string }): Promise<void>
  }
  const yourSmsProvider: {
    send(message: { to: string; body: string }): Promise<void>
  }
}
