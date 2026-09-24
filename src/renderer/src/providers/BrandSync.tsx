import { useEffect } from 'react'
import { api } from '@/lib/api'
import { applyBrand, isEditingBrandLocally } from '@/lib/brand'

/** Keeps this window's brand color in step with main (settings, other windows, the vault). */
export function BrandSync() {
  useEffect(() => {
    void api.preferences.get().then((p) => applyBrand(p.brand))
    return api.preferences.onChange((p) => {
      if (!isEditingBrandLocally()) applyBrand(p.brand, { animate: true })
    })
  }, [])
  return null
}
