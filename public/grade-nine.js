// The 9, surveyed. A 9 on the difficulty scale is the one grade drawn with motion: on a dark
// ground, the contour lines of the site's own ground are surveyed in as the home page opens —
// a ragged front from the top left, each line drawn a little above its place and settling into
// it — and then taken away by a second front, the same way. Every point of the shape runs that
// survey on its own clock, a little later toward the bottom right, so while one band of lines
// leaves, the next, on another patch of ground and in other colours, is already arriving:
// about two bands across a 9 at any moment, never a pause. The lines come from the height
// field ground-motion.js draws.
//
// It covers the 9 bars of a crag's grade distribution and of Find's small histograms. Each
// gets a canvas laid over it; one WebGL context draws them all. Decoration only: without
// WebGL2, or before the height field arrives, a 9 keeps its plain dark fill from app.css;
// under reduced motion it is drawn once and kept still. Find swaps its rows in place, so new
// 9s are picked up as they appear. See a design study, option O2.

const FIELD = '/assets/bg/height.u16'
const FW = 960, FH = 640
const MARKS = '.chart .bar[data-grade="9"] path, .gh rect[data-grade="9"]'
const LEVELS = 180, RATE = .55, BANDS = 2.1, SCALE = 1.1
const GROUND = [0x26 / 255, 0x2C / 255, 0x33 / 255]   // --g9, the dark slate

const calm = matchMedia('(prefers-reduced-motion: reduce)')

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`
const FS = `#version 300 es
precision highp float;
uniform sampler2D H;
uniform vec2 res, base;
uniform float s, L, time, rate, K;
uniform vec3 ground;
out vec4 o;
const vec2 IMG = vec2(3840., 2560.);
float ease(float x){ x = clamp(x, 0., 1.); return 1. - pow(1. - x, 3.); }
vec3 hsv(float h, float sat, float v){ vec3 k = clamp(abs(mod(h*6. + vec3(0.,4.,2.), 6.) - 3.) - 1., 0., 1.); return v * mix(vec3(1.), k, sat); }
float phiAt(vec2 n){ return n.x * .6 + n.y * .4 + .08 * sin(n.y * 9. + n.x * 3.) + .05 * sin(n.x * 17. - n.y * 5.); }
// survey c draws its lines in while u goes 0 to .45 and takes them away from .7 to 1.2
float uAt(vec2 n){ return time * rate - phiAt(n) * K; }
vec2 orgOf(float c){ return base + vec2(mod(c * 613., 2600.), mod(c * 389., 1700.)); }
float field(vec2 px, float back){
  vec2 n = px / res;
  float w = uAt(n), c = floor(w) - back, u = w - c;
  return L * texture(H, (orgOf(c) + px / s) / IMG).r - (1. - ease(u / .45)) * 2. - ease((u - .7) / .5) * 2.;
}
vec3 layer(vec2 px, float back){
  vec2 n = px / res;
  float w = uAt(n), u = w - (floor(w) - back);
  float A = smoothstep(0., .16, u) * (1. - smoothstep(.7, .9, u));
  if (A <= 0.) return vec3(0.);
  float F = field(px, back);
  float gx = (field(px + vec2(1.5, 0.), back) - field(px - vec2(1.5, 0.), back)) / 3.;
  float gy = (field(px + vec2(0., 1.5), back) - field(px - vec2(0., 1.5), back)) / 3.;
  float g = length(vec2(gx, gy)) + 1e-6;
  float idx = floor(F + .5);
  bool index = mod(idx + 500., 5.) < .5;
  float la = clamp((index ? 1.25 : .8) + .5 - abs(F - idx) / g, 0., 1.) * (g > .9 ? 0. : 1.) * (index ? 1. : .8);
  float up = (ceil(F) - F) / g;
  float facing = clamp((-gx - gy) * .7071 / g, 0., 1.);
  return vec3(la * A, idx + (floor(w) - back) * 7., exp(-up / 6.) * (.25 + .75 * facing) * A);
}
void main(){
  vec2 px = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
  vec3 a = layer(px, 0.), b = layer(px, 1.);
  vec3 c = ground;
  c = mix(c, vec3(1.), max(a.z, b.z) * .10);
  c = mix(c, hsv(fract(a.y * .045 - time * .05), .75, 1.), a.x);
  c = mix(c, hsv(fract(b.y * .045 - time * .05), .75, 1.), b.x);
  o = vec4(c, 1.);
}`

let gl = null, U = null, glCanvas = null
const marks = new Map()   // a 9 mark → { cv, c2, base }
let count = 0, raf = 0
const t0 = performance.now()

function setup(heights) {
  glCanvas = document.createElement('canvas')
  glCanvas.width = glCanvas.height = 512
  gl = glCanvas.getContext('webgl2', { preserveDrawingBuffer: true })
  if (!gl || !gl.getExtension('OES_texture_float_linear')) { gl = null; return false }
  const sh = (type, src) => {
    const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x)
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x))
    return x
  }
  const prog = gl.createProgram()
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS))
  gl.linkProgram(prog); gl.useProgram(prog)
  U = {}
  for (const n of ['H', 'res', 'base', 's', 'L', 'time', 'rate', 'K', 'ground']) U[n] = gl.getUniformLocation(prog, n)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, FW, FH, 0, gl.RED, gl.FLOAT, heights)
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT], [gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
  gl.uniform1i(U.H, 0)
  gl.uniform1f(U.L, LEVELS); gl.uniform1f(U.rate, RATE); gl.uniform1f(U.K, BANDS)
  gl.uniform3f(U.ground, ...GROUND)
  return true
}

// Only the 9s on screen are drawn: a Find list or a crag's chart can hold many, and a phone
// has no frame to spare for the ones scrolled away. With none in view the loop stops.
const visible = new Set()
const seen = new IntersectionObserver(entries => {
  for (const e of entries) e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)
  wake()
})

// The canvas sits in the mark's nearest HTML ancestor, so it scrolls with the chart and is
// clipped where the chart is; it lets every pointer through to the bar and its title.
function adopt(mark) {
  if (marks.has(mark)) return
  const svg = mark.ownerSVGElement, host = svg?.parentElement
  if (!host) return
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
  const cv = document.createElement('canvas')
  cv.className = 'grade-nine'
  cv.setAttribute('aria-hidden', 'true')
  host.append(cv)
  // each 9 looks onto its own patch of the ground
  const i = count++
  marks.set(mark, { cv, c2: cv.getContext('2d'), host, base: [300 + (i * 397) % 3000, 200 + (i * 251) % 2000], css: '' })
  seen.observe(mark)
}

function forget(mark) {
  marks.get(mark)?.cv.remove()
  marks.delete(mark); visible.delete(mark); seen.unobserve(mark)
}

function draw(now) {
  const time = calm.matches ? 2 : (now - t0) / 1000
  const dpr = devicePixelRatio || 1
  // Every box is read first and every canvas moved after: reading a box after moving a canvas
  // makes the browser lay the page out again, once per 9, every frame.
  const placed = []
  for (const mark of visible) {
    if (!mark.isConnected) { forget(mark); continue }
    const m = marks.get(mark)
    const r = mark.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) { placed.push({ m, r: null }); continue }
    const h = m.host.getBoundingClientRect()
    const svg = mark.ownerSVGElement, vb = svg.viewBox.baseVal
    const k = vb && vb.width ? svg.getBoundingClientRect().width / vb.width : 1
    // the canvas is not inside the SVG, so it does not fade with its bar when another bar is
    // pointed at (app.css, the chart as slim columns): it copies the bar's opacity instead
    const opacity = getComputedStyle(mark.closest('.bar') ?? mark).opacity
    placed.push({ m, r, mark, k, opacity, x: r.left - h.left + m.host.scrollLeft, y: r.top - h.top + m.host.scrollTop })
  }
  for (const { m, r, mark, k, opacity, x, y } of placed) {
    if (!r) { if (m.css !== 'none') { m.cv.style.display = 'none'; m.css = 'none' } continue }
    // the canvas over the mark, in the host's own coordinates, with the bar's own rounded top
    // corners scaled as its SVG is — written only when one of them changed
    const radius = mark.tagName === 'rect' ? (+mark.getAttribute('rx') || 0) * k : 4 * k
    const css = `display:block;left:${x}px;top:${y}px;width:${r.width}px;height:${r.height}px;opacity:${opacity};` +
      `border-radius:${mark.tagName === 'rect' ? `${radius}px` : `${radius}px ${radius}px 0 0`}`
    if (css !== m.css) { m.cv.style.cssText = css; m.css = css }
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
    const W = Math.min(512, Math.round(r.width * dpr)), H = Math.min(512, Math.round(r.height * dpr))
    if (m.cv.width !== W || m.cv.height !== H) { m.cv.width = W; m.cv.height = H }
    gl.viewport(0, 0, W, H)
    gl.uniform2f(U.res, W, H); gl.uniform2f(U.base, ...m.base)
    gl.uniform1f(U.s, SCALE * dpr)
    // the bands cross the page left to right: a 9 further right is a little behind
    gl.uniform1f(U.time, time - (r.left / innerWidth) * .6)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    m.c2.clearRect(0, 0, W, H)
    m.c2.drawImage(glCanvas, 0, 512 - H, W, H, 0, 0, W, H)
  }
}

function loop(now) {
  draw(now)
  raf = visible.size && !calm.matches ? requestAnimationFrame(loop) : 0
}

function wake() {
  if (!gl || !visible.size) return
  if (calm.matches) { requestAnimationFrame(draw); return }
  if (!raf) raf = requestAnimationFrame(loop)
}

function scan() {
  for (const mark of marks.keys()) if (!mark.isConnected) forget(mark)
  for (const mark of document.querySelectorAll(MARKS)) adopt(mark)
  wake()
}

// idle until a 9 is on the page, then loading, then ready — or failed, and never tried again
let state = 'idle'

async function start() {
  if (state !== 'idle' || !document.querySelector(MARKS)) return
  state = 'loading'
  let heights
  try {
    const r = await fetch(FIELD)
    if (!r.ok) throw new Error(`${FIELD}: ${r.status}`)
    const u16 = new Uint16Array(await r.arrayBuffer())
    heights = new Float32Array(u16.length)
    for (let i = 0; i < u16.length; i++) heights[i] = u16[i] / 65535
    if (!setup(heights)) throw new Error('no WebGL2')
  } catch { state = 'failed'; return }
  state = 'ready'
  scan()
  addEventListener('resize', () => { if (visible.size) requestAnimationFrame(draw) })
}

// Find swaps its rows in place: a 9 may arrive, or leave, at any time.
new MutationObserver(() => {
  if (state === 'ready') scan()
  else if (state === 'idle') start()
}).observe(document.body, { childList: true, subtree: true })

start()
