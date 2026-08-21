import type { AdditionalFieldsSchema } from "../core/auth-server-options.ts"
/** A validated set of additional-field values. */
export type AdditionalFieldValues = Record<string, string | number | boolean>
/**
 * Rejects a schema that redeclares a field core owns.
 *
 * Runs at construction, so a colliding declaration is a startup failure rather
 * than a field that silently stops working. `name` and `imageURL` are included
 * because `PATCH /user` takes a flat body and two fields with one name cannot both
 * win.
 *
 * @throws {AuthConfigError} When a reserved name is declared.
 */
export declare function assertNoReservedFields(
  schema: AdditionalFieldsSchema,
  reserved: readonly string[]
): void
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
export declare function validateAdditionalFields(
  schema: AdditionalFieldsSchema,
  value: unknown
): AdditionalFieldValues
//# sourceMappingURL=validate-additional-fields.d.ts.map
