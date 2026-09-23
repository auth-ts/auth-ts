import type { SignOutInput } from "@auth-ts/core/client"
import {
  ArrowRightStartOnRectangleIcon,
  ArrowsRightLeftIcon,
  CheckIcon,
  EnvelopeIcon,
  LinkSlashIcon,
  TrashIcon,
  XMarkIcon
} from "@heroicons/react/24/outline"
import {
  useDeleteMutation,
  useQuery,
  useRevalidateTables,
  useUpdateMutation
} from "@supabase-cache-helpers/postgrest-react-query"
import {
  useQueryClient,
  useQuery as useReactQuery
} from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { ConfirmDialog } from "../components/confirm-dialog"
import { GitHubIcon } from "../components/github-icon"
import type { Notice } from "../components/notice"
import { NoticeAlert } from "../components/notice"
import { PendingSpinner } from "../components/pending-spinner"
import { SignedOutCard } from "../components/signed-out-card"
import { UpdateEmailDialog } from "../components/update-email-dialog"
import type { VerifiedAction } from "../components/verify-identity-dialog"
import { useVerifiedAction } from "../components/verify-identity-dialog"
import { UNEXPECTED, useReportError } from "../hooks/use-report-error"
import { useUser } from "../hooks/use-user"
import { authClient } from "../lib/auth-client"
import { client } from "../lib/client"

export const Route = createFileRoute("/account")({ component: AccountPage })

type SetNotice = (notice: Notice | null) => void
type SignOut = (input?: SignOutInput) => Promise<void>
type RunVerified = (action: VerifiedAction) => Promise<void>

function AccountPage() {
  const { data: user, isPending } = useUser()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<Notice | null>(null)
  const verified = useVerifiedAction(
    user?.email ?? user?.phoneNumber ?? "your address"
  )

  const report = useReportError()

  const signOut: SignOut = async (input) => {
    try {
      await authClient.signOut(input)
      await queryClient.resetQueries()
      await navigate({ to: "/login" })
    } catch (error) {
      await report(error, setNotice)
    }
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

      <ProfileCard
        userId={user.id}
        name={user.name}
        email={user.email}
        setNotice={setNotice}
        runVerified={verified.run}
      />
      <ProvidersCard setNotice={setNotice} />
      <SessionsCard setNotice={setNotice} runVerified={verified.run} />
      <SwitchUserCard userId={user.id} setNotice={setNotice} />
      <SignOutButtons userId={user.id} signOut={signOut} />
      {user.email || user.phoneNumber ? (
        <DeleteCard runVerified={verified.run} />
      ) : null}
      {verified.dialog}
    </section>
  )
}

function ProfileCard({
  userId,
  name,
  email,
  setNotice,
  runVerified
}: {
  userId: string
  name: string | null
  email: string | null
  setNotice: SetNotice
  runVerified: RunVerified
}) {
  // null until the user edits
  const [draftName, setDraftName] = useState<string | null>(null)
  const [changingEmail, setChangingEmail] = useState(false)
  const revalidateUsers = useRevalidateTables([{ table: "users" }])

  const rename = useUpdateMutation(client.from("users"), ["id"], null, {
    onSuccess: () => {
      setDraftName(null)
      setNotice({ text: "Saved.", tone: "success" })
    },
    onError: () => setNotice({ text: UNEXPECTED, tone: "error" })
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
            if (draftName) rename.mutate({ id: userId, name: draftName.trim() })
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
        {email ? (
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-base-content/70">{email}</span>
            <button
              type="button"
              onClick={() => setChangingEmail(true)}
              className="btn btn-outline btn-sm"
            >
              <EnvelopeIcon className="size-4" />
              Update email address
            </button>
          </div>
        ) : null}
        {changingEmail ? (
          <UpdateEmailDialog
            runVerified={runVerified}
            onCancel={() => setChangingEmail(false)}
            onUpdated={async () => {
              setChangingEmail(false)
              setNotice({ text: "Email address updated.", tone: "success" })
              await revalidateUsers()
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

function ProvidersCard({ setNotice }: { setNotice: SetNotice }) {
  const identities = useQuery(
    client.from("identities").select().order("provider", { ascending: true })
  )

  // By id: one provider, many identities
  const disconnect = useDeleteMutation(
    client.from("identities"),
    ["id"],
    null,
    {
      onError: () => setNotice({ text: UNEXPECTED, tone: "error" })
    }
  )

  const report = useReportError()

  const linkGitHub = async () => {
    setNotice(null)
    try {
      await authClient.connectProvider({
        provider: "github",
        redirect: "/account"
      })
    } catch (error) {
      await report(error, setNotice)
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
                  onClick={() => disconnect.mutate({ id: identity.id })}
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
  setNotice,
  runVerified
}: {
  setNotice: SetNotice
  runVerified: RunVerified
}) {
  const sessions = useQuery(
    client.from("sessions").select().order("createdAt", { ascending: false })
  )
  const revalidateSessions = useRevalidateTables([{ table: "sessions" }])
  const report = useReportError()
  const [revoking, setRevoking] = useState<string | null>(null)

  const revoke = async (id: string, device: string) => {
    setRevoking(id)
    try {
      await runVerified(async () => {
        const result = await authClient.revokeSession({ id })
        if (result.status === "revoked") {
          setNotice({
            text: `Signed out ${device}. It stays signed in until its current token expires, up to an hour.`,
            tone: "success"
          })
          await revalidateSessions()
        }
        return result
      })
    } catch (error) {
      await report(error, setNotice)
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="card bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <h2 className="card-title">Sessions</h2>
        <ul className="list rounded-box bg-base-200">
          {(sessions.data ?? []).map((session) => (
            <li key={session.id} className="list-row items-center">
              <div className="list-col-grow min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="truncate text-sm"
                    title={session.userAgent ?? undefined}
                  >
                    {session.userAgent ?? "Unknown device"}
                  </span>
                </div>
                <div className="text-xs text-base-content/60">
                  {session.ipAddress ?? "no ip"}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  revoke(session.id, session.userAgent ?? "that device")
                }
                disabled={revoking !== null}
                className="btn btn-ghost btn-sm"
              >
                {revoking === session.id ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <XMarkIcon className="size-4" />
                )}
                Revoke
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-base-content/60">
          Revoking asks you to confirm it's you, once an hour. A revoked device
          keeps working until its current access token expires — an hour by
          default.
        </p>
      </div>
    </div>
  )
}

function SwitchUserCard({
  userId,
  setNotice
}: {
  userId: string
  setNotice: SetNotice
}) {
  const queryClient = useQueryClient()
  const report = useReportError()
  const [switching, setSwitching] = useState<string | null>(null)

  const switchTo = async (id: string) => {
    setSwitching(id)
    try {
      await authClient.switchUser({ userId: id })
      await queryClient.resetQueries()
    } catch (error) {
      await report(error, setNotice)
    } finally {
      setSwitching(null)
    }
  }
  const users = useReactQuery({
    queryKey: ["users"],
    queryFn: authClient.listUsers,
    // 404 means multiUser is off
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
                  onClick={() => void switchTo(signedIn.id)}
                  disabled={switching !== null}
                  className="btn btn-outline btn-sm"
                >
                  {switching === signedIn.id ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <ArrowsRightLeftIcon className="size-4" />
                  )}
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
  signOut
}: {
  userId: string
  signOut: SignOut
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmingAll, setConfirmingAll] = useState(false)
  const buttons: { label: string; input?: SignOutInput }[] = [
    { label: "Sign out" },
    { label: "Sign out this account", input: { userId } },
    { label: "Sign out of all devices", input: { scope: "global" } }
  ]

  const run = async (label: string, input?: SignOutInput) => {
    setBusy(label)
    try {
      await signOut(input)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map(({ label, input }) => (
        <button
          key={label}
          type="button"
          onClick={() =>
            input?.scope === "global"
              ? setConfirmingAll(true)
              : void run(label, input)
          }
          disabled={busy !== null}
          className="btn btn-outline btn-sm"
        >
          {busy === label ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <ArrowRightStartOnRectangleIcon className="size-4" />
          )}
          {label}
        </button>
      ))}
      {confirmingAll ? (
        <ConfirmDialog
          title="Sign out of all devices"
          body="Do you want to sign out of all devices?"
          confirmLabel="Sign out"
          onConfirm={async () => {
            await run("Sign out of all devices", { scope: "global" })
            setConfirmingAll(false)
          }}
          onCancel={() => setConfirmingAll(false)}
        />
      ) : null}
    </div>
  )
}

function DeleteCard({ runVerified }: { runVerified: RunVerified }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // Own notice: the page alert is offscreen
  const [deletionNotice, setDeletionNotice] = useState<Notice | null>(null)
  const [confirming, setConfirming] = useState(false)

  const report = useReportError()

  const removeAccount = async () => {
    setDeletionNotice(null)
    try {
      await runVerified(async () => {
        const result = await authClient.deleteUser()
        if (result.status === "deleted") {
          await queryClient.resetQueries()
          await navigate({ to: "/login" })
        }
        return result
      })
    } catch (error) {
      await report(error, setDeletionNotice)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="card border border-error/30 bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <h2 className="card-title text-error">Delete your account</h2>
        <p className="text-sm text-base-content/60">
          Deleting your account will permanently remove all your data.
        </p>
        {deletionNotice ? <NoticeAlert notice={deletionNotice} /> : null}
        <div className="card-actions">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="btn btn-error"
          >
            <TrashIcon className="size-4" />
            Delete account
          </button>
        </div>
      </div>
      {confirming ? (
        <ConfirmDialog
          title="Delete your account"
          body="Are you sure you want to delete your account? This action is permanent and cannot be undone."
          confirmLabel="Delete account"
          danger
          onConfirm={removeAccount}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  )
}
