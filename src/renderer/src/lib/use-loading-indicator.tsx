import { useEffect, useState } from 'react'
import { createLoadingIndicator } from './loading-indicator'

// TSX enables Fast Refresh to track changes to this hook's internal Hook order.
export function useLoadingIndicator(pending: boolean) {
  const [visible, setVisible] = useState(false)
  const [indicator] = useState(() => createLoadingIndicator(setVisible))
  useEffect(() => {
    indicator.update(pending)
  }, [indicator, pending])
  useEffect(() => indicator.cancel, [indicator])
  return visible
}
