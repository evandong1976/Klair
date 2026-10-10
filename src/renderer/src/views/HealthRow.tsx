import type { ReactNode } from 'react'
import type { CheckStatus } from '../../../shared/types'

const DOT: Record<CheckStatus, string> = {
  ok: 'bg-sage',
  warn: 'bg-[#E9C46A]',
  fail: 'bg-rose',
  unknown: 'bg-line-key'
}

export function HealthRow({
  status,
  title,
  detail,
  action,
  last
}: {
  status: CheckStatus
  title: string
  detail: ReactNode
  action?: ReactNode
  last?: boolean
}): React.JSX.Element {
  return (
    <li
      className={`flex items-center gap-3.5 py-3 px-4 ${last ? '' : 'border-b border-[#F5EDEB]'}`}
    >
      <span aria-hidden="true" className={`w-3 h-3 flex-none ${DOT[status]}`} />
      <span className="flex-1 flex flex-col gap-0.5 min-w-0">
        <span className="text-[14px] font-bold">{title}</span>
        <span className="text-[12.5px] text-muted break-words">{detail}</span>
      </span>
      {action}
    </li>
  )
}
