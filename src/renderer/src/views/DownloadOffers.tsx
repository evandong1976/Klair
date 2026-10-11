import type { DownloadOffer } from '../../../shared/types'
import { Button } from '../components/ui'
import { klair } from '../lib/useKlair'

// "Add this download to the session?" Shown beside the flower (pill) and at the top of
// the panel (cards). Nothing is read from the file until the user picks Add.

const KIND: Record<string, string> = {
  pdf: 'PDF',
  document: 'Document',
  slides: 'Slides',
  spreadsheet: 'Spreadsheet',
  text: 'Text file',
  image: 'Image',
  other: 'File'
}

function kindLabel(kind: string): string {
  return KIND[kind] ?? 'File'
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function statusLine(o: DownloadOffer): string {
  if (o.status === 'adding') return 'Reading it into the session…'
  if (o.status === 'added')
    return o.detail ? `Added to the session (${o.detail})` : 'Added to the session'
  if (o.status === 'failed') return `Couldn't add it${o.detail ? `: ${o.detail}` : ''}`
  return `${kindLabel(o.kind)} · ${sizeLabel(o.size)} · just downloaded`
}

/** Panel cards: one per pending download. */
export function DownloadOfferCards({ offers }: { offers: DownloadOffer[] }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {offers.map((o) => (
        <div
          key={o.id}
          className="flex items-center gap-3 p-2.5 pl-3.5 rounded-[14px] border border-sage-line bg-sage-tint-2"
        >
          <span className="flex-1 flex flex-col gap-0.5 min-w-0">
            <span className="text-[13.5px] font-bold truncate" title={o.name}>
              {o.status === 'offered' ? `Add “${o.name}” to this session?` : o.name}
            </span>
            <span className="text-[12.5px] text-muted truncate">{statusLine(o)}</span>
          </span>
          {o.status === 'offered' ? (
            <>
              <Button onClick={() => void klair.skipDownload(o.id)} className="h-8 text-[12.5px]">
                Not now
              </Button>
              <Button
                kind="primary"
                onClick={() => void klair.addDownload(o.id)}
                className="h-8 text-[12.5px]"
              >
                Add
              </Button>
            </>
          ) : o.status === 'failed' ? (
            <Button onClick={() => void klair.skipDownload(o.id)} className="h-8 text-[12.5px]">
              Dismiss
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** Beside the flower: the newest download, with Add / Not now. */
export function DownloadOfferPill({
  offer,
  hover
}: {
  offer: DownloadOffer
  hover: { onMouseEnter: () => void; onMouseLeave: () => void }
}): React.JSX.Element {
  const small =
    'h-[30px] px-3 rounded-full text-[12.5px] font-bold flex items-center cursor-pointer'
  return (
    <span
      {...hover}
      className="surface flex items-center gap-2 h-[42px] pl-4 pr-1.5 rounded-full text-[14px] font-bold text-ink max-w-[400px]"
    >
      <span className="truncate" title={offer.name}>
        {offer.status === 'offered'
          ? `Add “${offer.name}”?`
          : offer.status === 'adding'
            ? `Adding “${offer.name}”…`
            : offer.status === 'added'
              ? `Added “${offer.name}”`
              : `Couldn't add “${offer.name}”`}
      </span>
      {offer.status === 'offered' ? (
        <>
          <button
            type="button"
            onClick={() => void klair.skipDownload(offer.id)}
            className={`${small} flex-none text-ink-3 hover:bg-blush-3`}
          >
            Not now
          </button>
          <button
            type="button"
            onClick={() => void klair.addDownload(offer.id)}
            className={`${small} flex-none bg-ink text-on-dark`}
          >
            Add
          </button>
        </>
      ) : offer.status === 'failed' ? (
        <button
          type="button"
          onClick={() => void klair.skipDownload(offer.id)}
          className={`${small} flex-none text-ink-3 hover:bg-blush-3`}
        >
          Dismiss
        </button>
      ) : null}
    </span>
  )
}
