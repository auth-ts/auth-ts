import type { AdditionalFieldsSchema, AuthWhere } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"

/** Deletes sessions and the codes filed under them, as `ON DELETE CASCADE` would. */
export async function deleteSessions(
  internals: AuthInternals,
  where: AuthWhere<"date", AdditionalFieldsSchema, "sessions">
) {
  const deleted = await internals.db.delete({ table: "sessions", where })
  await Promise.all(
    deleted.map((session) =>
      internals.db.delete({
        table: "verifications",
        where: { identifier: { eq: session.id } }
      })
    )
  )

  return deleted
}
