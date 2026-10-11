import { FLOWER_STYLES, type FlowerStyleId } from './flower'
import type { Idea } from './types'

// What Klair offers, by the type of project. The wording of every option is written here,
// once. The model never writes an option: for each screen it only says which entries of
// the active type's menu fit (notes.ts), and may name the thing on screen an entry is
// about. Options written per screen by a model read as filler; a fixed menu doesn't.
//
// Each menu is in ⌘-number order. The first three (`top`) are shown the moment the panel
// opens, before the screen has been checked, so they come first and keep their numbers.

export const PROJECT_TYPES = ['work', 'study', 'research'] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]
export const isProjectType = (v: unknown): v is ProjectType =>
  typeof v === 'string' && (PROJECT_TYPES as readonly string[]).includes(v)

export interface MenuOption {
  id: string
  title: string
  /** The tile's second line when the model names nothing on screen. */
  line: string
  /** Which preview the tile shows, and how the answer is labelled while it loads. */
  kind: Idea['kind']
  /** The rule the model goes by when deciding whether this entry fits a screen. */
  when: string
  /** What the model should name for this entry, if anything (shown as the second line). */
  about?: string
  /** What Klair is asked to write when the option is picked. */
  task: string
  /** One of the three shown before the screen has been checked. */
  top?: true
  /**
   * What must be true before it can run: something to open, a concept an explainer can
   * draw, or earlier notes in the project.
   */
  needs?: 'open' | 'explore' | 'history'
}

const explainConcept: MenuOption = {
  id: 'explain',
  title: 'Explain a concept',
  line: 'The idea on screen, in plain words',
  kind: 'explain',
  when: 'Always, when the screen teaches or uses a concept.',
  about: 'the one concept on screen most worth explaining, by its name',
  task: 'Explain the concept as a good tutor would to someone meeting it for the first time: what it is, why it works, and one small concrete example. Use the notation on screen and define any term you need.',
  top: true
}

const playWithIt: MenuOption = {
  id: 'interactive',
  title: 'Play with it',
  line: 'Move the sliders and see what changes',
  kind: 'interactive',
  when: 'Only when explore.offer is true.',
  task: '',
  needs: 'explore'
}

export const MENUS: Record<ProjectType, MenuOption[]> = {
  work: [
    {
      id: 'explain',
      title: 'Explain this',
      line: 'The part on screen that needs explaining',
      kind: 'explain',
      when: 'Always, when the screen has content.',
      about:
        'the concept, feature, function, setting or message on screen the user is most likely stuck on',
      task: 'Explain what the user is looking at so they can keep working. Take the part most likely to be holding them up (an unfamiliar concept, feature, function, setting or message) and say what it is, how it works here, and what to do with it. Stay concrete to this screen: no general background.',
      top: true
    },
    {
      id: 'ideas',
      title: 'Give me ideas',
      line: 'Useful angles and next moves for this',
      kind: 'other',
      when: 'Always, when the user is making something (code, a design, a document, a plan). Leave out for a screen that is only being read.',
      task: 'Suggest three to five ideas that would really help with what the user is making on screen: a better approach, something missing, a risk worth handling, a next move. Each must be specific to this screen and this project and say why it is worth doing. No generic advice.',
      top: true
    },
    {
      id: 'catchup',
      title: 'Catch me up',
      line: 'What this says and what needs you',
      kind: 'summary',
      when: 'Always, when there is a lot to read: a long thread, document, pull request, ticket, log or page. Leave out for a screen with only a few lines.',
      task: "Summarize what is on screen for someone who has to act on it: what it says, what was decided or changed, and what needs the user's attention or reply. Lead with the single most important thing.",
      top: true
    },
    {
      id: 'fix',
      title: 'Find the problem',
      line: 'Likely cause and a fix',
      kind: 'explain',
      when: 'Only when an error, failing test, stack trace, warning or broken output is visible.',
      about: 'the error or failure, in its own words',
      task: 'An error or failure is on screen. Say what is most likely causing it, how to confirm that, and the fix. Quote the exact line that matters. If more than one cause is plausible, rank them.'
    },
    {
      id: 'do',
      title: 'Do it for me',
      line: 'Open what you need next',
      kind: 'action',
      when: 'Only when the obvious next step is opening one web page or one app: for example the console page for an API key the screen says is missing, the documentation for a tool named in an error, or a dashboard that was mentioned. Fill in `open` as well.',
      task: '',
      needs: 'open'
    },
    {
      id: 'review',
      title: 'Review this',
      line: 'Bugs, risks and gaps',
      kind: 'other',
      when: 'Only when code, a diff, a document or a design that someone is writing or reviewing is on screen.',
      task: 'Review what is on screen as a careful colleague would. List the real problems first (bugs, wrong assumptions, risks, missing cases), each with where it is and what to change. Then anything unclear. Skip style nits and praise.'
    },
    {
      id: 'draft',
      title: 'Draft it',
      line: 'The text this screen is waiting for',
      kind: 'code',
      when: 'Only when the screen is waiting for the user to write something: a reply, a message, a commit message, a pull request description, a section of a document. Not for the prompt box of an AI assistant.',
      about: 'what is to be written, such as "Reply to Sam" or "Commit message"',
      task: 'Write the text the screen is waiting for (a reply, a message, a commit message, a description, a section), ready to paste. Match the tone and conventions visible on screen and use only facts from the screen and the project. Put the draft in one fenced code block with nothing after it.'
    },
    {
      id: 'handoff',
      title: 'Write a project prompt',
      line: 'Bring this assistant up to speed',
      kind: 'code',
      when: 'Only when an AI assistant the user can type a prompt into is the main thing on screen: ChatGPT, Claude, Gemini, Copilot or Cursor chat, or a coding agent such as Claude Code or Codex in a terminal.',
      task: 'An AI assistant is on screen. Write a prompt the user can paste into it to bring it up to speed on this project: what the project is, how it is built or organised, where it stands now, and what the user is working on at the moment. State only what the project brief and the earlier context support, and end with a line the user completes with their request. Give one line saying what it is, then the prompt in one fenced code block.'
    }
  ],
  study: [
    {
      id: 'summarize',
      title: 'Summarize this',
      line: 'The whole page, with what matters here',
      kind: 'summary',
      when: 'Always, when there is a page, document, PDF, slide or video with content.',
      task: 'Summarize the whole page or document, not only the part in view (use the full page text when it is given). Lead with the main idea in a sentence, then the points, definitions, formulas and results someone studying this project needs to take away. This answer may run to 250 words.',
      top: true
    },
    explainConcept,
    {
      id: 'quiz',
      title: 'Test me',
      line: 'A short quiz on this, scored at the end',
      kind: 'quiz',
      when: 'Always, when the screen has material that can be recalled or applied: definitions, facts, methods, results.',
      // Picking it opens a quiz taken in the panel (main/quiz.ts), not a written answer.
      task: 'Quiz the user on what is on screen, and on the rest of the page when its text is given.',
      top: true
    },
    playWithIt,
    {
      id: 'relate',
      title: 'Connect to earlier',
      line: 'How this ties to what you covered',
      kind: 'other',
      when: 'Only when project-so-far lists a different topic from the one on screen that has a real, specific link to it: the same method, a prerequisite, a contrast. Not for a loose match in subject.',
      about: 'the name of that earlier topic as project-so-far gives it, without its description',
      task: 'Show how what is on screen connects to what this project covered earlier: what carries over, what is new here, and where the two differ. Name the earlier material you draw on. If the earlier context has nothing related, say so in one line and stop.',
      needs: 'history'
    },
    {
      id: 'prepare',
      title: 'Get ready for it',
      line: 'Practice aimed at what is coming up',
      kind: 'other',
      when: "Only when project-knowledge-graph lists an exam, quiz, homework or deadline that is still ahead of today's date and that this topic belongs to.",
      about: 'that exam, homework or deadline and how soon it is, such as "Midterm 1, in 3 days"',
      task: 'An exam, homework or deadline this topic belongs to is coming up (named below). Prepare the user for it from what is on screen: the questions it is most likely to ask about this material, each with a short worked answer, then what to review first.',
      needs: 'history'
    },
    {
      id: 'example',
      title: 'Worked example',
      line: 'One problem solved step by step',
      kind: 'explain',
      when: 'Only when a method, formula, theorem or algorithm is on screen that can be applied to a concrete case.',
      about: 'the method or formula, by its name',
      task: 'Work one concrete example of the method or formula on screen from start to finish, with small numbers, showing each step and why it is taken. End with the result and one line on how to check it.'
    },
    {
      id: 'terms',
      title: 'Key terms',
      line: 'The terms on this page, defined',
      kind: 'other',
      when: 'Only when the screen introduces several terms or symbols a learner would need defined.',
      task: 'List the terms and symbols this screen relies on, in the order they appear, each with a one-line definition in plain words as it is used here. Six at most.'
    }
  ],
  research: [
    {
      id: 'summarize',
      title: 'Summarize this',
      line: 'Question, method, findings, limits',
      kind: 'summary',
      when: 'Always, when there is a page, document, PDF, slide or video with content.',
      task: 'Summarize the whole source, not only the part in view (use the full page text when it is given): the question it asks, how it goes about answering it, what it finds, and its limits. Give numbers where the source does. This answer may run to 250 words.',
      top: true
    },
    {
      id: 'claims',
      title: 'Claims and evidence',
      line: 'Each claim and what backs it',
      kind: 'other',
      when: 'Always, when the source argues or reports something: a paper, article, report, post or documentation that makes claims.',
      task: 'List the main claims made on screen. For each, give the evidence or reasoning offered for it and how strong that support is: measured, cited, argued, or only asserted. Flag anything stated without support.',
      top: true
    },
    explainConcept,
    {
      id: 'compare',
      title: "Compare with what I've read",
      line: 'Agrees, contradicts or extends',
      kind: 'other',
      when: 'Only when project-so-far lists a different source or topic from the one on screen that covers the same ground.',
      about:
        'the name of that earlier source or topic as project-so-far gives it, without its description',
      task: 'Compare what is on screen with the earlier sources in this project: where they agree, where they contradict each other, and what this one adds. Name each earlier source you draw on. If the earlier context has nothing comparable, say so in one line and stop.',
      needs: 'history'
    },
    {
      id: 'carry',
      title: 'Carry it over',
      line: 'What to take from one text to the other',
      kind: 'other',
      when: 'Only when project-so-far is given and either the user is writing (a document, notes, a draft) on a subject the earlier sources bear on, or is reading a source that feeds writing or notes already in the project.',
      task: 'Help move knowledge between the texts in this project. If the user is writing, give the findings from the earlier sources that belong in what is on screen, each worded so it can be dropped in and marked with the source it came from. If the user is reading, give the points from this source worth carrying into their notes or draft, the same way. Only what the sources actually say.',
      needs: 'history'
    },
    {
      id: 'gaps',
      title: 'Open questions',
      line: 'What this leaves unanswered',
      kind: 'other',
      when: 'Only when the source makes an argument or reports results.',
      task: 'Say what the source on screen leaves open: questions it does not answer, limits of its method or data, and assumptions worth checking. Then two or three things worth looking up next, as phrases to search for.'
    },
    playWithIt
  ]
}

/** Work → Study → Research → Work: what ⌘T and the type chip step through. */
export const nextType = (type: ProjectType): ProjectType =>
  PROJECT_TYPES[(PROJECT_TYPES.indexOf(type) + 1) % PROJECT_TYPES.length]

/**
 * What Klair marks on the Chrome page after each option answers (main/highlights.ts): the
 * passages the answer came from, so the user can see them in place. `false`: nothing is
 * marked (a quiz would give its answers away; a draft or prompt isn't about the page).
 * An option not listed, and a typed question, get the general rule.
 */
export const MARKS: Record<string, { what: string; max: number } | false> = {
  summarize: {
    what: 'one passage for each main point of the summary, in the order they appear on the page, so the user sees where each point comes from',
    max: 6
  },
  catchup: { what: "the passages that need the user's attention or a reply", max: 4 },
  explain: {
    what: 'the sentences that state or define what was explained, and the one hardest to follow',
    max: 3
  },
  terms: {
    what: 'for each term, the sentence or clause where the page introduces or defines it (not the bare word); the note gives its meaning in a few words',
    max: 6
  },
  example: { what: 'the formula, rule or method statement the example applies', max: 2 },
  interactive: { what: 'the sentence that introduces the idea the explainer shows', max: 2 },
  relate: { what: 'the passages on this page that connect to the earlier topic', max: 3 },
  prepare: { what: 'the passages most likely to be examined', max: 4 },
  claims: {
    what: 'the sentence where each claim is made; the note says what supports it and how strongly',
    max: 6
  },
  compare: {
    what: 'the passages that agree with, contradict or extend the earlier source; the note says which',
    max: 4
  },
  carry: { what: "the passages worth carrying into the user's notes or draft", max: 4 },
  gaps: {
    what: 'the passages where a limit, an assumption or an unanswered question shows',
    max: 4
  },
  fix: { what: 'the line that shows the problem', max: 2 },
  review: { what: 'the passages with the problems raised; the note says what to change', max: 5 },
  quiz: false,
  draft: false,
  handoff: false,
  ideas: false,
  do: false
}

/** The three options shown before a screen has been checked. */
export const topOptions = (type: ProjectType): MenuOption[] => MENUS[type].filter((o) => o.top)

/** Why an option listed under "All options" can't run on this screen. */
export const CANNOT_RUN: Record<NonNullable<MenuOption['needs']>, string> = {
  open: 'Nothing to open on this screen',
  explore: 'Nothing here to draw',
  history: 'Nothing earlier in this project yet'
}

// ---- how each type looks: a pixel icon in the flower's style, in a flower's colours

/**
 * 11×11 sprites. '.' is clear; 1 to 4 run from the palette's darkest shade to its
 * lightest (bloom.center, inner, crease, petalOuter in flower.ts).
 */
export const TYPE_META: Record<
  ProjectType,
  { label: string; flower: FlowerStyleId; sprite: string[] }
> = {
  work: {
    label: 'Work',
    flower: 'bluebell',
    // a briefcase
    sprite: [
      '...........',
      '....111....',
      '...1...1...',
      '.111111111.',
      '.133333331.',
      '.133333331.',
      '.111121111.',
      '.133323331.',
      '.133333331.',
      '.111111111.',
      '...........'
    ]
  },
  study: {
    label: 'Study',
    flower: 'buttercup',
    // an open book
    sprite: [
      '...........',
      '.1111.1111.',
      '14444144441',
      '14334143341',
      '14444144441',
      '14334143341',
      '14444144441',
      '14334143341',
      '14444144441',
      '11111111111',
      '...........'
    ]
  },
  research: {
    label: 'Research',
    flower: 'violet',
    // a magnifying glass
    sprite: [
      '...1111....',
      '..144441...',
      '.14433441..',
      '.14344441..',
      '.14444441..',
      '.14444441..',
      '..144441...',
      '...11112...',
      '........22.',
      '.........22',
      '..........2'
    ]
  }
}

/** The colours a type is drawn in: 1 (darkest) to 4 as in the sprites, and a pale tint. */
export function typeShades(type: ProjectType): Record<string, string> {
  const b = FLOWER_STYLES[TYPE_META[type].flower].bloom
  return { 1: b.center, 2: b.inner, 3: b.crease, 4: b.petalOuter, tint: b.petalEdge }
}

// ---- guessing the type from a project's name

const RESEARCH_NAME =
  /\b(research|papers?|thesis|dissertation|literature|lit review|survey|experiments?)\b/i
// A course code ("CS 4563", "MATH-UA 120") counts as study.
const STUDY_NAME =
  /\b(stud(y|ies|ying)|course|class|lectures?|exam|midterm|finals?|homework|hw|assignments?|quiz|learn(ing)?|revision|tutorial)\b|\b[a-z]{2,4}([- ][a-z]{2})?[- ]?\d{3,4}\b/i
const RESEARCH_BRIEF = /\b(research(ing)?|literature|papers)\b/i
const STUDY_BRIEF = /\b(stud(y|ying)|course|lectures?|exam|homework)\b/i

/**
 * The type a project most likely is, from its name and (for an older project) its brief.
 * Only a starting point: the picker shows it and the user can change it at any time.
 * ponytail: keywords, so a bare "OS" or "Algorithms" is taken for work. Ask the fast model once at
 * creation if wrong guesses turn out to be common.
 */
export function guessType(name: string, brief = ''): ProjectType {
  if (RESEARCH_NAME.test(name)) return 'research'
  if (STUDY_NAME.test(name)) return 'study'
  if (STUDY_BRIEF.test(brief)) return 'study'
  if (RESEARCH_BRIEF.test(brief)) return 'research'
  return 'work'
}
