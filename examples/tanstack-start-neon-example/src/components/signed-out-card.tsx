import { ArrowRightEndOnRectangleIcon } from "@heroicons/react/24/outline"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

export function SignedOutCard({
  title,
  children
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="mx-auto max-w-sm">
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body items-center gap-4 text-center">
          <h1 className="card-title text-2xl">{title}</h1>
          <p className="text-base-content/70">{children}</p>
          <Link to="/login" className="btn btn-primary">
            <ArrowRightEndOnRectangleIcon className="size-4" />
            Sign in
          </Link>
        </div>
      </div>
    </section>
  )
}
