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
export declare function validateRedirect(redirect: string | null | undefined, allowlist?: readonly string[]): string;
//# sourceMappingURL=validate-redirect.d.ts.map