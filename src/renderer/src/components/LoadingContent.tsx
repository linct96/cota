import { Suspense, useLayoutEffect, useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useLoadingIndicator } from '../lib/use-loading-indicator'

function SuspendedContent({ onChange }: { onChange: (pending: boolean) => void }) {
  useLayoutEffect(() => {
    onChange(true)
    return () => onChange(false)
  }, [onChange])
  return null
}

export function LoadingContent({
  pending,
  label,
  children,
}: {
  pending: boolean
  label: string
  children: ReactNode
}) {
  const [suspended, setSuspended] = useState(false)
  const visible = useLoadingIndicator(pending || suspended)
  const busy = pending || suspended || visible

  return (
    <div className="loading-content relative flex min-h-0 min-w-0 flex-1 flex-col" aria-busy={busy}>
      {visible && (
        <output
          className="loading-content-indicator absolute inset-0 z-20 flex items-center justify-center"
          aria-label={label}
        >
          <LoaderCircle
            className="loading-content-icon size-5 text-muted-foreground motion-safe:animate-spin"
            aria-hidden="true"
          />
        </output>
      )}
      <div
        className="loading-content-body flex min-h-0 min-w-0 flex-1 flex-col"
        inert={busy}
        style={{ opacity: visible ? 0 : undefined }}
      >
        <Suspense fallback={<SuspendedContent onChange={setSuspended} />}>{children}</Suspense>
      </div>
    </div>
  )
}
