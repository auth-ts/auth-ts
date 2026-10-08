import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon
} from "@heroicons/react/24/outline"

export interface Notice {
  text: string
  tone: "success" | "info" | "error"
}

const noticeClass = {
  success: "alert-success",
  info: "alert-info",
  error: "alert-error"
}

const noticeIcon = {
  success: CheckCircleIcon,
  info: InformationCircleIcon,
  error: ExclamationCircleIcon
}

export function NoticeAlert({ notice }: { notice: Notice }) {
  const Icon = noticeIcon[notice.tone]
  return (
    <div
      role="alert"
      className={`alert alert-soft text-sm ${noticeClass[notice.tone]}`}
    >
      <Icon className="size-4 shrink-0" />
      <span>{notice.text}</span>
    </div>
  )
}
