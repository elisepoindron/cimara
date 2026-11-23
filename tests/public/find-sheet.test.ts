import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'

// find-sheet.js is a browser script that wires itself up on import, so it runs
// here against a linkedom page with the few browser globals it reaches for.
// Touch events are plain Events carrying the fields the script reads.

const { window, document } = parseHTML(`<!doctype html><html><body>
  <div class="split"><div class="col">
    <div class="q"></div>
    <div class="list">
      <div class="list__h"><b>9 itinerari</b></div>
      <div class="r"><p class="r__n"><a class="r__link" href="/itinerario/a">A</a></p><span class="r__f">42</span></div>
    </div>
  </div></div>
</body></html>`)

// linkedom lays nothing out: give the list the few measures the script reads,
// a list at its top, under a sheet resting at half
const list = document.querySelector('.list')!
Object.assign(list, { scrollTop: 0, scrollTo() {}, getBoundingClientRect: () => ({ top: 420 }) })
Object.defineProperty(document.querySelector('.split')!, 'clientHeight', { value: 800 })

const NodeEvent = Event
const g = globalThis as Record<string, unknown>
const win = new EventTarget()
g.Event = window.Event
g.document = document
g.Element = window.Element
g.matchMedia = () => ({ matches: true, addEventListener() {} })
g.addEventListener = win.addEventListener.bind(win)
g.removeEventListener = win.removeEventListener.bind(win)
g.dispatchEvent = win.dispatchEvent.bind(win)
g.requestAnimationFrame = () => 0
await import(new URL('../../public/find-sheet.js', import.meta.url).href)

let clicks: string[] = []
document.addEventListener('click', e => { clicks.push((e.target as Element).getAttribute('href') ?? ''); e.preventDefault() })

function touch(type: string, target: Element, y: number | null): Event {
  const e = new window.Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>
  e.touches = y === null ? [] : [{ clientY: y }]
  target.dispatchEvent(e)
  return e
}
/** What a phone sends for a finger: touches, then a pointerup before the touchend. */
function finger(target: Element, ys: number[]): { end: Event } {
  clicks = []
  touch('touchstart', target, ys[0]!)
  for (const y of ys.slice(1)) touch('touchmove', target, y)
  win.dispatchEvent(Object.assign(new NodeEvent('pointerup'), { pointerType: 'touch' }))
  return { end: touch('touchend', target, null) }
}

const link = () => document.querySelector('.r__link')!

test('a tap on a row that drifts a pixel down still opens the row', () => {
  const { end } = finger(link(), [500, 501, 502])
  assert.equal(end.defaultPrevented, true, 'the touch is ended by the script, not left to Safari')
  assert.deepEqual(clicks, ['/itinerario/a'])
})

test('a pull that moves the sheet does not open the row it started on', () => {
  const { end } = finger(link(), [500, 510, 540, 580])
  assert.equal(end.defaultPrevented, false)
  assert.deepEqual(clicks, [])
})

test('a still tap is left to the browser, which clicks on its own', () => {
  const { end } = finger(link(), [500])
  assert.equal(end.defaultPrevented, false)
  assert.deepEqual(clicks, [])
})
