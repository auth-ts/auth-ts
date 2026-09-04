import { useEffect, useState } from "react"

/**
 * Seconds remaining, ticking down to zero once a second.
 *
 * Built for `retryAfter`: the server says how long to wait, and a number that
 * visibly counts down is what turns "try again later" into something a person
 * can act on. Resets whenever a new value is started.
 */
export function useCountdown(): [
  seconds: number,
  start: (from: number) => void
] {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (seconds <= 0) return
    const timer = setTimeout(() => setSeconds(seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds])

  return [seconds, setSeconds]
}
