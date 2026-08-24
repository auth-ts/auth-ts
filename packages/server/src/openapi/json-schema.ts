/**
 * The JSON Schema keywords this library emits.
 *
 * Not the whole vocabulary — what the endpoint table actually needs. Anything
 * absent here was left out because no endpoint describes itself with it.
 */
export interface JsonSchema {
  type?:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "object"
    | "array"
    | "null"
  description?: string
  enum?: readonly string[]
  format?: string
  properties?: Record<string, JsonSchema | ComponentName>
  required?: readonly string[]
  items?: JsonSchema | ComponentName
  additionalProperties?: boolean | JsonSchema
  example?: unknown
  $ref?: string
}

/**
 * The shapes `components.schemas` publishes, by name.
 *
 * The list lives here rather than in `components.ts` so a schema may reference a
 * sibling by name without the two files importing each other. `components.ts`
 * declares `Record<ComponentName, JsonSchema>`, so a name added here fails to
 * build until it is defined there.
 */
export type ComponentName =
  | "User"
  | "Session"
  | "Identity"
  | "Account"
  | "TokenResult"
  | "RevokeSessionResult"
  | "SignOutResult"
  | "AuthorizeURL"
  | "ProviderToken"
  | "AuthError"
  | "AdditionalFields"

/** The reusable `components.responses` entries, by name. */
export type ComponentResponseName =
  | "Unauthenticated"
  | "NotFound"
  | "InvalidField"
  | "RateLimited"
  | "Forbidden"
  | "Conflict"
  | "MethodNotAllowed"
  | "InternalError"

type RequiredKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? never : K
}[keyof T]

type PropertySchemaFor<V> = [V] extends [string]
  ? JsonSchema & { type: "string" }
  : [V] extends [number]
    ? JsonSchema & { type: "number" | "integer" }
    : [V] extends [boolean]
      ? JsonSchema & { type: "boolean" }
      : [V] extends [Date]
        ? JsonSchema & { type: "string"; format: "date-time" }
        : [V] extends [readonly (infer I)[]]
          ? JsonSchema & { type: "array"; items: PropertySchemaFor<I> }
          : [V] extends [object]
            ? ObjectSchemaFor<V> | ComponentName
            : JsonSchema

/**
 * A JSON Schema for `T` that names every one of its fields.
 *
 * The `-?` on `properties` is the load-bearing part: adding a field to the
 * interface stops this compiling until the field is described. That is what
 * keeps the schemas honest without a validation library to derive them from.
 */
export type ObjectSchemaFor<T> = {
  type: "object"
  properties: {
    [K in keyof T]-?: unknown extends T[K]
      ? JsonSchema
      : PropertySchemaFor<NonNullable<T[K]>>
  }
  required?: ReadonlyArray<RequiredKeys<T> & string>
  additionalProperties?: boolean
  description?: string
}
