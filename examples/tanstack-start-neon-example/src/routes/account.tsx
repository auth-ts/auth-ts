import type { SignOutInput } from "@auth-ts/client"
import { isAuthError } from "@auth-ts/client"
import {
  ArrowRightStartOnRectangleIcon,
  ArrowsRightLeftIcon,
  CheckIcon,
  LinkSlashIcon,
  TrashIcon,
  XMarkIcon
} from "@heroicons/react/24/outline"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { GitHubIcon } from "../components/github-icon"
import type { Notice } from "../components/notice"
import { NoticeAlert } from "../components/notice"
import { PendingSpinner } from "../components/pending-spinner"
import { SignedOutCard } from "../components/signed-out-card"
import { postgrest } from "../db/postgrest"
import { useCountdown } from "../hooks/use-countdown"
import { identitiesQueryKey, useIdentities } from "../hooks/use-identities"
import { sessionsQueryKey, useSessions } from "../hooks/use-sessions"
import { useToken } from "../hooks/use-token"
import { userQueryKey, useUser } from "../hooks/use-user"
import { authClient } from "../lib/auth-client"

export const Route = createFileRoute("/account")({ component: AccountPage })

type SetNotice = (notice: Notice | null) => void
type SignOut = (input?: SignOutInput) => Promise<void>

/** Profile, linked providers, sessions, account switching, and deletion. */
function AccountPage() {
  const { data: user, isPending } = useUser()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<Notice | null>(null)

  const signOut: SignOut = async (input) => {
    await authClient.signOut(input)
    queryClient.clear()
    await navigate({ to: "/login" })
  }

  if (isPending) return <PendingSpinner />

  if (!user) {
    return <SignedOutCard title="Account">You're not signed in.</SignedOutCard>
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        {user.image ? (
          <div className="avatar">
            <div className="w-14 rounded-full">
              <img src={user.image} alt="" />
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

      {notice ? <NoticeAlert notice={notice} /> : null}

      <ProfileCard name={user.name} setNotice={setNotice} />
      <ProvidersCard userId={user.id} setNotice={setNotice} />
      <SessionsCard userId={user.id} signOut={signOut} setNotice={setNotice} />
      <SwitchUserCard userId={user.id} />
      <SignOutButtons
        userId={user.id}
        signOut={signOut}
        setNotice={setNotice}
      />
      <DeleteCard />
    </section>
  )
}

function ProfileCard({
  name,
  setNotice
}: {
  name: string | null
  setNotice: SetNotice
}) {
  const queryClient = useQueryClient()
  // `null` until the user edits, so the input shows the stored name and Save
  // cannot send an empty or unchanged value over it.
  const [draftName, setDraftName] = useState<string | null>(null)

  const rename = useMutation({
    // No `eq`: updateOwnUser already narrows the write to the caller's row.
    mutationFn: async (name: string) => {
      await postgrest.from("users").update({ name }).throwOnError()
    },
    onSuccess: async () => {
      setDraftName(null)
      setNotice({ text: "Saved.", tone: "success" })
      await queryClient.invalidateQueries({ queryKey: userQueryKey })
    },
    onError: () => setNotice({ text: "Could not save.", tone: "error" })
  })

  const nameUnchanged =
    draftName === null ||
    draftName.trim() === "" ||
    draftName.trim() === (name ?? "")

  return (
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
            value={draftName ?? name ?? ""}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Your name"
            className="input join-item flex-1"
          />
          <button
            type="submit"
            disabled={nameUnchanged || rename.isPending}
            className="btn btn-primary join-item"
          >
            <CheckIcon className="size-4" />
            Save
          </button>
        </form>
      </div>
    </div>
  )
}

function ProvidersCard({
  userId,
  setNotice
}: {
  userId: string
  setNotice: SetNotice
}) {
  const queryClient = useQueryClient()
  const identities = useIdentities(userId)

  // By id, not by provider: two accounts at the same provider can be connected
  // at once, and disconnecting one must not take the other. No userId filter —
  // deleteOwnIdentities narrows the delete to this user's rows.
  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      await postgrest.from("identities").delete().eq("id", id).throwOnError()
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: identitiesQueryKey(userId)
      }),
    onError: () => setNotice({ text: "Could not disconnect.", tone: "error" })
  })

  const linkGitHub = async () => {
    setNotice(null)
    try {
      await authClient.connectProvider({
        provider: "github",
        redirect: "/account"
      })
    } catch (error) {
      setNotice({
        text: isAuthError(error) ? error.message : "Could not link GitHub.",
        tone: "error"
      })
    }
  }

  return (
    <div className="card bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="card-title">Connected providers</h2>
          <button
            type="button"
            onClick={() => void linkGitHub()}
            className="btn btn-outline btn-sm"
          >
            <GitHubIcon className="size-4" />
            Link GitHub
          </button>
        </div>
        {identities.data?.length === 0 ? (
          <p className="text-sm text-base-content/60">None linked.</p>
        ) : (
          <ul className="list rounded-box bg-base-200">
            {(identities.data ?? []).map((identity) => (
              <li key={identity.id} className="list-row items-center">
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
                  <LinkSlashIcon className="size-4" />
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SessionsCard({
  userId,
  signOut,
  setNotice
}: {
  userId: string
  signOut: SignOut
  setNotice: SetNotice
}) {
  const queryClient = useQueryClient()
  const sessions = useSessions(userId)
  // Which entry is this device: the token names its own session, so no request.
  const { data: token } = useToken()
  const currentSessionId = token
    ? authClient.decodeToken(token)?.claims.sid
    : undefined

  // Another device's session is a row this user owns, so the data plane
  // deletes it. This device's is a sign-out, because the cookie has to go too.
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      await postgrest.from("sessions").delete().eq("id", id).throwOnError()
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(userId) }),
    onError: () => setNotice({ text: "Could not revoke.", tone: "error" })
  })

  return (
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
                  onClick={() => void signOut({ userId })}
                  className="btn btn-ghost btn-sm"
                >
                  <ArrowRightStartOnRectangleIcon className="size-4" />
                  Sign out
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => revoke.mutate(session.id)}
                  className="btn btn-ghost btn-sm"
                >
                  <XMarkIcon className="size-4" />
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-base-content/60">
          Revoked sessions keep working until their current access token expires
          — ten minutes by default.
        </p>
      </div>
    </div>
  )
}

function SwitchUserCard({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const users = useQuery({
    queryKey: ["users"],
    queryFn: authClient.listUsers,
    // 404 means multiUser is off on the server; that is a configuration
    // answer, not a failure worth retrying.
    retry: false
  })

  if (!users.data || users.data.length <= 1) return null

  return (
    <div className="card bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <h2 className="card-title">Switch user</h2>
        <ul className="list rounded-box bg-base-200">
          {users.data.map((signedIn) => (
            <li key={signedIn.id} className="list-row items-center">
              <span className="list-col-grow text-sm">
                {signedIn.email ?? `Guest ${signedIn.id.slice(0, 8)}`}
              </span>
              {signedIn.id === userId ? (
                <span className="badge badge-soft badge-sm">current</span>
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    await authClient.switchUser({
                      userId: signedIn.id
                    })
                    queryClient.clear()
                  }}
                  className="btn btn-outline btn-sm"
                >
                  <ArrowsRightLeftIcon className="size-4" />
                  Switch
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function SignOutButtons({
  userId,
  signOut,
  setNotice
}: {
  userId: string
  signOut: SignOut
  setNotice: SetNotice
}) {
  const sessions = useSessions(userId)

  const buttons: {
    label: string
    input?: SignOutInput
    navigates: boolean
  }[] = [
    // Every account in this browser — the default, as in Clerk.
    // "Sign out this account" below is the switcher's narrower
    // version.
    { label: "Sign out", navigates: true },
    { label: "Sign out this account", input: { userId }, navigates: true },
    {
      label: "Sign out other devices",
      input: { scope: "others" },
      navigates: false
    },
    {
      label: "Sign out everywhere",
      input: { scope: "global" },
      navigates: true
    }
  ]

  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map(({ label, input, navigates }) => (
        <button
          key={label}
          type="button"
          onClick={async () => {
            if (navigates) {
              await signOut(input)
              return
            }
            await authClient.signOut(input)
            setNotice({
              text: "Signed out on your other devices.",
              tone: "success"
            })
            await sessions.refetch()
          }}
          className="btn btn-outline btn-sm"
        >
          <ArrowRightStartOnRectangleIcon className="size-4" />
          {label}
        </button>
      ))}
    </div>
  )
}

function DeleteCard() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [deletionCode, setDeletionCode] = useState<string | null>(null)
  // Deletion gets its own notice, rendered inside its card: the page-level
  // alert sits at the top, and the Delete button is at the bottom, so an error
  // reported up there is invisible from where the click happened.
  const [deletionNotice, setDeletionNotice] = useState<Notice | null>(null)
  const [deletionCooldown, startDeletionCooldown] = useCountdown()

  const removeAccount = async () => {
    setDeletionNotice(null)
    try {
      const result = await authClient.deleteUser(
        deletionCode ? { code: deletionCode } : {}
      )

      // Two-phase deletion reports the challenge as a value, because it is an
      // expected branch of a working flow rather than a failure. Deletion never
      // sends a code itself, so a stale session asks for one explicitly.
      if (result.status === "staleSession") {
        // Show the field even if sending fails.
        setDeletionCode("")
        await authClient.sendDeleteUserCode()
        setDeletionNotice({
          text: "For your security, enter the code we just sent.",
          tone: "info"
        })
        return
      }

      queryClient.clear()
      await navigate({ to: "/login" })
    } catch (error) {
      // Sending the code, or confirming inside its cooldown, both answer
      // `cooldown` with a retryAfter; the button counts it down.
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

  return (
    <div className="card border border-error/30 bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <h2 className="card-title text-error">Delete account</h2>
        <p className="text-sm text-base-content/60">
          This removes your account and everything in it. There is no undo.
        </p>
        {deletionNotice ? <NoticeAlert notice={deletionNotice} /> : null}
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
            <TrashIcon className="size-4" />
            {deletionCooldown > 0 && !deletionCode
              ? `Try again in ${deletionCooldown}s`
              : deletionCode !== null
                ? "Confirm deletion"
                : "Delete my account"}
          </button>
        </div>
      </div>
    </div>
  )
}
