import type { AdditionalFieldsSchema } from "../core/auth-database"
import { AuthApiError } from "./auth-api-error"
import { AuthConfigError } from "./auth-config-error"

/** A validated set of additional-field values. */
export type AdditionalFieldValues = Record<string, string | number | boolean>

/**
 * Rejects a schema that redeclares a field core owns.
 *
 * Runs at construction, so a colliding declaration is a startup failure rather
 * than a field that silently stops working. `name` and `image` are included
 * because `POST /user` takes a flat body and two fields with one name cannot both
 * win.
 *
 * @throws {AuthConfigError} When a reserved name is declared.
 */
export function assertNoReservedFields(
  schema: AdditionalFieldsSchema,
  reserved: readonly string[]
) {
  for (const fieldName of Object.keys(schema)) {
    if (reserved.includes(fieldName)) {
      throw new AuthConfigError(
        `user.additionalFields cannot declare "${fieldName}" — core owns that field. Reserved: ${reserved.join(", ")}.`
      )
    }
  }
}

/**
 * Validates request-supplied additional fields against the declared schema.
 *
 * This is the security boundary for additional fields. The end-to-end types make
 * the right call easy, but types are erased at runtime, so an undeclared key or a
 * wrong primitive is rejected here — otherwise any request could set any column,
 * which is mass assignment with extra steps.
 *
 * @param schema - Declared fields, from `user.additionalFields`.
 * @param value - The untrusted `additionalFields` object from a request body.
 * @throws {AuthApiError} `invalidField` for undeclared keys or wrong types.
 */
export function validateAdditionalFields(
  schema: AdditionalFieldsSchema,
  value: unknown
): AdditionalFieldValues {
  if (value === undefined || value === null) return {}

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AuthApiError("invalidField", 400, {
      message: "additionalFields must be an object."
    })
  }

  const validated: AdditionalFieldValues = {}

  for (const [fieldName, fieldValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (fieldValue === undefined) continue

    const declaredType = schema[fieldName]
    if (!declaredType) {
      throw new AuthApiError("invalidField", 400, {
        message: `Unknown field: ${fieldName}.`
      })
    }

    if (typeof fieldValue !== declaredType) {
      throw new AuthApiError("invalidField", 400, {
        message: `Field ${fieldName} must be a ${declaredType}.`
      })
    }

    validated[fieldName] = fieldValue as string | number | boolean
  }

  return validated
}
