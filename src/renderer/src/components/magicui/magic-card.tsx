import { useCallback, useEffect } from 'react'
import { motion, useMotionTemplate, useMotionValue } from 'motion/react'
import { cn } from '../../lib/utils'

// Magic UI "Magic Card" (gradient mode): a solid surface whose border and a soft
// spotlight follow the pointer. Adapted from magicui.design/r/magic-card: the orb
// mode and next-themes are dropped, and `contentClassName` lays out the children.

interface MagicCardProps {
  children?: React.ReactNode
  className?: string
  contentClassName?: string
  gradientSize?: number
  gradientColor?: string
  gradientOpacity?: number
  gradientFrom?: string
  gradientTo?: string
}

export function MagicCard({
  children,
  className,
  contentClassName,
  gradientSize = 220,
  gradientColor = '#fce4e2',
  gradientOpacity = 0.55,
  gradientFrom = '#ee8378',
  gradientTo = '#9caa77'
}: MagicCardProps): React.JSX.Element {
  const mouseX = useMotionValue(-gradientSize)
  const mouseY = useMotionValue(-gradientSize)

  const reset = useCallback(() => {
    mouseX.set(-gradientSize)
    mouseY.set(-gradientSize)
  }, [gradientSize, mouseX, mouseY])

  useEffect(() => {
    reset()
    window.addEventListener('blur', reset)
    return () => window.removeEventListener('blur', reset)
  }, [reset])

  return (
    <motion.div
      className={cn(
        'group relative isolate overflow-hidden rounded-[inherit] border border-transparent',
        className
      )}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        mouseX.set(e.clientX - rect.left)
        mouseY.set(e.clientY - rect.top)
      }}
      onPointerLeave={reset}
      style={{
        background: useMotionTemplate`
          linear-gradient(var(--color-background) 0 0) padding-box,
          radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px,
            ${gradientFrom},
            ${gradientTo},
            var(--color-border) 100%
          ) border-box
        `
      }}
    >
      <div className="bg-background absolute inset-px z-20 rounded-[inherit]" />
      <motion.div
        className="pointer-events-none absolute inset-px z-30 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: useMotionTemplate`
            radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px,
              ${gradientColor},
              transparent 100%
            )
          `,
          opacity: gradientOpacity
        }}
      />
      <div className={cn('relative z-40 rounded-[inherit]', contentClassName)}>{children}</div>
    </motion.div>
  )
}
