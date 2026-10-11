import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AnswerBlock, QuizBlock, SliderPlotBlock } from '../../../shared/blocks'
import { isMod } from '../lib/useKlair'
import { Button, Key } from './ui'
import { Explorable } from './Explorable'

// Renderers for the whitelisted answer blocks (src/shared/blocks.ts). Model output is
// rendered as React text only: no HTML injection, no code execution.

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={i++}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`'))
      out.push(
        <code key={i++} className="font-mono text-[12.5px] text-ink">
          {tok.slice(1, -1)}
        </code>
      )
    else out.push(<em key={i++}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  const paras = text.trim().split(/\n{2,}/)
  return (
    <div className="flex flex-col gap-2.5 text-[14.5px] leading-[1.55] text-ink-2">
      {paras.map((p, i) => {
        const lines = p.split('\n')
        if (lines.every((l) => /^\s*[-*]\s+/.test(l)))
          return (
            <ul key={i} className="m-0 pl-5 list-disc flex flex-col gap-1.5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>
              ))}
            </ul>
          )
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l)))
          return (
            <ol key={i} className="m-0 pl-5 list-decimal flex flex-col gap-1.5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>
              ))}
            </ol>
          )
        if (/^#{1,4}\s/.test(p))
          return (
            <h3 key={i} className="m-0 text-[15px] font-extrabold text-ink">
              {inline(p.replace(/^#{1,4}\s/, ''))}
            </h3>
          )
        return (
          <p key={i} className="m-0 text-pretty">
            {inline(p.replace(/\n/g, ' '))}
          </p>
        )
      })}
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
          className="m-0 py-3 px-4 rounded-[16px] bg-code border border-code-line font-mono text-[12.5px] leading-[1.65] text-ink whitespace-pre overflow-x-auto max-h-[260px]"
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

export function Quiz({ block }: { block: QuizBlock }): React.JSX.Element {
  const [qi, setQi] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const q = block.questions[Math.min(qi, block.questions.length - 1)]
  const next = (): void => {
    if (qi < block.questions.length - 1) {
      setQi(qi + 1)
      setPicked(null)
    }
  }
  const restart = (): void => {
    setQi(0)
    setPicked(null)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isMod(e)) return
      const n = Number(e.key)
      if (n >= 1 && n <= q.options.length) {
        setPicked(n - 1)
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
  const right = picked === q.correctIndex
  return (
    <div className="flex flex-col gap-4">
      <div
        aria-hidden="true"
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${block.questions.length}, minmax(0, 1fr))` }}
      >
        {block.questions.map((_, i) => (
          <span key={i} className={`h-1.5 ${i <= qi ? 'bg-rose' : 'bg-white/80'}`} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-ink-3">
          {`Question ${qi + 1} of ${block.questions.length}`}
          {q.source ? ` · ${q.source}` : ''}
        </span>
        <h2 className="m-0 text-[21px] leading-[1.35] font-extrabold text-pretty">{q.prompt}</h2>
      </div>
      <div role="group" aria-label="Answers" className="flex flex-col gap-2">
        {q.options.map((opt, i) => {
          const isCorrect = picked !== null && i === q.correctIndex
          const isPick = picked !== null && i === picked && i !== q.correctIndex
          return (
            <button
              key={i}
              type="button"
              onClick={() => setPicked(i)}
              className={`flex items-center gap-3 min-h-[54px] py-2.5 px-3.5 rounded-[16px] border-[1.5px] text-left text-[15px] font-semibold text-ink cursor-pointer transition-colors ${
                isCorrect
                  ? 'border-sage-dark bg-sage-tint-2'
                  : isPick
                    ? 'border-danger-outline bg-blush-2'
                    : 'border-line bg-white hover:bg-blush-3'
              }`}
            >
              <Key>{`⌘${i + 1}`}</Key>
              <span className="flex-1">{opt}</span>
              {isCorrect ? (
                <span className="text-[12.5px] font-bold text-sage-deeper">Correct answer</span>
              ) : null}
              {isPick ? (
                <span className="text-[12.5px] font-bold text-rose-text">Your pick</span>
              ) : null}
            </button>
          )
        })}
      </div>
      {picked !== null ? (
        <div className="py-3.5 px-4 rounded-[16px] bg-white flex flex-col gap-1.5">
          <span className="text-[14.5px] font-extrabold text-sage-deeper">
            {right ? 'Right.' : 'Not quite.'}
          </span>
          <span className="text-[14px] leading-[1.5] text-ink-2">{q.explanation}</span>
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button onClick={restart} keyHint="⌘R">
          Start over
        </Button>
        <Button
          kind="primary"
          onClick={next}
          keyHint="⌘↵"
          disabled={qi >= block.questions.length - 1}
        >
          Next question
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
