import { isAuthError } from "@auth-ts/core/client"
import { EnvelopeIcon } from "@heroicons/react/24/outline"
import { useState } from "react"
import { useCountdown } from "../hooks/use-countdown"
import { useReportError } from "../hooks/use-report-error"
import { authClient } from "../lib/auth-client"
import type { Notice } from "./notice"
import { NoticeAlert } from "./notice"
import type { VerifiedAction } from "./verify-identity-dialog"

const RESEND_SECONDS = 30

const TAKEN = "This email address is already linked to an existing account."

/**
 * The author's two pages in one dialog: set the new address, then verify the
 * code sent to it. Both steps run through "confirm it's you".
 */
export function UpdateEmailDialog({
  runVerified,
  onCancel,
  onUpdated
}: {
  runVerified: (action: VerifiedAction) => Promise<void>
  onCancel: () => void
  onUpdated: () => Promise<void>
}) {
  const [step, setStep] = useState<"set" | "verify">("set")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [notice, setNotice] = useState<Notice | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, startCooldown] = useCountdown()
  const report = useReportError()

  const fail = async (error: unknown) => {
    if (isAuthError(error) && error.retryAfter) startCooldown(error.retryAfter)
    if (isAuthError(error) && error.code === "emailTaken") {
      setNotice({ text: TAKEN, tone: "error" })
      return
    }
    await report(error, setNotice)
  }

  const send = async () => {
    setSubmitting(true)
    setNotice(null)
    try {
      await runVerified(async () => {
        const result = await authClient.sendEmailUpdateCode({ email })
        if (result.status === "sent") {
          setStep("verify")
          startCooldown(RESEND_SECONDS)
        }
        return result
      })
    } catch (error) {
      await fail(error)
    } finally {
      setSubmitting(false)
    }
  }

  const resend = async () => {
    setNotice(null)
    try {
      await runVerified(async () => {
        const result = await authClient.sendEmailUpdateCode({ email })
        if (result.status === "sent") {
          startCooldown(RESEND_SECONDS)
          setNotice({
            text: "We've sent another email to your inbox.",
            tone: "info"
          })
        }
        return result
      })
    } catch (error) {
      await fail(error)
    }
  }

  const verify = async () => {
    setSubmitting(true)
    setNotice(null)
    try {
      await runVerified(async () => {
        const result = await authClient.verifyEmailUpdate({ code })
        if (result.status === "updated") await onUpdated()
        return result
      })
    } catch (error) {
      await fail(error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <dialog open className="modal modal-open">
      <div className="modal-box flex flex-col gap-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <EnvelopeIcon className="size-5" />
          {step === "set"
            ? "Set your new email address"
            : "Verify your new email address"}
        </h3>
        <p className="text-sm text-base-content/70">
          {step === "set"
            ? "The email address must be lowercase and no more than 100 characters long."
            : `We sent a verification code to ${email}. It may take up to 30 seconds to arrive. Check your spam or junk folder if you don't see it.`}
        </p>
        {notice ? <NoticeAlert notice={notice} /> : null}
        {step === "set" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              New email address
              <input
                autoFocus
                type="email"
                required
                maxLength={100}
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="input w-full"
              />
            </label>
            <div className="modal-action mt-0">
              <button
                type="button"
                onClick={onCancel}
                className="btn btn-ghost btn-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || email.length === 0}
                className="btn btn-primary btn-sm"
              >
                {submitting ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : null}
                Continue
              </button>
            </div>
          </form>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void verify()
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              Verification code (hyphens and spaces are optional)
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
                onClick={() => void resend()}
                disabled={cooldown > 0}
                className="btn btn-ghost btn-sm"
              >
                {cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : "Resend verification code"}
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
                Update email address
              </button>
            </div>
          </form>
        )}
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
