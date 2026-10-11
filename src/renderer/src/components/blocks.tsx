import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AnswerBlock, QuizBlock, SliderPlotBlock } from '../../../shared/blocks'
import { mdBlocks, mdInline, type Inline } from '../../../shared/markdown'
import { isMod } from '../lib/useKlair'
import { Button, Key } from './ui'
import { Explorable } from './Explorable'

// Renderers for the whitelisted answer blocks (src/shared/blocks.ts). Model output is
// rendered as React text only: no HTML injection, no code execution. The one exception
// is maths: KaTeX parses the LaTeX itself and returns its own markup, with `trust` off
// (no links, images or raw HTML can come through it).

/**
 * An equation, drawn by KaTeX with its own fonts (bundled, so it works offline). The
 * browser's built-in maths layout was tried first: it drops bold vectors and blackboard
 * letters. A formula KaTeX can't parse is shown as its source, in red.
 */
function Tex({ tex, display }: { tex: string; display: boolean }): React.JSX.Element {
  const html = useMemo(
    () =>
      katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore' }),
    [tex, display]
  )
  return (
    <span
      // A long display equation scrolls sideways inside the panel instead of widening it.
      className={display ? 'block overflow-x-auto overflow-y-hidden' : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function inline(tokens: Inline[]): ReactNode[] {
  return tokens.map((t, i) =>
    t.type === 'text' ? (
      t.text
    ) : t.type === 'math' ? (
      <Tex key={i} tex={t.tex} display={t.display} />
    ) : t.type === 'strong' ? (
      <strong key={i}>{t.text}</strong>
    ) : t.type === 'code' ? (
      <code key={i} className="font-mono text-[12.5px] text-ink">
        {t.text}
      </code>
    ) : (
      <em key={i}>{t.text}</em>
    )
  )
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks = useMemo(() => mdBlocks(text), [text])
  return (
    <div className="flex flex-col gap-2.5 text-[14.5px] leading-[1.55] text-ink-2">
      {blocks.map((b, i) =>
        b.type === 'ul' ? (
          <ul key={i} className="m-0 pl-5 list-disc flex flex-col gap-1.5">
            {b.items.map((item, j) => (
              <li key={j} className={b.nested[j] ? 'ml-5 list-[circle]' : undefined}>
                {inline(item)}
              </li>
            ))}
          </ul>
        ) : b.type === 'ol' ? (
          <ol key={i} start={b.start} className="m-0 pl-5 list-decimal flex flex-col gap-1.5">
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </ol>
        ) : b.type === 'h' ? (
          <h3 key={i} className="m-0 text-[15px] font-extrabold text-ink">
            {inline(b.inline)}
          </h3>
        ) : b.type === 'code' ? (
          <CodeBlock key={i} language={b.language} source={b.source} />
        ) : (
          <p key={i} className="m-0 text-pretty whitespace-pre-line">
            {inline(b.inline)}
          </p>
        )
      )}
    </div>
  )
}

export function CodeBlock({
  language,
  source,
  caption
}: {
  language: string
  source: string
  caption?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard.writeText(source).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div className="relative">
        <pre
          aria-label={`${language} code`}
          // Prose in a fence (a drafted reply, a prompt to paste) wraps; code keeps its lines.
          className={`m-0 py-3 pl-4 pr-[84px] rounded-[16px] bg-code border border-code-line font-mono text-[12.5px] leading-[1.65] text-ink overflow-auto max-h-[260px] ${
            /^(text|markdown|md)$/.test(language) ? 'whitespace-pre-wrap' : 'whitespace-pre'
          }`}
        >
          {source}
        </pre>
        <button
          type="button"
          data-copy-code
          onClick={copy}
          className="absolute top-2.5 right-2.5 h-[30px] pl-2.5 pr-1.5 rounded-[8px] border border-[#E4DFD3] bg-white text-[12px] font-semibold text-ink flex items-center gap-1.5 cursor-pointer"
        >
          {copied ? 'Copied' : 'Copy'}
          <Key variant="inline" className="text-[10px]">
            ⌘C
          </Key>
        </button>
      </div>
      {caption ? <figcaption className="text-[12.5px] text-muted">{caption}</figcaption> : null}
    </figure>
  )
}

export function SliderPlot({ block }: { block: SliderPlotBlock }): React.JSX.Element {
  const { param } = block
  const [value, setValue] = useState(param.initial)
  const W = 480
  const H = 150
  const allPts = useMemo(
    () => [...block.curve, ...block.series.flatMap((s) => s.points)],
    [block.curve, block.series]
  )
  const xs = allPts.map((p) => p.x)
  const ys = allPts.map((p) => p.y)
  const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)]
  const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)]
  const X = (x: number): number => ((x - xMin) / (xMax - xMin || 1)) * (W - 12) + 6
  const Y = (y: number): number => H - 6 - ((y - yMin) / (yMax - yMin || 1)) * (H - 14)
  const series = block.series.reduce((best, s) =>
    Math.abs(s.value - value) < Math.abs(best.value - value) ? s : best
  )
  const curve = block.curve.map((p, i) => `${i ? 'L' : 'M'} ${X(p.x)} ${Y(p.y)}`).join(' ')
  const pts = series.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')
  const presets = [param.min, (param.min + param.max) / 2, param.max].map(
    (v) => Math.round(v / param.step) * param.step
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && !isMod(e) && ['1', '2', '3'].includes(e.key)) {
        setValue(presets[Number(e.key) - 1])
        e.preventDefault()
      }
      if (isMod(e) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const d = e.key === 'ArrowLeft' ? -param.step : param.step
        setValue((v) => Math.min(param.max, Math.max(param.min, +(v + d).toFixed(6))))
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [param.max, param.min, param.step, presets])

  const fmt = (v: number): string => (param.step < 1 ? v.toFixed(2) : String(v))

  return (
    <div className="rounded-[18px] bg-white border border-line py-3.5 px-4 flex flex-col gap-2.5">
      <div className="text-[13px] font-extrabold text-ink">{block.title}</div>
      <div className="flex items-center gap-3">
        <label htmlFor="klair-param" className="text-[14px] font-bold whitespace-nowrap">
          {param.label}
        </label>
        <input
          id="klair-param"
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={value}
          onChange={(e) => setValue(parseFloat(e.target.value))}
          className="flex-1"
        />
        <span className="font-mono text-[13px] w-10 text-right">{fmt(value)}</span>
        <Key variant="small">⌘← →</Key>
      </div>
      <div className="relative self-center" style={{ width: W, height: H }}>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden="true"
          className="absolute inset-0"
        >
          <line x1="0" y1={H - 6} x2={W} y2={H - 6} stroke="#E6E9DD" strokeWidth="2" />
          <path d={curve} fill="none" stroke="#9CAA77" strokeWidth="2" />
          <polyline
            points={pts}
            fill="none"
            stroke="#EE8378"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        </svg>
        {series.points.map((p, i) => {
          const last = i === series.points.length - 1
          const s = last ? 8 : 6
          return (
            <span
              key={i}
              className="absolute"
              style={{
                left: X(p.x) - s / 2,
                top: Y(p.y) - s / 2,
                width: s,
                height: s,
                background: last ? '#56623F' : '#EE8378',
                boxShadow: '0 0 0 1px #FFFFFF'
              }}
            />
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-ink-2">{series.status}</span>
        <div className="flex gap-1.5">
          {presets.map((v, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setValue(v)}
              className="h-[30px] pl-2 pr-1.5 rounded-[8px] border border-line-input bg-white font-mono text-[12px] text-ink flex items-center gap-1.5 cursor-pointer hover:bg-blush"
            >
              {fmt(v)}
              <Key variant="inline" className="text-[10px]">{`⌥${i + 1}`}</Key>
            </button>
          ))}
        </div>
      </div>
      {block.codeTemplate ? (
        <CodeBlock
          language="python"
          source={block.codeTemplate.replaceAll('{{value}}', fmt(value))}
        />
      ) : null}
    </div>
  )
}

/** Text a model wrote for a quiz: plain, with maths and bold drawn as in answers. */
const rich = (text: string): ReactNode[] => inline(mdInline(text))

/**
 * "Test me": one question at a time. Picking an option locks it in and shows whether it
 * was right and why; after the last question comes the score and every answer.
 */
export function Quiz({ block }: { block: QuizBlock }): React.JSX.Element {
  const total = block.questions.length
  const [qi, setQi] = useState(0)
  // What was picked for each question so far (undefined = not answered yet).
  const [picks, setPicks] = useState<number[]>([])
  const [finished, setFinished] = useState(false)
  const q = block.questions[Math.min(qi, total - 1)]
  const picked = picks[qi] as number | undefined
  const last = qi >= total - 1
  const score = block.questions.filter((x, i) => picks[i] === x.correctIndex).length

  const pick = (i: number): void => {
    // The first pick counts: an answer can't be changed once the right one is showing.
    if (finished || picked !== undefined || i >= q.options.length) return
    setPicks((cur) => {
      const next = [...cur]
      next[qi] = i
      return next
    })
  }
  const next = (): void => {
    if (finished || picked === undefined) return
    if (last) setFinished(true)
    else setQi(qi + 1)
  }
  const restart = (): void => {
    setQi(0)
    setPicks([])
    setFinished(false)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isMod(e) || e.shiftKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= q.options.length && !finished) {
        pick(n - 1)
        e.preventDefault()
      } else if (e.key === 'Enter') {
        next()
        e.preventDefault()
      } else if (e.key.toLowerCase() === 'r') {
        restart()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const progress = (
    <div
      aria-hidden="true"
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
    >
      {block.questions.map((x, i) => (
        <span
          key={i}
          // Answered: sage if right, rose if not. The one being asked is rose; the rest wait.
          className={`h-1.5 ${
            picks[i] !== undefined
              ? picks[i] === x.correctIndex
                ? 'bg-sage'
                : 'bg-rose'
              : i === qi && !finished
                ? 'bg-blush-key'
                : 'bg-white/80'
          }`}
        />
      ))}
    </div>
  )

  if (finished) {
    return (
      <div className="flex flex-col gap-4">
        {progress}
        {/* The way back in sits beside the score, so it never needs scrolling to. */}
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-ink-3">Your score</span>
            <h2 className="m-0 text-[28px] leading-[1.2] font-extrabold">{`${score} of ${total}`}</h2>
            <span className="text-[14px] text-ink-2">
              {score === total
                ? 'Every one right.'
                : score === 0
                  ? 'None right this time. The answers are below.'
                  : `${total - score} to look at again. The answers are below.`}
            </span>
          </div>
          <Button kind="primary" onClick={restart} keyHint="⌘R" className="flex-none">
            Try again
          </Button>
        </div>
        <ol className="list-none m-0 p-0 flex flex-col gap-2">
          {block.questions.map((x, i) => {
            const right = picks[i] === x.correctIndex
            return (
              <li key={i} className="py-3 px-3.5 rounded-[16px] bg-white flex flex-col gap-1.5">
                <span className="flex items-start gap-2 text-[14.5px] font-bold text-ink">
                  <span
                    className={`flex-none mt-0.5 w-[18px] h-[18px] rounded-full text-[11px] leading-[18px] text-center text-white ${
                      right ? 'bg-sage-dark' : 'bg-rose'
                    }`}
                    aria-label={right ? 'Right' : 'Wrong'}
                  >
                    {right ? '✓' : '✕'}
                  </span>
                  <span className="flex-1 text-pretty">{rich(x.prompt)}</span>
                </span>
                {right ? null : (
                  <span className="pl-[26px] text-[13.5px] text-rose-text">
                    {'You picked: '}
                    {rich(x.options[picks[i]] ?? '')}
                  </span>
                )}
                <span className="pl-[26px] text-[13.5px] font-semibold text-sage-deeper">
                  {'Answer: '}
                  {rich(x.options[x.correctIndex])}
                </span>
                {x.explanation ? (
                  <span className="pl-[26px] text-[13.5px] leading-[1.5] text-ink-2">
                    {rich(x.explanation)}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ol>
      </div>
    )
  }

  const right = picked === q.correctIndex
  return (
    <div className="flex flex-col gap-4">
      {progress}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-ink-3">
          {`Question ${qi + 1} of ${total}`}
          {q.source ? ` · ${q.source}` : ''}
        </span>
        <h2 className="m-0 text-[19px] leading-[1.35] font-extrabold text-pretty">
          {rich(q.prompt)}
        </h2>
      </div>
      <div role="group" aria-label="Answers" className="flex flex-col gap-2">
        {q.options.map((opt, i) => {
          const answered = picked !== undefined
          const isCorrect = answered && i === q.correctIndex
          const isPick = answered && i === picked && i !== q.correctIndex
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(i)}
              aria-disabled={answered || undefined}
              className={`flex items-center gap-3 min-h-[54px] py-2.5 px-3.5 rounded-[16px] border-[1.5px] text-left text-[15px] font-semibold text-ink transition-colors ${
                isCorrect
                  ? 'border-sage-dark bg-sage-tint-2'
                  : isPick
                    ? 'border-danger-outline bg-blush-2'
                    : answered
                      ? 'border-line bg-white opacity-60'
                      : 'border-line bg-white cursor-pointer hover:bg-blush-3'
              }`}
            >
              <Key>{`⌘${i + 1}`}</Key>
              <span className="flex-1">{rich(opt)}</span>
              {isCorrect ? (
                <span className="flex-none text-[12.5px] font-bold text-sage-deeper">
                  {right ? 'Correct' : 'Correct answer'}
                </span>
              ) : null}
              {isPick ? (
                <span className="flex-none text-[12.5px] font-bold text-rose-text">Your pick</span>
              ) : null}
            </button>
          )
        })}
      </div>
      {picked !== undefined ? (
        <div className="py-3.5 px-4 rounded-[16px] bg-white flex flex-col gap-1.5">
          <span
            className={`text-[14.5px] font-extrabold ${right ? 'text-sage-deeper' : 'text-rose-text'}`}
          >
            {right ? 'Right.' : 'Not quite.'}
          </span>
          {q.explanation ? (
            <span className="text-[14px] leading-[1.5] text-ink-2">{rich(q.explanation)}</span>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button onClick={restart} keyHint="⌘R">
          Start over
        </Button>
        <Button kind="primary" onClick={next} keyHint="⌘↵" disabled={picked === undefined}>
          {last ? 'See your score' : 'Next question'}
        </Button>
      </div>
    </div>
  )
}

export function Block({ block }: { block: AnswerBlock }): React.JSX.Element | null {
  switch (block.type) {
    case 'text':
      return <Markdown text={block.markdown} />
    case 'code':
      return <CodeBlock language={block.language} source={block.source} caption={block.caption} />
    case 'slider-plot':
      return <SliderPlot block={block} />
    case 'explorable':
      return <Explorable spec={block.spec} />
    case 'quiz':
      return <Quiz block={block} />
    case 'steps':
      return (
        <ol className="m-0 pl-5 list-decimal flex flex-col gap-1.5 text-[14.5px] leading-[1.5] text-ink-2">
          {block.items.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )
    default:
      return null
  }
}
