import { isAuthError } from "@auth-ts/client"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { authClient } from "../lib/auth-client"

export const Route = createFileRoute("/login")({ component: LoginPage })

/** Every way in that this demo has configured. */
function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [stage, setStage] = useState<"email" | "code">("email")
  const [message, setMessage] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  const report = (error: unknown) => {
    // Errors are switched on by code, never by message text: the message is
    // localized and free to change, the code is the contract.
    if (isAuthError(error) && error.retryAfter) {
      setCooldown(error.retryAfter)
      setMessage(error.message)
      return
    }

    setMessage(isAuthError(error) ? error.message : "Something went wrong.")
  }

  const requestCode = async () => {
    setMessage(null)
    try {
      await authClient.sendCode({ email })
      setStage("code")
      setMessage("Check the server console for your code.")
    } catch (error) {
      report(error)
    }
  }

  const submitCode = async () => {
    setMessage(null)
    try {
      await authClient.verifyCode({ email, code })
      await navigate({ to: "/todos" })
    } catch (error) {
      report(error)
    }
  }

  return (
    <section className="max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>

      {stage === "email" ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void requestCode()
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 placeholder:text-neutral-500"
          />
          <button
            type="submit"
            className="w-full rounded bg-neutral-100 px-4 py-2 text-neutral-900"
          >
            Email me a code
          </button>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submitCode()
          }}
        >
          <input
            inputMode="numeric"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="123456"
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 tracking-widest placeholder:text-neutral-500"
          />
          <button
            type="submit"
            className="w-full rounded bg-neutral-100 px-4 py-2 text-neutral-900"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setStage("email")}
            className="text-sm text-neutral-500"
          >
            Use a different address
          </button>
        </form>
      )}

      {message ? (
        <p className="text-sm text-neutral-400">
          {message}
          {/* The countdown is the point of retryAfter: "try again later" with no
              number is the least useful error message in software. */}
          {cooldown ? ` (${cooldown}s)` : null}
        </p>
      ) : null}

      <div className="space-y-2 border-t border-neutral-800 pt-6">
        <button
          type="button"
          onClick={() =>
            authClient.signIn({ provider: "github", redirect: "/todos" })
          }
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-4 py-2"
        >
          Continue with GitHub
        </button>
        <button
          type="button"
          onClick={async () => {
            await authClient.signInAsGuest()
            await navigate({ to: "/todos" })
          }}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-4 py-2"
        >
          Continue as guest
        </button>
      </div>
    </section>
  )
}
