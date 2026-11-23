import { DatabaseSync } from 'node:sqlite'

export type SqlParams = readonly (string | number | null)[]

/**
 * This project's own database interface. Repository functions take this and
 * never a driver type, and every method is async although SQLite is synchronous.
 * That ceremony is what lets a networked database replace this one later without
 * touching a single call site.
 */
export interface Db {
  all<T>(sql: string, params?: SqlParams): Promise<T[]>
  get<T>(sql: string, params?: SqlParams): Promise<T | undefined>
  run(sql: string, params?: SqlParams): Promise<void>
  exec(sql: string): Promise<void>
  tx<T>(fn: () => Promise<T>): Promise<T>
  close(): Promise<void>
}

/** The five settings that separate production SQLite from a toy. */
const PRAGMAS = `
  pragma journal_mode = WAL;
  pragma busy_timeout = 5000;
  pragma synchronous = NORMAL;
  pragma foreign_keys = ON;
`

export function openDb(path: string): Db {
  const raw = new DatabaseSync(path)
  raw.exec(PRAGMAS)

  return {
    async all<T>(sql: string, params: SqlParams = []) {
      return raw.prepare(sql).all(...[...params]) as T[]
    },
    async get<T>(sql: string, params: SqlParams = []) {
      return raw.prepare(sql).get(...[...params]) as T | undefined
    },
    async run(sql: string, params: SqlParams = []) {
      raw.prepare(sql).run(...[...params])
    },
    async exec(sql: string) {
      raw.exec(sql)
    },
    async tx<T>(fn: () => Promise<T>): Promise<T> {
      raw.exec('begin')
      try {
        const out = await fn()
        raw.exec('commit')
        return out
      } catch (err) {
        raw.exec('rollback')
        throw err
      }
    },
    async close() {
      raw.close()
    },
  }
}
