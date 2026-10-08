import { isAuthError } from "@auth-ts/core/client"
import { ShieldCheckIcon } from "@heroicons/react/24/outline"
import { useState } from "react"
import { useCountdown } from "../hooks/use-countdown"
import { useReportError } from "../hooks/use-report-error"
import { authClient } from "../lib/auth-client"
import type { Notice } from "./notice"
import { NoticeAlert } from "./notice"

/** An action behind "confirm it's you", reporting the challenge as its status. */
export type VerifiedAction = () => Promise<{ status: string }>

const RESEND_SECONDS = 30

/**
 * Runs an action, and when the server asks for verification, confirms it's
 * the user and runs it again. One verification covers every action for an
 * hour, so a second revoke goes straight through.
 */
export function useVerifiedAction(destination: string) {
  const [pending, setPending] = useState<{
    action: VerifiedAction
    settle: (error?: unknown) => void
  } | null>(null)
  const [sendNotice, setSendNotice] = useState<Notice | null>(null)
  const report = useReportError()

  // Settles once the retry after verifying does, so its error reaches the caller.
  const run = async (action: VerifiedAction) => {
    const result = await action()
    if (result.status !== "verificationRequired") return

    setSendNotice(null)
    const settled = new Promise<void>((resolve, reject) =>
      setPending({
        action,
        settle: (error) => (error === undefined ? resolve() : reject(error))
      })
    )
    try {
      await authClient.sendIdentityCode()
    } catch (error) {
      await report(error, setSendNotice)
    }
    return settled
  }

  const dialog = pending ? (
    <VerifyIdentityDialog
      destination={destination}
      initialNotice={sendNotice}
      onCancel={() => {
        setPending(null)
        pending.settle()
      }}
      onVerified={async () => {
        try {
          await pending.action()
          pending.settle()
        } catch (error) {
          pending.settle(error)
        } finally {
          setPending(null)
        }
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
  const report = useReportError()

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
      await report(error, setNotice)
    }
  }

  const submit = async () => {
    setSubmitting(true)
    setNotice(null)
    try {
      await authClient.verifyIdentity({ code })
      await onVerified()
    } catch (error) {
      await report(error, setNotice)
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
          Verify your identity
        </h3>
        <p className="text-sm text-base-content/70">
          We sent a one-time code to {destination}. It covers this browser for
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
          <label className="flex flex-col gap-1 text-sm">
            Code
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
              className="input w-full text-center font-mono text-lg tracking-[0.4em]"
            />
          </label>
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
              {submitting ? (
                <span className="loading loading-spinner loading-xs" />
              ) : null}
              Continue
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
