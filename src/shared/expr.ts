// A small, safe expression language for interactive explainers (explorable.ts).
//
// The model writes math such as "x - lr * gx" or "lr > 0.3 && diverged". Klair parses
// it here and evaluates it itself: nothing is ever handed to eval or Function, so text
// that started on someone's screen can't run code. Every name must be a declared
// variable, a known constant or a known function, checked when the expression is
// compiled, so a bad expression is caught before it is ever drawn.

export class ExprError extends Error {}

export type Scope = Record<string, number>
export type Compiled = (scope: Scope) => number

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  hypot: Math.hypot,
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
  sigmoid: (x) => 1 / (1 + Math.exp(-x)),
  relu: (x) => Math.max(0, x)
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  E: Math.E,
  true: 1,
  false: 0,
  Infinity: Infinity
}

/** Names an explainer may not use for its own variables. */
export function isBuiltinName(name: string): boolean {
  return Object.hasOwn(FUNCTIONS, name) || Object.hasOwn(CONSTANTS, name)
}

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string }

const WORD_OPS: Record<string, string> = { and: '&&', or: '||', not: '!' }
const TOKEN =
  /\s+|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|((?:Math\.)?[A-Za-z_Ͱ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*)|(\*\*|===|!==|==|!=|<=|>=|&&|\|\||[-+*/%^(),<>!?:])/y

function tokenize(source: string): Token[] {
  // Math copied from a page often uses typographic signs.
  const s = source
    .replace(/[−–]/g, '-')
    .replace(/[×·⋅]/g, '*')
    .replace(/÷/g, '/')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/≠/g, '!=')
  const out: Token[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < s.length) {
    const at = TOKEN.lastIndex
    const m = TOKEN.exec(s)
    if (!m) throw new ExprError(`Unexpected "${s[at]}" in "${source}"`)
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) })
    else if (m[2] !== undefined) {
      const name = m[2].replace(/^Math\./, '')
      if (Object.hasOwn(WORD_OPS, name)) out.push({ t: 'op', v: WORD_OPS[name] })
      else out.push({ t: 'id', v: name })
    } else if (m[3] !== undefined) out.push({ t: 'op', v: m[3] })
  }
  return out
}

const truthy = (v: number): boolean => v !== 0 && !Number.isNaN(v)

function compare(op: string, a: number, b: number): boolean {
  switch (op) {
    case '<':
      return a < b
    case '<=':
      return a <= b
    case '>':
      return a > b
    default:
      return a >= b
  }
}

/**
 * Compile an expression that may use the given variable names. Throws ExprError,
 * with a message a person (or the model, on a retry) can act on, if it can't be used.
 */
export function compile(source: string, variables: readonly string[]): Compiled {
  if (typeof source !== 'string' || !source.trim()) throw new ExprError('An expression is empty')
  if (source.length > 400) throw new ExprError('An expression is too long')
  const tokens = tokenize(source)
  let pos = 0

  const peek = (): Token | undefined => tokens[pos]
  const isOp = (...ops: string[]): boolean => {
    const t = tokens[pos]
    return !!t && t.t === 'op' && ops.includes(t.v)
  }
  const fail = (): never => {
    const t = peek()
    throw new ExprError(
      t ? `Unexpected "${t.v}" in "${source}"` : `"${source}" ends before it is complete`
    )
  }
  /** Consume the operator the caller has just checked for with isOp. */
  const takeOp = (): string => String((tokens[pos++] as Token).v)
  const expect = (op: string): void => {
    if (!isOp(op)) fail()
    pos++
  }

  function ternary(): Compiled {
    const cond = or()
    if (!isOp('?')) return cond
    pos++
    const yes = ternary()
    expect(':')
    const no = ternary()
    return (s) => (truthy(cond(s)) ? yes(s) : no(s))
  }

  function or(): Compiled {
    let left = and()
    while (isOp('||')) {
      pos++
      const a = left
      const b = and()
      left = (s) => (truthy(a(s)) || truthy(b(s)) ? 1 : 0)
    }
    return left
  }

  function and(): Compiled {
    let left = equality()
    while (isOp('&&')) {
      pos++
      const a = left
      const b = equality()
      left = (s) => (truthy(a(s)) && truthy(b(s)) ? 1 : 0)
    }
    return left
  }

  function equality(): Compiled {
    let left = comparison()
    while (isOp('==', '===', '!=', '!==')) {
      const negate = takeOp().startsWith('!')
      const a = left
      const b = comparison()
      left = (s) => ((a(s) === b(s)) !== negate ? 1 : 0)
    }
    return left
  }

  // Chains read the way they are written in math: 0.05 <= lr <= 0.4.
  function comparison(): Compiled {
    const first = additive()
    const rest: [string, Compiled][] = []
    while (isOp('<', '<=', '>', '>=')) {
      const op = takeOp()
      rest.push([op, additive()])
    }
    if (!rest.length) return first
    return (s) => {
      let left = first(s)
      for (const [op, f] of rest) {
        const right = f(s)
        if (!compare(op, left, right)) return 0
        left = right
      }
      return 1
    }
  }

  function additive(): Compiled {
    let left = multiplicative()
    while (isOp('+', '-')) {
      const minus = takeOp() === '-'
      const a = left
      const b = multiplicative()
      left = minus ? (s) => a(s) - b(s) : (s) => a(s) + b(s)
    }
    return left
  }

  function multiplicative(): Compiled {
    let left = unary()
    for (;;) {
      const t = peek()
      const prev = tokens[pos - 1]
      // "2x" and "2(x + 1)": a number directly followed by a name or a bracket.
      const implicit = !!t && prev?.t === 'num' && (t.t === 'id' || (t.t === 'op' && t.v === '('))
      if (!implicit && !isOp('*', '/', '%')) return left
      const op = implicit ? '*' : takeOp()
      const a = left
      const b = unary()
      left = op === '*' ? (s) => a(s) * b(s) : op === '/' ? (s) => a(s) / b(s) : (s) => a(s) % b(s)
    }
  }

  function unary(): Compiled {
    if (isOp('-')) {
      pos++
      const v = unary()
      return (s) => -v(s)
    }
    if (isOp('+')) {
      pos++
      return unary()
    }
    if (isOp('!')) {
      pos++
      const v = unary()
      return (s) => (truthy(v(s)) ? 0 : 1)
    }
    return power()
  }

  // Right-associative, and tighter than a leading minus: -x^2 is -(x^2).
  function power(): Compiled {
    const base = primary()
    if (!isOp('^', '**')) return base
    pos++
    const exponent = unary()
    return (s) => Math.pow(base(s), exponent(s))
  }

  function primary(): Compiled {
    const t = peek()
    if (!t) return fail()
    if (t.t === 'num') {
      pos++
      const v = t.v
      return () => v
    }
    if (t.t === 'id') {
      pos++
      const name = t.v
      if (isOp('(')) {
        pos++
        if (!Object.hasOwn(FUNCTIONS, name)) {
          throw new ExprError(`"${name}" is not a function that can be used in "${source}"`)
        }
        const fn = FUNCTIONS[name]
        const args: Compiled[] = []
        if (!isOp(')')) {
          args.push(ternary())
          while (isOp(',')) {
            pos++
            args.push(ternary())
          }
        }
        expect(')')
        return (s) => fn(...args.map((a) => a(s)))
      }
      if (variables.includes(name)) return (s) => s[name]
      if (Object.hasOwn(CONSTANTS, name)) {
        const v = CONSTANTS[name]
        return () => v
      }
      throw new ExprError(
        `"${name}" is not available in "${source}". It may use: ${variables.join(', ')}`
      )
    }
    if (t.v === '(') {
      pos++
      const inner = ternary()
      expect(')')
      return inner
    }
    return fail()
  }

  const compiled = ternary()
  if (pos < tokens.length) fail()
  return (scope) => {
    const v = compiled(scope)
    return typeof v === 'number' ? v : NaN
  }
}
