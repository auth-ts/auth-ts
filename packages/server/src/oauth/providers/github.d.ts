import type { OAuthProvider } from "./oauth-provider.ts";
/**
 * GitHub sign-in.
 *
 * Scope is `read:user user:email` because the profile response does not include
 * a usable email — `/user/emails` is a second call, and the only one that reports
 * verification status.
 */
export declare const github: OAuthProvider;
//# sourceMappingURL=github.d.ts.map