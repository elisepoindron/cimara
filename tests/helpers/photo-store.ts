import type { PhotoStore, PhotoMime } from '../../src/app/photo-store.ts'

/**
 * An in-memory PhotoStore, fresh per test — no disk, no cleanup, nothing
 * shared, the same spirit as `freshDb()` in `tests/helpers/db.ts`.
 */
export function memoryPhotoStore(): PhotoStore {
  const files = new Map<string, Buffer>()
  const key = (id: string, mime: PhotoMime) => `${id}:${mime}`

  return {
    async put(id, mime, bytes) { files.set(key(id, mime), bytes) },
    async get(id, mime) { return files.get(key(id, mime)) ?? null },
    async remove(id, mime) { files.delete(key(id, mime)) },
  }
}
