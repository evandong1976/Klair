import { randomUUID } from 'crypto'
import { CANNOT_RUN, MENUS, topOptions, type MenuOption, type ProjectType } from '../shared/options'
import { openTarget } from '../shared/open'
import type { Idea, SuggestionSet } from '../shared/types'
import { interactiveOffer, type VisionNote } from './notes'

// Suggestion Engine: turns the menu of the project's type (shared/options.ts) into the
// options shown for a screen (⌘1–9). No model call here. The note for the screen says
// which entries fit; this checks each pick can be honoured and packages them. It only
// *proposes*; nothing here executes assistance.

interface SetInput {
  type: ProjectType
  captureId: number
  generationId: number
  capturedAt: string
  /** Title of the Chrome page this screen shows, when its full text was matched. */
  pageTitle?: string | null
  /** An area the user selected, rather than a whole-screen capture. */
  selection?: boolean
}

/** A name the model gave for the thing on screen, trimmed to fit a tile's second line. */
function cleanAbout(about: string | undefined): string {
  const text = (about ?? '').replace(/\s+/g, ' ').trim()
  // Too long to be a name: cut at a word, and say so.
  const cut = text.length > 60 ? `${text.slice(0, 60).replace(/\s+\S*$/, '')}…` : text
  return cut.replace(/[.:;,]+(…?)$/, '$1')
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4)

/**
 * Whether a named earlier topic is worth connecting to: it shares a word of substance
 * with what the project covered, and it is not just the topic on screen under its own name.
 */
function grounded(about: string, context: string, topic: string): boolean {
  const named = words(about)
  const here = new Set(words(topic))
  return named.some((w) => context.includes(w)) && !named.every((w) => here.has(w))
}

function tile(setId: string, o: MenuOption, extra: Partial<Idea> = {}): Idea {
  const about = extra.about
  return {
    id: `${setId}:${o.id}`,
    key: 0, // numbered once the list is final
    title: o.title,
    subtitle: about || o.line,
    kind: o.kind,
    prompt: about ? `${o.task}\nIt is about: ${about}` : o.task,
    option: o.id,
    ...extra
  }
}

function pack(
  input: SetInput,
  id: string,
  ideas: Idea[],
  text: { topic: string; whereRead: string },
  flags: { thinking?: boolean; all?: boolean }
): SuggestionSet {
  const at = new Date(input.capturedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  })
  return {
    id,
    generationId: input.generationId,
    captureId: input.captureId,
    createdAt: new Date().toISOString(),
    topic: text.topic,
    whereTitle: text.topic,
    whereRead: text.whereRead.slice(0, 240),
    sources: [
      {
        kind: 'screen',
        label: `${input.selection ? 'Your selection' : 'On screen'} · ${at}`,
        captureId: input.captureId
      },
      ...(input.pageTitle
        ? [
            {
              kind: 'screen' as const,
              label: `Full page · ${input.pageTitle.slice(0, 40)}`,
              captureId: input.captureId
            }
          ]
        : [])
    ],
    ideas: ideas.map((idea, i) => ({ ...idea, key: i + 1 })),
    ...flags
  }
}

/**
 * The type's three standing options, for the moment the panel opens on a screen whose
 * note isn't back yet. They can be picked straight away; the checked list replaces them.
 */
export function defaultSuggestions(input: SetInput): SuggestionSet {
  const id = randomUUID()
  return pack(
    input,
    id,
    topOptions(input.type).map((o) => tile(id, o)),
    { topic: '', whereRead: '' },
    { thinking: true }
  )
}

export function suggestionsFromNote(
  input: SetInput & {
    note: VisionNote
    /** What the project had covered when the note was made ('' for a new project). */
    context?: string
    /** Everything read off the screen (note, page text): what "Do it for me" must be named in. */
    seen?: string
    /** List the whole menu, with what can't run on this screen dimmed. */
    all?: boolean
  }
): SuggestionSet {
  const { note } = input
  const id = randomUUID()
  const context = (input.context ?? '').toLowerCase()
  const picked = new Map<string, string>()
  for (const p of note.options ?? []) {
    if (!picked.has(p.id)) picked.set(p.id, cleanAbout(p.about))
  }
  const offer = interactiveOffer(note)
  const open = openTarget(note.open, input.seen ?? `${note.topic} ${note.note}`)

  /** What an option needs that this screen (or project) doesn't have. */
  const missing = (o: MenuOption): boolean =>
    o.needs === 'explore'
      ? !offer
      : o.needs === 'open'
        ? !open
        : o.needs === 'history'
          ? !context
          : false

  const fits = (o: MenuOption): boolean => {
    if (missing(o)) return false
    // Something to draw or to open is the pick itself: there is nothing more to ask.
    if (o.needs === 'explore' || o.needs === 'open') return true
    if (!picked.has(o.id)) return false
    // "Connect to earlier" has to name an earlier topic that is really in the project.
    if (o.needs === 'history' && o.about) {
      return grounded(picked.get(o.id) ?? '', context, note.topic)
    }
    return true
  }

  const make = (o: MenuOption): Idea => {
    if (missing(o)) return tile(id, o, { subtitle: CANNOT_RUN[o.needs!], disabled: true })
    if (o.needs === 'explore' && offer) {
      return tile(id, o, {
        about: offer.concept,
        prompt: `Interactive explainer: ${offer.concept}`,
        interactive: offer
      })
    }
    if (o.needs === 'open' && open) {
      return tile(id, o, {
        subtitle: `Open ${open.label}${open.kind === 'url' ? ' in your browser' : ''}`,
        prompt: `Open ${open.target}`,
        open
      })
    }
    return tile(id, o, o.about && picked.get(o.id) ? { about: picked.get(o.id) } : {})
  }

  const menu = MENUS[input.type]
  let shown = input.all ? menu : menu.filter(fits)
  // Nothing usable came back: the standing three are always safe to offer.
  if (!shown.length) shown = topOptions(input.type)
  return pack(input, id, shown.map(make), note, input.all ? { all: true } : {})
}
