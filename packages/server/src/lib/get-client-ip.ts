/**
 * Extracts the client IP from proxy headers.
 *
 * Order is leftmost `X-Forwarded-For` entry, then `X-Real-IP`. Web-standard
 * `Request` exposes no socket address, so behind no proxy this returns
 * `undefined` and IP-keyed rate limits are skipped for that request.
 *
 * Deployment note worth repeating in the docs: if a platform does not set either
 * header, every visitor shares one limiter bucket — a self-inflicted denial of
 * service on sign-in. One extractor is used everywhere an IP is read, so this is
 * the single place that behaviour is defined.
 */
export function getClientIp(headers: Headers) {
  const forwardedFor = headers.get("x-forwarded-for")
  if (forwardedFor) {
    const leftmost = forwardedFor.split(",")[0]?.trim()
    if (leftmost) return leftmost
  }

  return headers.get("x-real-ip")?.trim() || undefined
}
