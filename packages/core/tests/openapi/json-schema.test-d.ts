import { describe, expectTypeOf, it } from "vitest"
import type { JsonSchema, ObjectSchemaFor } from "../../src/openapi/json-schema"

type Result = {
  expiresAt: Date | null
  scope: string | null
  optional?: string
  optionalNullable?: number | null
  dates: Array<Date | null>
  empty: null
}

describe("ObjectSchemaFor", () => {
  it("preserves nullability independently of optionality", () => {
    const schema: ObjectSchemaFor<Result> = {
      type: "object",
      properties: {
        expiresAt: {
          oneOf: [{ type: "string", format: "date-time" }, { type: "null" }]
        },
        scope: { oneOf: [{ type: "string" }, { type: "null" }] },
        optional: { type: "string" },
        optionalNullable: {
          oneOf: [{ type: "number" }, { type: "null" }]
        },
        dates: {
          type: "array",
          items: {
            oneOf: [{ type: "string", format: "date-time" }, { type: "null" }]
          }
        },
        empty: { type: "null" }
      },
      required: ["expiresAt", "scope", "dates", "empty"]
    }
    expectTypeOf(schema).toMatchTypeOf<JsonSchema>()
  })

  it("rejects schemas that discard nullable types", () => {
    const scope = (schema: ObjectSchemaFor<Result>["properties"]["scope"]) =>
      schema
    const expiry = (
      schema: ObjectSchemaFor<Result>["properties"]["expiresAt"]
    ) => schema
    // @ts-expect-error nullable fields MUST describe null
    scope({ type: "string" })
    // @ts-expect-error dates MUST retain their format
    expiry({ oneOf: [{ type: "string" }, { type: "null" }] })
    // @ts-expect-error null MUST remain the alternative
    scope({ oneOf: [{ type: "string" }, { type: "number" }] })
  })

  it("keeps optional nonnullable fields nonnullable", () => {
    const optional = (
      schema: ObjectSchemaFor<Result>["properties"]["optional"]
    ) => schema
    optional({ type: "string" })
    // @ts-expect-error optionality MUST NOT imply nullability
    optional({ oneOf: [{ type: "string" }, { type: "null" }] })
    const required = (keys: ObjectSchemaFor<Result>["required"]) => keys
    // @ts-expect-error optional fields MUST NOT be required
    required(["optional"])
    // @ts-expect-error optional fields MUST NOT be required
    required(["optionalNullable"])
  })
})
