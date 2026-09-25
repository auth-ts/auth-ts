import * as Twoslash from "fumadocs-twoslash/ui"
import { Accordion, Accordions } from "fumadocs-ui/components/accordion"
import { File, Files, Folder } from "fumadocs-ui/components/files"
import { Step, Steps } from "fumadocs-ui/components/steps"
import { Tab, Tabs } from "fumadocs-ui/components/tabs"
import { TypeTable } from "fumadocs-ui/components/type-table"
import defaultComponents from "fumadocs-ui/mdx"
import type { ComponentProps, ComponentType } from "react"

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
  return {
    ...defaultComponents,
    ...Twoslash,
    Accordion,
    Accordions,
    File,
    Files,
    Folder,
    Step,
    Steps,
    Tab,
    Tabs,
    // Row ids rewrite the hash, which scrolls.
    TypeTable: ({ id: _, ...props }: ComponentProps<typeof TypeTable>) => (
      <TypeTable {...props} />
    ),
    ...components
  }
}
