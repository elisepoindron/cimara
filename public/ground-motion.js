// The contour ground, drawn. Now and then the paper is wiped and its contour
// lines are surveyed back in: a ragged front crosses the sheet from the top
// left, and behind it each line is drawn a little above its place and settles
// into it. The lines come from the same height field the still ground was baked
// from, so the last frame is the image,
// and the image quietly takes over again underneath.
//
// It is decoration and nothing else: without WebGL2, with reduced motion, or
// before the height field has arrived, the page simply keeps its still ground.
//
// It plays once, on the first page of a visit: never on an ordinary page load,
// nor on going back home by the site's name, top left, which would be too much.
// Pointing at that word, though, replays it: the visitor asked for it.
// When that first page is home, it is the opening of the visit: the survey
// runs on an empty sheet under the site's name, and the layout follows.

const FIELD = '/assets/bg/height.u16'
const FW = 960, FH = 640, LEVELS = 34, DURATION = 3200

const store = {
  get: (s, k) => { try { return s.getItem(k) } catch { return null } },
  set: (s, k, v) => { try { s.setItem(k, v) } catch {} },
}
const calm = matchMedia('(prefers-reduced-motion: reduce)')

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`
// Lines and shadow as the script that baked the ground draws them, at the
// strength and colours bake.py gives them, shrunk to the screen the way the
// browser shrinks the PNG under background-size:cover.
const FS = `#version 300 es
precision highp float;
uniform sampler2D H;
uniform vec2 res, off;
uniform float s, t;
uniform vec3 lc, sc;
out vec4 o;
const vec2 IMG = vec2(3840., 2560.);
const float L = ${LEVELS}.;
float ease(float x){ x = clamp(x, 0., 1.); return 1. - pow(1. - x, 3.); }
float front(vec2 q){
  vec2 n = q / IMG;
  float phi = n.x * .6 + n.y * .4 + .08 * sin(n.y * 9. + n.x * 3.) + .05 * sin(n.x * 17. - n.y * 5.);
  return clamp((t * 1.65 - phi) / .5, 0., 1.);
}
float field(vec2 q){ return L * texture(H, q / IMG).r - (1. - ease(front(q))) * 2.; }
void main(){
  vec2 q = (vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) - off) / s;
  float F = field(q);
  float gx = (field(q + vec2(4., 0.)) - field(q - vec2(4., 0.))) * .125;
  float gy = (field(q + vec2(0., 4.)) - field(q - vec2(0., 4.))) * .125;
  float g = length(vec2(gx, gy)) + 1e-6;
  if (g > .45) { o = vec4(0.); return; }
  float idx = floor(F + .5);
  bool index = mod(idx + 500., 5.) < .5;
  float w = index ? 1.5 : 1.05, k = index ? 1. : .82;
  float dd = abs(F - idx) / g * s, ww = 2. * w * s;
  float la = (ww >= 1. ? clamp(ww * .5 + .5 - dd, 0., 1.) : ww * clamp(1. - dd, 0., 1.)) * k;
  float up = (ceil(F) - F) / g;
  float facing = clamp((-gx - gy) * .7071 / g, 0., 1.);
  float sa = exp(-up / 9.) * (.25 + .75 * facing);
  float A = smoothstep(0., .35, front(q));
  la *= .03 * A; sa *= .14 * A;
  o = vec4(sc * sa + lc * la * (1. - sa), sa + la * (1. - sa));
}`

let field = null      // the height field, once fetched
let ctx = null        // { gl, cv, u } once set up
let raf = 0

function loadField() {
  field ??= fetch(FIELD).then(r => {
    if (!r.ok) throw new Error(`${FIELD}: ${r.status}`)
    return r.arrayBuffer()
  }).then(b => {
    const u = new Uint16Array(b), f = new Float32Array(u.length)
    for (let i = 0; i < u.length; i++) f[i] = u[i] / 65535
    return f
  })
  return field
}

function setup(heights) {
  const cv = document.createElement('canvas')
  cv.setAttribute('aria-hidden', 'true')
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;opacity:0'
  const gl = cv.getContext('webgl2', { premultipliedAlpha: true })
  if (!gl || !gl.getExtension('OES_texture_float_linear')) return null
  const sh = (type, src) => {
    const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x)
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x))
    return x
  }
  const prog = gl.createProgram()
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS))
  gl.linkProgram(prog); gl.useProgram(prog)
  const u = {}
  for (const n of ['H', 'res', 'off', 's', 't', 'lc', 'sc']) u[n] = gl.getUniformLocation(prog, n)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, FW, FH, 0, gl.RED, gl.FLOAT, heights)
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
  gl.uniform1i(u.H, 0)
  gl.uniform3f(u.lc, 0x8B / 255, 0x5A / 255, 0x2B / 255)   // bistre, as bake.py
  gl.uniform3f(u.sc, 0x17 / 255, 0x24 / 255, 0x30 / 255)   // ink
  return { gl, cv, u }
}

function draw(t) {
  const { gl, cv, u } = ctx
  const dpr = devicePixelRatio || 1
  const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr)
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
  const s = Math.max(W / 3840, H / 2560)
  gl.viewport(0, 0, W, H)
  gl.uniform2f(u.res, W, H); gl.uniform2f(u.off, (W - 3840 * s) / 2, (H - 2560 * s) / 2)
  gl.uniform1f(u.s, s); gl.uniform1f(u.t, t)
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3)
}

/**
 * Wipes the ground and surveys it back in. `onFrame`, if given, hears how far
 * the survey has got (0 to 1); it returns false when the survey cannot run.
 * `eager` starts the survey while the paper is still being wiped, for when
 * the visitor asked for it and is waiting on it.
 */
async function play(onFrame, blank = false, eager = false) {
  if (calm.matches) return false
  let heights
  try { heights = await loadField() } catch { return false }
  try { ctx ??= setup(heights) } catch { ctx = null }
  if (!ctx) return false
  const { cv } = ctx
  cancelAnimationFrame(raf)
  if (!cv.isConnected) document.body.prepend(cv)
  // The canvas carries its own paper, so it can first cover the still ground…
  cv.style.background = getComputedStyle(document.body).backgroundColor
  draw(0)
  if (blank) {
    // …unless the sheet is already blank, as at the opening of a visit.
    cv.style.transition = 'none'
    cv.style.opacity = 1
  } else if (eager) {
    cv.style.transition = 'opacity .15s ease-out'
    cv.style.opacity = 1
  } else {
    cv.style.transition = 'opacity .35s ease-out'
    cv.style.opacity = 1
    await new Promise(r => setTimeout(r, 380))
  }
  // …then the survey runs over a blank sheet.
  // The front takes about .3 s to reach the sheet's top-left corner; the
  // visitor pointing at the site's name, there, should not wait on an empty sheet.
  const start = performance.now() - (eager ? DURATION * .09 : 0)
  const tick = now => {
    const t = Math.min((now - start) / DURATION, 1)
    draw(t)
    onFrame?.(t)
    if (t < 1) { raf = requestAnimationFrame(tick); return }
    // The last frame is the image: drop the canvas away, the PNG is under it —
    // once the opening of a visit has lifted its cover off the PNG.
    const fade = () => { cv.style.transition = 'opacity .6s'; cv.style.opacity = 0 }
    if (!root.classList.contains('intro')) { fade(); return }
    const watch = new MutationObserver(() => {
      if (!root.classList.contains('intro')) { watch.disconnect(); fade() }
    })
    watch.observe(root, { attributes: true, attributeFilter: ['class'] })
  }
  raf = requestAnimationFrame(tick)
  return true
}

// --- Home, the first page of a visit ----------------------------------------
// page-motion.js has already hidden the layout and blanked the sheet (the
// `intro` class). The survey draws the ground in, the site's name is
// written in over it (app.css), and once most of the sheet is drawn the
// word is wiped out; after a pause, the layout arrives.
// Any click, key or scroll skips straight to the layout.

const root = document.documentElement
const WORD_OUT = .48    // how far the survey has got when the word may leave
const WORD_HOLD = 1000  // ms the word then stays on before it leaves
const LAYOUT_IN = 1300  // ms after that: the .7 s wipe, then a pause
const SKIP = ['pointerdown', 'keydown', 'wheel', 'touchstart']
const sleep = ms => new Promise(r => setTimeout(r, ms))

function intro() {
  let left = false, shown = false
  // The word leaves (`intro-out`); the layout stays hidden behind `intro`.
  const leave = () => {
    if (left) return
    left = true
    root.classList.add('intro-out')
  }
  // The layout arrives (`intro-reveal`), and the ground image is back under the canvas.
  const show = () => {
    if (shown) return
    shown = true
    leave()
    root.classList.remove('intro')
    root.classList.add('intro-reveal')
    setTimeout(() => root.classList.remove('intro-out', 'intro-reveal'), 1800)
    for (const ev of SKIP) removeEventListener(ev, show, true)
  }
  const go = () => { if (!left) { leave(); setTimeout(show, LAYOUT_IN) } }
  let held = false
  const hold = () => { if (!held) { held = true; setTimeout(go, WORD_HOLD) } }
  for (const ev of SKIP) addEventListener(ev, show, { capture: true, passive: true })
  // The word waits for its own font, so it never shifts once shown; then the
  // survey starts, and the word follows it a moment later.
  Promise.race([document.fonts.load('700 100px Archivo'), sleep(1200)]).catch(() => {}).then(() => {
    if (left) return
    root.classList.add('intro-ready')
    play(t => { if (t >= WORD_OUT) hold() }, true).then(ran => {
      // no survey to watch: hold the word a moment, then on with the page
      if (!ran) setTimeout(go, 2000 + WORD_HOLD)
    })
  })
}

// --- When it plays ---------------------------------------------------------

const SEEN = 'fondo.seen'   // this visit has had its first page

const firstOfVisit = !store.get(sessionStorage, SEEN)
store.set(sessionStorage, SEEN, '1')
if (root.classList.contains('intro')) intro()
// Leave the browser's own page transition (about .25 s) its moment first.
else if (firstOfVisit) setTimeout(play, 300)

// Pointing at the site's name, top left, surveys the ground in again — with a mouse
// only (a tap is a click, and goes home), and never during the opening of a
// visit. Pointing at it again mid-survey wipes the sheet and starts over.
// The height field is fetched as the pointer comes into the header, so it is
// there by the time it reaches the word.
document.querySelector('header')?.addEventListener('pointerenter', () => {
  if (!calm.matches) loadField().catch(() => {})
}, { once: true })
document.querySelector('.mark a')?.addEventListener('pointerenter', e => {
  if (e.pointerType !== 'mouse') return
  if (root.classList.contains('intro')) return
  play(null, false, true)
})
