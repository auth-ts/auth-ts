import { expect } from "vitest"

/**
 * Asserts a value is present and narrows it.
 *
 * Tests reach for `!` constantly — this fails with a useful message instead of a
 * confusing `TypeError` three lines later, and keeps the codebase free of
 * non-null assertions.
 */
export function required<T>(value: T | null | undefined, label: string): T {
  expect(value, `expected ${label} to be present`).toBeDefined()
  expect(value, `expected ${label} not to be null`).not.toBeNull()

  return value as T
}
