/**
 * Normalizes the mount path to a leading slash and no trailing slash.
 *
 * Both entries resolve this option and must reach the same string: it is
 * concatenated with a route that already leads with a slash, so a disagreement
 * about either end is a doubled separator or none. A bare `/` keeps its slash —
 * it is the mount, not a prefix.
 */
export function normalizeBasePath(basePath: string) {
  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, "")
    : withLeadingSlash
}
