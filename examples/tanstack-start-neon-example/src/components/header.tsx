import { Link } from "@tanstack/react-router"

export function Header() {
  return (
    <header className="border-b border-neutral-800 bg-neutral-900">
      <nav className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-4 text-sm">
        <Link to="/" className="font-medium">
          Home
        </Link>

        <Link to="/todos">Todos</Link>

        <Link to="/account">Account</Link>

        <Link to="/login" className="ml-auto">
          Sign in
        </Link>
      </nav>
    </header>
  )
}
