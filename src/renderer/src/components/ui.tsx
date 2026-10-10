import type { ReactNode } from 'react'
import type { Provenance } from '../../../shared/types'
import { RippleButton } from './magicui/ripple-button'
import { ShimmerButton } from './magicui/shimmer-button'

// Small shared pieces from the design: keycaps, buttons, labels, chips.

type KeyVariant = 'default' | 'small' | 'selected' | 'dark' | 'inline'

const keyStyles: Record<KeyVariant, string> = {
  default:
    'text-[12px] px-2 py-1.5 rounded-[6px] bg-white border border-line-key shadow-[0_2px_0_#E2D3D0] text-ink',
  selected:
    'text-[12px] px-2 py-1.5 rounded-[6px] bg-blush border border-blush-key shadow-[0_2px_0_#EBB8B2] text-ink',
  small:
    'text-[10.5px] px-1.5 py-1 rounded-[5px] bg-white border border-line-key shadow-[0_2px_0_#E2D3D0] text-ink',
  inline: 'text-[10.5px] px-1.5 py-1 rounded-[5px] bg-ground border border-line-key text-ink',
  dark: 'text-[10.5px] px-1.5 py-1 rounded-[5px] bg-key-dark border border-key-dark-line text-on-dark'
}

export function Key({
  children,
  variant = 'default',
  className = ''
}: {
  children: ReactNode
  variant?: KeyVariant
  className?: string
}): React.JSX.Element {
  return (
    <kbd
      className={`font-sans font-bold leading-none whitespace-nowrap flex-none ${keyStyles[variant]} ${className}`}
    >
      {children}
    </kbd>
  )
}

export function PixelLabel({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return <span className={`font-pixel text-[11px] text-sage-deep ${className}`}>{children}</span>
}

export function Button({
  children,
  onClick,
  kind = 'secondary',
  keyHint,
  disabled,
  className = '',
  title
}: {
  children: ReactNode
  onClick?: () => void
  kind?: 'primary' | 'secondary' | 'danger'
  keyHint?: string
  disabled?: boolean
  className?: string
  title?: string
}): React.JSX.Element {
  const base =
    'h-10 rounded-[12px] gap-2 text-[13.5px] disabled:cursor-not-allowed disabled:opacity-45'
  const pad = keyHint ? 'pl-4 pr-2 py-0' : 'px-4 py-0'
  if (kind === 'primary') {
    return (
      <ShimmerButton
        title={title}
        onClick={onClick}
        disabled={disabled}
        background="#2d3128"
        shimmerColor="#fce4e2"
        borderRadius="12px"
        className={`${base} ${pad} font-bold text-on-dark ${className}`}
      >
        {children}
        {keyHint ? <Key variant="dark">{keyHint}</Key> : null}
      </ShimmerButton>
    )
  }
  return (
    <RippleButton
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${pad} font-semibold transition-colors ${
        kind === 'danger'
          ? 'text-danger border-danger-line hover:bg-blush-2'
          : 'text-ink border-line-input hover:bg-blush-3'
      } ${className}`}
    >
      {children}
      {keyHint ? <Key variant="inline">{keyHint}</Key> : null}
    </RippleButton>
  )
}

export function SourceChips({ sources }: { sources: Provenance[] }): React.JSX.Element | null {
  if (!sources.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((s, i) => (
        <span
          key={`${s.label}-${i}`}
          className="text-[12px] font-semibold px-2 py-[3px] rounded-[6px] bg-white text-sage-deep"
        >
          {s.label}
        </span>
      ))}
    </div>
  )
}

export function CloseButton({
  onClick,
  label = 'Close'
}: {
  onClick: () => void
  label?: string
}): React.JSX.Element {
  return (
    <RippleButton
      aria-label={label}
      onClick={onClick}
      className="h-9 pl-2.5 pr-2 py-0 rounded-[12px] border-line-input text-ink transition-colors hover:bg-blush-3"
    >
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M2 2l8 8M10 2l-8 8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <Key variant="inline">esc</Key>
    </RippleButton>
  )
}

export function PixelProgress(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="h-2 relative overflow-hidden"
      style={{
        background:
          'repeating-linear-gradient(90deg, rgba(255,255,255,0.9) 0 8px, transparent 8px 10px)'
      }}
    >
      <span
        className="klair-fill absolute left-0 top-0 bottom-0"
        style={{
          background: 'repeating-linear-gradient(90deg, #EE8378 0 8px, transparent 8px 10px)'
        }}
      />
    </div>
  )
}
