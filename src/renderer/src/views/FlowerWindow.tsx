import { useEffect, useState } from 'react'
import { Flower } from '../components/Flower'
import { useBloom } from '../lib/useBloom'
import { Key } from '../components/ui'
import { klair, useKlairState } from '../lib/useKlair'
import { prettyAccel } from '../../../shared/keys'

// Top-right corner (Main.dc.html): the see-through flower, plus a pill when
// there's something to say. The window is click-through except over the pill.

const PILL =
  'surface flex items-center gap-2.5 h-[42px] pl-4 pr-2 rounded-full text-[14px] font-bold text-ink cursor-pointer'

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
  const big = open && (s?.panel === 'ideas' || s?.panel === 'shortcuts')
  const res = useBloom(open ? 30 : 11)
  const cell = open ? (big ? 4 : 3) : 4

  const hasPill =
    !!s && s.flower !== 'off' && !open && (!!s.notice || s.observing === 'paused' || s.nudge)
  useEffect(() => {
    // Never leave the corner clickable once the pill is gone.
    if (!hasPill) void klair.setFlowerInteractive(false)
  }, [hasPill])

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
    } else if (s.nudge && s.suggestions) {
      pill = (
        <button type="button" {...hover} onClick={() => void klair.openPanel()} className={PILL}>
          {`${s.suggestions.ideas.length} ideas for this section`}
          <Key className="text-[11.5px] px-2 py-[5px]">{openKey || prettyAccel(s.toggleKey)}</Key>
        </button>
      )
    }
  }

  return (
    <div className="fixed top-0 right-0 flex flex-row-reverse items-start gap-3 p-0.5">
      <div
        className={!open && s.flower !== 'paused' ? 'klair-bob' : ''}
        style={{ filter: 'drop-shadow(0 1px 1px rgba(90,60,55,0.28))' }}
      >
        <Flower
          res={res}
          cell={cell}
          paused={s.flower === 'paused'}
          label={
            open
              ? 'Klair is open'
              : s.flower === 'paused'
                ? 'Klair is paused'
                : 'Klair is observing'
          }
        />
      </div>
      {pill ? <div className="mt-px">{pill}</div> : null}
    </div>
  )
}
