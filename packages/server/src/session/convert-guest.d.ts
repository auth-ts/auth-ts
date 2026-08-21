import type { AuthUser } from "../core/auth-db.ts";
import type { AuthServerInternals } from "../core/auth-server-internals.ts";
/** Identity details learned during a sign-in that a guest is completing. */
export interface GuestIdentity {
    email?: string;
    phoneNumber?: string;
    name?: string;
    imageURL?: string;
}
/** The outcome of converting a guest. */
export interface GuestConversion {
    /** The user the new session belongs to. */
    user: AuthUser;
    /**
     * `"upgraded"` — the guest row became a real user, keeping its id.
     * `"merged"` — the identifier already belonged to someone, so the guest points at them.
     */
    outcome: "upgraded" | "merged";
}
/**
 * Completes a sign-in performed by someone currently signed in as a guest.
 *
 * Two cases, and the difference matters enormously to the data they created:
 *
 * **The identifier is new** — the guest row is upgraded in place. Same id, so
 * every row they already own under row-level security stays theirs with no
 * migration at all. This is the case worth optimising for, and why guests are
 * full users rather than a separate table.
 *
 * **The identifier already belongs to someone** — that account wins, and the
 * guest row records `primaryUserId` pointing at it. Core does not move any data:
 * only the application knows what a guest's rows mean or whether merging them is
 * even desirable. The guest's session is replaced rather than parked, because
 * leaving a stranded anonymous account in an account switcher helps nobody.
 */
export declare function convertGuest(internals: AuthServerInternals, guest: AuthUser, identity: GuestIdentity): Promise<GuestConversion>;
//# sourceMappingURL=convert-guest.d.ts.map