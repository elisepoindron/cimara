import { mkdirSync } from 'node:fs'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
export type { PhotoMime } from '../db/gita-photo.ts'
import type { PhotoMime } from '../db/gita-photo.ts'

export interface PhotoStore {
  put(id: string, mime: PhotoMime, bytes: Buffer): Promise<void>
  get(id: string, mime: PhotoMime): Promise<Buffer | null>
  remove(id: string, mime: PhotoMime): Promise<void>
}

const EXT: Record<PhotoMime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' }
const MIME: Record<'jpg' | 'png', PhotoMime> = { jpg: 'image/jpeg', png: 'image/png' }

export const extFor = (mime: PhotoMime): string => EXT[mime]
export const mimeForExt = (ext: 'jpg' | 'png'): PhotoMime => MIME[ext]

/**
 * Bytes on disk under `dir`, named by the photo's own id — there is no
 * separate storage-key column to keep in sync with a filename. The one
 * implementation this project ships; a day this needs to move to real object
 * storage, this is the one seam that changes, not any of its callers.
 */
export function filesystemPhotoStore(dir: string): PhotoStore {
  mkdirSync(dir, { recursive: true })

  return {
    async put(id, mime, bytes) {
      await writeFile(join(dir, `${id}.${extFor(mime)}`), bytes)
    },
    async get(id, mime) {
      try {
        return await readFile(join(dir, `${id}.${extFor(mime)}`))
      } catch {
        return null
      }
    },
    async remove(id, mime) {
      try {
        await unlink(join(dir, `${id}.${extFor(mime)}`))
      } catch {
        // Already gone is not a failure — remove is idempotent, the same way
        // get already treats a missing file as absence rather than an error.
      }
    },
  }
}
