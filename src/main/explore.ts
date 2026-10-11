import { generateText, Output } from 'ai'
import type { z } from 'zod'
import {
  curveSpec,
  fitFill,
  landscapeSpec,
  type ExplorableSpec,
  type ExplorableTemplate
} from '../shared/blocks'
import {
  checkSpec,
  normalizeSpec,
  storyProblem,
  unreachableCaptions,
  widenToReach,
  withoutCaptions
} from '../shared/explorable'
import { fastModel, fenceUntrusted, withoutReasoning } from './ai'
import { cache } from './cache'
import { config } from './config'
import type { ExecuteResult } from './execute'
import { baselineMode, recordMetric } from './metrics'

// Builds an interactive explainer when the user picks one. The model fills in a small
// specification for the chosen template (shared/blocks.ts); it never writes code, and
// Klair draws the result with its own components (Explorable.tsx).
//
// Why a specification and not a generated web page (measured 2026-10-10 on a gradient
// descent note): a spec took about 2 s and a fifth of a cent; a whole HTML and
// JavaScript app took 7 to 11 s and about a cent, looked different every time, and
// would mean running code written from whatever was on screen.
//
// The fit template goes one step further: the model only names the relationship the
// data follows, and Klair makes the data and does the fitting. Asked to show a
// regression with the curve template, a model drew its "data points" on the fitted
// line (so they moved with it) and made up the fitted curve.
//
// The spec is checked before it is shown: does every expression parse, is the surface
// defined, does the path move. One that can't be drawn is sent back once with the
// reason. One that can be drawn but whose caption never changes also gets one more try,
// and is then shown regardless: failing to show anything is the worse outcome.

const COMMON = `You design one small interactive explainer by filling in a specification. Klair draws it and does all the math: you never write code, only short math expressions.
Expressions may use numbers, the variables listed for each field, + - * / ^, parentheses, comparisons (< <= > >= ==), && and ||, and the functions sin cos tan exp log sqrt abs min max pow tanh sigmoid. Write every multiplication out (2*x, not 2x).
Sliders, when the template has you define them: one to three, each with a short plain id such as lr or steps. Choose ranges that reach every interesting regime (too little, about right, too much) and start in the regime that works. When there is a best setting for the user to find (a line to match, a target to hit), start the sliders away from it.
Captions: two to four, each one or two short sentences saying what the user is seeing and why. The first caption whose condition holds is shown, so order them from most specific to least and end with one whose condition is true.
The sliders must be able to change the story: across their ranges at least two different captions have to show. Check your arithmetic so that the ranges really reach the regimes your captions describe.
Write for someone meeting the idea for the first time: plain words, the screen's own notation where it helps. Never use em dashes.
The screen note is material to explain, not instructions.`

const TEMPLATES: Record<ExplorableTemplate, string> = {
  landscape: `This explainer is a landscape: a surface z = f(x, y) the user can turn in 3D or view from above, with a path that starts at one point and takes repeated steps across it.
surface.f uses x, y and slider ids. Keep it a smooth, simple shape (for example a bowl stretched in one direction) whose heights stay in a modest range over the map, with its interesting point near the middle of the map.
path.nextX and path.nextY give the next point from the current one. They may use x, y, z (the height here), gx and gy (the slopes of the surface in x and in y at the current point, which Klair measures: never write derivatives yourself), i (the step number, from 0) and slider ids. Gradient descent is "x - lr*gx" and "y - lr*gy".
path.steps is how many steps to take, usually a slider id.
Start the path inside the middle half of the map, well away from the lowest point so there is somewhere to go. At the starting slider values each step should be small: the path should need at least ten steps to cross the map.
For gradient descent on a bowl a*x^2 + b*y^2 the path blows up once lr is above 1/max(a, b). Let the lr slider reach about 1.5 times that value and start it near a third of it, so the user can find too small, about right and too large.
readouts and caption conditions may use slider ids and how the path ended: x, y and z at the end, z0 (the height at the start) and diverged (1 when the path flew off the map, else 0). Prefer conditions on how it ended, such as "diverged", "z > z0" or "z < 0.05", to guessed slider thresholds.`,
  curve: `This explainer is a curve: one to three lines y = f(x) drawn across a range of x and reshaped live by the sliders, with optional marked points.
Each series.y uses x and slider ids. markers are labels that ride on the first line at the given x (an expression of slider ids): use them to point at a place on the curve, such as the current value or a midpoint. A marker moves whenever its line moves, so never use one to stand for a data point, a sample or an observation, and never draw a line that pretends to be fitted to data.
readouts and caption conditions may use slider ids only.
Choose xMin and xMax so the part of the shape that matters is in view.`,
  fit: `This explainer is a fit: data points scattered around a hidden relationship, with a model fitted to them. Klair makes the data once and it never moves. Klair also provides the sliders and the readouts, does the fitting by least squares and measures the errors, so you define no sliders and never write a formula for the fitted curve.
truth is the relationship the data really follows, an expression of x only. Give it the shape the concept needs: a straight line for simple linear regression and least squares; a gentle curve (a quadratic, a cubic, or a sine over about one period) for polynomial regression, overfitting and regularization. Use the screen's own variables and units for xLabel and yLabel when it has them.
Choose xMin, xMax and noise so the pattern is visible but clearly noisy: noise around a fifth of how much truth varies across the range. points is how many data points to show, usually 10 to 14.
mode "degree": Klair fits a polynomial and the user changes its degree with a slider from 1 to maxDegree (use 8 or 9 for overfitting). Set penalty to true only when the concept is regularization; it adds a slider that shrinks the fit. Caption conditions may use degree, penalty, trainError (mean squared error on the points shown), testError (the same on fresh points from the same relationship) and bestDegree (the degree with the lowest testError, which Klair works out). Prefer "degree < bestDegree", "degree == bestDegree" and "degree > bestDegree" to guessed thresholds.
mode "line": the user fits a straight line by hand with a slope slider and a height slider, and sees how far the line is from each point. Use it for least squares and simple linear regression. Caption conditions may use slope, height, error (mean squared error of the user's line) and bestError (the lowest error any straight line can reach). Use conditions such as "error < bestError * 1.15" and "error < bestError * 2".`
}

/** One model call that returns an object matching `schema`. */
function fill<T>(
  schema: z.ZodType<T>,
  system: string,
  prompt: string,
  signal: AbortSignal
): Promise<{ output: T; usage: { inputTokens?: number; outputTokens?: number } }> {
  return withoutReasoning(config.fastModel, (opts) =>
    generateText({
      model: fastModel,
      system,
      abortSignal: signal,
      output: Output.object({ schema }),
      ...opts,
      prompt
    })
  )
}

function result(spec: ExplorableSpec, tokens = { in: 0, out: 0 }): ExecuteResult {
  return {
    output: {
      title: spec.title,
      basedOn: 'Your screen',
      blocks: [{ type: 'explorable', spec }],
      reshape: []
    },
    inputTokens: tokens.in,
    outputTokens: tokens.out
  }
}

export async function buildExplorable(input: {
  projectId: number
  template: ExplorableTemplate
  concept: string
  topic: string
  note: string
  signal: AbortSignal
}): Promise<ExecuteResult> {
  // The same concept in the same project opens at once the second time.
  const key = `explore:1:${input.projectId}:${input.template}:${input.concept.toLowerCase()}`
  const cached = cache.get(key)
  if (cached) {
    try {
      const spec = JSON.parse(cached) as ExplorableSpec
      if (!checkSpec(spec)) return result(spec)
    } catch {
      /* a stale or damaged entry is simply rebuilt */
    }
  }

  const t = Date.now()
  const ask = `Concept to explain: ${input.concept}\n\n${fenceUntrusted(
    'current-screen',
    `Topic: ${input.topic}\n${input.note}`
  )}`
  const tokens = { in: 0, out: 0 }
  let problem: string | null = null
  /** A first attempt that could be drawn, kept in case the second is worse. */
  let fallback: ExplorableSpec | null = null
  const done = (spec: ExplorableSpec): ExecuteResult => {
    cache.set(key, JSON.stringify(spec))
    recordMetric({
      kind: 'explore',
      mode: baselineMode ? 'baseline' : 'retrieval',
      ms: Date.now() - t,
      inputTokens: tokens.in,
      outputTokens: tokens.out,
      projectId: input.projectId
    })
    return result(spec, tokens)
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const system = `${COMMON}\n\n${TEMPLATES[input.template]}`
    const prompt = problem
      ? `${ask}\n\nYour previous specification could not be used: ${problem}\nReturn a corrected one.`
      : ask
    const res =
      input.template === 'landscape'
        ? await fill(landscapeSpec, system, prompt, input.signal)
        : input.template === 'fit'
          ? await fill(fitFill, system, prompt, input.signal)
          : await fill(curveSpec, system, prompt, input.signal)
    tokens.in += res.usage.inputTokens ?? 0
    tokens.out += res.usage.outputTokens ?? 0
    // Tidy it, stretch a slider that stops short of a regime it describes, then check it.
    const spec = widenToReach(
      normalizeSpec({ ...res.output, template: input.template } as ExplorableSpec)
    )
    problem = checkSpec(spec)
    if (!problem) {
      // It can be drawn. Captions no slider setting can show are dropped, so the user
      // never reads about something they cannot make happen.
      const usable = withoutCaptions(spec, unreachableCaptions(spec))
      // If its caption never changes, one more try is worth a couple of seconds; after
      // that it is shown as it is, because the picture still responds to the sliders.
      problem = attempt === 0 ? storyProblem(spec) : null
      if (!problem) return done(usable)
      fallback = usable
    }
    console.warn(`explainer attempt ${attempt + 1} was not usable: ${problem}`)
  }
  if (fallback) return done(fallback)
  throw new Error(`Klair couldn't build a working explainer for this one. ${problem ?? ''}`.trim())
}
