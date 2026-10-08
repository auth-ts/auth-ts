/**
 * Validates a post-sign-in redirect target, returning a safe path.
 *
 * The open-redirect guard, and it defaults closed. A value is accepted only when
 * it is a same-origin relative path: it must start with `/`, must not start with
 * `//` (protocol-relative URLs like `//evil.com` are absolute to a browser), and
 * must not contain a scheme. Anything else falls back to `"/"` rather than
 * failing the sign-in, because a bad `?redirect=` is not a reason to lock
 * someone out of their account.
 *
 * @param redirect - Untrusted `?redirect=` value.
 * @param allowlist - Optional exact paths; when given, the value must be one of them.
 */
export function validateRedirect(
  redirect: string | null | undefined,
  allowlist?: readonly string[]
) {
  if (!redirect) return "/"

  // Reject C0 controls and DEL before any structural check. The URL parser
  // strips tab, newline, and carriage return before parsing, so "/\t/evil.com"
  // slips past the "//" test below and then resolves to evil.com anyway. No
  // legitimate path contains these, so the whole range is refused rather than
  // just the three known to be stripped today.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  if (/[\u0000-\u001f\u007f]/.test(redirect)) return "/"

  const isRelativePath =
    redirect.startsWith("/") &&
    !redirect.startsWith("//") &&
    !redirect.includes("\\") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(redirect)

  if (!isRelativePath) return "/"
  if (allowlist && !allowlist.includes(redirect)) return "/"

  return redirect
}
