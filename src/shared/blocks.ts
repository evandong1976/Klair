import { z } from 'zod'

// Zod schemas shared by the main process (validating model output) and the
// renderer (rendering answer blocks). Never render anything that hasn't passed
// these schemas, and never execute model-generated code.

export const ideaKind = z.enum(['summary', 'code', 'quiz', 'explain', 'other'])

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

export const answerBlock = z.discriminatedUnion('type', [
  textBlock,
  codeBlock,
  sliderPlotBlock,
  quizBlock,
  stepsBlock
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
