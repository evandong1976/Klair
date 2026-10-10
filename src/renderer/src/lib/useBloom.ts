import { useEffect, useRef, useState } from 'react'
import { bloomSteps } from '../../../shared/flower'

/** Steps the flower's resolution toward `target` by +3 every 55ms (DESIGN.md §3). */
export function useBloom(target: number): number {
  const [res, setRes] = useState(target)
  const current = useRef(target)
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
