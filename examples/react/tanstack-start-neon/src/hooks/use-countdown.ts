import { useEffect, useState } from "react"

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
