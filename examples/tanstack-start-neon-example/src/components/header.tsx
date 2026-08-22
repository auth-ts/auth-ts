import { Link } from "@tanstack/react-router"
import { useUser } from "../hooks/use-user"
import { Logo } from "./logo"

export function Header() {
  const { data: user } = useUser()
  const label = user?.name ?? user?.email ?? user?.phoneNumber ?? "Guest"

  return (
    <header className="border-b border-base-300 bg-base-100">
      <div className="navbar mx-auto max-w-3xl px-2">
        <div className="navbar-start">
          <Link
            to="/"
            className="btn btn-ghost gap-1.5 px-2 text-lg font-semibold"
          >
            <Logo className="size-6 text-primary" />
            Auth.ts
          </Link>
        </div>

        <div className="navbar-center">
          <ul className="menu menu-horizontal gap-1 px-0">
            <li>
              <Link to="/todos" activeProps={{ className: "menu-active" }}>
                Todos
              </Link>
            </li>
            <li>
              <Link to="/account" activeProps={{ className: "menu-active" }}>
                Account
              </Link>
            </li>
          </ul>
        </div>

        <div className="navbar-end">
          {user ? (
            <Link to="/account" className="btn btn-ghost gap-2 px-2">
              {user.imageURL ? (
                <div className="avatar">
                  <div className="w-8 rounded-full">
                    <img src={user.imageURL} alt="" />
                  </div>
                </div>
              ) : (
                <div className="avatar avatar-placeholder">
                  <div className="w-8 rounded-full bg-primary text-primary-content">
                    <span className="text-xs uppercase">
                      {label.slice(0, 1)}
                    </span>
                  </div>
                </div>
              )}
              <span className="hidden max-w-40 truncate font-normal sm:inline">
                {label}
              </span>
            </Link>
          ) : (
            <Link to="/login" className="btn btn-primary btn-sm">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
