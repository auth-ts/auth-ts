import { TypeTable } from "fumadocs-ui/components/type-table"
import defaultComponents from "fumadocs-ui/mdx"
import type { ComponentType } from "react"

/** The components every MDX page can use. */
export type MDXComponents = Record<string, ComponentType<never>>

/**
 * The component set available to every MDX page.
 *
 * `TypeTable` is what the build-time type-table plugin compiles
 * `<auto-type-table>` into, so it must be registered here or the reference pages
 * render empty.
 */
export function getMDXComponents(components?: MDXComponents) {
  return { ...defaultComponents, TypeTable, ...components }
}
