import { motion } from 'motion/react'

// Magic UI "Blur Fade" (magicui.design/r/blur-fade), reduced to the entrance
// animation Klair uses: content fades up out of a slight blur when it mounts.

export function BlurFade({
  children,
  className,
  duration = 0.3,
  offset = 6,
  blur = '6px'
}: {
  children: React.ReactNode
  className?: string
  duration?: number
  offset?: number
  blur?: string
}): React.JSX.Element {
  return (
    <motion.div
      className={className}
      initial={{ y: offset, opacity: 0, filter: `blur(${blur})` }}
      animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
      transition={{ duration, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
