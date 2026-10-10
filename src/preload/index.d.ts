import type { KlairApi } from '../shared/types'

declare global {
  interface Window {
    klair: KlairApi
  }
}
