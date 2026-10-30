import { useCallback, useState } from 'react'

export function useDialogState<T>() {
  const [state, setState] = useState<{ value: T | undefined; open: boolean }>({
    value: undefined,
    open: false,
  })
  // Closing hides the dialog first; its content is released after the exit animation.
  const setValue = useCallback((value: T | undefined) => {
    setState((current) =>
      value === undefined ? { ...current, open: false } : { value, open: true },
    )
  }, [])
  const onOpenChangeComplete = useCallback((open: boolean) => {
    if (!open) setState((current) => (current.open ? current : { value: undefined, open: false }))
  }, [])

  return [state.value, setValue, { open: state.open, onOpenChangeComplete }] as const
}
