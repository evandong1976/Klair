import type { Notice } from '../../../shared/types'
import { Flower } from '../components/Flower'
import { Button } from '../components/ui'
import { klair } from '../lib/useKlair'

// The approved copy for every failure state (design/canvas/States.dc.html),
// wired to the matching failure from the brief's table.

export function NoticeCard({ notice }: { notice: Notice }): React.JSX.Element | null {
  const dismiss = (): void => void klair.dismissNotice()
  const card = 'rounded-[20px] bg-white/70 border border-white p-4 flex flex-col gap-2.5'
  switch (notice.kind) {
    case 'no-history':
      return (
        <div className="text-[13.5px] leading-[1.5] py-2.5 px-3 rounded-[12px] bg-white text-ink-2 flex items-start justify-between gap-3">
          <span>
            Earlier tabs couldn&apos;t be loaded, so this answer uses only what&apos;s on screen
            now.
          </span>
          <button
            type="button"
            onClick={() => void klair.retry()}
            className="text-[13px] font-bold text-rose-text whitespace-nowrap cursor-pointer"
          >
            Retry with history
          </button>
        </div>
      )
    case 'request-failed':
      return (
        <div className={card}>
          <span className="text-[15.5px] font-extrabold">Couldn&apos;t finish that</span>
          <span className="text-[13.5px] leading-[1.5] text-ink-2">
            Claude stopped responding. Anything already shown is saved; nothing else was lost.
          </span>
          <div className="flex justify-end gap-2">
            <Button onClick={dismiss} keyHint="esc">
              Dismiss
            </Button>
            <Button kind="primary" onClick={() => void klair.retry()} keyHint="⌘R">
              Retry
            </Button>
          </div>
        </div>
      )
    case 'not-saving':
      return (
        <div className={`${card} outline-2 outline-danger-outline -outline-offset-2`}>
          <span className="text-[15.5px] font-extrabold">This session isn&apos;t being saved</span>
          <span className="text-[13.5px] leading-[1.5] text-ink-2">
            Klair can&apos;t reach your TigerData database, so it has stopped capturing. Everything
            saved so far is safe.
            {notice.detail ? (
              <span className="block text-[12px] text-muted mt-1">{notice.detail}</span>
            ) : null}
          </span>
          <div className="flex justify-end gap-2">
            <Button onClick={() => void klair.endSession()} keyHint="⌘E">
              End session
            </Button>
            <Button kind="primary" onClick={() => void klair.retry()} keyHint="⌘R">
              Try again
            </Button>
          </div>
        </div>
      )
    case 'screen-access':
      return (
        <div className={card}>
          <div className="flex items-center gap-3">
            <Flower res={11} cell={3} paused label="Klair is not observing" />
            <span className="text-[15.5px] font-extrabold">Not observing</span>
          </div>
          <span className="text-[13.5px] leading-[1.5] text-ink-2">
            macOS hasn&apos;t let Klair record the screen yet, so it can&apos;t see anything. Turn
            it on in Privacy &amp; Security, then come back.
          </span>
          <div className="flex justify-end">
            <Button kind="primary" onClick={() => void klair.openSettings('screen')} keyHint="⌘↵">
              Open System Settings
            </Button>
          </div>
        </div>
      )
    case 'fn-busy':
      return (
        <div className={card}>
          <span className="text-[15.5px] font-extrabold">macOS is using the fn key</span>
          <span className="text-[13.5px] leading-[1.5] text-ink-2">
            It&apos;s set to switch input or start dictation. Set &quot;Press fn key to&quot; Do
            Nothing in Keyboard settings, or use ⌃⌥K instead.
          </span>
          <div className="flex justify-end gap-2">
            <Button onClick={dismiss}>Use ⌃⌥K instead</Button>
            <Button kind="primary" onClick={() => void klair.openSettings('keyboard')} keyHint="⌘,">
              Settings
            </Button>
          </div>
        </div>
      )
    case 'partial-page':
      return (
        <div className={card}>
          <span className="text-[15.5px] font-extrabold">Summary of what&apos;s been captured</span>
          <span className="text-[13.5px] leading-[1.5] text-ink-2">
            The rest of the page hasn&apos;t been on screen yet. Scroll, then refresh.
          </span>
        </div>
      )
    case 'stale':
      return (
        <span className="text-[13.5px] font-semibold text-ink-2">
          Those ideas were for the last screen
        </span>
      )
    default:
      return null
  }
}
