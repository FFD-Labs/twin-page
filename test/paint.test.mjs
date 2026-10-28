// The paint functions against a record no Notary writes: one whose bag_g, version and reference are HTML where a number,
// a number and 64 hex digits belong. A gateway or an RPC that lies can serve one. Whatever a record says, the page writes
// it as text: no element and no attribute may come out of it. `npm test` runs it.
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { clean, hostile, openPage } from './page.mjs'

const { document, page } = await openPage()
const { documentOf, placeCard, productFiles, readDescription, readPoint, renderCo2, reset, revealFruit } = page

const config = { co2: { factor_kg_per_kg: 0.6, scenario: 'an open dump', scenario_written: '2026-10-04' } }
// The description of the product, as the file a packing record names would give it.
const mango = { schema: 'ffd/product-description/1.0', fruit: 'mango', name: 'Mango', nutrition: { energy_kcal: 340, carbohydrate_g: 82, sugars_g: 72, protein_g: 3, fat_g: 1.5, fibre_g: 9 } }
const bytes = (value) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
const described = readDescription(bytes(mango))
// what a description may leave unsaid of a label: the energy in kJ, the saturates and the salt
const unsaid = { energy_kj: null, saturated_fat_g: null, salt_g: null }
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
    revealFruit(events, described)
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

test('the version of a record is in its raw record, and nowhere else on its card', () => {
    const packed = packing({ version: 2 })
    paint([intake(), cycle(), packed])
    assert.equal(cardOf(packed).querySelector('.chip'), null)
    assert.equal(cardOf(packed).textContent.includes('Correction'), false)
    assert.match(cardOf(packed).querySelector('pre').textContent, /"version": 2/)
    clean(document)
})

test('a card opens with the glyph of its record, the page’s own markup; a record not understood has none', () => {
    const odd = event(3, null, { raw: 'not a record' })
    paint([intake(), cycle(), packing(), odd])
    const heads = [...document.querySelectorAll('#path .card h2')]
    assert.deepEqual(Object.fromEntries(heads.map((h2) => [h2.textContent, !!h2.querySelector('svg.glyph')])), { Received: true, 'Freeze-dried': true, Packed: true, 'Record not understood': false })
    clean(document)
})

test('a record that was read and not understood has a card with its text, as text', () => {
    const odd = event(3, null, { raw: hostile('raw') })
    paint([intake(), cycle(), odd])
    assert.match(cardOf(odd).textContent, /Record not understood/)
    assert.equal(cardOf(odd).querySelector('pre').textContent, hostile('raw'))
    assert.ok(cardOf(odd).querySelector('.links a').href.startsWith('https://explorer.example/block/'))
    assert.equal($('fruit-name').textContent, 'Mango')
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

// ---------- the description of the product, and the files a packing record names ----------

test('a description gives its name, its table and the text and the credit of its photograph', () => {
    const full = { ...mango, nutrition: { ...mango.nutrition, micro: [['Vitamin C', 180, 'mg']], source: 'a public table' }, photo: { alt: 'A mango, cut', credit: 'A photographer' }, ingredients: ['mango'] }
    assert.deepEqual(readDescription(bytes(full)), {
        fruit: 'mango',
        name: 'Mango',
        nutrition: { energy_kcal: 340, carbohydrate_g: 82, sugars_g: 72, protein_g: 3, fat_g: 1.5, fibre_g: 9, ...unsaid, micro: [['Vitamin C', 180, 'mg']], source: 'a public table' },
        alt: 'A mango, cut',
        credit: 'A photographer',
        manufactured: null,
        expires: null
    })
    assert.deepEqual(described, { fruit: 'mango', name: 'Mango', nutrition: { ...mango.nutrition, ...unsaid, micro: [], source: null }, alt: null, credit: null, manufactured: null, expires: null })
})

for (const [what, file] of [
    ['is not JSON', '{"schema": '],
    ['is not text', new Uint8Array([0x7b, 0x22, 0xe9, 0x22, 0x7d])],
    ['is a list', [mango]],
    ['is nothing', 'null'],
    ['is of another kind', { ...mango, schema: 'ffd/product-description/2.0' }]
])
    test(`a description that ${what} says nothing`, () => {
        assert.equal(readDescription(file instanceof Uint8Array ? file : bytes(file)), null)
    })

for (const [what, nutrition] of [
    ['is missing', undefined],
    ['lacks a figure', { ...mango.nutrition, sugars_g: undefined }],
    ['has a figure that is text', { ...mango.nutrition, energy_kcal: '340' }],
    ['has a figure below zero', { ...mango.nutrition, fat_g: -1 }],
    ['has a figure that is not finite', { ...mango.nutrition, fibre_g: 1e999 }],
    ['is a list', [340, 82, 72, 3, 1.5, 9]]
])
    test(`a table that ${what} is no table, and the name is still read`, () => {
        // JSON has no word for a number that is not finite: a file can only say it as one too large to hold, 1e999
        const read = readDescription(bytes(JSON.stringify({ ...mango, nutrition }).replace('"fibre_g":null', '"fibre_g":1e999')))
        assert.equal(read.nutrition, null)
        assert.equal(read.name, 'Mango')
    })

test('what a description says that is not a line of text is left out, one thing at a time', () => {
    const odd = { ...mango, name: ['Mango'], fruit: 7, nutrition: { ...mango.nutrition, micro: [['Vitamin C', '180', 'mg'], ['Potassium', 1490, 'mg'], 'iron'], source: { url: 'x' } }, photo: { alt: 'x'.repeat(301), credit: '  ' } }
    assert.deepEqual(readDescription(bytes(odd)), { fruit: null, name: null, nutrition: { ...mango.nutrition, ...unsaid, micro: [['Potassium', 1490, 'mg']], source: null }, alt: null, credit: null, manufactured: null, expires: null })
})

test('a description whose values are HTML paints text, in the name, the table and its note', () => {
    const packed = packing()
    const loud = readDescription(bytes({ ...mango, name: hostile('name'), nutrition: { ...mango.nutrition, micro: [[hostile('micro'), 1, hostile('unit')]], source: hostile('source') } }))
    const path = document.getElementById('path')
    placeCard(path, [packed], packed, 'https://explorer.example')
    revealFruit([packed], loud)
    clean(document)
    assert.equal($('fruit-name').textContent, hostile('name'))
    assert.ok($('fruit-origin').textContent.includes(hostile('micro')))
    assert.ok($('fruit-origin').textContent.includes(hostile('unit')))
    assert.ok($('fruit-origin').textContent.includes(hostile('source')))
})

test('a bag whose description has not come says its fruit and its grams, and no table', () => {
    paint([intake(), cycle(), packing()])
    revealFruit([intake(), cycle(), packing()], null)
    assert.equal($('fruit-name').textContent, 'Mango')
    assert.equal($('fruit-grams').textContent, '30 g per bag')
    assert.equal($('fruit-contains').hidden, true)
    assert.equal($('fruit-origin').innerHTML, '')
    clean(document)
})

test('the files of the product are the documents of the packing record that have its names, its types and a reference', () => {
    const ref = (n) => String(n).repeat(64)
    const documents = [
        { name: 'sheet.pdf', type: 'application/pdf', ref: ref(1) },
        { name: 'product-description.json', type: 'application/json', ref: ref(2) },
        { name: 'photo.webp', type: 'image/png', ref: ref(3) },
        { name: 'cover.webp', type: 'image/webp', ref: 'not a reference' },
        { name: 'background.webp', type: 'image/webp', ref: ref(5) },
        { name: 'background.webp', type: 'image/webp', ref: ref(6) },
        { name: 'toString', type: 'image/webp', ref: ref(7) },
        null,
        'photo.webp'
    ]
    assert.deepEqual([...productFiles([intake(), packing({ documents })])], [['product-description.json', `0x${ref(2)}`], ['background.webp', `0x${ref(5)}`]])
    for (const not of [undefined, null, 'photo.webp', { name: 'photo.webp' }, 7]) assert.equal(productFiles([packing({ documents: not })]).size, 0)
    // a record that was not read, or not understood, names nothing; and only a packing record names the files of the product
    assert.equal(productFiles([event(3, null, { verified: false })]).size, 0)
    assert.equal(productFiles([event(1, { phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'mango', documents })]).size, 0)
})

for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])
    test(`a fruit called ${key}, in a record or in a description, picks no pouch`, () => {
        const named = [event(1, { phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: key, kg: 20 }), packing({ product: key })]
        revealFruit(named, readDescription(bytes({ ...mango, fruit: key })))
        assert.equal(document.documentElement.dataset.way, undefined)
        assert.equal($('fruit-name').textContent, 'Mango')
        clean(document)
    })

// ---------- the full table, in the order of a label ----------
const tableOf = (nutrition, bag_g = 10) => {
    const packed = packing({ bag_g })
    placeCard(document.getElementById('path'), [packed], packed, 'https://explorer.example')
    revealFruit([packed], readDescription(bytes({ ...mango, nutrition })))
    return [...$('fruit-origin').querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((cell) => cell.textContent))
}

test('a description with the energy in kJ, the saturates and the salt: the full table is that of a label, in its order', () => {
    const rows = tableOf({ energy_kj: 1534, energy_kcal: 367, fat_g: 0.8, saturated_fat_g: 0.06, carbohydrate_g: 81, sugars_g: 68, fibre_g: 9.7, protein_g: 3.7, salt_g: 0.02, micro: [['Potassium', 1385, 'mg']] })
    assert.deepEqual(rows, [
        ['Energy', '153 kJ', '1534 kJ'],
        ['', '37 kcal', '367 kcal'],
        ['Fat', '0.08 g', '0.8 g'],
        ['of which saturates', '<0.1 g', '<0.1 g'],
        ['Carbohydrate', '8.1 g', '81 g'],
        ['of which sugars', '6.8 g', '68 g'],
        ['Fibre', '0.97 g', '9.7 g'],
        ['Protein', '0.37 g', '3.7 g'],
        ['Salt', '<0.01 g', '0.02 g'],
        ['Potassium', '139 mg', '1385 mg']
    ])
    clean(document)
})

test('a description that leaves them unsaid, or gives them as text: the table has the six figures and no more', () => {
    for (const more of [{}, { energy_kj: '1534', saturated_fat_g: null, salt_g: -1 }])
        assert.deepEqual(tableOf({ ...mango.nutrition, ...more }).map(([label]) => label), ['Energy', 'Fat', 'Carbohydrate', 'of which sugars', 'Fibre', 'Protein'])
})

// ---------- the dates of the pouch ----------
test('the two dates of the pouch are read as a month or a day, and anything else is left out', () => {
    const dated = readDescription(bytes({ ...mango, manufactured: '2026-09', expires: '2028-08-31' }))
    assert.equal(dated.manufactured, '2026-09')
    assert.equal(dated.expires, '2028-08-31')
    const odd = readDescription(bytes({ ...mango, manufactured: 'SEP/2026', expires: 20280831 }))
    assert.equal(odd.manufactured, null)
    assert.equal(odd.expires, null)
    assert.equal(readDescription(bytes({ ...mango, manufactured: '2026-13' })).manufactured, null)
})

test('the dates go under the full table as the pouch prints them, and the line is not there without them', () => {
    const packed = packing({ bag_g: 7 })
    placeCard(document.getElementById('path'), [packed], packed, 'https://explorer.example')
    revealFruit([packed], readDescription(bytes({ ...mango, manufactured: '2026-09', expires: '2028-08' })))
    assert.equal($('fruit-origin').querySelector('.origin-dates').textContent, 'Mfg. date SEP/2026 · Expiry date AUG/2028')
    assert.ok($('fruit-origin').querySelector('.origin-dates').compareDocumentPosition($('fruit-origin').querySelector('.origin-note')) & 4) // DOCUMENT_POSITION_FOLLOWING: the note comes after the dates
    clean(document)
    revealFruit([packed], readDescription(bytes({ ...mango, expires: '2028-08-31' })))
    assert.equal($('fruit-origin').querySelector('.origin-dates').textContent, 'Expiry date AUG/2028')
    clean(document)
    revealFruit([packed], readDescription(bytes(mango)))
    assert.equal($('fruit-origin').querySelector('.origin-dates'), null)
    clean(document)
})

// ---------- where a location file says the plant is, and the documents a record names ----------
const india = { type: 'Feature', geometry: { type: 'Point', coordinates: [85.109112, 20.235281] }, properties: { site: 'urn:bdf:site:india-1', place: 'Dhodapalli, Odisha 752077, India' } }

test('a location file gives its place, its site, its country and its coordinates, the longitude first as GeoJSON writes it', () => {
    assert.deepEqual(readPoint(bytes(india)), { site: 'urn:bdf:site:india-1', place: 'Dhodapalli, Odisha 752077, India', country: null, lat: 20.235281, lon: 85.109112 })
    // the words are read when they are lines of text, and the point is there without them
    assert.deepEqual(readPoint(bytes({ ...india, properties: { site: 7, place: 'x'.repeat(301) } })), { site: null, place: null, country: null, lat: 20.235281, lon: 85.109112 })
    assert.deepEqual(readPoint(bytes({ ...india, properties: undefined })), { site: null, place: null, country: null, lat: 20.235281, lon: 85.109112 })
    // the ends of the Earth are on it
    assert.deepEqual(readPoint(bytes({ type: 'Feature', geometry: { type: 'Point', coordinates: [-180, -90] } })), { site: null, place: null, country: null, lat: -90, lon: -180 })
    // the country is its code of two capital letters, as the file writes it; nothing else is one
    const country = (value) => readPoint(bytes({ ...india, properties: { ...india.properties, country: value } })).country
    assert.equal(country('IN'), 'IN')
    for (const value of ['in', 'India', 'IND', 'I', 7, null, ['IN']]) assert.equal(country(value), null, String(value))
})

test('what a location file says that is HTML is read as text, for the page to write as text', () => {
    const loud = readPoint(bytes({ ...india, properties: { site: hostile('site'), place: hostile('place') } }))
    assert.equal(loud.place, hostile('place'))
    assert.equal(loud.site, hostile('site'))
})

for (const [what, file] of [
    ['is not JSON', '{"type": '],
    ['is not text', new Uint8Array([0x7b, 0x22, 0xe9, 0x22, 0x7d])],
    ['is a list', [india]],
    ['is nothing', 'null'],
    ['is not a Feature', { ...india, type: 'FeatureCollection' }],
    ['has no geometry', { ...india, geometry: null }],
    ['has a geometry that is not a Point', { ...india, geometry: { type: 'Polygon', coordinates: [[[85, 20], [86, 20], [86, 21], [85, 20]]] } }],
    ['has one coordinate', { ...india, geometry: { type: 'Point', coordinates: [85.109112] } }],
    ['has three coordinates', { ...india, geometry: { type: 'Point', coordinates: [85.109112, 20.235281, 40] } }],
    ['has coordinates that are text', { ...india, geometry: { type: 'Point', coordinates: ['85.109112', '20.235281'] } }],
    ['has coordinates that are nothing', { ...india, geometry: { type: 'Point', coordinates: [null, null] } }],
    ['has a longitude past 180', { ...india, geometry: { type: 'Point', coordinates: [180.1, 20] } }],
    ['has a latitude past 90', { ...india, geometry: { type: 'Point', coordinates: [85, -90.1] } }],
    // JSON has no word for a number that is not finite: a file can only say it as one too large to hold, 1e999
    ['has a coordinate that is not finite', '{"type":"Feature","geometry":{"type":"Point","coordinates":[1e999,20]}}']
])
    test(`a location file that ${what} says nothing`, () => {
        assert.equal(readPoint(file instanceof Uint8Array ? file : bytes(file)), null)
    })

test('the document of a record is the first under its name and its type whose reference is one', () => {
    const ref = (n) => String(n).repeat(64)
    const documents = [
        { name: 'site-location.geojson', type: 'application/json', ref: ref(1) },
        { name: 'site-location.geojson', type: 'application/geo+json', ref: 'not a reference' },
        { name: 'site-location.geojson', type: 'application/geo+json', ref: ref(3) },
        { name: 'site-location.geojson', type: 'application/geo+json', ref: ref(4) },
        { name: hostile('name'), type: hostile('type'), ref: ref(5) },
        null,
        'site-location.geojson'
    ]
    const record = { phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'mango', documents }
    assert.equal(documentOf(record, 'site-location.geojson', 'application/geo+json'), `0x${ref(3)}`)
    assert.equal(documentOf(record, 'site-location.geojson', 'application/json'), `0x${ref(1)}`)
    assert.equal(documentOf(record, 'site.geojson', 'application/geo+json'), null)
    assert.equal(documentOf(record, 'site-location.geojson', 'application/geo+json; charset=utf-8'), null)
    for (const not of [undefined, null, 'site-location.geojson', { name: 'site-location.geojson' }, 7, []]) assert.equal(documentOf({ ...record, documents: not }, 'site-location.geojson', 'application/geo+json'), null)
    for (const none of [null, undefined]) assert.equal(documentOf(none, 'site-location.geojson', 'application/geo+json'), null)
})

// ---------- the preview of a cycle's curves, and the cycle drawn from it ----------
const { readPreview, drawCycle } = page
const preview = (fields = {}) => ({
    schema: 'ffd/telemetry-preview/1.0',
    cycle: '5201',
    bt: 1790911800,
    every: 5,
    t: [0, 3600, 7200],
    series: [
        { n: 'chamber_temperature', u: 'Cel', v: [21.4, -38.2, -30] },
        { n: 'chamber_pressure', u: 'Pa', v: [101325, 21.3, 40] },
        { n: 'shelf_3_temperature', u: 'Cel', v: [20, null, -10] },
        { n: 'power', u: 'W', v: [400, 3100, 900] }
    ],
    ...fields
})
const dryer = (fields = {}) => ({ phase: 'cycle', at: '2026-09-29T08:00:00Z', ...fields })

test('a preview gives its clock and the series the page knows, each in its unit, and nothing else', () => {
    const read = readPreview(bytes(preview()))
    assert.deepEqual(read.t, [0, 3600, 7200])
    assert.deepEqual([...read.series.keys()], ['chamber_temperature', 'chamber_pressure', 'shelf_3_temperature'])
    assert.deepEqual(read.series.get('shelf_3_temperature'), [20, null, -10])
    // the first of two series of one name is the one read; a series in another unit is not the series the page knows; one with no unit is
    const twice = readPreview(bytes(preview({ series: [{ n: 'chamber_temperature', u: 'Cel', v: [1, 2, 3] }, { n: 'chamber_temperature', u: 'Cel', v: [4, 5, 6] }, { n: 'chamber_pressure', u: 'kPa', v: [1, 2, 3] }, { n: 'shelf_8_temperature', v: [7, 8, 9] }] })))
    assert.deepEqual([...twice.series], [['chamber_temperature', [1, 2, 3]], ['shelf_8_temperature', [7, 8, 9]]])
    // a clock of 2000 points is drawn, one of 2001 is not
    const long = (n) => preview({ t: Array.from({ length: n }, (_, i) => i), series: [{ n: 'chamber_temperature', v: Array.from({ length: n }, () => 0) }] })
    assert.equal(readPreview(bytes(long(2000))).t.length, 2000)
    assert.equal(readPreview(bytes(long(2001))), null)
})

for (const [what, file] of [
    ['is not JSON', '{"schema": '],
    ['is not text', new Uint8Array([0x7b, 0x22, 0xe9, 0x22, 0x7d])],
    ['is a list', [preview()]],
    ['is nothing', 'null'],
    ['is of another kind', preview({ schema: 'ffd/telemetry/1.0' })],
    ['has no clock', preview({ t: undefined })],
    ['has a clock of one point', preview({ t: [0], series: [{ n: 'chamber_temperature', v: [1] }] })],
    ['has a clock that goes back', preview({ t: [0, 7200, 3600] })],
    ['has a clock that does not advance', preview({ t: [5, 5, 5] })],
    ['has a clock that is not finite', JSON.stringify(preview()).replace('7200', '1e999')],
    ['has a clock of text', preview({ t: ['0', '3600', '7200'] })],
    ['has a series out of step with its clock', preview({ series: [{ n: 'chamber_temperature', v: [1, 2] }] })],
    ['has a reading that is text', preview({ series: [{ n: 'chamber_pressure', v: [1, '2', 3] }] })],
    ['has a reading that is not finite', JSON.stringify(preview()).replace('21.4', '1e999')],
    ['has a reading that is not a number', JSON.stringify(preview()).replace('21.4', 'NaN')],
    ['names its series with HTML', preview({ series: [{ n: hostile('n'), u: hostile('u'), v: [1, 2, 3] }] })],
    ['has series that are not a list', preview({ series: { n: 'chamber_temperature', v: [1, 2, 3] } })],
    ['names no series the page knows', preview({ series: [{ n: 'power', v: [1, 2, 3] }, { n: '__proto__', v: [1, 2, 3] }, { n: 'constructor', v: [1, 2, 3] }, 'chamber_temperature', null] })]
])
    test(`a preview that ${what} says nothing`, () => {
        assert.equal(readPreview(file instanceof Uint8Array ? file : bytes(file)), null)
    })

test('the cycle is drawn from numbers alone: HTML where the record declares its minima creates nothing, and numbers are marked on their curves', () => {
    const read = readPreview(bytes(preview()))
    const card = document.createElement('div')
    card.className = 'card'
    document.getElementById('path').append(card)
    card.innerHTML = drawCycle(read, dryer({ min_temperature_c: hostile('min_temperature_c'), min_pressure_pa: hostile('min_pressure_pa') }))
    clean(document)
    assert.equal(card.querySelectorAll('.min').length, 0)
    assert.equal(card.querySelector('.minima'), null)
    assert.equal(card.querySelectorAll('path.line').length, 3)
    assert.equal(card.querySelector('.key').textContent, 'ChamberShelvesPressure')
    card.innerHTML = drawCycle(read, dryer({ min_temperature_c: -38.2, min_pressure_pa: 21.3 }))
    assert.deepEqual([...card.querySelectorAll('.minima b')].map((b) => b.textContent), ['-38.2 °C', '21.3 Pa'])
    assert.deepEqual([...card.querySelectorAll('.minima small')].map((s) => s.textContent), ['at 1 h', 'at 1 h'])
    assert.equal(card.querySelectorAll('svg .min').length, 2)
    // a pressure that is not above zero has no place on a scale of powers of ten, and is not marked
    card.innerHTML = drawCycle(read, dryer({ min_temperature_c: null, min_pressure_pa: 0 }))
    assert.equal(card.querySelectorAll('.min').length, 0)
    clean(document)
})

test('a preview of pressure alone has one scale, and one that read nothing draws nothing', () => {
    const alone = drawCycle(readPreview(bytes(preview({ series: [{ n: 'chamber_pressure', u: 'Pa', v: [100, 10, 1] }] }))), dryer())
    assert.ok(alone.includes('Pa'))
    assert.equal(alone.includes('°C'), false)
    assert.equal(alone.includes('class="line temp"'), false)
    assert.equal(drawCycle(readPreview(bytes(preview({ series: [{ n: 'chamber_temperature', v: [null, null, null] }] }))), dryer()), '')
    assert.equal(drawCycle(readPreview(bytes(preview({ series: [{ n: 'chamber_pressure', v: [0, -5, null] }] }))), dryer()), '')
})

test('the link to the full curves is there when the cycle names a reference, and not when it names something else', () => {
    const path = document.getElementById('path')
    const ref = 'ab'.repeat(32)
    const named = event(2, { phase: 'cycle', at: '2026-09-29T08:00:00Z', telemetry: ref, telemetry_preview: 'cd'.repeat(32) })
    const odd = event(4, { phase: 'cycle', at: '2026-09-29T09:00:00Z', telemetry: hostile('telemetry'), telemetry_preview: null })
    placeCard(path, [named, odd], named, 'https://explorer.example')
    placeCard(path, [named, odd], odd, 'https://explorer.example')
    const link = cardOf(named).querySelector('.quiet a')
    assert.equal(link.textContent, 'Full curve data ↗')
    assert.equal(cardOf(named).querySelectorAll('.links a').length, 2) // the two buttons of every card, and no third
    assert.equal(link.href, `https://gateway.example/bytes/${ref}`)
    assert.equal(cardOf(odd).querySelector('.quiet'), null)
    clean(document)
})

// ---------- the route, drawn from two places ----------
const { drawRoute } = page
const plant = { site: 'urn:bdf:site:india-1', place: 'Dhodapalli, Odisha 752077, India', lat: 20.235281, lon: 85.109112 }
const devcon = { site: null, place: 'Jio World Convention Centre, G Block, Bandra Kurla Complex, Bandra East, Mumbai 400098, India', lat: 19.064192, lon: 72.867442 }
const carried = (fields = {}) => ({ phase: 'transport', at: '2026-11-02T10:00:00Z', origin: 'urn:bdf:site:india-1', destination: 'Devcon 8, Mumbai', departure: '2026-10-27T03:26:59Z', arrival: '2026-11-02T09:20:36Z', ...fields })
// the markup of a route, parsed; and the line of a map as its numbers: where it starts, where it bows to, and where it ends
const parsed = (html) => Object.assign(document.createElement('div'), { innerHTML: html })
const lineOf = (card) => card.querySelector('.way').getAttribute('d').match(/^M([\d.]+) ([\d.]+)Q([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)$/).slice(1).map(Number)

test('the route is drawn from the two points: the words of the places as text, the line and the markers from numbers alone', () => {
    const card = document.createElement('div')
    card.className = 'card'
    document.getElementById('path').append(card)
    card.innerHTML = drawRoute({ ...plant, place: hostile('place') }, { ...devcon, place: hostile('place') }, carried({ departure: hostile('departure'), arrival: hostile('arrival'), origin: hostile('origin'), destination: hostile('destination') }))
    clean(document)
    assert.deepEqual([...card.querySelectorAll('text')].map((t) => t.textContent), [`${hostile('place').slice(0, 32)}…`, `${hostile('place').slice(0, 32)}…`])
    assert.equal(card.querySelector('.leg .far').textContent, '≈ 1,290 km')
    assert.equal(card.querySelector('.plant').getAttribute('d').match(/[^\dMlz .-]/g), null)
    // the link at the end of the line: OpenStreetMap over the two places, the destination marked, from numbers alone
    const open = card.querySelector('.leg a')
    assert.equal(open.textContent, 'Open in OpenStreetMap ↗')
    assert.equal(open.getAttribute('href'), 'https://www.openstreetmap.org/?mlat=19.064192&mlon=72.867442#map=6/19.649736/78.988277')
    assert.equal(open.getAttribute('rel'), 'noopener')
    assert.equal(card.querySelectorAll('.way[pathLength="1"]').length, 1)
    // the honest route: the plant at the east edge of the frame, where the bag went at the west, named under each, and the
    // line between them bowing to the north
    card.innerHTML = drawRoute(plant, devcon, carried())
    assert.equal(card.querySelector('.leg .far').textContent, '≈ 1,290 km · 6 days')
    assert.equal(card.querySelector('.map').getAttribute('aria-label'), 'The route from Dhodapalli to Jio World Convention Centre: about 1,290 km in 6 days')
    const [x1, y1, cx, cy, x2, y2] = lineOf(card)
    assert.deepEqual([x1, x2], [264, 36])
    assert.ok(y1 < y2) // Dhodapalli lies north of Mumbai
    assert.ok(cy < Math.min(y1, y2))
    assert.equal(cx, 150)
    assert.match(card.querySelector('.plant').getAttribute('d'), /^M264\.0 /)
    assert.equal(card.querySelector('.dest').getAttribute('cx'), '36.0')
    const [from, to] = card.querySelectorAll('text')
    assert.deepEqual([from.getAttribute('text-anchor'), to.getAttribute('text-anchor')], ['end', 'start'])
    assert.ok(Number(from.getAttribute('y')) > y1 && Number(to.getAttribute('y')) > y2)
    clean(document)
})

test('the days of the journey are rounded, one day and less are said as such, and dates the record does not give leave the distance alone', () => {
    const leg = (fields) => parsed(drawRoute(plant, devcon, carried(fields))).querySelector('.leg .far').textContent
    assert.equal(leg({ arrival: '2026-10-28T03:26:59Z' }), '≈ 1,290 km · 1 day')
    assert.equal(leg({ arrival: '2026-10-28T20:00:00Z' }), '≈ 1,290 km · 2 days')
    assert.equal(leg({ arrival: '2026-10-27T09:00:00Z' }), '≈ 1,290 km · under a day')
    for (const fields of [{ arrival: undefined }, { departure: undefined }, { arrival: '2026-10-26T09:00:00Z' }, { departure: 7, arrival: 8 }, { departure: 'yesterday', arrival: 'today' }]) assert.equal(leg(fields), '≈ 1,290 km')
})

test('the view of OpenStreetMap under the map takes the widest zoom at which the two places fit, from 2 to 15, centred between them', () => {
    const view = (from, to) => parsed(drawRoute(from, to, carried())).querySelector('.leg a').getAttribute('href').split('#map=')[1]
    const at = (lat, lon) => ({ site: null, place: null, lat, lon })
    assert.equal(view(plant, devcon), '6/19.649736/78.988277') // 12° of longitude: 557 of 700 pixels at zoom 6, twice that at 7
    assert.equal(view(at(0, 10), at(60, 10)), '3/30.000000/10.000000') // 60° of latitude: 429 of 500 pixels at zoom 3
    assert.equal(view(at(0, 0), at(0, 0.02)), '15/0.000000/0.010000') // two kilometres: no closer than 15
    assert.equal(view(at(0, -170), at(0, 170)), '2/0.000000/0.000000') // most of the world: no wider than 2
})

test('two places that are one, within a kilometre, draw nothing; places without words have no names, and the map is drawn', () => {
    assert.equal(drawRoute(plant, plant, carried()), '')
    assert.equal(drawRoute(plant, { ...plant, lon: 85.1092 }, carried()), '')
    const html = drawRoute({ ...plant, place: null }, { ...devcon, place: ', Mumbai' }, carried())
    const card = parsed(html)
    assert.equal(card.querySelectorAll('text').length, 0)
    assert.equal(card.querySelectorAll('.plant, .dest').length, 2)
    assert.equal(card.querySelector('.map').getAttribute('aria-label'), 'The route from the plant to where the bag went: about 1,290 km in 6 days')
    // a route up a meridian fills the height of the frame, and its line is straight: the bow lies on it
    const north = drawRoute({ ...plant, lat: 10, lon: 80 }, { ...devcon, lat: 20, lon: 80 }, carried())
    const [x1, y1, cx, cy, x2, y2] = lineOf(parsed(north))
    assert.deepEqual([x1, x2, cx], [150, 150, 150])
    assert.deepEqual([y1, y2], [146, 24])
    assert.ok(cy > y2 && cy < y1)
    assert.match(north, /≈ 1,110 km/)
})
