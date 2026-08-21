/**
 * What a user is to this library.
 *
 * `admin` is vocabulary the library carries into the JWT but never assigns —
 * promoting someone is your own SQL. Core only ever writes `guest` or `user`.
 */
export type UserType = "guest" | "user" | "admin";
/**
 * A user row, as core reads it.
 *
 * Declared `additionalFields` are **flat on this type**, not nested under a
 * property: your row already has them as columns, so `AuthUser & YourFields` is
 * what a `select *` actually returns and what application code wants to read.
 * Structural typing means returning a richer object is always fine.
 *
 * Note the deliberate asymmetry with {@link UpsertUserInput}, which nests them:
 * on the way *in* they are an allowlisted payload that must stay visibly
 * separate from the fields core owns, and writing `...user.additionalFields` in
 * your insert is the line that makes mass assignment impossible to do by
 * accident. On the way *out* there is nothing to separate — it is just your row.
 *
 * This is also the `user` returned to the browser on sign-in and refresh, so
 * nothing sensitive belongs on it.
 */
export interface AuthUser {
    id: string;
    /** Null for guests; unique when present. */
    email?: string | null;
    /** Null for guests; unique when present. E.164. */
    phoneNumber?: string | null;
    name?: string | null;
    imageURL?: string | null;
    type: UserType;
    /**
     * Set on a **guest** row when its sign-in resolved to an existing account —
     * a pointer saying "this guest's data belongs to that user now".
     *
     * Core writes it and never reads it again: migrating the guest's rows is your
     * decision, on your schedule. It is deliberately never a JWT claim, because it
     * describes a data migration rather than who is signed in.
     */
    primaryUserId?: string | null;
}
/** A refresh-token row. Core stores only the hash of the token, never the token. */
export interface AuthSession {
    id: string;
    userId: string;
    tokenHash: string;
    /**
     * When this session was created — the one timestamp core owns.
     *
     * It is an authentication input, not bookkeeping: account deletion reads the
     * age of the *authentication* from it. A sliding "last active" value would say
     * nothing about how recently the person proved who they were.
     */
    createdAt: Date;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
}
/** What a live magic code is for. Checked on every verify so codes cannot cross purposes. */
export type MagicCodePurpose = "signIn" | "deleteUser";
/** A live magic code. One per identifier — a new send replaces the old row. */
export interface AuthMagicCode {
    /** Normalized email or E.164 phone number. */
    identifier: string;
    codeHash: string;
    expiresAt: Date;
    attempts: number;
    purpose: MagicCodePurpose;
}
/** A fixed-window rate-limit counter. */
export interface AuthRateLimit {
    key: string;
    count: number;
    resetAt: Date;
}
/** A provider identity linked to a user. */
export interface AuthConnection {
    userId: string;
    provider: string;
    /** The provider's stable id — GitHub's numeric id, Google's `sub`. */
    providerAccountId: string;
    /** Metadata only; never the match key. */
    email?: string | null;
}
/** Fields accepted by {@link AuthDb.upsertUser}. */
export interface UpsertUserInput {
    /**
     * When present, targets that exact row by id instead of looking up by
     * identifier — used for guest conversion.
     */
    id?: string;
    email?: string;
    phoneNumber?: string;
    name?: string;
    imageURL?: string;
    type?: UserType;
    primaryUserId?: string;
    /**
     * Declared `additionalFields`. Spread them into your insert.
     *
     * Applied **on insert**, and on the id-targeted form — which is how
     * `PATCH /user` edits them. They must be **ignored when merging into a row
     * found by identifier**, exactly like `type`: that path is a sign-in, and a
     * sign-in request that could rewrite profile columns is mass assignment.
     */
    additionalFields?: Record<string, string | number | boolean>;
}
/** Fields written by {@link AuthDb.upsertSession}. */
export interface UpsertSessionInput {
    /** Core-generated uuid — the browser-safe address of this session. */
    id: string;
    userId: string;
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
    /**
     * Nullable rather than merely optional so that a session read from your table
     * can be written straight back without reshaping. Unlike `upsertUser`, this is
     * a whole-row write, so there is no "leave this field alone" case to confuse
     * `null` with.
     */
    userAgent?: string | null;
    ipAddress?: string | null;
}
/** Fields written by {@link AuthDb.upsertMagicCode}. */
export interface UpsertMagicCodeInput {
    identifier: string;
    codeHash: string;
    expiresAt: Date;
    attempts: number;
    purpose: MagicCodePurpose;
}
/** Fields written by {@link AuthDb.upsertConnection}. */
export interface UpsertConnectionInput {
    userId: string;
    provider: string;
    providerAccountId: string;
    email?: string;
}
/** Query accepted by {@link AuthDb.getUser} — exactly one key. */
export type GetUserWhere = {
    id: string;
} | {
    email: string;
} | {
    phoneNumber: string;
};
/** Query accepted by {@link AuthDb.deleteSession}. */
export type DeleteSessionWhere = {
    tokenHash: string;
} | {
    id: string;
    userId: string;
};
/**
 * The integration surface: the callbacks that read and write your database.
 *
 * This interface *is* the product. There are no adapters — you write these
 * functions against your own tables, and in exchange the library never owns your
 * schema, your migrations, or your data.
 *
 * Two conventions run through it. `upsert*` takes the entity; `get*`, `list*`,
 * and `delete*` take a `where` query. And upserts are deliberate rather than
 * split into create/update: the create-or-merge race is delegated to your store,
 * where `ON CONFLICT`, `MERGE`, or `$setOnInsert` handles it atomically, instead
 * of being relocated into this library as a read-then-write on every sign-in.
 *
 * Callbacks are pure with respect to the request: none of them receive headers.
 * Header-dependent session resolution is a spoofable auth bypass, and non-HTTP
 * callers (tests, migrations, the in-memory fixture) drive this contract
 * directly. For multi-tenancy, close over the tenant when constructing the
 * server instead.
 */
export interface AuthDb {
    /**
     * Creates or merges a user.
     *
     * Keyed on whichever identifier is present — core normalizes it first, and
     * passes exactly one for code flows, or email for OAuth. Three shapes:
     *
     * - **An identifier, no `id`** — look up by that identifier; insert if absent,
     *   otherwise merge the provided fields. `undefined` fields mean "leave alone".
     * - **No identifier at all** — always insert. This is guest creation.
     * - **`id` present** — update that exact row, no identifier lookup. This is
     *   guest conversion.
     *
     * `type` applies **on insert only** for identifier-keyed calls. Merging it on
     * every sign-in would silently demote an admin the next time they logged in.
     * The single exception is the id-targeted form, which may move `guest` to
     * `user`. Core never passes `admin`.
     *
     * @returns The stored user, as core should see it.
     */
    upsertUser(user: UpsertUserInput): Promise<AuthUser>;
    /** Looks up one user by exactly one of id, email, or phone number. */
    getUser(where: GetUserWhere): Promise<AuthUser | null>;
    /**
     * Deletes a user.
     *
     * **Contract:** this must also remove or invalidate that user's sessions, via
     * `ON DELETE CASCADE` or by calling your own `deleteSessions`. A deleted
     * account that keeps a live refresh token is still a working login.
     */
    deleteUser(where: {
        id: string;
    }): Promise<void>;
    /** Creates or updates a session row, keyed by `tokenHash`. */
    upsertSession(session: UpsertSessionInput): Promise<void>;
    /** Looks up a session by token hash. Core only ever passes hashes. */
    getSession(where: {
        tokenHash: string;
    }): Promise<AuthSession | null>;
    /** Lists a user's sessions — the "your devices" screen. */
    listSessions(where: {
        userId: string;
    }): Promise<AuthSession[]>;
    /**
     * Deletes one session.
     *
     * The `{ id, userId }` form must filter on **both** columns, so that revoking
     * someone else's session id is structurally impossible rather than a check you
     * remembered to write. After deletion, `getSession` must return null — a soft
     * delete is fine as long as reads respect it.
     */
    deleteSession(where: DeleteSessionWhere): Promise<void>;
    /**
     * Deletes all of a user's sessions, optionally sparing the current one.
     *
     * `exceptTokenHash` powers "sign out my other devices". This also satisfies the
     * cascade required by {@link AuthDb.deleteUser} if you reuse it there.
     */
    deleteSessions(where: {
        userId: string;
        exceptTokenHash?: string;
    }): Promise<void>;
    /**
     * Stores the live magic code for an identifier, replacing any existing one.
     *
     * One live code per identifier is a security property, not a convenience: it
     * means a resend invalidates the previous code instead of widening the set of
     * values an attacker may guess.
     */
    upsertMagicCode(magicCode: UpsertMagicCodeInput): Promise<void>;
    /** Reads the live magic code for an identifier. */
    getMagicCode(where: {
        identifier: string;
    }): Promise<AuthMagicCode | null>;
    /** Deletes the magic code for an identifier — on success, or when attempts run out. */
    deleteMagicCode(where: {
        identifier: string;
    }): Promise<void>;
    /** Reads a rate-limit counter. Never called when `rateLimit: false`. */
    getRateLimit(where: {
        key: string;
    }): Promise<AuthRateLimit | null>;
    /** Writes a rate-limit counter. Never called when `rateLimit: false`. */
    upsertRateLimit(rateLimit: AuthRateLimit): Promise<void>;
    /**
     * Links a provider identity to a user, keyed on `(provider, providerAccountId)`.
     *
     * Keyed on the provider's stable id rather than email on purpose: people change
     * their email at the provider, and matching on email alone quietly creates a
     * second account for the same person.
     */
    upsertConnection(connection: UpsertConnectionInput): Promise<void>;
    /** Looks up a connection by the provider's stable account id. */
    getConnection(where: {
        provider: string;
        providerAccountId: string;
    }): Promise<AuthConnection | null>;
    /** Lists a user's linked providers. */
    listConnections(where: {
        userId: string;
    }): Promise<AuthConnection[]>;
    /** Unlinks a provider from a user; ownership is enforced in the query. */
    deleteConnection(where: {
        userId: string;
        provider: string;
    }): Promise<void>;
    /**
     * Deletes expired magic codes, sessions, and rate-limit counters.
     *
     * Three one-line deletes: `magicCodes.expiresAt < now()`,
     * `sessions.expiresAt < now()`, `rateLimits.resetAt < now()`. Core calls this
     * fire-and-forget after mutating flows, so index those columns.
     *
     * It takes no arguments deliberately. "Expired" means expired *now*, and your
     * database already knows what time it is — using its clock avoids the skew
     * between an application server and the database that a passed-in timestamp
     * would introduce, and makes the natural SQL the correct SQL.
     *
     * This is hygiene, never a security boundary: expiry is enforced on read
     * everywhere regardless of whether a sweep has ever run.
     */
    deleteExpired(): Promise<void>;
}
//# sourceMappingURL=auth-db.d.ts.map