import { isAuthError } from "@auth-ts/core/client"
import { ShieldCheckIcon } from "@heroicons/react/24/outline"
import { useState } from "react"
import { useCountdown } from "../hooks/use-countdown"
import { authClient } from "../lib/auth-client"
import type { Notice } from "./notice"
import { NoticeAlert } from "./notice"

/** An action behind "confirm it's you", reporting the challenge as its status. */
export type VerifiedAction = () => Promise<{ status: string }>

const RESEND_SECONDS = 30

function errorNotice(error: unknown, fallback: string): Notice {
  return {
    text: isAuthError(error) ? error.message : fallback,
    tone: "error"
  }
}

/**
 * Runs an action, and when the server asks for verification, confirms it's
 * the user and runs it again. One verification covers every action for an
 * hour, so a second revoke goes straight through.
 */
export function useVerifiedAction(destination: string) {
  const [pending, setPending] = useState<VerifiedAction | null>(null)
  const [sendNotice, setSendNotice] = useState<Notice | null>(null)

  const run = async (action: VerifiedAction) => {
    const result = await action()
    if (result.status !== "verificationRequired") return

    setSendNotice(null)
    setPending(() => action)
    try {
      await authClient.sendIdentityCode()
    } catch (error) {
      setSendNotice(errorNotice(error, "Could not send the code."))
    }
  }

  const dialog = pending ? (
    <VerifyIdentityDialog
      destination={destination}
      initialNotice={sendNotice}
      onCancel={() => setPending(null)}
      onVerified={async () => {
        setPending(null)
        await pending()
      }}
    />
  ) : null

  return { run, dialog }
}

function VerifyIdentityDialog({
  destination,
  initialNotice,
  onCancel,
  onVerified
}: {
  destination: string
  initialNotice: Notice | null
  onCancel: () => void
  onVerified: () => Promise<void>
}) {
  const [code, setCode] = useState("")
  const [notice, setNotice] = useState<Notice | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, startCooldown] = useCountdown()

  const resend = async () => {
    setNotice(null)
    try {
      await authClient.sendIdentityCode()
      startCooldown(RESEND_SECONDS)
      setNotice({ text: "Sent a new code.", tone: "info" })
    } catch (error) {
      if (isAuthError(error) && error.retryAfter) {
        startCooldown(error.retryAfter)
      }
      setNotice(errorNotice(error, "Could not send the code."))
    }
  }

  const submit = async () => {
    setSubmitting(true)
    setNotice(null)
    try {
      await authClient.verifyIdentity({ code })
      await onVerified()
    } catch (error) {
      setNotice(errorNotice(error, "Could not verify the code."))
    } finally {
      setSubmitting(false)
    }
  }

  const shown = notice ?? initialNotice

  return (
    <dialog open className="modal modal-open">
      <div className="modal-box flex flex-col gap-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheckIcon className="size-5" />
          Confirm it's you
        </h3>
        <p className="text-sm text-base-content/70">
          Enter the code we sent to {destination}. It covers this browser for
          the next hour.
        </p>
        {shown ? <NoticeAlert notice={shown} /> : null}
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <input
            autoFocus
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            required
            value={code}
            onChange={(event) =>
              setCode(
                event.target.value
                  .replaceAll(" ", "")
                  .replaceAll("-", "")
                  .toUpperCase()
              )
            }
            placeholder="A1B2C3"
            className="input w-full text-center font-mono text-lg tracking-[0.4em]"
          />
          <div className="modal-action mt-0 flex-wrap">
            <button
              type="button"
              onClick={resend}
              disabled={cooldown > 0}
              className="btn btn-ghost btn-sm"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || code.length === 0}
              className="btn btn-primary btn-sm"
            >
              Confirm
            </button>
          </div>
        </form>
      </div>
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className="modal-backdrop"
      />
    </dialog>
  )
}
