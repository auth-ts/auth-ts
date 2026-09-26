import { isAuthError } from "@auth-ts/core/client"
import {
  ArrowLeftIcon,
  ArrowRightEndOnRectangleIcon,
  EnvelopeIcon,
  UserIcon
} from "@heroicons/react/24/outline"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { GitHubIcon } from "../components/github-icon"
import type { Notice } from "../components/notice"
import { NoticeAlert } from "../components/notice"
import { useCountdown } from "../hooks/use-countdown"
import { UNEXPECTED } from "../hooks/use-report-error"
import { useUser } from "../hooks/use-user"
import { authClient } from "../lib/auth-client"

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): { error?: string } =>
    typeof search.error === "string" ? { error: search.error } : {}
})

/** Messages for `?error=` codes. */
const signInFailures: Record<string, string> = {
  providerDenied: "That sign-in was cancelled.",
  providerRejected: "That sign-in could not be completed. Please try again.",
  providerEmailUnverified:
    "Verify your email address with that provider, then try again.",
  providerUnavailable: "The provider did not respond. Please try again.",
  providerConflict: "That account is already connected to a different user.",
  invalidState: "That sign-in attempt expired. Please start again.",
  sessionExpired: "Your session has expired."
}

function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: user } = useUser()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [stage, setStage] = useState<"email" | "code">("email")
  const { error } = Route.useSearch()
  const [notice, setNotice] = useState<Notice | null>(
    error
      ? { text: signInFailures[error] ?? "That sign-in failed.", tone: "error" }
      : null
  )
  const [cooldown, startCooldown] = useCountdown()
  const [pending, setPending] = useState<string | null>(null)

  // Back from GitHub restores this page with the spinner still on.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(null)
    }
    window.addEventListener("pageshow", reset)
    return () => window.removeEventListener("pageshow", reset)
  }, [])

  const report = (error: unknown) => {
    setPending(null)
    if (isAuthError(error) && error.retryAfter) {
      startCooldown(error.retryAfter)
      setNotice({ text: error.message, tone: "error" })
      return
    }

    setNotice({
      text: isAuthError(error) ? error.message : UNEXPECTED,
      tone: "error"
    })
  }

  const requestCode = async () => {
    setNotice(null)
    setPending("send")
    try {
      await authClient.sendSignInCode({ email })
      setPending(null)
      setStage("code")
      if (import.meta.env.DEV) {
        setNotice({
          text: "Check the server console for your code.",
          tone: "info"
        })
      }
    } catch (error) {
      report(error)
    }
  }

  const submitCode = async () => {
    setNotice(null)
    setPending("code")
    try {
      await authClient.signInWithCode({ code })
      await queryClient.invalidateQueries()
      await navigate({ to: "/todos" })
    } catch (error) {
      report(error)
    }
  }

  const continueWithGitHub = async () => {
    setNotice(null)
    setPending("github")
    try {
      await authClient.signInWithProvider({
        provider: "github",
        redirect: "/todos",
        errorRedirect: "/login"
      })
    } catch (error) {
      report(error)
    }
  }

  const continueAsGuest = async () => {
    setNotice(null)
    setPending("guest")
    try {
      await authClient.signInAsGuest()
      await queryClient.invalidateQueries()
      await navigate({ to: "/todos" })
    } catch (error) {
      report(error)
    }
  }

  return (
    <section className="mx-auto max-w-sm">
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body gap-5">
          <div>
            <h1 className="card-title text-2xl">
              {stage === "email" ? "Sign in" : "Sign in with email code"}
            </h1>
            <p className="text-sm text-base-content/60">
              {stage === "email"
                ? "We'll email you a one-time code. No password to remember."
                : `We sent a one-time code to ${email}.`}
            </p>
            {user?.type === "guest" ? (
              <p className="mt-2 text-sm text-base-content/60">
                You're signed in as a guest. Sign in to keep everything you've
                made so far.
              </p>
            ) : null}
          </div>

          {stage === "email" ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                void requestCode()
              }}
            >
              <fieldset className="fieldset">
                <legend className="fieldset-legend">
                  Email address (lowercase)
                </legend>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={100}
                  className="input w-full"
                />
              </fieldset>
              <button
                type="submit"
                disabled={cooldown > 0 || pending !== null}
                className="btn btn-primary w-full"
              >
                {pending === "send" ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : cooldown ? (
                  `Try again in ${cooldown}s`
                ) : (
                  <>
                    <EnvelopeIcon className="size-4" />
                    Continue
                  </>
                )}
              </button>
            </form>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                void submitCode()
              }}
            >
              <fieldset className="fieldset">
                <legend className="fieldset-legend">Code</legend>
                <input
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
              </fieldset>
              <button
                type="submit"
                disabled={cooldown > 0 || pending !== null}
                className="btn btn-primary w-full"
              >
                {pending === "code" ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : cooldown ? (
                  `Try again in ${cooldown}s`
                ) : (
                  <>
                    <ArrowRightEndOnRectangleIcon className="size-4" />
                    Continue
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setStage("email")}
                className="btn btn-ghost btn-sm w-full"
              >
                <ArrowLeftIcon className="size-4" />
                Cancel
              </button>
            </form>
          )}

          {notice ? <NoticeAlert notice={notice} /> : null}

          <div className="divider my-0 text-xs">or</div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void continueWithGitHub()}
              disabled={pending !== null}
              className="btn btn-outline w-full"
            >
              {pending === "github" ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <GitHubIcon className="size-4" />
              )}
              Continue with GitHub
            </button>
            {/* Guests need a signed-out browser. */}
            {user ? null : (
              <button
                type="button"
                onClick={() => void continueAsGuest()}
                disabled={pending !== null}
                className="btn btn-ghost w-full"
              >
                {pending === "guest" ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <UserIcon className="size-4" />
                )}
                Continue as guest
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
