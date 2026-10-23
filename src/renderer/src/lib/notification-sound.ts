let playing: HTMLAudioElement | undefined

export function playNotificationSound(source: string): void {
  if (!/^data:audio\/(mpeg|wav|ogg|mp4);base64,/.test(source)) return
  playing?.pause()
  playing = new Audio(source)
  void playing.play().catch((error: unknown) => {
    if (!(error instanceof DOMException && error.name === 'AbortError'))
      console.warn('通知提示音播放失败；系统通知不受影响。')
  })
}
