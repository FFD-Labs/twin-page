// The paint functions against a record no Notary writes: one whose bag_g, version and reference are HTML where a number,
// a number and 64 hex digits belong. A gateway or an RPC that lies can serve one. Whatever a record says, the page writes
// it as text: no element and no attribute may come out of it.
//
// The page's code is imported as written, web/devcon8.ts with the page of web/devcon8.html around it; jsdom stands in for
// the browser's DOM, parsing HTML the way the standard says. `npm test` runs it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, test } from 'node:test'
import { JSDOM } from 'jsdom'

const root = resolve(import.meta.dirname, '..')
const text = (file) => readFileSync(resolve(root, file), 'utf8')

// ---------- the page, as the single file has it: the markup and the config inline ----------
const { window } = new JSDOM(text('web/devcon8.html'))
const { document } = window
const inline = document.createElement('script')
inline.type = 'application/json'
inline.id = 'config'
inline.textContent = text('web/public/config.json')
document.body.append(inline)
Object.assign(globalThis, { window, document, location: window.location, requestAnimationFrame: (fn) => setTimeout(fn, 0) })

// Importing the script starts the page; with no bag in the link it settles on its notice. Then the functions are ours to call.
const { placeCard, renderCo2, reset, revealFruit } = await import('../web/devcon8.ts')
await new Promise((done) => setTimeout(done, 0))
assert.match(document.getElementById('notice').textContent, /No bag to show yet/)

// ---------- the records ----------
// One string for every place a value can land: as text it would open two elements, inside a quoted attribute it would close
// the quote and add a handler. `via` says which field it came through.
const hostile = (via) => `x" onfocus="globalThis.ran='${via}'" autofocus="<img src=x onerror="globalThis.ran='${via}'"><ffd-probe via="${via}"></ffd-probe>`

const config = {
    fruits: { mango: { name: 'Mango', nutrition: { energy_kcal: 340, carbohydrate_g: 82, sugars_g: 72, protein_g: 3, fat_g: 1.5, fibre_g: 9 } } },
    co2: { factor_kg_per_kg: 0.6, scenario: 'an open dump', scenario_written: '2026-10-04' }
}
const ref = (n) => `0x${String(n).repeat(64)}`
const event = (n, data, more = {}) => ({ ref: ref(n), at: '2026-10-02T10:00:00.000Z', block: 7n, gateway: 'https://gateway.example', verified: true, data, ...more })
const intake = () => event(1, { phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'mango', kg: 20, sourcing: 'rescued' })
const cycle = () => event(2, { phase: 'cycle', at: '2026-09-29T08:00:00Z', start: '2026-09-28T10:00:00Z', end: '2026-09-29T08:00:00Z', loads: [{ trays: 10, kg: 20 }], kg_out: 2 })
const packing = (fields = {}, more = {}) => event(3, { phase: 'packing', at: '2026-09-30T08:00:00Z', product: 'mango', bag_g: 30, lot: 'L1', ...fields }, more)

// Every block a record reaches: its card on the path, the fruit card, the arithmetic.
function paint(events) {
    const path = document.getElementById('path')
    const shown = []
    for (const e of events) {
        shown.push(e)
        placeCard(path, shown, e, 'https://explorer.example')
    }
    revealFruit(config, events, true)
    renderCo2(config, events)
}

const made = () => document.querySelectorAll('ffd-probe, img[src="x"]')
const handlers = () => [...document.querySelectorAll('*')].flatMap((el) => [...el.attributes].filter((a) => a.name.startsWith('on') || a.name === 'autofocus').map((a) => `${el.localName} ${a.name}`))
const clean = () => {
    assert.equal(made().length, 0, 'an element was created from a value of the record')
    assert.deepEqual(handlers(), [], 'an attribute was created from a value of the record')
}
const cardOf = (e) => [...document.querySelectorAll('#path li.step')].find((li) => li.dataset.ref === e.ref)

beforeEach(() => reset())

test('an honest record paints its grams in the fruit card and in the arithmetic', () => {
    paint([intake(), cycle(), packing()])
    assert.equal(document.querySelectorAll('#path li.step').length, 3)
    assert.equal(document.getElementById('fruit-grams').textContent, '30 g per bag')
    assert.match(document.getElementById('fruit-origin').textContent, /this bag · 30 g/)
    assert.equal(document.getElementById('co2').hidden, false)
    assert.match(document.querySelector('#co2 .ring').getAttribute('aria-label'), /^30 g of fruit against 180 g/)
    clean()
})

test('bag_g that is HTML creates nothing, in the fruit card or in the arithmetic', () => {
    const packed = packing({ bag_g: hostile('bag_g') })
    paint([intake(), cycle(), packed])
    clean()
    // the card of the record shows what the record says, as text; the two blocks that compute with grams have none to compute with
    assert.ok(cardOf(packed).textContent.includes(hostile('bag_g')))
    assert.equal(document.getElementById('fruit-name').textContent, 'Mango')
    assert.equal(document.getElementById('fruit-origin').innerHTML, '')
    assert.equal(document.getElementById('co2').hidden, true)
    assert.equal(document.getElementById('co2').innerHTML, '')
})

for (const [what, value] of [['zero', 0], ['negative', -30], ['not finite', 1e999], ['a numeric string', '30'], ['a list', [30]], ['an object', { g: 30 }], ['true', true]])
    test(`bag_g that is ${what} is not grams`, () => {
        paint([intake(), cycle(), packing({ bag_g: value })])
        clean()
        assert.equal(document.getElementById('fruit-origin').innerHTML, '')
        assert.equal(document.getElementById('co2').hidden, true)
    })

test('a reference that is HTML is written as text in its card', () => {
    const packed = packing({}, { ref: hostile('ref') })
    paint([intake(), cycle(), packed])
    clean()
    assert.equal(cardOf(packed).querySelector('details code').textContent, hostile('ref'))
})

test('a version that is HTML creates nothing', () => {
    paint([intake(), cycle(), packing({ version: hostile('version') })])
    clean()
})

test('a correction says its version', () => {
    const packed = packing({ version: 2 })
    paint([intake(), cycle(), packed])
    assert.equal(cardOf(packed).querySelector('.chip').textContent, 'Correction v2')
    clean()
})
