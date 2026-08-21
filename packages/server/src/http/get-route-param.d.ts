/**
 * Splits a request path into the segments below `basePath`.
 *
 * Tolerates a trailing slash on either side and percent-decodes each segment, so
 * `/sessions/abc%2Fdef` yields one segment containing a slash rather than two
 * segments — a decoded separator must never become a path boundary.
 *
 * @returns The segments, or `null` when the path is outside the mount.
 */
export declare function splitPathSegments(pathname: string, basePath: string): string[] | null;
//# sourceMappingURL=get-route-param.d.ts.map