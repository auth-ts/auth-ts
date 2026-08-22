import { isAuthError } from "@auth-ts/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { authClient } from "../auth-client.ts"
import { useUser } from "../hooks/use-user.ts"

export const Route = createFileRoute("/account")({ component: AccountPage })

/** Profile, linked providers, devices, account switching, and deletion. */
function AccountPage() {
  const { data: user, isPending } = useUser()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // `null` until the user edits, so the input shows the stored name and Save
  // cannot send an empty or unchanged value over it.
  const [draftName, setDraftName] = useState<string | null>(null)
  const [deletionCode, setDeletionCode] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const sessions = useQuery({
    queryKey: ["sessions", user?.id],
    queryFn: authClient.listSessions,
    enabled: Boolean(user)
  })
  const connections = useQuery({
    queryKey: ["connections", user?.id],
    queryFn: authClient.listConnections,
    enabled: Boolean(user)
  })
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: authClient.listAccounts,
    enabled: Boolean(user),
    // 404 means multiAccount is off on the server; that is a configuration
    // answer, not a failure worth retrying.
    retry: false
  })

  const rename = useMutation({
    mutationFn: (name: string) => authClient.updateUser({ name }),
    onSuccess: () => {
      setDraftName(null)
      setMessage("Saved.")
    }
  })

  const revoke = useMutation({
    mutationFn: (id: string) => authClient.revokeSession({ id }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["sessions", user?.id] })
  })

  const disconnect = useMutation({
    mutationFn: (provider: string) => authClient.disconnect({ provider }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["connections", user?.id] }),
    onError: (error) =>
      setMessage(isAuthError(error) ? error.message : "Could not disconnect.")
  })

  if (isPending) return <p className="text-neutral-500">Loading…</p>
  if (!user) return <p className="text-neutral-600">Not signed in.</p>

  const removeAccount = async () => {
    setMessage(null)
    try {
      const result = await authClient.deleteUser(
        deletionCode ? { code: deletionCode } : {}
      )

      // Two-phase deletion reports the challenge as a value, because it is an
      // expected branch of a working flow rather than a failure.
      if (result.status === "codeRequired") {
        setDeletionCode("")
        setMessage("For your security, enter the code we just sent.")
        return
      }

      queryClient.clear()
      await navigate({ to: "/login" })
    } catch (error) {
      setMessage(
        isAuthError(error) ? error.message : "Could not delete the account."
      )
    }
  }

  return (
    <section className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-sm text-neutral-500">
          {user.email ?? user.phoneNumber ?? "Guest account"}
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="font-medium">Profile</h2>
        <div className="flex gap-2">
          <input
            value={draftName ?? user.name ?? ""}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Your name"
            className="flex-1 rounded border border-neutral-300 px-3 py-2"
          />
          <button
            type="button"
            disabled={
              draftName === null ||
              draftName.trim() === "" ||
              draftName.trim() === (user.name ?? "")
            }
            onClick={() => draftName && rename.mutate(draftName.trim())}
            className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-medium">Connected providers</h2>
        <ul className="space-y-2">
          {(connections.data ?? []).map((connection) => (
            <li key={connection.provider} className="flex items-center gap-3">
              <span className="flex-1 capitalize">{connection.provider}</span>
              <span className="text-sm text-neutral-500">
                {connection.email}
              </span>
              <button
                type="button"
                onClick={() => disconnect.mutate(connection.provider)}
                className="text-sm text-neutral-500"
              >
                Disconnect
              </button>
            </li>
          ))}
          {connections.data?.length === 0 ? (
            <li className="text-neutral-500">None linked.</li>
          ) : null}
        </ul>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              authClient.connect({ provider: "github", redirect: "/account" })
            }
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Link GitHub
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-medium">Devices</h2>
        <ul className="space-y-2">
          {(sessions.data ?? []).map((session) => (
            <li key={session.id} className="flex items-center gap-3 text-sm">
              <span className="flex-1">
                {session.userAgent ?? "Unknown device"}
                {session.current ? (
                  <span className="ml-2 text-green-700">this device</span>
                ) : null}
              </span>
              <span className="text-neutral-500">
                {session.ipAddress ?? "no ip"}
              </span>
              <button
                type="button"
                onClick={() => revoke.mutate(session.id)}
                className="text-neutral-500"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-neutral-500">
          Revoked devices keep working until their current access token expires
          — ten minutes by default.
        </p>
      </div>

      {accounts.data && accounts.data.length > 1 ? (
        <div className="space-y-3">
          <h2 className="font-medium">Switch account</h2>
          <ul className="space-y-2">
            {accounts.data.map((account) => (
              <li
                key={account.user.id}
                className="flex items-center gap-3 text-sm"
              >
                <span className="flex-1">
                  {account.user.email ?? `Guest ${account.user.id.slice(0, 8)}`}
                </span>
                {account.current ? (
                  <span className="text-neutral-500">current</span>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      await authClient.switchAccount({
                        userId: account.user.id
                      })
                      queryClient.clear()
                    }}
                    className="text-neutral-700 underline"
                  >
                    Switch
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-3 border-t border-neutral-200 pt-6">
        <h2 className="font-medium">Sessions</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            onClick={async () => {
              // Every account in this browser — the default, as in Clerk and
              // Better Auth. "Sign out this account" below is the switcher's
              // narrower version.
              await authClient.logout()
              queryClient.clear()
              await navigate({ to: "/login" })
            }}
            className="rounded border border-neutral-300 px-3 py-1.5"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={async () => {
              const result = await authClient.logout({ account: "current" })
              queryClient.clear()
              if (result?.switchedTo) {
                setMessage(`Now signed in as ${result.switchedTo.email}.`)
                await sessions.refetch()
              } else {
                await navigate({ to: "/login" })
              }
            }}
            className="rounded border border-neutral-300 px-3 py-1.5"
          >
            Sign out this account
          </button>
          <button
            type="button"
            onClick={async () => {
              await authClient.logout({ scope: "others" })
              setMessage("Signed out on your other devices.")
              await sessions.refetch()
            }}
            className="rounded border border-neutral-300 px-3 py-1.5"
          >
            Sign out other devices
          </button>
          <button
            type="button"
            onClick={async () => {
              await authClient.logout({ scope: "global" })
              queryClient.clear()
              await navigate({ to: "/login" })
            }}
            className="rounded border border-neutral-300 px-3 py-1.5"
          >
            Sign out everywhere
          </button>
        </div>
      </div>

      <div className="space-y-3 border-t border-neutral-200 pt-6">
        <h2 className="font-medium text-red-700">Delete account</h2>
        {deletionCode !== null ? (
          <input
            value={deletionCode}
            onChange={(event) => setDeletionCode(event.target.value)}
            placeholder="Confirmation code"
            className="w-48 rounded border border-neutral-300 px-3 py-2"
          />
        ) : null}
        <button
          type="button"
          onClick={removeAccount}
          className="block rounded bg-red-700 px-4 py-2 text-white"
        >
          {deletionCode !== null ? "Confirm deletion" : "Delete my account"}
        </button>
      </div>

      {message ? <p className="text-sm text-neutral-600">{message}</p> : null}
    </section>
  )
}
