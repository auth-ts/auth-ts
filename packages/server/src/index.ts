export type {
  AuthConnection,
  AuthDb,
  AuthMagicCode,
  AuthRateLimit,
  AuthSession,
  AuthUser,
  DeleteSessionWhere,
  GetUserWhere,
  MagicCodePurpose,
  UpsertConnectionInput,
  UpsertMagicCodeInput,
  UpsertSessionInput,
  UpsertUserInput,
  UserType
} from "./core/auth-db.ts"
export type {
  AdditionalFieldsSchema,
  AdditionalFieldType,
  AuthServerOptions,
  CookieOptions,
  CorsOptions,
  EmailOptions,
  JwtOptions,
  ProviderCredentials,
  ProvidersOptions,
  RateLimitOptions,
  RateLimitWindow,
  ResolvedAuthServerOptions,
  SendCodeContext,
  SessionOptions,
  SmsOptions,
  UserOptions
} from "./core/auth-server-options.ts"
export type {
  AuthCallables,
  AuthHandlers,
  AuthServer,
  AuthSessionResult
} from "./core/create-auth-server.ts"
export { createAuthServer } from "./core/create-auth-server.ts"
export type { LogoutInput, LogoutScope } from "./endpoints/logout.ts"
export type { SendCodeInput } from "./endpoints/send-code.ts"
export type { RevokeSessionInput } from "./endpoints/sessions/$id.ts"
export type { SessionInfo } from "./endpoints/sessions.ts"
export type { SignInGuestInput } from "./endpoints/sign-in/guest.ts"
export type { AuthTokenResult } from "./endpoints/token.ts"
export type { DeleteUserInput, UpdateUserInput } from "./endpoints/user.ts"
export type { VerifyCodeInput } from "./endpoints/verify-code.ts"
export { AuthApiError } from "./http/auth-api-error.ts"
export { AuthConfigError } from "./http/auth-config-error.ts"
export type { AuthHandler } from "./http/create-handler.ts"
export type { AuthErrorBody, AuthErrorCode } from "./http/error-response.ts"
export type {
  LocaleMessages,
  LocalizationOptions
} from "./http/get-error-message.ts"
export type { DecodedToken } from "./jwt/decode-token.ts"
export type { JwtAlgorithm } from "./jwt/import-signing-key.ts"
export type { SignTokenClaims } from "./jwt/sign-token.ts"
export type { TokenClaims } from "./jwt/verify-token.ts"
export type { LeveledLogger, Logger, LogLevel } from "./lib/logger.ts"
export type { Duration } from "./lib/parse-duration.ts"
export type { GuestConversion, GuestIdentity } from "./session/convert-guest.ts"
export type { IssueMode } from "./session/issue-session.ts"
export type { HeadersInput } from "./session/resolve-session.ts"
