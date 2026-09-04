export type { AuthClientConfig } from "./client/core/auth-client-config"
export type { AuthClientOptions } from "./client/core/auth-client-options"
export type { AuthClient } from "./client/core/create-auth-client"
export { createAuthClient } from "./client/core/create-auth-client"
export {
  AuthError,
  AuthNetworkError,
  isAuthError
} from "./client/lib/auth-error"
export type { CookieStorage } from "./client/lib/cookie-jar"
export type { Logger, LogLevel } from "./client/lib/logger"
export type {
  DeleteUserInput,
  DeleteUserResult,
  SignOutInput,
  SignOutScope,
  UpdateUserInput
} from "./client/methods/account"
export type { GetTokenOptions, RefreshToken } from "./client/methods/get-token"
export type {
  GetProviderTokenInput,
  SwitchUserInput
} from "./client/methods/identities-and-users"
export type { OAuthNavigationInput } from "./client/methods/oauth"
export type {
  SendSignInCodeInput,
  SignInAsGuestInput,
  SignInResult,
  SignInWithCodeInput
} from "./client/methods/sign-in"
export type { AuthUser } from "./core/auth-database"
export type { TokenResult } from "./endpoints/token"
export type { AuthErrorCode } from "./http/error-response"
