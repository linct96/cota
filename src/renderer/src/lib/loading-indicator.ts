export function createLoadingIndicator(onChange: (visible: boolean) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let completionTimer: ReturnType<typeof setTimeout> | undefined
  let visible = false
  let shownAt = 0
  const cancel = () => {
    clearTimeout(timer)
    clearTimeout(completionTimer)
    timer = undefined
  }

  return {
    update(pending: boolean) {
      clearTimeout(completionTimer)
      if (pending) {
        if (!visible && timer === undefined) {
          timer = setTimeout(() => {
            timer = undefined
            visible = true
            shownAt = performance.now()
            onChange(true)
          }, 200)
        }
      } else {
        // Keep one clock when a read hands off to a Suspense fallback in the same turn.
        completionTimer = setTimeout(
          () => {
            clearTimeout(timer)
            timer = undefined
            if (visible) {
              visible = false
              onChange(false)
            }
          },
          visible ? Math.max(0, 500 - (performance.now() - shownAt)) : 0,
        )
      }
    },
    cancel,
  }
}
