import { Suspense, useLayoutEffect, useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useLoadingIndicator } from '../lib/use-loading-indicator'
import { cn } from '../lib/utils'

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
  showLabel = false,
  loadingHeader,
  children,
}: {
  pending: boolean
  label: string
  showLabel?: boolean
  loadingHeader?: ReactNode
  children: ReactNode
}) {
  const [suspended, setSuspended] = useState(false)
  const visible = useLoadingIndicator(pending || suspended)
  const busy = pending || suspended || visible

  return (
    <>
      {busy && loadingHeader}
      <div
        className="loading-content relative flex min-h-0 min-w-0 flex-1 flex-col"
        aria-busy={busy}
      >
        {visible && (
          <output
            className={cn(
              'loading-content-indicator absolute z-20',
              showLabel
                ? 'top-0 left-0 text-sm text-muted-foreground'
                : 'inset-0 flex items-center justify-center gap-2',
            )}
            aria-label={label}
          >
            {showLabel ? (
              <span className="loading-content-label">{label}</span>
            ) : (
              <LoaderCircle
                className="loading-content-icon size-5 text-muted-foreground motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
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
    </>
  )
}
