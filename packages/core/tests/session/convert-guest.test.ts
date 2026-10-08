import { afterEach, describe, expect, it, vi } from "vitest"
import { convertGuest, mergeGuestInto } from "../../src/session/convert-guest"
import { createTestInternals } from "../helpers/create-test-internals"
import { insertUser, selectRow } from "../helpers/rows"

const ada = { kind: "email", value: "ada@example.com" } as const
const grace = { kind: "email", value: "grace@example.com" } as const

afterEach(() => {
  vi.restoreAllMocks()
})

describe("convertGuest", () => {
  it("keeps the guest id and returns the stored row", async () => {
    const { internals, db } = await createTestInternals()
    const guest = await insertUser(db, { type: "guest", name: "Guest" })
    await db.update({
      table: "users",
      where: { id: { eq: guest.id } },
      values: { name: "Stored name" }
    })

    const result = await convertGuest(internals, guest, {
      identifier: ada,
      additionalFields: { plan: "pro" }
    })

    expect(result.created).toBe(true)
    expect(result.user).toMatchObject({
      id: guest.id,
      type: "user",
      email: ada.value,
      name: "Stored name",
      plan: "pro",
      primaryUserId: null
    })
    expect(result.user).toEqual(
      await selectRow(db, "users", { id: { eq: guest.id } })
    )
  })

  it.each([grace, { kind: "phoneNumber", value: "+15551234567" } as const])(
    "separates competing verified identities: $kind",
    async (identifier) => {
      const { internals, db } = await createTestInternals()
      const guest = await insertUser(db, { type: "guest" })

      const [first, second] = await Promise.all([
        convertGuest(internals, guest, {
          identifier: ada,
          additionalFields: { plan: "first" }
        }),
        convertGuest(internals, guest, {
          identifier,
          name: "Grace",
          image: "https://example.com/grace.png",
          additionalFields: { plan: "second" }
        })
      ])

      expect(first.user.id).toBe(guest.id)
      expect(second.user.id).not.toBe(guest.id)
      expect(first.user.email).toBe(ada.value)
      expect(first.user.plan).toBe("first")
      expect(second.user[identifier.kind]).toBe(identifier.value)
      expect(second.user).toMatchObject({
        name: "Grace",
        image: "https://example.com/grace.png",
        plan: "second"
      })
      expect(first.created).toBe(true)
      expect(second.created).toBe(true)
      expect(db.users()).toHaveLength(2)
      expect(first.user).toEqual(
        await selectRow(db, "users", { id: { eq: first.user.id } })
      )
      expect(second.user).toEqual(
        await selectRow(db, "users", { id: { eq: second.user.id } })
      )
    }
  )

  it("resolves the same verified identifier to one account", async () => {
    const { internals, db } = await createTestInternals()
    const guest = await insertUser(db, { type: "guest" })

    const results = await Promise.all([
      convertGuest(internals, guest, {
        identifier: ada,
        additionalFields: { plan: "first" }
      }),
      convertGuest(internals, guest, {
        identifier: ada,
        additionalFields: { plan: "second" }
      })
    ])

    expect(results.map(({ user }) => user.id)).toEqual([guest.id, guest.id])
    expect(results.map(({ created }) => created)).toEqual([true, false])
    expect(db.users()).toHaveLength(1)
    expect(results[1]?.user.plan).toBe("first")
  })

  it("does not upgrade a guest already merged elsewhere", async () => {
    const { internals, db } = await createTestInternals()
    const guest = await insertUser(db, { type: "guest" })
    const owner = await insertUser(db, { email: ada.value })
    await mergeGuestInto(internals, guest, owner)

    const result = await convertGuest(internals, guest, { identifier: grace })

    expect(result.created).toBe(true)
    expect(result.user.id).not.toBe(guest.id)
    expect(result.user.email).toBe(grace.value)
    expect(
      await selectRow(db, "users", { id: { eq: guest.id } })
    ).toMatchObject({
      type: "guest",
      email: null,
      primaryUserId: owner.id
    })
  })

  it("does not merge a guest already upgraded elsewhere", async () => {
    const { internals, db } = await createTestInternals()
    const guest = await insertUser(db, { type: "guest" })
    const owner = await insertUser(db, { email: grace.value })
    await convertGuest(internals, guest, { identifier: ada })

    const result = await mergeGuestInto(internals, guest, owner)

    expect(result).toEqual({ user: owner, created: false })
    expect(
      await selectRow(db, "users", { id: { eq: guest.id } })
    ).toMatchObject({
      type: "user",
      email: ada.value,
      primaryUserId: null
    })
  })

  it("retains the first destination of competing merges", async () => {
    const { internals, db } = await createTestInternals()
    const guest = await insertUser(db, { type: "guest" })
    const first = await insertUser(db, { email: ada.value })
    const second = await insertUser(db, { email: grace.value })

    const results = await Promise.all([
      mergeGuestInto(internals, guest, first),
      mergeGuestInto(internals, guest, second)
    ])

    expect(results.map(({ user }) => user.id)).toEqual([first.id, second.id])
    expect(
      await selectRow(db, "users", { id: { eq: guest.id } })
    ).toMatchObject({
      type: "guest",
      primaryUserId: first.id
    })
  })

  it("recovers when another account claims the identifier before the upgrade", async () => {
    const { internals, db } = await createTestInternals()
    const guest = await insertUser(db, { type: "guest" })
    const update = db.update.bind(db)
    let ownerId: string | undefined
    vi.spyOn(db, "update").mockImplementation(async (input) => {
      if (
        input.table === "users" &&
        "type" in input.values &&
        input.values.type === "user"
      ) {
        const owner = await insertUser(db, { email: ada.value })
        ownerId = owner.id
      }
      return (await update(input)) as never
    })

    const result = await convertGuest(internals, guest, { identifier: ada })

    expect(result.created).toBe(false)
    expect(result.user.id).toBe(ownerId)
    expect(
      await selectRow(db, "users", { id: { eq: guest.id } })
    ).toMatchObject({
      type: "guest",
      email: null,
      primaryUserId: ownerId
    })
  })

  it("does not fabricate an upgrade when the conditional write matched nothing", async () => {
    const { internals, db } = await createTestInternals()
    const guest = await insertUser(db, { type: "guest" })
    const update = db.update.bind(db)
    vi.spyOn(db, "update").mockImplementation(async (input) => {
      if (
        input.table === "users" &&
        "type" in input.values &&
        input.values.type === "user"
      )
        return []
      return (await update(input)) as never
    })

    const result = await convertGuest(internals, guest, { identifier: ada })

    expect(result.user.id).not.toBe(guest.id)
    expect(result.user.email).toBe(ada.value)
    expect(await selectRow(db, "users", { id: { eq: guest.id } })).toEqual(
      guest
    )
  })

  it("propagates a database error without a matching verified identity", async () => {
    const { internals, db } = await createTestInternals()
    const guest = await insertUser(db, { type: "guest" })
    const failure = new Error("database unavailable")
    vi.spyOn(db, "update").mockRejectedValue(failure)

    await expect(
      convertGuest(internals, guest, { identifier: ada })
    ).rejects.toBe(failure)
    expect(db.users()).toEqual([guest])
  })

  it("preserves a real account when called with a stale guest snapshot", async () => {
    const { internals, db } = await createTestInternals()
    const guest = await insertUser(db, { type: "guest" })
    await convertGuest(internals, guest, {
      identifier: ada,
      additionalFields: { plan: "pro" }
    })
    await db.update({
      table: "users",
      where: { id: { eq: guest.id } },
      values: { type: "admin" }
    })

    const result = await convertGuest(internals, guest, {
      identifier: ada,
      name: "Ada",
      additionalFields: { plan: "enterprise" }
    })

    expect(result.created).toBe(false)
    expect(result.user).toMatchObject({
      id: guest.id,
      type: "admin",
      name: "Ada",
      plan: "pro",
      primaryUserId: null
    })
  })
})
