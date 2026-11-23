import { test } from 'node:test'
import assert from 'node:assert/strict'
import { html, raw, join, render, escape } from '../../src/render/html.ts'

test('interpolated text is escaped, so a route name cannot become markup', () => {
  const name = '<script>alert(1)</script>'
  assert.equal(render(html`<h1>${name}</h1>`),
    '<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>')
})

test('quotes and ampersands are escaped too, for attribute positions', () => {
  assert.equal(render(html`<a title="${`Balma "Scura" & co`}">x</a>`),
    '<a title="Balma &quot;Scura&quot; &amp; co">x</a>')
})

test('nested Html passes through unescaped', () => {
  const inner = html`<b>AD</b>`
  assert.equal(render(html`<p>${inner}</p>`), '<p><b>AD</b></p>')
})

test('an array of Html is concatenated', () => {
  const items = ['6a', '6b'].map(g => html`<em>${g}</em>`)
  assert.equal(render(html`<div>${items}</div>`), '<div><em>6a</em><em>6b</em></div>')
})

test('null, undefined and false render as nothing, so conditionals read cleanly', () => {
  const absent = null
  assert.equal(render(html`<p>${absent}${undefined}${false}ok</p>`), '<p>ok</p>')
})

test('numbers render without escaping', () => {
  assert.equal(render(html`<dd>${3841}</dd>`), '<dd>3841</dd>')
})

test('raw is the deliberate escape hatch, and looks like one at the call site', () => {
  assert.equal(render(html`<div>${raw('<hr>')}</div>`), '<div><hr></div>')
})

test('join puts a separator between items', () => {
  assert.equal(render(join(['a', 'b'].map(s => html`<i>${s}</i>`), ' / ')),
    '<i>a</i> / <i>b</i>')
})

test('a plain object cannot impersonate escaped markup', () => {
  // Stored facts come straight out of a JSON column as Record<string, unknown>,
  // so an object shaped like `{ html: '<img src=x onerror=alert(1)>' }` is a
  // real shape untrusted data can take. Only this module's own functions may
  // produce a value the template treats as pre-escaped.
  const fromDatabase = { html: '<img src=x onerror=alert(1)>' }
  const out = render(html`<p>${fromDatabase}</p>`)
  assert.equal(out, `<p>${escape(String(fromDatabase))}</p>`)
  assert.equal(out, '<p>[object Object]</p>')
  assert.ok(!out.includes('<img'), 'the stored markup must never appear unescaped')
})
