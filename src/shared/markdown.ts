// The small markdown Klair's answers are written in, parsed into plain data so the
// renderer (components/blocks.tsx) only has to draw it. It covers what the answer
// prompts ask for: paragraphs, headings, bullet and numbered lists, fenced code,
// bold, italic and inline code, and maths written in LaTeX.
//
// Maths is \( ... \) inside a sentence and \[ ... \] or $$ ... $$ on display. A single
// $ is left alone: "$5 to $10" must stay a price.

export type Inline =
  | { type: 'text' | 'strong' | 'em' | 'code'; text: string }
  | { type: 'math'; tex: string; display: boolean }

export type MdBlock =
  | { type: 'p' | 'h'; inline: Inline[] }
  // `nested[i]`: the item was indented under the one before it (a sub-point).
  | { type: 'ul'; items: Inline[][]; nested: boolean[] }
  | { type: 'ol'; start: number; items: Inline[][] }
  | { type: 'code'; language: string; source: string }

const DISPLAY = /\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$/g
// Maths comes first: a "*" or a backtick inside it is not emphasis or code.
const INLINE =
  /(\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g

export function mdInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    const tok = m[0]
    if (tok.startsWith('\\[') || tok.startsWith('$$'))
      out.push({ type: 'math', tex: tok.slice(2, -2).trim(), display: true })
    else if (tok.startsWith('\\('))
      out.push({ type: 'math', tex: tok.slice(2, -2).trim(), display: false })
    else if (tok.startsWith('**')) out.push({ type: 'strong', text: tok.slice(2, -2) })
    else if (tok.startsWith('`')) out.push({ type: 'code', text: tok.slice(1, -1) })
    else out.push({ type: 'em', text: tok.slice(1, -1) })
    last = m.index + tok.length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  // A display equation sits on a line of its own: the spaces and line breaks written
  // around it would only add an empty line above or below.
  out.forEach((tok, i) => {
    if (tok.type !== 'math' || !tok.display) return
    const [before, after] = [out[i - 1], out[i + 1]]
    if (before?.type === 'text') before.text = before.text.trimEnd()
    if (after?.type === 'text') after.text = after.text.trimStart()
  })
  return out.filter((tok) => tok.type !== 'text' || tok.text)
}

// While being read, a block holds its lines as raw text; they are tokenised at the end.
type Raw =
  | { type: 'p' | 'h'; text: string }
  | { type: 'ul'; items: string[]; nested: boolean[] }
  | { type: 'ol'; start: number; items: string[] }

function prose(text: string): MdBlock[] {
  const raw: Raw[] = []
  // Display maths is often written across lines. Put on one line, it can't be split by
  // a blank line or have one of its lines ("- \frac{1}{2}") taken for a list item.
  const flat = text.replace(DISPLAY, (m) => m.replace(/\s*\n\s*/g, ' '))
  for (const para of flat.split(/\n{2,}/)) {
    // Lines are grouped as they come, so a numbered step followed by bullets gives a
    // numbered item and then a list, not one run-on paragraph.
    let run: Raw | null = null
    const open = (block: Raw): void => {
      raw.push(block)
      run = block
    }
    for (const line of para.split('\n')) {
      if (!line.trim()) continue
      const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line)
      const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
      const heading = /^#{1,4}\s+(.*)$/.exec(line)
      const cur = run as Raw | null
      if (heading) {
        raw.push({ type: 'h', text: heading[1] })
        run = null
      } else if (bullet) {
        // Indented under an earlier item: a sub-point (one level is all answers use).
        const nested = bullet[1].length >= 2
        if (cur?.type === 'ul') {
          cur.items.push(bullet[2])
          cur.nested.push(nested)
        } else open({ type: 'ul', items: [bullet[2]], nested: [false] })
      } else if (numbered) {
        if (cur?.type === 'ol') cur.items.push(numbered[2])
        else open({ type: 'ol', start: Number(numbered[1]), items: [numbered[2]] })
      } else if ((cur?.type === 'ul' || cur?.type === 'ol') && /^\s/.test(line)) {
        // An indented line under a list item is the rest of that item.
        cur.items[cur.items.length - 1] += ` ${line.trim()}`
      } else if (cur?.type === 'p') {
        // The line break is kept (the renderer shows it): answers put one item per line
        // ("Training data has 3 points:" and then each point) without making it a list.
        cur.text += `\n${line.trim()}`
      } else {
        open({ type: 'p', text: line.trim() })
      }
    }
  }
  return raw.map((b): MdBlock =>
    'text' in b
      ? { type: b.type, inline: mdInline(b.text) }
      : { ...b, items: b.items.map(mdInline) }
  )
}

export function mdBlocks(text: string): MdBlock[] {
  const out: MdBlock[] = []
  // Fenced code first: nothing inside a fence is markdown. A fence that isn't closed yet
  // (the answer is still streaming) runs to the end.
  let last = 0
  for (const m of text.matchAll(/```([\w+-]*)[^\n]*\n([\s\S]*?)(?:\n?```|$)/g)) {
    out.push(...prose(text.slice(last, m.index)))
    out.push({ type: 'code', language: m[1] || 'text', source: m[2].replace(/\s+$/, '') })
    last = m.index + m[0].length
  }
  out.push(...prose(text.slice(last)))
  return out
}
