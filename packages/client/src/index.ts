export type { AuthClientConfig } from "./core/auth-client-config"
export type { AuthClientOptions } from "./core/auth-client-options"
export type { AuthClient } from "./core/create-auth-client"
export { createAuthClient } from "./core/create-auth-client"
export type { TokenState } from "./core/token-store"
export { REFRESH_AHEAD_MS } from "./core/token-store"
export type { UserListener } from "./core/user-store"

export { AuthError, AuthNetworkError, isAuthError } from "./lib/auth-error"
export type { FetchJson, FetchJsonOptions } from "./lib/fetch-json"
export type { LeveledLogger, Logger, LogLevel } from "./lib/logger"
export type {
  DeleteUserInput,
  DeleteUserResult,
  LogoutAccount,
  LogoutInput,
  LogoutScope,
  RevokeSessionInput,
  UpdateUserInput
} from "./methods/account"
export type {
  DisconnectInput,
  SwitchAccountInput
} from "./methods/connections-and-accounts"
export type { OAuthNavigationInput } from "./methods/oauth"
export type {
  SendCodeInput,
  SignInAsGuestInput,
  SignInResult,
  VerifyCodeInput
} from "./methods/sign-in-with-code"
