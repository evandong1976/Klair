import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseQuiz, toQuiz } from './quiz'

const q = (
  n: number,
  wrong = ['wrong a', 'wrong b', 'wrong c']
): {
  prompt: string
  answer: string
  wrong: string[]
  why: string
} => ({ prompt: `Question ${n}?`, answer: `right ${n}`, wrong, why: `because ${n}` })

test('options are shuffled by Klair and the right one is tracked wherever it lands', () => {
  const fill = { questions: [q(1), q(2), q(3)] }
  const landed = new Set<number>()
  for (let seed = 0; seed < 40; seed++) {
    // A different, repeatable stream of "random" numbers per run.
    let s = seed + 1
    const random = (): number => (s = (s * 16807) % 2147483647) / 2147483647
    const quiz = toQuiz(fill, random)
    assert.ok(quiz)
    quiz.questions.forEach((question, i) => {
      assert.equal(question.options.length, 4)
      assert.equal(question.options[question.correctIndex], `right ${i + 1}`)
      assert.equal(question.explanation, `because ${i + 1}`)
      landed.add(question.correctIndex)
    })
  }
  // Not always in the same place.
  assert.deepEqual([...landed].sort(), [0, 1, 2, 3])
})

test('a question that cannot be asked fairly is left out; too few left means no quiz', () => {
  const quiz = toQuiz({
    questions: [
      q(1),
      // A "wrong" answer that is the right one, a repeat and a blank: one real choice left.
      q(2, ['Right 2', 'only one', 'only one', ' ']),
      { ...q(3), answer: '' },
      q(4, ['x', 'y']), // two wrong answers are enough
      q(5, ['a', 'b', 'c', 'd', 'e']) // extra wrong answers are dropped
    ]
  })
  assert.deepEqual(
    quiz?.questions.map((x) => [x.prompt, x.options.length]),
    [
      ['Question 1?', 4],
      ['Question 4?', 3],
      ['Question 5?', 4]
    ]
  )
  assert.equal(toQuiz({ questions: [q(1), { ...q(2), prompt: '' }] }), null)
})

test('at most five questions', () => {
  const quiz = toQuiz({ questions: [1, 2, 3, 4, 5, 6, 7].map((n) => q(n)) })
  assert.equal(quiz?.questions.length, 5)
})

test("the model's labelled lines are read, with maths untouched and stray text ignored", () => {
  const fill = parseQuiz(
    [
      'Here is your quiz:',
      '',
      'Q: What does \\(\\eta\\) control in \\(w \\leftarrow w - \\eta \\nabla L\\)?',
      'A: The step size',
      'X: The number of features',
      'X: The loss function',
      'X: The stopping rule',
      'W: \\(\\eta\\) scales the gradient,',
      'so it sets how far each update moves.',
      '',
      '**Q:** If \\(\\eta\\) is too large?',
      'A: It can overshoot\u0003 the minimum',
      'X: It stops at once',
      'X: The gradient becomes zero',
      'W: A big step can jump past the lowest point.'
    ].join('\n')
  )
  assert.equal(fill.questions.length, 2)
  assert.deepEqual(fill.questions[0], {
    prompt: 'What does \\(\\eta\\) control in \\(w \\leftarrow w - \\eta \\nabla L\\)?',
    answer: 'The step size',
    wrong: ['The number of features', 'The loss function', 'The stopping rule'],
    why: '\\(\\eta\\) scales the gradient, so it sets how far each update moves.'
  })
  const quiz = toQuiz(fill, () => 0.99)
  assert.equal(quiz?.questions[1].prompt, 'If \\(\\eta\\) is too large?')
  // A control character that slipped in is dropped.
  assert.ok(quiz?.questions[1].options.includes('It can overshoot the minimum'))
})
