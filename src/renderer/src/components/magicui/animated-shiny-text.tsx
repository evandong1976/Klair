import type { ComponentPropsWithoutRef, CSSProperties } from 'react'
import { cn } from '../../lib/utils'

// Magic UI "Animated Shiny Text" (magicui.design/r/animated-shiny-text): a glare
// that pans across text. Used for "working on it" labels.

interface AnimatedShinyTextProps extends ComponentPropsWithoutRef<'span'> {
  shimmerWidth?: number
}

export function AnimatedShinyText({
  children,
  className,
  shimmerWidth = 100,
  ...props
}: AnimatedShinyTextProps): React.JSX.Element {
  return (
    <span
      style={{ '--shiny-width': `${shimmerWidth}px` } as CSSProperties}
      className={cn(
        'text-ink/55',
        'animate-shiny-text bg-size-[var(--shiny-width)_100%] bg-clip-text bg-position-[0_0] bg-no-repeat',
        'bg-linear-to-r from-transparent via-ink via-50% to-transparent',
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
