/**
 * Parses a `Cookie` request header into a name → value map.
 *
 * Values are percent-decoded to mirror {@link serializeCookie}, which encodes
 * them. Unparseable pairs are skipped rather than throwing: a malformed cookie
 * from some unrelated script must not take down authentication.
 */
export declare function parseCookies(cookieHeader: string | null | undefined): Map<string, string>;
/** Reads a single cookie from a `Headers` object, or `undefined` when absent. */
export declare function readCookie(headers: Headers, name: string): string | undefined;
//# sourceMappingURL=parse-cookies.d.ts.map