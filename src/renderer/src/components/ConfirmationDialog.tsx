import { useEffect, useRef, useState } from 'react'
import { unwrap, type ConfirmationRequest } from '../../../shared/contracts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'

export function ConfirmationDialog() {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null)
  const [error, setError] = useState<string>()
  const [responding, setResponding] = useState(false)
  const responsePending = useRef(false)
  const cancelButton = useRef<HTMLButtonElement | null>(null)

  useEffect(
    () =>
      window.desktop.onConfirmation((request) => {
        setError(undefined)
        setRequest(request)
      }),
    [],
  )

  async function respond(confirmed: boolean) {
    if (!request || responsePending.current) return
    responsePending.current = true
    setResponding(true)
    setError(undefined)
    try {
      unwrap(await window.desktop.respondToConfirmation(request.id, confirmed))
      setRequest((current) => (current?.id === request.id ? null : current))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      responsePending.current = false
      setResponding(false)
    }
  }

  return (
    <AlertDialog
      open={request !== null}
      onOpenChange={(open, details) => {
        if (!open) {
          details.cancel()
          void respond(false)
        }
      }}
    >
      <AlertDialogContent className="app-confirmation-dialog" initialFocus={cancelButton}>
        <AlertDialogHeader className="app-confirmation-header">
          <AlertDialogTitle className="app-confirmation-title">{request?.title}</AlertDialogTitle>
          <AlertDialogDescription className="app-confirmation-description break-words">
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
