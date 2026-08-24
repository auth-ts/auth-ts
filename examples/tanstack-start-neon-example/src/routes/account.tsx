import { isAuthError } from "@auth-ts/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { GitHubIcon } from "../components/icons"
import { postgrest } from "../db/postgrest"
import { useCountdown } from "../hooks/use-countdown"
import { identitiesQueryKey, useIdentities } from "../hooks/use-identities"
import { sessionsQueryKey, useSessions } from "../hooks/use-sessions"
import { useToken } from "../hooks/use-token"
import { userQueryKey, useUser } from "../hooks/use-user"
import { authClient } from "../lib/auth-client"

export const Route = createFileRoute("/account")({ component: AccountPage })

interface Notice {
  text: string
  tone: "success" | "info" | "error"
}

const noticeClass = {
  success: "alert-success",
  info: "alert-info",
  error: "alert-error"
}

/** Profile, linked providers, sessions, account switching, and deletion. */
function AccountPage() {
  const { data: user, isPending } = useUser()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // `null` until the user edits, so the input shows the stored name and Save
  // cannot send an empty or unchanged value over it.
  const [draftName, setDraftName] = useState<string | null>(null)
  const [deletionCode, setDeletionCode] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  // Deletion gets its own notice, rendered inside its card: the page-level
  // alert sits at the top, and the Delete button is at the bottom, so an error
  // reported up there is invisible from where the click happened.
  const [deletionNotice, setDeletionNotice] = useState<Notice | null>(null)
  const [deletionCooldown, startDeletionCooldown] = useCountdown()

  const sessions = useSessions(user?.id)
  // Which entry is this device: the token names its own session, so no request.
  const { data: token } = useToken()
  const currentSessionId = token
    ? authClient.decodeToken(token)?.claims.sid
    : undefined
  const identities = useIdentities(user?.id)
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: authClient.listAccounts,
    enabled: Boolean(user),
    // 404 means multiAccount is off on the server; that is a configuration
    // answer, not a failure worth retrying.
    retry: false
  })

  const rename = useMutation({
    // No `eq`: updateOwnUser already narrows the write to the caller's row.
    mutationFn: async (name: string) => {
      await postgrest.from("users").update({ name }).throwOnError()
    },
    onSuccess: async () => {
      setDraftName(null)
      setNotice({ text: "Saved.", tone: "success" })
      await queryClient.invalidateQueries({ queryKey: userQueryKey })
    }
  })

  // Another device's session is a row this user owns, so the data plane
  // deletes it. This device's is a sign-out, because the cookie has to go too.
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      await postgrest.from("sessions").delete().eq("id", id).throwOnError()
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(user?.id) })
  })

  // By id, not by provider: two accounts at the same provider can be connected
  // at once, and disconnecting one must not take the other. No userId filter —
  // deleteOwnIdentities narrows the delete to this user's rows.
  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      await postgrest.from("identities").delete().eq("id", id).throwOnError()
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: identitiesQueryKey(user?.id)
      }),
    onError: () => setNotice({ text: "Could not disconnect.", tone: "error" })
  })

  const linkGitHub = async () => {
    setNotice(null)
    try {
      await authClient.connect({ provider: "github", redirect: "/account" })
    } catch (error) {
      setNotice({
        text: isAuthError(error) ? error.message : "Could not link GitHub.",
        tone: "error"
      })
    }
  }

  if (isPending) {
    return (
      <div className="flex justify-center py-16">
        <span className="loading loading-spinner loading-lg" />
      </div>
    )
  }

  if (!user) {
    return (
      <section className="mx-auto max-w-sm">
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body items-center gap-4 text-center">
            <h1 className="card-title text-2xl">Account</h1>
            <p className="text-base-content/70">You're not signed in.</p>
            <button
              type="button"
              onClick={() => navigate({ to: "/login" })}
              className="btn btn-primary"
            >
              Sign in
            </button>
          </div>
        </div>
      </section>
    )
  }

  const removeAccount = async () => {
    setDeletionNotice(null)
    try {
      const result = await authClient.deleteUser(
        deletionCode ? { code: deletionCode } : {}
      )

      // Two-phase deletion reports the challenge as a value, because it is an
      // expected branch of a working flow rather than a failure.
      if (result.status === "codeRequired") {
        setDeletionCode("")
        setDeletionNotice({
          text: "For your security, enter the code we just sent.",
          tone: "info"
        })
        return
      }

      queryClient.clear()
      await navigate({ to: "/login" })
    } catch (error) {
      // Confirming with no code re-sends one, which inside the send cooldown
      // answers `cooldown` with a retryAfter; the button counts it down.
      if (isAuthError(error) && error.retryAfter) {
        startDeletionCooldown(error.retryAfter)
      }
      setDeletionNotice({
        text: isAuthError(error)
          ? error.message
          : "Could not delete the account.",
        tone: "error"
      })
    }
  }

  const nameUnchanged =
    draftName === null ||
    draftName.trim() === "" ||
    draftName.trim() === (user.name ?? "")

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        {user.imageURL ? (
          <div className="avatar">
            <div className="w-14 rounded-full">
              <img src={user.imageURL} alt="" />
            </div>
          </div>
        ) : null}
        <div>
          <h1 className="text-2xl font-semibold">Account</h1>
          <p className="text-sm text-base-content/60">
            {user.email ?? user.phoneNumber ?? "Guest account"}
          </p>
        </div>
      </div>

      {notice ? (
        <div
          role="alert"
          className={`alert alert-soft text-sm ${noticeClass[notice.tone]}`}
        >
          <span>{notice.text}</span>
        </div>
      ) : null}

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body gap-4">
          <h2 className="card-title">Profile</h2>
          <form
            className="join w-full"
            onSubmit={(event) => {
              event.preventDefault()
              if (draftName) rename.mutate(draftName.trim())
            }}
          >
            <input
              value={draftName ?? user.name ?? ""}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="Your name"
              className="input join-item flex-1"
            />
            <button
              type="submit"
              disabled={nameUnchanged || rename.isPending}
              className="btn btn-primary join-item"
            >
              Save
            </button>
          </form>
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body gap-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="card-title">Connected providers</h2>
            <button
              type="button"
              onClick={() => void linkGitHub()}
              className="btn btn-outline btn-sm"
            >
              <GitHubIcon />
              Link GitHub
            </button>
          </div>
          {identities.data?.length === 0 ? (
            <p className="text-sm text-base-content/60">None linked.</p>
          ) : (
            <ul className="list rounded-box bg-base-200">
              {(identities.data ?? []).map((identity) => (
                <li key={identity.provider} className="list-row items-center">
                  <span className="badge badge-neutral capitalize">
                    {identity.provider}
                  </span>
                  <span className="list-col-grow text-sm text-base-content/60">
                    {identity.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => disconnect.mutate(identity.id)}
                    className="btn btn-ghost btn-sm"
                  >
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body gap-4">
          <h2 className="card-title">Sessions</h2>
          <ul className="list rounded-box bg-base-200">
            {(sessions.data ?? []).map((session) => (
              <li key={session.id} className="list-row items-center">
                <div className="list-col-grow min-w-0">
                  <div className="flex items-center gap-2">
                    {/* User agents run long; truncation keeps the row on one line
                        and the Revoke button in view. */}
                    <span
                      className="truncate text-sm"
                      title={session.userAgent ?? undefined}
                    >
                      {session.userAgent ?? "Unknown device"}
                    </span>
                    {session.id === currentSessionId ? (
                      <span className="badge badge-soft badge-success badge-sm shrink-0">
                        this device
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-base-content/60">
                    {session.ipAddress ?? "no ip"}
                  </div>
                </div>
                {session.id === currentSessionId ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await authClient.signOut()
                      queryClient.clear()
                      await navigate({ to: "/login" })
                    }}
                    className="btn btn-ghost btn-sm"
                  >
                    Sign out
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => revoke.mutate(session.id)}
                    className="btn btn-ghost btn-sm"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-base-content/60">
            Revoked sessions keep working until their current access token
            expires — ten minutes by default.
          </p>
        </div>
      </div>

      {accounts.data && accounts.data.length > 1 ? (
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body gap-4">
            <h2 className="card-title">Switch account</h2>
            <ul className="list rounded-box bg-base-200">
              {accounts.data.map((account) => (
                <li key={account.id} className="list-row items-center">
                  <span className="list-col-grow text-sm">
                    {account.email ?? `Guest ${account.id.slice(0, 8)}`}
                  </span>
                  {account.id === user.id ? (
                    <span className="badge badge-soft badge-sm">current</span>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        await authClient.switchAccount({
                          userId: account.id
                        })
                        queryClient.clear()
                      }}
                      className="btn btn-outline btn-sm"
                    >
                      Switch
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            // Every account in this browser — the default, as in Clerk.
            // "Sign out this account" below is the switcher's narrower
            // version.
            await authClient.signOut()
            queryClient.clear()
            await navigate({ to: "/login" })
          }}
          className="btn btn-outline btn-sm"
        >
          Sign out
        </button>
        <button
          type="button"
          onClick={async () => {
            const result = await authClient.signOut({ userId: user.id })
            queryClient.clear()
            if (result?.switchedTo) {
              const label =
                result.switchedTo.email ??
                `Guest ${result.switchedTo.id.slice(0, 8)}`
              setNotice({
                text: `Now signed in as ${label}.`,
                tone: "success"
              })
              await sessions.refetch()
            } else {
              await navigate({ to: "/login" })
            }
          }}
          className="btn btn-outline btn-sm"
        >
          Sign out this account
        </button>
        <button
          type="button"
          onClick={async () => {
            await authClient.signOut({ scope: "others" })
            setNotice({
              text: "Signed out on your other devices.",
              tone: "success"
            })
            await sessions.refetch()
          }}
          className="btn btn-outline btn-sm"
        >
          Sign out other devices
        </button>
        <button
          type="button"
          onClick={async () => {
            await authClient.signOut({ scope: "global" })
            queryClient.clear()
            await navigate({ to: "/login" })
          }}
          className="btn btn-outline btn-sm"
        >
          Sign out everywhere
        </button>
      </div>

      <div className="card border border-error/30 bg-base-100 shadow-sm">
        <div className="card-body gap-4">
          <h2 className="card-title text-error">Delete account</h2>
          <p className="text-sm text-base-content/60">
            This removes your account and everything in it. There is no undo.
          </p>
          {deletionNotice ? (
            <div
              role="alert"
              className={`alert alert-soft text-sm ${noticeClass[deletionNotice.tone]}`}
            >
              <span>{deletionNotice.text}</span>
            </div>
          ) : null}
          {deletionCode !== null ? (
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Confirmation code</legend>
              <input
                value={deletionCode}
                inputMode="numeric"
                autoComplete="one-time-code"
                onChange={(event) => setDeletionCode(event.target.value)}
                placeholder="123456"
                className="input w-48 font-mono tracking-widest"
              />
            </fieldset>
          ) : null}
          <div className="card-actions">
            {/* The cooldown only gates sending a fresh code, so a typed code
                can still be confirmed while the button counts down. */}
            <button
              type="button"
              onClick={removeAccount}
              disabled={deletionCooldown > 0 && !deletionCode}
              className="btn btn-error"
            >
              {deletionCooldown > 0 && !deletionCode
                ? `Try again in ${deletionCooldown}s`
                : deletionCode !== null
                  ? "Confirm deletion"
                  : "Delete my account"}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
