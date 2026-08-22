export type {
  AdditionalFields,
  AdditionalFieldsInput,
  AdditionalFieldsSchema,
  AdditionalFieldType,
  AdditionalFieldValue,
  AuthAttempt,
  AuthConnection,
  AuthDB,
  AuthDeleteInput,
  AuthDirection,
  AuthInsert,
  AuthInsertInput,
  AuthOrderBy,
  AuthRow,
  AuthSelectInput,
  AuthSession,
  AuthTable,
  AuthTables,
  AuthUpdateInput,
  AuthUser,
  AuthVerificationCode,
  AuthWhere,
  CoreUserFields,
  UserType,
  VerificationCodePurpose
} from "./core/auth-db"
export { defineAuthDB } from "./core/auth-db"
export type { AuthServerConfig } from "./core/auth-server-config"
export type {
  AuthServerOptions,
  CookieOptions,
  CorsOptions,
  EmailOptions,
  JwksOptions,
  JwtOptions,
  ProviderCredentials,
  ProvidersOptions,
  RateLimitOptions,
  RateLimitWindow,
  SendCodeContext,
  SessionOptions,
  SmsOptions,
  UserOptions
} from "./core/auth-server-options"
export type {
  AuthCallables,
  AuthHandlers,
  AuthServer,
  AuthSessionResult
} from "./core/create-auth-server"
export { createAuthServer } from "./core/create-auth-server"
export type { AccountInfo, ListAccountsInput } from "./endpoints/accounts"
export type { SwitchAccountInput } from "./endpoints/accounts/switch"
export type { CallbackProviderInput } from "./endpoints/callback/$provider"
export type { ConnectProviderInput } from "./endpoints/connect/$provider"
export type { ConnectionInfo } from "./endpoints/connections"
export type { DisconnectProviderInput } from "./endpoints/connections/$provider"
export type {
  LogoutAccount,
  LogoutInput,
  LogoutScope
} from "./endpoints/logout"
export type { SendCodeInput } from "./endpoints/send-code"
export type { SessionInfo } from "./endpoints/sessions"
export type {
  RevokeSessionInput,
  RevokeSessionResult
} from "./endpoints/sessions/$id"
export type { SignInProviderInput } from "./endpoints/sign-in/$provider"
export type { SignInGuestInput } from "./endpoints/sign-in/guest"
export type { AuthTokenResult, TokenSession } from "./endpoints/token"
export type { DeleteUserInput, UpdateUserInput } from "./endpoints/user"
export type { VerifyCodeInput } from "./endpoints/verify-code"
export { AuthApiError } from "./http/auth-api-error"
export { AuthConfigError } from "./http/auth-config-error"
export type { AuthHandler } from "./http/create-handler"
export type { AuthErrorBody, AuthErrorCode } from "./http/error-response"
export type {
  LocaleMessages,
  LocalizationOptions
} from "./http/get-error-message"
export type { DecodedToken } from "./jwt/decode-token"
export type { JwtAlgorithm } from "./jwt/import-signing-key"
export type { SignTokenClaims } from "./jwt/sign-token"
export type { TokenClaims, UnverifiedClaims } from "./jwt/verify-token"
export type {
  IpAddressConfig,
  IpAddressOptions
} from "./lib/ip-address"
export { isIpAddress } from "./lib/ip-address"
export type { LeveledLogger, Logger, LogLevel } from "./lib/logger"
export type { Duration } from "./lib/parse-duration"
export type {
  OAuthProvider,
  ProviderIdentity
} from "./oauth/providers/oauth-provider"
export type { OAuthStatePayload, StateCookie } from "./oauth/state-cookie"
export type { GuestConversion, GuestIdentity } from "./session/convert-guest"
export type { IssueMode } from "./session/issue-session"
export type { HeadersInput } from "./session/resolve-session"
