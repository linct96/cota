import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import type { NotificationSound } from '../shared/notification-sounds'

const MAX_SOUND_BYTES = 5 * 1024 * 1024
const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}

export async function readNotificationSound(sound: NotificationSound): Promise<string | undefined> {
  if (typeof sound === 'string') return undefined
  const mime = MIME_TYPES[extname(sound.path).toLowerCase()]
  if (!mime) throw new Error('请选择 MP3、WAV、OGG 或 M4A 音频文件。')
  try {
    const file = await open(sound.path, constants.O_RDONLY | constants.O_NONBLOCK)
    try {
      const info = await file.stat()
      if (!info.isFile()) throw new Error('请选择普通音频文件。')
      if (info.size === 0 || info.size > MAX_SOUND_BYTES)
        throw new Error('提示音文件不能为空，且不能超过 5 MB。')
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of file.createReadStream({ end: MAX_SOUND_BYTES, autoClose: false })) {
        size += chunk.length
        if (size > MAX_SOUND_BYTES) throw new Error('提示音文件不能超过 5 MB。')
        chunks.push(chunk)
      }
      if (size === 0) throw new Error('提示音文件不能为空。')
      return `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`
    } finally {
      await file.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code)
      throw new Error('无法读取提示音文件，可能已移动、删除或没有访问权限，请重新选择。')
    throw error
  }
}
