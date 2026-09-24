import Link from "fumadocs-core/link"
import type * as PageTree from "fumadocs-core/page-tree"
import { useTreeContext, useTreePath } from "fumadocs-ui/contexts/tree"

function firstPageUrl(folder: PageTree.Folder): string | undefined {
  if (folder.index) return folder.index.url

  for (const child of folder.children) {
    const url =
      child.type === "page"
        ? child.url
        : child.type === "folder"
          ? firstPageUrl(child)
          : undefined
    if (url) return url
  }
}

/** The page tree's root folders, as tabs beside the logo. */
export function SectionTabs({ className }: { className: string }) {
  const { full } = useTreeContext()
  const active = useTreePath().find(
    (node) => node.type === "folder" && node.root
  )

  return (
    <nav className={`flex gap-6 ${className}`}>
      {full.children.map((node) => {
        const url = node.type === "folder" && node.root && firstPageUrl(node)
        if (!url) return null

        return (
          <Link
            key={node.$id ?? url}
            href={url}
            data-active={node.$id === active?.$id}
            className="text-fd-muted-foreground hover:text-fd-accent-foreground data-[active=true]:border-fd-primary data-[active=true]:text-fd-primary -mb-px inline-flex items-center border-b-2 py-2 border-transparent text-sm transition-colors"
          >
            {node.name}
          </Link>
        )
      })}
    </nav>
  )
}
