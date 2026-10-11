import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { AnswerState, KlairState, SuggestionSet } from '../../../shared/types'
import { Block } from '../components/blocks'
import { AnimatedShinyText } from '../components/magicui/animated-shiny-text'
import { BlurFade } from '../components/magicui/blur-fade'
import { BorderBeam } from '../components/magicui/border-beam'
import { MagicCard } from '../components/magicui/magic-card'
import { Flower } from '../components/Flower'
import { Button, CloseButton, Key, PixelLabel, PixelProgress, SourceChips } from '../components/ui'
import { useBloom } from '../lib/useBloom'
import { isMod, klair, useKlairState } from '../lib/useKlair'
import { DownloadOfferCards } from './DownloadOffers'
import { CORNER_CELL, CORNER_INSET, CORNER_RES } from './FlowerWindow'
import { NoticeCard } from './NoticeCard'
import { ShortcutsView } from './Shortcuts'

// The panel under the flower: ideas (Open.dc.html), answers (Result.dc.html,
// Quiz.dc.html) and the ⌘/ sheet. ⌘ keys work only here, while the panel has focus.

const WIDTH = { ideas: 460, answer: 572, quiz: 490, shortcuts: 572 } as const

function isQuizOnly(a: AnswerState | null): boolean {
  return !!a && a.blocks.length > 0 && a.blocks.every((b) => b.type === 'quiz')
}

export function PanelWindow(): React.JSX.Element | null {
  const state = useKlairState()
  const rootRef = useRef<HTMLDivElement>(null)
  const askRef = useRef<HTMLInputElement>(null)
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([])

  const view = state?.panel ?? 'closed'
  const width =
    view === 'answer'
      ? isQuizOnly(state?.answer ?? null)
        ? WIDTH.quiz
        : WIDTH.answer
      : view === 'shortcuts'
        ? WIDTH.shortcuts
        : WIDTH.ideas

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const report = (): void =>
      void klair.setPanelSize(width, Math.ceil(el.getBoundingClientRect().height))
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width, view])

  useEffect(() => {
    if (!state) return
    const onKey = (e: KeyboardEvent): void => {
      const s = state
      const typing = document.activeElement?.tagName === 'INPUT'
      if (e.key === 'Escape') {
        e.preventDefault()
        if (typing) return (document.activeElement as HTMLElement).blur()
        if (s.answer && (s.answer.status === 'pending' || s.answer.status === 'streaming')) {
          void klair.cancel()
          return
        }
        if (s.panel === 'shortcuts') return void klair.backToIdeas()
        return void klair.closePanel()
      }
      if (!isMod(e)) return
      const k = e.key.toLowerCase()
      if (k === '/') {
        e.preventDefault()
        return void (s.panel === 'shortcuts' ? klair.backToIdeas() : klair.showShortcuts())
      }
      if (k === 'k') {
        e.preventDefault()
        askRef.current?.focus()
        return
      }
      if (k === 's' && !e.shiftKey && s.session) {
        e.preventDefault()
        return void klair.startSelection()
      }
      if (s.panel === 'ideas' && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        return void klair.pickKey(Number(e.key))
      }
      if (s.panel === 'ideas' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        const tiles = tileRefs.current.filter(Boolean) as HTMLButtonElement[]
        const i = tiles.findIndex((t) => t === document.activeElement)
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1
        tiles[(next + tiles.length) % tiles.length]?.focus()
        return
      }
      if (s.panel === 'answer') {
        if (e.key === '[') {
          e.preventDefault()
          return void klair.backToIdeas()
        }
        if (e.shiftKey && /^Digit[1-3]$/.test(e.code)) {
          const chip = s.answer?.reshape[Number(e.code.slice(5)) - 1]
          if (chip) {
            e.preventDefault()
            void klair.reshape(chip)
          }
          return
        }
        if (k === 'c' && !window.getSelection()?.toString()) {
          const btn = document.querySelector<HTMLButtonElement>('[data-copy-code]')
          if (btn) {
            e.preventDefault()
            btn.click()
          }
          return
        }
        if (
          k === 'r' &&
          s.answer &&
          (s.answer.status === 'failed' || s.answer.status === 'cancelled')
        ) {
          e.preventDefault()
          return void klair.retry()
        }
      }
      if (k === 'e' && s.notice?.kind === 'not-saving') {
        e.preventDefault()
        return void klair.endSession()
      }
      if (k === 'r' && s.notice?.kind === 'not-saving') {
        e.preventDefault()
        return void klair.retry()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state])

  if (!state) return null
  // The beam circles the panel while Klair is reading the screen or writing an answer.
  const busy =
    view === 'answer'
      ? state.answer?.status === 'pending' || state.answer?.status === 'streaming'
      : view === 'ideas' && !!state.session && !state.suggestions

  return (
    <div ref={rootRef} style={{ width }} className="p-0">
      <section aria-label="Klair" className="rounded-[16px] text-ink">
        <MagicCard contentClassName="p-5">
          {view !== 'closed' ? <BackdropFlower /> : null}
          <BlurFade key={view} className="flex flex-col gap-4">
            {state.notice && !['no-history', 'stale', 'switched'].includes(state.notice.kind) ? (
              <NoticeCard notice={state.notice} />
            ) : null}
            {view === 'shortcuts' ? (
              <ShortcutsView />
            ) : view === 'answer' && state.answer ? (
              <AnswerView state={state} answer={state.answer} askRef={askRef} />
            ) : (
              <IdeasView
                state={state}
                set={state.suggestions}
                askRef={askRef}
                tileRefs={tileRefs}
              />
            )}
          </BlurFade>
          {busy ? <BorderBeam /> : null}
        </MagicCard>
      </section>
    </div>
  )
}

/** The pinned selection: a thumbnail, and a way back to following the whole screen. */
function SelectionChip({
  selection
}: {
  selection: NonNullable<KlairState['selection']>
}): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void klair.openShot(selection.captureId).then((url) => alive && setSrc(url))
    return () => {
      alive = false
    }
  }, [selection.captureId])
  const at = new Date(selection.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-[14px] border border-blush-line bg-blush-3">
      {src ? (
        <img
          src={src}
          alt="Your selected area"
          className="flex-none h-12 max-w-24 rounded-[8px] object-cover border border-white"
        />
      ) : (
        <span className="flex-none h-12 w-16 rounded-[8px] bg-white/70" />
      )}
      <span className="flex-1 flex flex-col gap-0.5 min-w-0">
        <span className="text-[13.5px] font-bold">Using your selection</span>
        <span className="text-[12.5px] text-muted">{`${selection.width} × ${selection.height} · ${at}`}</span>
      </span>
      <Button
        onClick={() => void klair.clearSelection()}
        title="Go back to following the whole screen"
        className="h-8 text-[12.5px]"
      >
        Use whole screen
      </Button>
    </div>
  )
}

// The flower as the panel's backdrop. It starts as the corner flower (same pixels, same
// place: FlowerWindow), then in one continuous movement gains detail, grows and settles
// faintly behind the content. Detail (res) and size are separate, so the growth is a
// smooth scale while the pixels resolve underneath it.
const BACKDROP_PX = 210
const BACKDROP_RES = 30
const START_SCALE = (CORNER_RES * CORNER_CELL) / BACKDROP_PX
function BackdropFlower(): React.JSX.Element {
  const res = useBloom(BACKDROP_RES, CORNER_RES)
  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute -z-10 origin-top-right"
      // The card's 1px border sits between the window edge and this element.
      style={{ top: CORNER_INSET - 1, right: CORNER_INSET - 1 }}
      initial={{ scale: START_SCALE, opacity: 1 }}
      animate={{ scale: 1, opacity: [1, 1, 0.22] }}
      transition={{
        scale: { duration: 0.9, ease: [0.22, 1, 0.36, 1] },
        opacity: { duration: 0.9, times: [0, 0.3, 1], ease: 'easeOut' }
      }}
    >
      <Flower res={res} cell={7} size={BACKDROP_PX} label="" />
    </motion.div>
  )
}

function TilePreview({ kind }: { kind: string }): React.JSX.Element {
  if (kind === 'quiz')
    return (
      <span
        aria-hidden="true"
        className="flex-none w-14 h-10 rounded-[8px] bg-ground grid grid-cols-2 gap-1 p-2"
      >
        <span className="bg-sage-line" />
        <span className="bg-[#E6DCD9]" />
        <span className="bg-[#E6DCD9]" />
        <span className="bg-[#E6DCD9]" />
      </span>
    )
  if (kind === 'code')
    return (
      <span
        aria-hidden="true"
        className="flex-none w-14 h-10 rounded-[8px] bg-ground relative overflow-hidden"
      >
        <span className="absolute left-2 top-2 w-1 h-1 bg-rose" />
        <span className="absolute left-4 top-[18px] w-1 h-1 bg-rose" />
        <span className="absolute left-[22px] top-[25px] w-1 h-1 bg-rose" />
        <span className="absolute left-[27px] top-[28px] w-1 h-1 bg-sage-dark" />
        <span className="absolute left-1.5 right-1.5 bottom-1.5 h-0.5 bg-sage-line" />
      </span>
    )
  return (
    <span
      aria-hidden="true"
      className="flex-none w-14 h-10 rounded-[8px] bg-ground p-2 flex flex-col gap-1"
    >
      <span className="h-1 w-full bg-[#E6DCD9]" />
      <span className="h-1 w-4/5 bg-[#E6DCD9]" />
      <span className="h-1 w-[90%] bg-[#E6DCD9]" />
    </span>
  )
}

function AskBox({
  askRef,
  placeholder,
  onSubmit
}: {
  askRef: React.RefObject<HTMLInputElement | null>
  placeholder: string
  onSubmit: (text: string) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  return (
    <form
      className="relative flex"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) onSubmit(text)
        setText('')
      }}
    >
      <input
        ref={askRef}
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="flex-1 h-[46px] box-border pl-3.5 pr-14 rounded-[14px] border border-line-input bg-white text-[14.5px] font-medium text-ink outline-none focus:border-blush-key"
      />
      <Key
        variant="inline"
        className="absolute right-2.5 top-3 text-[11px] shadow-[0_2px_0_#E2D3D0]"
      >
        ⌘K
      </Key>
    </form>
  )
}

function IdeasView({
  state,
  set,
  askRef,
  tileRefs
}: {
  state: KlairState
  set: SuggestionSet | null
  askRef: React.RefObject<HTMLInputElement | null>
  tileRefs: React.RefObject<(HTMLButtonElement | null)[]>
}): React.JSX.Element {
  if (!state.session) {
    return (
      <div className="flex flex-col gap-3">
        <PixelLabel>Klair</PixelLabel>
        <h1 className="m-0 text-[19px] font-extrabold">No session running</h1>
        <p className="m-0 text-[14.5px] text-ink-2">
          Start a session so Klair can see your screen and offer ideas.
        </p>
        <div className="flex justify-end">
          <Button kind="primary" onClick={() => void klair.openWindow('start')}>
            Start a session
          </Button>
        </div>
      </div>
    )
  }
  return (
    <>
      {state.downloads.length ? <DownloadOfferCards offers={state.downloads} /> : null}
      {state.selection ? <SelectionChip selection={state.selection} /> : null}
      {set ? (
        <div className="flex flex-col gap-2">
          <PixelLabel>{state.selection ? 'Your selection' : 'Where you are'}</PixelLabel>
          <h1 className="m-0 text-[19px] font-extrabold leading-[1.3]">{set.whereTitle}</h1>
          <p className="m-0 text-[14.5px] leading-[1.5] text-ink-2 text-pretty">{set.whereRead}</p>
          <SourceChips sources={set.sources} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <PixelLabel>{state.selection ? 'Your selection' : 'Where you are'}</PixelLabel>
          <AnimatedShinyText className="text-[15px] font-bold">
            {state.selection ? 'Reading your selection…' : 'Reading your screen…'}
          </AnimatedShinyText>
          <PixelProgress />
          <span className="text-[13px] text-ink-3">
            Klair is looking at what&apos;s on screen and what you read earlier.
          </span>
        </div>
      )}

      {set ? (
        <nav aria-label="Ideas" className="flex flex-col gap-2">
          {set.ideas.map((idea, i) => (
            <button
              key={idea.id}
              ref={(el) => {
                tileRefs.current[i] = el
              }}
              type="button"
              onClick={() => void klair.pickKey(idea.key)}
              className="flex items-center gap-3 p-3 rounded-[16px] border border-line bg-white min-h-16 text-left cursor-pointer transition-colors hover:bg-blush-3 hover:border-blush-line focus:bg-blush-3 focus:border-blush-line"
            >
              <Key variant={i === 0 ? 'selected' : 'default'}>{`⌘${idea.key}`}</Key>
              <span className="flex-1 flex flex-col gap-0.5">
                <span className="text-[15px] font-bold">{idea.title}</span>
                <span className="text-[13px] text-muted">{idea.subtitle}</span>
              </span>
              <TilePreview kind={idea.kind} />
            </button>
          ))}
        </nav>
      ) : null}

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <AskBox
            askRef={askRef}
            placeholder={state.selection ? 'Ask about your selection…' : 'Ask for something else…'}
            onSubmit={(t) => void klair.ask(t)}
          />
        </div>
        <Button
          onClick={() => void klair.startSelection()}
          keyHint="⌘S"
          title="Drag out an area of the screen for Klair to look at"
          className="h-[46px] text-[13.5px]"
        >
          Select area
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[12.5px] font-semibold text-ink-3">
        <span className="flex items-center gap-1.5">
          <Key variant="small">{`⌘1–${Math.max(3, set?.ideas.length ?? 3)}`}</Key> pick
        </span>
        <span className="flex items-center gap-1.5">
          <Key variant="small">⌘↑↓</Key> move
        </span>
        <button
          type="button"
          onClick={() => void klair.showShortcuts()}
          className="flex items-center gap-1.5 cursor-pointer"
        >
          <Key variant="small">⌘/</Key> all keys
        </button>
        {set ? (
          <button
            type="button"
            onClick={() => void klair.dismissIdeas()}
            className="flex items-center gap-1.5 cursor-pointer"
          >
            Not now
          </button>
        ) : null}
        <span className="flex items-center gap-1.5">
          <Key variant="small">esc</Key> close
        </span>
      </div>
    </>
  )
}

function AnswerView({
  state,
  answer,
  askRef
}: {
  state: KlairState
  answer: AnswerState
  askRef: React.RefObject<HTMLInputElement | null>
}): React.JSX.Element {
  const label =
    answer.kind === 'ask'
      ? 'You asked'
      : answer.kind === 'reshape'
        ? 'Reshaped'
        : answer.pickedKey
          ? `You picked ⌘${answer.pickedKey}`
          : 'Answer'
  const working = answer.status === 'pending' || answer.status === 'streaming'
  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <PixelLabel>{label}</PixelLabel>
          <h1 className="m-0 text-[20px] font-extrabold">{answer.title}</h1>
          {answer.basedOn ? <span className="text-[13px] text-ink-3">{answer.basedOn}</span> : null}
          <SourceChips sources={answer.sources} />
        </div>
        <div className="flex-none flex gap-1.5">
          <Button onClick={() => void klair.backToIdeas()} keyHint="⌘[" className="h-9 text-[13px]">
            Ideas
          </Button>
          <CloseButton onClick={() => void klair.closePanel()} />
        </div>
      </header>

      {state.notice?.kind === 'no-history' ? <NoticeCard notice={state.notice} /> : null}

      {working && answer.blocks.length === 0 ? (
        <div className="rounded-[20px] bg-white/70 border border-white p-4 flex flex-col gap-3">
          <AnimatedShinyText className="text-[15.5px] font-extrabold">
            {answer.kind === 'quiz'
              ? 'Writing your quiz…'
              : answer.kind === 'code'
                ? 'Building a live demo…'
                : 'Working on it…'}
          </AnimatedShinyText>
          <PixelProgress />
          <div className="flex justify-end">
            <Button onClick={() => void klair.cancel()} keyHint="esc">
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 max-h-[560px] overflow-y-auto">
        {answer.blocks.map((b, i) => (
          <Block key={`${answer.actionId}-${i}-${b.type}`} block={b} />
        ))}
      </div>

      {answer.status === 'cancelled' ? (
        <div className="flex items-center justify-between text-[13.5px] text-ink-2">
          <span>Cancelled. What&apos;s shown is kept as partial.</span>
          <Button onClick={() => void klair.retry()} keyHint="⌘R" className="h-9">
            Retry
          </Button>
        </div>
      ) : null}

      {answer.status === 'complete' ? (
        <div className="flex flex-col gap-2.5">
          {answer.reshape.length ? (
            <div className="flex flex-wrap gap-1.5">
              {answer.reshape.map((r, i) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => void klair.reshape(r)}
                  className="h-8 pl-3 pr-1.5 rounded-full border border-line-input bg-white text-[13px] font-semibold text-ink flex items-center gap-1.5 cursor-pointer hover:bg-blush"
                >
                  {r}
                  <Key variant="inline" className="rounded-full text-[10px]">{`⌘⇧${i + 1}`}</Key>
                </button>
              ))}
            </div>
          ) : null}
          <AskBox
            askRef={askRef}
            placeholder="Reshape this… e.g. compare two step sizes"
            onSubmit={(t) => void klair.reshape(t)}
          />
        </div>
      ) : null}
    </>
  )
}
