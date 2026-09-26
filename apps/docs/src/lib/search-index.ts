/**
 * Where the exported search index is served from.
 *
 * In production the build prerenders the `/api/search` route to a `.json` file,
 * so the extension is part of the path — without it Cloudflare Pages serves the
 * index as `application/octet-stream` and skips compression, which costs about
 * 300 kB on the first search. The dev server has no prerender step, so it is
 * read from the live route instead.
 */
export const SEARCH_INDEX_URL = import.meta.env.DEV
  ? "/api/search"
  : "/api/search.json"
