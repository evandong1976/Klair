import { z } from 'zod'

// Zod schemas shared by the main process (validating model output) and the
// renderer (rendering answer blocks). Never render anything that hasn't passed
// these schemas, and never execute model-generated code.

export const ideaKind = z.enum(['summary', 'code', 'quiz', 'explain', 'other', 'interactive'])

export const ideaSchema = z.object({
  title: z.string().min(2).max(60).describe('Short verb phrase, e.g. "Play with gradient descent"'),
  subtitle: z
    .string()
    .min(2)
    .max(90)
    .describe('One line saying what the result will be, e.g. "A small live demo plus the code"'),
  kind: ideaKind,
  prompt: z
    .string()
    .min(4)
    .max(600)
    .describe('The full instruction the assistant will run if picked')
})

export const suggestionOutputSchema = z.object({
  topic: z.string().max(80).describe('Likely topic of the visible work'),
  whereTitle: z.string().max(90).describe('e.g. "Gradient descent: learning rate"'),
  whereRead: z
    .string()
    .max(240)
    .describe('One or two plain sentences on where the user is; observed facts only'),
  ideas: z.array(ideaSchema).length(3)
})
export type SuggestionOutput = z.infer<typeof suggestionOutputSchema>

export const textBlock = z.object({
  type: z.literal('text'),
  markdown: z.string().max(4000)
})

export const codeBlock = z.object({
  type: z.literal('code'),
  language: z.string().max(20),
  source: z.string().max(4000),
  caption: z.string().max(200).optional()
})

const point = z.object({ x: z.number(), y: z.number() })

export const sliderPlotBlock = z.object({
  type: z.literal('slider-plot'),
  title: z.string().max(80),
  param: z.object({
    label: z.string().max(40).describe('e.g. "Step size η"'),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    initial: z.number()
  }),
  curve: z.array(point).max(200).describe('Static background curve, e.g. the loss function'),
  series: z
    .array(
      z.object({
        value: z.number().describe('Parameter value this series belongs to'),
        points: z.array(point).max(40).describe('Points to mark, in order'),
        status: z.string().max(140).describe('One-line result for this value')
      })
    )
    .min(1)
    .max(25)
    .describe('Precomputed results for each parameter value, from min to max'),
  codeTemplate: z
    .string()
    .max(3000)
    .optional()
    .describe('Optional code shown under the plot; {{value}} is replaced by the slider value')
})

export const quizBlock = z.object({
  type: z.literal('quiz'),
  questions: z
    .array(
      z.object({
        prompt: z.string().max(300),
        options: z.array(z.string().max(160)).min(2).max(4),
        correctIndex: z.number().int().min(0).max(3),
        explanation: z.string().max(500),
        source: z.string().max(120).optional()
      })
    )
    .min(1)
    .max(5)
})

export const stepsBlock = z.object({
  type: z.literal('steps'),
  items: z.array(z.string().max(300)).min(1).max(8)
})

// ---------------------------------------------------------------- interactive explainers
//
// What the model fills in for an "explorable" (see explorable.ts for how it is drawn).
// It is a description, never code: the math is short expressions that Klair parses
// and evaluates itself (expr.ts). There are no length limits here because providers
// don't enforce them and one over-long field would fail the whole answer; the spec is
// trimmed and checked after the call instead (normalizeSpec, checkSpec).

const control = z.object({
  id: z.string().describe('Variable name used in expressions, e.g. "lr". Letters and digits only'),
  label: z.string().describe('Plain label, e.g. "Learning rate"'),
  min: z.number(),
  max: z.number(),
  step: z.number().describe('Slider increment'),
  value: z.number().describe('Starting value')
})

const readout = z.object({
  label: z.string(),
  value: z.string().describe('Expression for the number to show')
})

const caption = z.object({
  when: z.string().describe('Condition expression; "true" for the fallback caption'),
  text: z.string().describe('One or two short sentences')
})

const explorableCommon = {
  title: z.string().describe('Short title naming the concept'),
  intro: z.string().describe('One or two sentences: what to try and what to notice'),
  controls: z.array(control).describe('One to three sliders'),
  readouts: z.array(readout).describe('Zero to three live numbers'),
  captions: z
    .array(caption)
    .describe('Two to four captions; the first whose condition holds is shown')
}

/** A surface z = f(x, y) with a path stepping across it (optimisation, descent). */
export const landscapeSpec = z.object({
  ...explorableCommon,
  surface: z.object({
    f: z.string().describe('Height z = f(x, y). May use x, y and slider ids'),
    xMin: z.number(),
    xMax: z.number(),
    yMin: z.number(),
    yMax: z.number(),
    zLabel: z.string().describe('What height means, e.g. "Loss"')
  }),
  path: z.object({
    startX: z.number(),
    startY: z.number(),
    nextX: z
      .string()
      .describe('Next x. May use x, y, z, gx, gy (slopes, computed by Klair), i and slider ids'),
    nextY: z
      .string()
      .describe('Next y. May use x, y, z, gx, gy (slopes, computed by Klair), i and slider ids'),
    steps: z.string().describe('How many steps to take; usually a slider id')
  })
})

/** One to three lines y = f(x), reshaped by the sliders. */
export const curveSpec = z.object({
  ...explorableCommon,
  xMin: z.number(),
  xMax: z.number(),
  xLabel: z.string(),
  yLabel: z.string(),
  series: z
    .array(
      z.object({
        label: z.string(),
        y: z.string().describe('y = f(x). May use x and slider ids')
      })
    )
    .describe('One to three lines'),
  markers: z
    .array(
      z.object({
        label: z.string(),
        x: z.string().describe('Where on the first line to mark a point. May use slider ids')
      })
    )
    .describe('Zero to three marked points')
})

/**
 * Data points scattered around a hidden relationship, with a model fitted to them.
 * This is what the model fills in. It names the relationship and writes the captions;
 * Klair makes the data (once, so it never moves), does the fitting, measures the errors
 * and provides the sliders. A model asked to do this with the curve template drew its
 * "data points" on the fitted line, so they moved with it, and invented the fitted
 * curve: correct-looking and wrong.
 */
export const fitFill = z.object({
  title: explorableCommon.title,
  intro: explorableCommon.intro,
  captions: explorableCommon.captions,
  xMin: z.number(),
  xMax: z.number(),
  xLabel: z.string(),
  yLabel: z.string(),
  truth: z
    .string()
    .describe(
      'The relationship the data really follows: y as an expression of x only, e.g. "30 - 2.5*x + 0.15*x^2"'
    ),
  points: z.number().describe('How many data points, from 8 to 40'),
  noise: z.number().describe('How far the points scatter from that relationship, in y units'),
  mode: z
    .enum(['degree', 'line'])
    .describe(
      '"degree": Klair fits a polynomial and the user changes its degree. "line": the user sets the slope and intercept of a straight line by hand'
    ),
  maxDegree: z.number().describe('For "degree": the highest degree the slider reaches, 2 to 9'),
  penalty: z
    .boolean()
    .describe(
      'For "degree": also give a slider for a penalty that shrinks the fit (regularization)'
    )
})

/** A fit as stored and drawn: what the model filled in, plus the sliders Klair derived. */
export const fitSpec = fitFill.extend({
  controls: explorableCommon.controls,
  readouts: explorableCommon.readouts
})

export const EXPLORABLE_TEMPLATES = ['landscape', 'curve', 'fit'] as const
export type ExplorableTemplate = (typeof EXPLORABLE_TEMPLATES)[number]

export const explorableSpec = z.discriminatedUnion('template', [
  landscapeSpec.extend({ template: z.literal('landscape') }),
  curveSpec.extend({ template: z.literal('curve') }),
  fitSpec.extend({ template: z.literal('fit') })
])
export type LandscapeSpec = z.infer<typeof landscapeSpec> & { template: 'landscape' }
export type CurveSpec = z.infer<typeof curveSpec> & { template: 'curve' }
export type FitFill = z.infer<typeof fitFill>
export type FitSpec = z.infer<typeof fitSpec> & { template: 'fit' }
export type ExplorableSpec = LandscapeSpec | CurveSpec | FitSpec

export const explorableBlock = z.object({
  type: z.literal('explorable'),
  spec: explorableSpec
})

export const answerBlock = z.discriminatedUnion('type', [
  textBlock,
  codeBlock,
  sliderPlotBlock,
  quizBlock,
  stepsBlock,
  explorableBlock
])
export type AnswerBlock = z.infer<typeof answerBlock>
export type SliderPlotBlock = z.infer<typeof sliderPlotBlock>
export type QuizBlock = z.infer<typeof quizBlock>

export const answerOutputSchema = z.object({
  title: z.string().max(80),
  basedOn: z.string().max(160).describe('Plain line naming the material used'),
  blocks: z.array(answerBlock).min(1).max(6),
  reshape: z.array(z.string().max(30)).max(3).describe('Up to three short reshape options')
})
export type AnswerOutput = z.infer<typeof answerOutputSchema>
