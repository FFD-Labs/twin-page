// The paint functions against a record no Notary writes: one whose bag_g, version and reference are HTML where a number,
// a number and 64 hex digits belong. A gateway or an RPC that lies can serve one. Whatever a record says, the page writes
// it as text: no element and no attribute may come out of it. `npm test` runs it.
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { clean, hostile, openPage } from './page.mjs'

const { document, page } = await openPage()
const { placeCard, renderCo2, reset, revealFruit } = page

const config = {
    fruits: { mango: { name: 'Mango', nutrition: { energy_kcal: 340, carbohydrate_g: 82, sugars_g: 72, protein_g: 3, fat_g: 1.5, fibre_g: 9 } } },
    co2: { factor_kg_per_kg: 0.6, scenario: 'an open dump', scenario_written: '2026-10-04' }
}
const event = (n, data, more = {}) => ({ ref: `0x${String(n).repeat(64)}`, at: '2026-10-02T10:00:00.000Z', block: 7n, gateway: 'https://gateway.example', verified: true, tx: null, data, ...more })
const intake = () => event(1, { phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'mango', kg: 20, sourcing: 'rescued' })
const cycle = () => event(2, { phase: 'cycle', at: '2026-09-29T08:00:00Z', start: '2026-09-28T10:00:00Z', end: '2026-09-29T08:00:00Z', loads: [{ trays: 10, kg: 20 }], kg_out: 2 })
const packing = (fields = {}, more = {}) => event(3, { phase: 'packing', at: '2026-09-30T08:00:00Z', product: 'mango', bag_g: 30, lot: 'L1', ...fields }, more)

// Every block a record reaches: its card on the path, the fruit card, the arithmetic.
function paint(events) {
    const path = document.getElementById('path')
    const placed = []
    for (const e of events) {
        placed.push(e)
        placeCard(path, placed, e, 'https://explorer.example')
    }
    revealFruit(config, events, true)
    renderCo2(config, events)
}
const cardOf = (e) => [...document.querySelectorAll('#path li.step')].find((li) => li.dataset.ref === e.ref)
const $ = (id) => document.getElementById(id)

beforeEach(() => reset())

test('an honest record paints its grams in the fruit card and in the arithmetic', () => {
    paint([intake(), cycle(), packing()])
    assert.equal(document.querySelectorAll('#path li.step').length, 3)
    assert.equal($('fruit-grams').textContent, '30 g per bag')
    assert.match($('fruit-origin').textContent, /this bag · 30 g/)
    assert.equal($('co2').hidden, false)
    assert.match(document.querySelector('#co2 .ring').getAttribute('aria-label'), /^30 g of fruit against 180 g/)
    clean(document)
})

test('bag_g that is HTML creates nothing, in the fruit card or in the arithmetic', () => {
    const packed = packing({ bag_g: hostile('bag_g') })
    paint([intake(), cycle(), packed])
    clean(document)
    // the card of the record shows what the record says, as text; the two blocks that compute with grams have none to compute with
    assert.ok(cardOf(packed).textContent.includes(hostile('bag_g')))
    assert.equal($('fruit-name').textContent, 'Mango')
    assert.equal($('fruit-origin').innerHTML, '')
    assert.equal($('co2').hidden, true)
    assert.equal($('co2').innerHTML, '')
})

for (const [what, value] of [['zero', 0], ['negative', -30], ['not finite', 1e999], ['a numeric string', '30'], ['a list', [30]], ['an object', { g: 30 }], ['true', true]])
    test(`bag_g that is ${what} is not grams`, () => {
        paint([intake(), cycle(), packing({ bag_g: value })])
        clean(document)
        assert.equal($('fruit-origin').innerHTML, '')
        assert.equal($('co2').hidden, true)
    })

test('a reference that is HTML is written as text in its card', () => {
    const packed = packing({}, { ref: hostile('ref') })
    paint([intake(), cycle(), packed])
    clean(document)
    assert.equal(cardOf(packed).querySelector('details code').textContent, hostile('ref'))
})

test('a version that is HTML creates nothing', () => {
    paint([intake(), cycle(), packing({ version: hostile('version') })])
    clean(document)
})

test('a correction says its version', () => {
    const packed = packing({ version: 2 })
    paint([intake(), cycle(), packed])
    assert.equal(cardOf(packed).querySelector('.chip').textContent, 'Correction v2')
    clean(document)
})

test('a record that was not read has a card with its reference and nothing else', () => {
    const unread = event(3, null, { verified: false })
    paint([intake(), cycle(), unread])
    assert.match(cardOf(unread).textContent, /Record not shown/)
    assert.equal(cardOf(unread).querySelector('details code').textContent, unread.ref)
    assert.equal(cardOf(unread).querySelector('a'), null)
    // the fruit comes from the intake that was read; without a packing record there are no grams, and no arithmetic
    assert.equal($('fruit-name').textContent, 'Mango')
    assert.equal($('co2').hidden, true)
    clean(document)
})
