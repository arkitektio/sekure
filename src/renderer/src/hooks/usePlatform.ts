import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

export function usePlatform(): NodeJS.Platform | undefined {
  const [platform, setPlatform] = useState<NodeJS.Platform>()
  useEffect(() => {
    void api.windowControls.platform().then(setPlatform)
  }, [])
  return platform
}
