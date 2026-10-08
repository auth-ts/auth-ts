import { useState } from "react"

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void>
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog open className="modal modal-open">
      <div className="modal-box flex flex-col gap-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-base-content/70">{body}</p>
        <div className="modal-action mt-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn btn-ghost btn-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={`btn btn-sm ${danger ? "btn-error" : "btn-primary"}`}
          >
            {busy ? (
              <span className="loading loading-spinner loading-xs" />
            ) : null}
            {confirmLabel}
          </button>
        </div>
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
