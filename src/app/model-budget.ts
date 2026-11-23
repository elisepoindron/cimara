import type { CallModel } from './synthesis.ts'
import type { RewriteLine } from './find.ts'

/**
 * A ceiling on something the public demonstration lets strangers spend: paid
 * model calls, reports filed, photos uploaded. Counted for the whole site, not
 * per visitor (everyone shares one account there, and a visitor's address is
 * what a proxy says it is), in sliding windows: a minute, an hour, a day.
 *
 * Held in memory and lost on a restart, which is when the demonstration
 * forgets everything written anyway.
 */
export interface Limits {
  readonly perMinute: number
  readonly perHour: number
  readonly perDay: number
}

export interface Budget {
  /** Takes one if every window has room, and says whether it did. */
  take(): boolean
}

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR

export function budget(limits: Limits, now: () => number = Date.now): Budget {
  let taken: number[] = []
  return {
    take() {
      const t = now()
      taken = taken.filter(at => at > t - DAY)
      const since = (ms: number) => taken.filter(at => at > t - ms).length
      if (since(MINUTE) >= limits.perMinute || since(HOUR) >= limits.perHour || taken.length >= limits.perDay) return false
      taken.push(t)
      return true
    },
  }
}

/** Thrown in place of a model call the budget had no room for; every caller already treats a failed call as no answer. */
export class OverBudget extends Error {
  constructor() { super('the model budget is spent for now') }
}

/**
 * The report reading, behind a budget: the first reading, the merge and the
 * check each take one. Over budget, the call throws and the reading keeps what
 * it had, as it does for any failed call: the report waits, unread.
 */
export function limitCallModel(inner: CallModel, b: Budget): CallModel {
  const guard = <A, R>(f: (a: A) => Promise<R>) => (a: A): Promise<R> =>
    b.take() ? f(a) : Promise.reject(new OverBudget())
  return Object.assign(guard(inner), {
    ...(inner.merge ? { merge: guard(inner.merge) } : {}),
    ...(inner.check ? { check: guard(inner.check) } : {}),
  })
}

/** Find's rewriting, behind the same budget: over it, the line is answered by the parser alone. */
export function limitRewriteLine(inner: RewriteLine, b: Budget): RewriteLine {
  return input => b.take() ? inner(input) : Promise.reject(new OverBudget())
}
