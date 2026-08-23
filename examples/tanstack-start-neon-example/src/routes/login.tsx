import { isAuthError } from "@auth-ts/client"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { GitHubIcon } from "../components/icons"
import { useCountdown } from "../hooks/use-countdown"
import { useToken } from "../hooks/use-token"
import { authClient } from "../lib/auth-client"

export const Route = createFileRoute("/login")({ component: LoginPage })

interface Notice {
  text: string
  tone: "info" | "error"
}

/** Every way in that this demo has configured. */
function LoginPage() {
  const navigate = useNavigate()
  // The token gates the user query, so refetching it pulls the rest through.
  const { refetch: refetchToken } = useToken()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [stage, setStage] = useState<"email" | "code">("email")
  const [notice, setNotice] = useState<Notice | null>(null)
  const [cooldown, startCooldown] = useCountdown()

  const report = (error: unknown) => {
    // Errors are switched on by code, never by message text: the message is
    // localized and free to change, the code is the contract.
    if (isAuthError(error) && error.retryAfter) {
      startCooldown(error.retryAfter)
      setNotice({ text: error.message, tone: "error" })
      return
    }

    setNotice({
      text: isAuthError(error) ? error.message : "Something went wrong.",
      tone: "error"
    })
  }

  const requestCode = async () => {
    setNotice(null)
    try {
      await authClient.sendCode({ email })
      setStage("code")
      setNotice({
        text: "Check the server console for your code.",
        tone: "info"
      })
    } catch (error) {
      report(error)
    }
  }

  const submitCode = async () => {
    setNotice(null)
    try {
      await authClient.verifyCode({ email, code })
      // Nothing pushes the new session into the cache, so ask for it.
      await refetchToken()
      await navigate({ to: "/todos" })
    } catch (error) {
      report(error)
    }
  }

  const continueAsGuest = async () => {
    setNotice(null)
    try {
      await authClient.signInAsGuest()
      await refetchToken()
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
            <h1 className="card-title text-2xl">Sign in</h1>
            <p className="text-sm text-base-content/60">
              We'll email you a one-time code. No password to remember.
            </p>
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
                <legend className="fieldset-legend">Email</legend>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="input w-full"
                />
              </fieldset>
              {/* The countdown lives on the button, not in the message: the
                  server's text already says how long, and a disabled button
                  that counts down is what turns that into something actionable. */}
              <button
                type="submit"
                disabled={cooldown > 0}
                className="btn btn-primary w-full"
              >
                {cooldown ? `Try again in ${cooldown}s` : "Email me a code"}
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
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="123456"
                  className="input w-full text-center font-mono text-lg tracking-[0.4em]"
                />
                <p className="label">Sent to {email}</p>
              </fieldset>
              <button type="submit" className="btn btn-primary w-full">
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setStage("email")}
                className="btn btn-ghost btn-sm w-full"
              >
                Use a different address
              </button>
            </form>
          )}

          {notice ? (
            <div
              role="alert"
              className={`alert alert-soft text-sm ${
                notice.tone === "error" ? "alert-error" : "alert-info"
              }`}
            >
              <span>{notice.text}</span>
            </div>
          ) : null}

          <div className="divider my-0 text-xs">or</div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() =>
                authClient.signIn({ provider: "github", redirect: "/todos" })
              }
              className="btn btn-outline w-full"
            >
              <GitHubIcon />
              Continue with GitHub
            </button>
            <button
              type="button"
              onClick={() => void continueAsGuest()}
              className="btn btn-ghost w-full"
            >
              Continue as guest
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
