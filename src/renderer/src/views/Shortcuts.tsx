import { CloseButton, Key, PixelLabel } from '../components/ui'
import { klair, useKlairState } from '../lib/useKlair'
import { prettyAccel } from '../../../shared/keys'

// ⌘/ sheet (design/canvas/Shortcuts.dc.html). Mirrors DESIGN.md §4.
const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Anywhere',
    rows: [
      ['Open or close Klair', 'fn  ·  ⌃⌥K'],
      ['Pause or resume observing', 'fn P  ·  ⌃⌥P'],
      ['Quiet ideas for 30 min', 'fn Q  ·  ⌃⌥Q']
    ]
  },
  {
    title: 'When Klair is open',
    rows: [
      ['Pick an idea', '⌘1 ⌘2 ⌘3'],
      ['Ask anything', '⌘K'],
      ['Move between ideas', '⌘↑ ⌘↓'],
      ['Close', 'esc']
    ]
  },
  {
    title: 'In an answer',
    rows: [
      ['Back to ideas', '⌘['],
      ['Reshape chips', '⌘⇧1–3'],
      ['Copy code', '⌘C'],
      ['Nudge a slider', '⌘← ⌘→'],
      ['Slider presets', '⌥1–3']
    ]
  },
  {
    title: 'In a quiz',
    rows: [
      ['Answer', '⌘1–4'],
      ['Next question', '⌘↵'],
      ['Start over', '⌘R']
    ]
  }
]

export function ShortcutsView(): React.JSX.Element {
  const toggleKey = useKlairState()?.toggleKey
  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <PixelLabel>Klair</PixelLabel>
          <h1 className="m-0 text-[22px] font-extrabold">Every shortcut</h1>
        </div>
        <div className="flex items-center gap-2 text-[13px] font-semibold text-ink-3">
          <Key variant="small">⌘/</Key> back
          <CloseButton onClick={() => void klair.closePanel()} />
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3">
        {GROUPS.map((g) => (
          <div
            key={g.title}
            className="rounded-[18px] bg-white border border-line py-3.5 px-4 flex flex-col gap-2"
          >
            <h2 className="m-0 text-[13px] font-extrabold text-sage-deep">{g.title}</h2>
            {g.rows.map(([label, k]) => {
              const keys = toggleKey ? k.replace('⌃⌥K', prettyAccel(toggleKey)) : k
              return (
                <div key={label} className="flex items-center justify-between gap-3 min-h-7">
                  <span className="text-[14px] font-semibold">{label}</span>
                  <Key variant="small" className="text-[11px]">
                    {keys}
                  </Key>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}
