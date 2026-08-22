import { describe, expect, it, vi } from "vitest"
import { updateUser } from "../../src/user/update-user"
import { createTestInternals } from "../helpers/create-test-internals"
import { insertUser, selectRow } from "../helpers/rows"

describe("updateUser", () => {
  it("applies the defined fields and returns the row as it now stands", async () => {
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })

    const updated = await updateUser(internals, user, { name: "Ada" })

    expect(updated.name).toBe("Ada")
    expect((await selectRow(db, "users", { id: user.id }))?.name).toBe("Ada")
  })

  it("treats undefined as leave alone rather than as null", async () => {
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, {
      email: "ada@example.com",
      imageURL: "https://img.example/a.png"
    })

    const updated = await updateUser(internals, user, {
      name: "Ada",
      imageURL: undefined
    })

    expect(updated.imageURL).toBe("https://img.example/a.png")
  })

  it("writes nothing when every field was undefined", async () => {
    // The rule that lets every implementation skip a guard against the empty
    // `SET` most query builders refuse: core never sends one.
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })
    const update = vi.spyOn(db, "update")

    const unchanged = await updateUser(internals, user, {
      name: undefined,
      imageURL: undefined
    })

    expect(update).not.toHaveBeenCalled()
    expect(unchanged).toBe(user)
  })

  it("writes null when null is what was asked for", async () => {
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com", name: "Ada" })

    const updated = await updateUser(internals, user, { name: null })

    expect(updated.name).toBeNull()
    expect((await selectRow(db, "users", { id: user.id }))?.name).toBeNull()
  })
})
