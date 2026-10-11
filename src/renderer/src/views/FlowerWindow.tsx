import { useEffect, useState } from 'react'
import { Flower } from '../components/Flower'
import { Key } from '../components/ui'
import { klair, useKlairState } from '../lib/useKlair'
import { prettyAccel } from '../../../shared/keys'
import { DownloadOfferPill } from './DownloadOffers'

// Top-right corner (Main.dc.html): the see-through flower, plus a pill when
// there's something to say. The window is click-through except over the pill.
//
// When Klair opens, this flower steps aside: the panel opens over this corner and draws
// the flower itself, starting at exactly this size and place, then blooms it and lets it
// sink into the panel's backdrop (BackdropFlower in Panel.tsx). One window animating
// the whole movement is what keeps it smooth and free of a visible handover.

/** The resting corner flower. The panel's backdrop starts from these. */
export const CORNER_RES = 11
export const CORNER_CELL = 4
/** Its top-right corner sits this far inside the window's (see the p-0.5 wrapper). */
export const CORNER_INSET = 2

const PILL =
  'surface flex items-center gap-2.5 h-[42px] pl-4 pr-2 rounded-full text-[14px] font-bold text-ink cursor-pointer'

/** How long the "N ideas" pill stays before it puts itself away. */
const NUDGE_MS = 3000

export function FlowerWindow(): React.JSX.Element | null {
  const s = useKlairState()
  const [openKey, setOpenKey] = useState('fn')
  useEffect(() => {
    void klair.getHealth().then((h) => {
      const fn = h.checks.find((c) => c.id === 'fnkey')
      setOpenKey(fn?.status === 'ok' ? 'fn' : '')
    })
  }, [])

  const open = s?.flower === 'open'
  const offer = s?.downloads.at(-1) ?? null
  const hasPill =
    !!s &&
    s.flower !== 'off' &&
    !open &&
    (!!s.notice || s.observing === 'paused' || s.nudge || !!offer)
  useEffect(() => {
    // Never leave the corner clickable once the pill is gone.
    if (!hasPill) void klair.setFlowerInteractive(false)
  }, [hasPill])

  // The ideas pill, when it is the pill on show (anything more pressing takes its place).
  // It is a glance, not a fixture: after a few seconds it puts itself away, and the ideas
  // stay one tap of fn away. The countdown waits while the pointer is on the pill, so it
  // never vanishes from under a click.
  const nudgeSet =
    !!s &&
    s.flower !== 'off' &&
    !open &&
    !['not-saving', 'screen-access', 'switched', 'stale'].includes(s.notice?.kind ?? '') &&
    !offer &&
    s.observing !== 'paused' &&
    s.nudge &&
    !s.idle
      ? s.suggestions
      : null
  const nudgeId = nudgeSet?.id ?? null
  // Remembered by set, so a pill that goes while hovered can't hold the next one open.
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const overNudge = hoveredId !== null && hoveredId === nudgeId
  useEffect(() => {
    if (!nudgeId || overNudge) return
    const t = setTimeout(() => void klair.hideNudge(), NUDGE_MS)
    return () => clearTimeout(t)
  }, [nudgeId, overNudge])

  if (!s || s.flower === 'off') return null

  const hover = {
    onMouseEnter: () => void klair.setFlowerInteractive(true),
    onMouseLeave: () => void klair.setFlowerInteractive(false)
  }

  let pill: React.JSX.Element | null = null
  if (!open) {
    if (s.notice?.kind === 'not-saving') {
      pill = (
        <button
          type="button"
          {...hover}
          onClick={() => void klair.openPanel()}
          className={`${PILL} outline-2 outline-danger-outline`}
        >
          This session isn&apos;t being saved
        </button>
      )
    } else if (s.notice?.kind === 'screen-access') {
      pill = (
        <button type="button" {...hover} onClick={() => void klair.openPanel()} className={PILL}>
          Screen access needed
        </button>
      )
    } else if (s.notice?.kind === 'switched') {
      pill = (
        <span className="surface flex items-center h-[42px] px-4 rounded-full text-[13.5px] font-semibold text-ink-2">
          {s.notice.detail?.startsWith('No ') ? s.notice.detail : `Now in ${s.notice.detail}`}
        </span>
      )
    } else if (offer) {
      pill = <DownloadOfferPill offer={offer} hover={hover} />
    } else if (s.notice?.kind === 'stale') {
      pill = (
        <span className="surface flex items-center h-[42px] px-4 rounded-full text-[13.5px] font-semibold text-ink-2 opacity-80">
          Those ideas were for the last screen
        </span>
      )
    } else if (s.observing === 'paused') {
      pill = (
        <span {...hover} className={`${PILL} cursor-default pr-1.5`}>
          Paused
          <button
            type="button"
            onClick={() => void klair.resume()}
            className="h-[30px] pl-3 pr-1.5 rounded-full bg-ink text-on-dark text-[12.5px] font-bold flex items-center gap-1.5 cursor-pointer"
          >
            Resume
            <span className="text-[10.5px] px-1.5 py-0.5 rounded-full bg-key-dark">
              {openKey === 'fn' ? 'fn P' : '⌃⌥P'}
            </span>
          </button>
        </span>
      )
    } else if (nudgeSet) {
      pill = (
        <span
          onMouseEnter={() => {
            hover.onMouseEnter()
            setHoveredId(nudgeSet.id)
          }}
          onMouseLeave={() => {
            hover.onMouseLeave()
            setHoveredId(null)
          }}
          className="surface flex items-center gap-1 h-[42px] pl-4 pr-1.5 rounded-full text-[14px] font-bold text-ink"
        >
          <button
            type="button"
            onClick={() => void klair.openPanel()}
            className="flex items-center gap-2.5 h-full cursor-pointer"
          >
            {`${nudgeSet.ideas.length} ideas for this section`}
            <Key className="text-[11.5px] px-2 py-[5px]">{openKey || prettyAccel(s.toggleKey)}</Key>
          </button>
          <button
            type="button"
            aria-label="Hide"
            title="Hide"
            onClick={() => void klair.hideNudge()}
            className="flex-none w-[26px] h-[26px] rounded-full flex items-center justify-center text-ink-3 cursor-pointer hover:bg-blush hover:text-ink"
          >
            <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M2 2l8 8M10 2l-8 8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </span>
      )
    }
  }

  return (
    <div className="fixed top-0 right-0 flex flex-row-reverse items-start gap-3 p-0.5">
      <div
        className={`${!open && s.flower !== 'paused' && !s.idle ? 'klair-bob' : ''} ${
          // Hidden a beat after the panel opens, so the two flowers overlap rather than blink.
          open ? 'opacity-0 transition-opacity duration-0 delay-[90ms]' : ''
        }`}
        style={{ filter: 'drop-shadow(0 1px 1px rgba(90,60,55,0.28))' }}
      >
        <Flower
          res={CORNER_RES}
          cell={CORNER_CELL}
          // Grey when paused, and when there is nothing on screen to help with.
          paused={s.flower === 'paused' || s.idle}
          label={
            open
              ? 'Klair is open'
              : s.flower === 'paused'
                ? 'Klair is paused'
                : s.idle
                  ? 'Klair sees nothing to help with on this screen'
                  : 'Klair is observing'
          }
        />
      </div>
      {pill ? <div className="mt-px">{pill}</div> : null}
    </div>
  )
}
