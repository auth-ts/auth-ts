import type { AuthIdentity, CoreUserFields } from "../core/auth-db"
import type { ProviderTokenResult } from "../endpoints/identities/$id/token"
import type { SessionInfo } from "../endpoints/sessions"
import type { TokenResult } from "../endpoints/token"
import type { AuthErrorBody } from "../http/error-response"
import type {
  ComponentName,
  ComponentResponseName,
  JsonSchema,
  ObjectSchemaFor
} from "./json-schema"

const user: ObjectSchemaFor<CoreUserFields> = {
  type: "object",
  properties: {
    id: { type: "string" },
    email: { type: "string", format: "email" },
    phoneNumber: { type: "string", description: "E.164." },
    name: { type: "string" },
    image: { type: "string" },
    type: { type: "string", enum: ["user", "guest"] },
    primaryUserId: {
      type: "string",
      description: "On a guest whose sign-in resolved to an existing account."
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  },
  required: ["id", "type", "createdAt", "updatedAt"]
}

const session: ObjectSchemaFor<SessionInfo> = {
  type: "object",
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    userAgent: { type: "string" },
    ipAddress: { type: "string" }
  },
  required: ["id", "userId", "createdAt", "expiresAt", "updatedAt"]
}

const identity: ObjectSchemaFor<AuthIdentity> = {
  type: "object",
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    provider: { type: "string" },
    providerUserId: {
      type: "string",
      description:
        "The provider's stable id \u2014 GitHub's numeric id, Google's `sub`."
    },
    label: { type: "string", description: "Display only." },
    scope: {
      type: "string",
      description: "Space-delimited, as the provider returned it."
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  },
  required: [
    "id",
    "userId",
    "provider",
    "providerUserId",
    "createdAt",
    "updatedAt"
  ]
}

const providerToken: ObjectSchemaFor<ProviderTokenResult> = {
  type: "object",
  properties: {
    token: { type: "string" },
    expiresAt: {
      type: "string",
      format: "date-time",
      description: "Null for a provider whose tokens do not expire."
    },
    scope: { type: "string", description: "Space-delimited, as granted." }
  },
  required: ["token", "expiresAt", "scope"]
}

const tokenResult: ObjectSchemaFor<TokenResult> = {
  type: "object",
  properties: { token: { type: "string" }, user: "User" },
  required: ["token", "user"]
}

/**
 * Every value `code` can take, for the schema's enum.
 *
 * Listed rather than derived: a union of string literals has no runtime form to
 * read. A type test asserts it against {@link AuthErrorCode} in both directions,
 * so adding a code without adding it here fails the build.
 */
export const ERROR_CODES = [
  "cooldown",
  "rateLimited",
  "invalidCode",
  "codeSent",
  "staleSession",
  "unauthenticated",
  "providerConflict",
  "channelNotConfigured",
  "invalidField",
  "notFound",
  "methodNotAllowed",
  "forbiddenOrigin",
  "unsupportedMediaType",
  "guestCannotReceiveCode",
  "guestRequiresSignOut",
  "providerUnavailable",
  "providerReconnectRequired",
  "internalError"
] as const

const authError: ObjectSchemaFor<AuthErrorBody> = {
  type: "object",
  properties: {
    name: { type: "string", enum: ["AuthError"] },
    code: { type: "string", enum: ERROR_CODES },
    message: {
      type: "string",
      description: "Localized. Switch on `code`, never on this."
    },
    retryAfter: {
      type: "integer",
      description: "Seconds; on `cooldown` and `rateLimited`."
    }
  },
  required: ["name", "code", "message"]
}

/**
 * The shapes every operation shares, declared once.
 *
 * Typed against the real interfaces, so a field added to `AuthSession` or
 * `AuthErrorBody` stops this compiling until it is described here. The builder
 * turns a bare {@link ComponentName} anywhere a schema is expected into a `$ref`
 * pointing at one of these.
 */
export const componentSchemas: Record<ComponentName, JsonSchema> = {
  User: user,
  Session: session,
  Identity: identity,
  Account: user,
  TokenResult: tokenResult,
  ProviderToken: providerToken,
  AuthorizeURL: {
    type: "object",
    properties: { url: { type: "string", format: "uri" } },
    required: ["url"]
  },
  AuthError: authError,
  AdditionalFields: { type: "object", additionalProperties: true }
}

function failure(description: string) {
  return {
    description,
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/AuthError" } }
    }
  }
}

/**
 * The failures every operation draws from, so the envelope is described once.
 *
 * Statuses are the author's to pick per endpoint — the same status carries
 * different codes on different routes, and `code` is what a client switches on.
 */
export const componentResponses: Record<
  ComponentResponseName,
  ReturnType<typeof failure>
> = {
  Unauthenticated: failure("No session, or a session that no longer resolves."),
  NotFound: failure("No such route, provider, session, or account."),
  InvalidField: failure(
    "A field was unknown, reserved, or the wrong primitive type."
  ),
  RateLimited: {
    ...failure(
      "A cooldown or fixed-window limit was exceeded. `retryAfter` carries the wait, mirrored into the `Retry-After` header."
    ),
    headers: { "Retry-After": { schema: { type: "integer" } } }
  } as ReturnType<typeof failure>,
  Forbidden: failure("The origin is not one this server serves."),
  StaleSession: failure(
    "The session is too old for this action without re-proving identity."
  ),
  Conflict: failure(
    "That provider identity is already linked to a different user."
  ),
  GuestCannotReceiveCode: failure(
    "The account has no email or phone number to send a code to."
  ),
  MethodNotAllowed: failure("The method is not allowed for this path."),
  InternalError: failure(
    "Something threw that this library did not anticipate."
  )
}
