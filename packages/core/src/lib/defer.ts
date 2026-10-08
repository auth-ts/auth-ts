import type { AuthInternals } from "../core/auth-internals"

/**
 * Runs work behind `waitUntil` where there is one, awaited otherwise.
 *
 * A failure is logged under `label`, never thrown: this is for hygiene and
 * bookkeeping that must not fail the request it rides on. Without `waitUntil`
 * the returned promise must be awaited, because an unawaited promise is not
 * guaranteed to run on Cloudflare Workers once the response has been returned.
 */
export function defer(
  internals: AuthInternals,
  label: string,
  work: Promise<unknown>
) {
  const settled = work.then(
    () => undefined,
    (error) => internals.log.error(`${label} failed`, { error: String(error) })
  )

  if (internals.config.waitUntil) {
    internals.config.waitUntil(settled)
    return
  }

  return settled
}
