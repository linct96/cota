import { useEffect, useRef, useState } from 'react'
import { unwrap } from '../../../shared/contracts'
import type { ConfirmationRequest } from '../../../shared/contracts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function ConfirmationDialog() {
  const [{ request, open }, setDialog] = useState<{
    request: ConfirmationRequest | null
    open: boolean
  }>({ request: null, open: false })
  const [error, setError] = useState<string>()
  const [responding, setResponding] = useState(false)
  const responsePending = useRef(false)
  const cancelButton = useRef<HTMLButtonElement | null>(null)

  useEffect(
    () =>
      window.desktop.onConfirmation((nextRequest) => {
        setError(undefined)
        setDialog({ request: nextRequest, open: true })
      }),
    [],
  )

  useEffect(
    () =>
      window.desktop.onExitProgress((progress) => {
        if (progress) setDialog((current) => ({ ...current, open: false }))
      }),
    [],
  )

  async function respond(confirmed: boolean) {
    if (!open || !request || responsePending.current) return
    responsePending.current = true
    setResponding(true)
    setError(undefined)
    try {
      unwrap(await window.desktop.respondToConfirmation(request.id, confirmed))
      setDialog((current) =>
        current.request?.id === request.id ? { ...current, open: false } : current,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      responsePending.current = false
      setResponding(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen) {
          details.cancel()
          void respond(false)
        }
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen)
          setDialog((current) => (current.open ? current : { request: null, open: false }))
      }}
    >
      <AlertDialogContent className="app-confirmation-dialog" initialFocus={cancelButton}>
        <AlertDialogHeader className="app-confirmation-header">
          <AlertDialogTitle className="app-confirmation-title">{request?.title}</AlertDialogTitle>
          <AlertDialogDescription className="app-confirmation-description max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words">
            {request?.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="app-confirmation-error text-xs text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter className="app-confirmation-footer">
          <AlertDialogCancel
            ref={cancelButton}
            className="app-confirmation-cancel"
            disabled={responding}
          >
            {request?.confirmLabel ? '取消' : '知道了'}
          </AlertDialogCancel>
          {request?.confirmLabel && (
            <AlertDialogAction
              variant="destructive"
              className="app-confirmation-confirm"
              disabled={responding}
              onClick={() => void respond(true)}
            >
              {request.confirmLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
