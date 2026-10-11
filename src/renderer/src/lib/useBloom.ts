import { useEffect, useRef, useState } from 'react'
import { bloomSteps } from '../../../shared/flower'

/**
 * Steps the flower's resolution toward `target` by +3 every 55ms (DESIGN.md §3).
 * `from` is where it starts when first shown; by default it starts already at `target`.
 */
export function useBloom(target: number, from = target): number {
  const [res, setRes] = useState(from)
  const current = useRef(from)
  useEffect(() => {
    if (current.current === target) return
    const steps = bloomSteps(current.current, target).slice(1)
    let i = 0
    const t = setInterval(() => {
      current.current = steps[i]
      setRes(steps[i])
      i += 1
      if (i >= steps.length) clearInterval(t)
    }, 55)
    return () => clearInterval(t)
  }, [target])
  return res
}
