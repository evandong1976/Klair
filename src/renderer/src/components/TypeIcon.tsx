import { PROJECT_TYPES, TYPE_META, typeShades, type ProjectType } from '../../../shared/options'

// A project type's icon: an 11×11 pixel sprite in the flower's style, coloured from one of
// the flower palettes (shared/options.ts). While Klair is checking which options fit the
// screen, its lighter pixels twinkle.

export function TypeIcon({
  type,
  size = 16,
  busy = false,
  className = ''
}: {
  type: ProjectType
  size?: number
  busy?: boolean
  className?: string
}): React.JSX.Element {
  const shades = typeShades(type)
  return (
    <svg
      viewBox="0 0 11 11"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={TYPE_META[type].label}
      className={`flex-none ${className}`}
    >
      {TYPE_META[type].sprite.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === '.' ? null : (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={shades[c]}
              className={busy && c > '2' ? 'klair-twinkle' : undefined}
              // Staggered, so the pixels shimmer across the icon and not all at once.
              style={busy ? { animationDelay: `${((x * 3 + y * 5) % 7) * 110}ms` } : undefined}
            />
          )
        )
      )}
    </svg>
  )
}

/** Work, Study, Research: pick one. Used when a project is created. */
export function TypeChips({
  value,
  onChange
}: {
  value: ProjectType
  onChange: (type: ProjectType) => void
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label="Kind of project" className="flex gap-1.5">
      {PROJECT_TYPES.map((t) => {
        const on = t === value
        const shades = typeShades(t)
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(t)}
            className={`flex items-center gap-1.5 h-8 pl-2 pr-3 rounded-full border text-[13px] font-semibold cursor-pointer transition-colors ${
              on ? 'text-ink' : 'border-line-input bg-white text-ink-3 hover:text-ink'
            }`}
            style={on ? { background: shades.tint, borderColor: shades[3] } : undefined}
          >
            <TypeIcon type={t} size={16} />
            {TYPE_META[t].label}
          </button>
        )
      })}
    </div>
  )
}
