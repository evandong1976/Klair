import { useEffect, useState, type ButtonHTMLAttributes, type MouseEvent } from 'react'
import { cn } from '../../lib/utils'

// Magic UI "Ripple Button" (magicui.design/r/ripple-button). The label wrapper is a
// flex row here so a key hint can sit beside the text.

interface RippleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  rippleColor?: string
  duration?: string
}

export function RippleButton({
  className,
  children,
  rippleColor = '#ee8378',
  duration = '600ms',
  onClick,
  ...props
}: RippleButtonProps): React.JSX.Element {
  const [ripples, setRipples] = useState<{ x: number; y: number; size: number; key: number }[]>([])

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height)
    const x = event.clientX - rect.left - size / 2
    const y = event.clientY - rect.top - size / 2
    setRipples((prev) => [...prev, { x, y, size, key: Date.now() }])
    onClick?.(event)
  }

  useEffect(() => {
    if (!ripples.length) return
    const last = ripples[ripples.length - 1]
    const timeout = setTimeout(
      () => setRipples((prev) => prev.filter((r) => r.key !== last.key)),
      parseInt(duration)
    )
    return () => clearTimeout(timeout)
  }, [ripples, duration])

  return (
    <button
      type="button"
      className={cn(
        'bg-background relative flex cursor-pointer items-center justify-center overflow-hidden rounded-lg border px-4 py-2 text-center',
        className
      )}
      onClick={handleClick}
      {...props}
    >
      <span className="relative z-10 flex items-center gap-2">{children}</span>
      <span className="pointer-events-none absolute inset-0">
        {ripples.map((ripple) => (
          <span
            className="animate-rippling absolute rounded-full opacity-30"
            key={ripple.key}
            style={
              {
                width: `${ripple.size}px`,
                height: `${ripple.size}px`,
                top: `${ripple.y}px`,
                left: `${ripple.x}px`,
                backgroundColor: rippleColor,
                transform: 'scale(0)',
                '--duration': duration
              } as React.CSSProperties
            }
          />
        ))}
      </span>
    </button>
  )
}
