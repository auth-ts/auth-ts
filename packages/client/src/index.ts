export type {
  AuthClientOptions,
  ResolvedAuthClientOptions
} from "./core/auth-client-options.ts"
export type { AuthClient } from "./core/create-auth-client.ts"
export { createAuthClient } from "./core/create-auth-client.ts"
export type { TokenState } from "./core/token-store.ts"
export { REFRESH_AHEAD_MS } from "./core/token-store.ts"
export type { UserListener } from "./core/user-store.ts"

export { AuthError, AuthNetworkError, isAuthError } from "./lib/auth-error.ts"
export type { FetchJson, FetchJsonOptions } from "./lib/fetch-json.ts"
export type { LeveledLogger, Logger, LogLevel } from "./lib/logger.ts"
export type {
  DeleteUserInput,
  DeleteUserResult,
  LogoutInput,
  LogoutScope,
  RevokeSessionInput,
  UpdateUserInput
} from "./methods/account.ts"
export type {
  DisconnectInput,
  SwitchAccountInput
} from "./methods/connections-and-accounts.ts"
export type { OAuthNavigationInput } from "./methods/oauth.ts"
export type {
  SendCodeInput,
  SignInAsGuestInput,
  SignInResult,
  VerifyCodeInput
} from "./methods/sign-in-with-code.ts"
