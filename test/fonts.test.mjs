// The five faces the page inlines, against the masters they are cut from (scripts/fonts.py) and against the rules that
// use them. A face holds what the page draws with it and nothing more: a text set in Montserrat that its cut does not have
// would fall, letter by letter, to the next font of the stack, and nothing on screen would say so. So each face is read
// here as a browser reads it, by its cmap, and held against what the page writes in it; the vertical metrics are the
// master's; and the rules that ask for Montserrat 300 and 400, the two cuts that hold numbers alone, are the known ones.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { brotliDecompressSync } from 'node:zlib'
import { parseSticker } from '../src/lib.ts'
import { openPage } from './page.mjs'

const root = resolve(import.meta.dirname, '..')
const html = readFileSync(resolve(root, 'web/devcon8.html'), 'utf8')

// ---------- a face, read from its woff2 ----------
// A woff2 is a directory of tables and one brotli stream that holds them in its order. The tables the page reads here,
// cmap, head, hhea, OS/2, GSUB and GPOS, are never transformed: they come out of the stream as they are in the font.
const TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill']
function woff2(file) {
    const bytes = readFileSync(resolve(root, file))
    assert.equal(bytes.toString('latin1', 0, 4), 'wOF2', `${file} is not a woff2`)
    let at = 48
    const base128 = () => {
        let value = 0
        for (let i = 0; i < 5; i++) {
            const byte = bytes[at++]
            value = value * 128 + (byte & 0x7f)
            if (!(byte & 0x80)) return value
        }
        throw Error(`${file}: a length that does not end`)
    }
    const directory = Array.from({ length: bytes.readUInt16BE(12) }, () => {
        const flags = bytes[at++]
        const tag = (flags & 0x3f) === 0x3f ? bytes.toString('latin1', at, (at += 4)) : TAGS[flags & 0x3f]
        const length = base128()
        const transformed = ['glyf', 'loca'].includes(tag) ? flags >> 6 !== 3 : flags >> 6 !== 0
        return { tag, length: transformed ? base128() : length, transformed }
    })
    const stream = brotliDecompressSync(bytes.subarray(at, at + bytes.readUInt32BE(20)))
    const tables = {}
    let offset = 0
    for (const { tag, length, transformed } of directory) {
        if (!transformed) tables[tag] = stream.subarray(offset, offset + length)
        offset += length
    }
    assert.equal(offset, stream.length, `${file}: its tables are not its stream`)
    return tables
}

// The characters a face has a glyph for: its Unicode cmap, format 4 or 12
function characters({ cmap }) {
    const records = Array.from({ length: cmap.readUInt16BE(2) }, (_, i) => ({ platform: cmap.readUInt16BE(4 + i * 8), encoding: cmap.readUInt16BE(6 + i * 8), offset: cmap.readUInt32BE(8 + i * 8) }))
    const unicode = (r) => r.platform === 0 || (r.platform === 3 && [1, 10].includes(r.encoding))
    const formats = records.filter(unicode).map((r) => ({ ...r, format: cmap.readUInt16BE(r.offset) }))
    const best = formats.find((r) => r.format === 12) ?? formats.find((r) => r.format === 4)
    const t = cmap.subarray(best.offset)
    const chars = new Set()
    if (best.format === 4) {
        const segments = t.readUInt16BE(6) / 2
        for (let s = 0; s < segments; s++) {
            const end = t.readUInt16BE(14 + s * 2), start = t.readUInt16BE(16 + segments * 2 + s * 2)
            const delta = t.readInt16BE(16 + segments * 4 + s * 2), rangeAt = 16 + segments * 6 + s * 2, range = t.readUInt16BE(rangeAt)
            for (let c = start; c <= end && c !== 0xffff; c++) {
                const listed = range ? t.readUInt16BE(rangeAt + range + (c - start) * 2) : c
                if ((range && !listed) || ((listed + delta) & 0xffff) === 0) continue
                chars.add(c)
            }
        }
    } else {
        for (let g = 0; g < t.readUInt32BE(12); g++) for (let c = t.readUInt32BE(16 + g * 12); c <= t.readUInt32BE(20 + g * 12); c++) chars.add(c)
    }
    return chars
}

// The features of its layout tables, and the lines it sets text on: the em, the box, and the ascent, descent and gap of
// hhea and of OS/2, with the flag that says which of the two a browser takes
const features = (tables) =>
    ['GSUB', 'GPOS'].flatMap((tag) => {
        const table = tables[tag]
        const list = table?.readUInt16BE(6)
        return list ? Array.from({ length: table.readUInt16BE(list) }, (_, i) => table.toString('latin1', list + 2 + i * 6, list + 6 + i * 6)) : []
    })
const metrics = ({ head, hhea, 'OS/2': os2 }) => ({
    unitsPerEm: head.readUInt16BE(18), yMin: head.readInt16BE(38), yMax: head.readInt16BE(42),
    ascender: hhea.readInt16BE(4), descender: hhea.readInt16BE(6), lineGap: hhea.readInt16BE(8),
    fsSelection: os2.readUInt16BE(62), typoAscender: os2.readInt16BE(68), typoDescender: os2.readInt16BE(70), typoLineGap: os2.readInt16BE(72),
    winAscent: os2.readUInt16BE(74), winDescent: os2.readUInt16BE(76), xHeight: os2.readInt16BE(86), capHeight: os2.readInt16BE(88)
})

// ---------- the faces the page declares, and the rules that use them ----------
const faces = [...html.matchAll(/@font-face \{([^}]*)\}/g)].map(([, body]) => ({
    family: /font-family: '([^']+)'/.exec(body)[1],
    file: /url\('\.\/(fonts\/[^']+)'\)/.exec(body)[1],
    format: /format\('([^']+)'\)/.exec(body)[1],
    weight: /font-weight: ([^;]+);/.exec(body)[1]
}))
const face = (family, weight) => {
    const declared = faces.find((f) => f.family === family && f.weight === String(weight))
    assert.ok(declared, `no face of ${family} at ${weight}`)
    return woff2(`web/public/${declared.file}`)
}
const master = (file) => woff2(`fonts-src/${file}`)
const has = (tables, text) => [...text].filter((c) => !characters(tables).has(c.codePointAt(0)))

// The rules of the page's styles, out of their @media and @supports, each with its selector and its declarations
function rules(css) {
    const found = []
    const walk = (text) => {
        let at = 0
        while (text.indexOf('{', at) >= 0) {
            const open = text.indexOf('{', at)
            let depth = 1, close = open + 1
            for (; depth; close++) depth += text[close] === '{' ? 1 : text[close] === '}' ? -1 : 0
            const head = text.slice(at, open).trim().replace(/\s+/g, ' ')
            const body = text.slice(open + 1, close - 1)
            if (/^@(media|supports)/.test(head)) walk(body)
            else if (!head.startsWith('@')) found.push({ selector: head, declarations: body.split(';').map((d) => d.split(/:(.*)/s).map((s) => s.trim())).filter(([name]) => name) })
            at = close
        }
    }
    walk(css.replace(/\/\*[\s\S]*?\*\//g, ''))
    return found
}
// every style of the page; the @font-face rules set no element, and are left out
const styles = rules([...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(([, css]) => css).join('\n'))
// The family and the weight a rule sets: the shorthand gives both, and a weight of 400 when it names none; font-family
// and font-weight give one each. The family is the first of the page's three a value names, by its custom property or
// by its own name. A weight is a number, normal or bold; bolder and lighter, which depend on the parent, stay as they are
// written, and the tests refuse them.
const FAMILIES = [['Montserrat', /var\(--caps\)|Montserrat/], ['Fira Sans Condensed', /var\(--text\)|Fira Sans Condensed/], ['Spline Sans Mono', /var\(--mono\)|Spline Sans Mono/]]
const familyOf = (value) => FAMILIES.map(([family, named]) => [family, value.search(named)]).filter(([, at]) => at >= 0).sort((a, b) => a[1] - b[1])[0]?.[0] ?? value
const weightOf = (value) => ({ normal: 400, bold: 700 })[value] ?? (/^[1-9]00$/.test(value) ? Number(value) : value)
function set({ declarations }) {
    let family, weight
    for (const [name, value] of declarations) {
        if (name === 'font' || name === 'font-family') family = familyOf(value)
        if (name === 'font') {
            // the weight comes before the size, which is the first length: a number with its unit, or a function of them.
            // A normal there may be the style's: the weight is normal unless another is named
            const tokens = value.split(/\s+/)
            const size = tokens.findIndex((token) => !/^[1-9]00$/.test(token) && /^[\d.]|^(calc|clamp|min|max)\(/.test(token))
            weight = weightOf(tokens.slice(0, Math.max(size, 0)).find((token) => /^([1-9]00|bold|bolder|lighter)$/.test(token)) ?? 'normal')
        }
        if (name === 'font-weight') weight = weightOf(value)
    }
    return { family, weight }
}
const sets = styles.map((rule) => ({ ...rule, ...set(rule) }))
const montserrat = sets.filter((rule) => rule.family === 'Montserrat')

// The rules that set a weight and leave the family to the element's parents, with the family those parents give it
const INHERITED = {
    ".twin b[data-len='4']": 'Montserrat',
    ".twin b[data-len='5']": 'Montserrat',
    ".twin b[data-len='6'], .twin b[data-len='7']": 'Montserrat',
    '.stored b': 'Montserrat',
    '.nutri th, .nutri td': 'Fira Sans Condensed',
    '.step .tile b': 'Montserrat',
    '.holder-line .who b': 'Fira Sans Condensed'
}

// What the page writes in the cuts of numbers: the twin's number is the digits of the link, and the arithmetic its times
// and its amounts. Here for a bag whose figures give a point, and for records whose figures make those numbers negative,
// very large or very small, which JavaScript writes with -, e+ and e-
const { document, page } = await openPage()
const twin = String(parseSticker('#11155111:0x240dfbca7064d091149169eff95f764d1e21cea7/1234567890').id)
const event = (n, data) => ({ ref: `0x${String(n).repeat(64)}`, at: '2026-10-02T10:00:00.000Z', block: 7n, gateway: 'https://gateway.example', verified: true, tx: null, data })
// the text an element sets in its own face, without its children that set another (the g of an amount, in Fira)
const own = (el) => [...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.data).join('')
const written = (selector) => [...document.querySelectorAll(selector)].map(own)
const arithmetic = [[2.3, 30.5], [-2.3, 30.5], [1e-22, 30.5], [2.3, 1e-7]].map(([kg_out, bag_g]) => {
    page.renderCo2({ co2: { factor_kg_per_kg: 0.6, scenario: 'an open dump', scenario_written: '2026-10-04' } }, [
        event(1, { phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'mango', kg: 20, sourcing: 'rescued' }),
        event(2, { phase: 'cycle', at: '2026-09-29T08:00:00Z', loads: [{ trays: 10, kg: 20 }], kg_out }),
        event(3, { phase: 'packing', at: '2026-09-30T08:00:00Z', product: 'mango', bag_g })
    ])
    return { times: written('.ring .times'), amounts: written('.ledger .amt') }
})

test('the page declares five faces, each a file of web/public/fonts, and that folder holds nothing else', () => {
    assert.deepEqual(faces.map((f) => `${f.family} ${f.weight} ${f.format}`), ['Montserrat 300 woff2', 'Montserrat 400 woff2', 'Montserrat 500 woff2', 'Fira Sans Condensed 400 woff2', 'Spline Sans Mono 400 woff2'])
    assert.deepEqual(faces.map((f) => f.file.slice('fonts/'.length)).sort(), readdirSync(resolve(root, 'web/public/fonts')).sort())
})

test('every face sets text on the lines of its master: the same em, box, ascent, descent and gap', () => {
    for (const [family, weight, file] of [['Montserrat', 300, 'montserrat-300.woff2'], ['Montserrat', 400, 'montserrat-400.woff2'], ['Montserrat', 500, 'montserrat-500.woff2'], ['Fira Sans Condensed', 400, 'fira-sans-condensed-400.woff2'], ['Spline Sans Mono', 400, 'spline-sans-mono-var.woff2']])
        assert.deepEqual(metrics(face(family, weight)), metrics(master(file)), `${family} ${weight}`)
})

test('only the known rules ask for Montserrat at 300 and 400, and they write numbers, and DEVCON', () => {
    // a weight is a number: bolder and lighter depend on the parent, and a rule that names Montserrat says which cut it takes
    for (const rule of sets.filter((rule) => rule.weight !== undefined)) assert.equal(typeof rule.weight, 'number', `${rule.selector}: a weight of ${rule.weight} depends on the parent; give the number`)
    for (const rule of montserrat) assert.notEqual(rule.weight, undefined, `${rule.selector} names Montserrat and not its weight`)
    const light = montserrat.filter((rule) => rule.weight === 300 || rule.weight === 400).map((rule) => `${rule.selector} ${rule.weight}`)
    assert.deepEqual(light, ['.devcon 400', '.twin b 300', '.ring .times 300', '.ledger .amt 300'])
    const weighted = sets.filter((rule) => rule.weight !== undefined && rule.family === undefined)
    assert.deepEqual(weighted.map((rule) => rule.selector), Object.keys(INHERITED), 'a rule sets a weight and not a family: name the family its element inherits')
    const inherited = weighted.filter((rule) => INHERITED[rule.selector] === 'Montserrat' && [300, 400].includes(rule.weight)).map((rule) => rule.selector)
    assert.ok(inherited.every((selector) => selector.startsWith('.twin b')), 'only the twin\'s number changes weight on Montserrat')
    // the page writes nothing in a face of its own: the looks live in devcon8.html
    assert.doesNotMatch(readFileSync(resolve(root, 'web/devcon8.ts'), 'utf8'), /font-(family|weight)|[{;"]\s*font:/)

    assert.match(twin, /^\d+$/)
    for (const { times, amounts } of arithmetic) assert.deepEqual([times.length, amounts.length], [1, 3])
    const numbers = arithmetic.flatMap(({ times, amounts }) => [...times, ...amounts]).join(' ')
    for (const sign of ['-', 'e+', 'e-']) assert.ok(numbers.includes(sign), `no number written with ${sign}`)
    const devcon = /<p class="devcon">([^<]*)<\/p>/.exec(html)[1]
    assert.equal(devcon, 'DEVCON')
    assert.deepEqual(has(face('Montserrat', 300), twin + numbers), [])
    assert.deepEqual(has(face('Montserrat', 400), twin + devcon), [])
    // and nothing else: a cut of numbers that drew more would be weight for nothing
    assert.deepEqual([...characters(face('Montserrat', 300))].sort((a, b) => a - b), [...' +,-.0123456789e×≈'].map((c) => c.codePointAt(0)).sort((a, b) => a - b))
    assert.deepEqual([...characters(face('Montserrat', 400))].sort((a, b) => a - b), [...' ,.0123456789CDENOV×≈'].map((c) => c.codePointAt(0)).sort((a, b) => a - b))
})

test('every rule of Montserrat 500 writes in capitals but the city, in capitals already, and the units of the chart, °C and Pa', () => {
    const lower = montserrat.filter((rule) => rule.weight === 500 && !rule.declarations.some(([name, value]) => name === 'text-transform' && value === 'uppercase'))
    assert.deepEqual(lower.map((rule) => rule.selector), ['.city', '.curves .unit'])
    const city = /<p class="city">([^<]*)<\/p>/.exec(html)[1]
    assert.equal(city, city.toUpperCase())
    const chart = document.createElement('div')
    const preview = { t: [0, 3600, 7200], series: new Map([['chamber_temperature', [20, -30, -38]], ['chamber_pressure', [100000, 30, 21]]]) }
    chart.innerHTML = page.drawCycle(preview, { phase: 'cycle', at: '2026-09-29T08:00:00Z' })
    const units = [...chart.querySelectorAll('.unit')].map((unit) => unit.textContent)
    assert.deepEqual(units, ['°C', 'Pa'])
    const m500 = face('Montserrat', 500)
    assert.deepEqual(has(m500, city + units.join('')), [])
    // every character of its master but the lowercase b to z, which no rule of 500 writes
    const kept = [...characters(master('montserrat-500.woff2'))].filter((c) => !(c >= 0x62 && c <= 0x7a))
    assert.deepEqual([...characters(m500)].sort((a, b) => a - b), kept.sort((a, b) => a - b))
})

test('Montserrat keeps its kerning and its tabular figures, and nothing it draws needs more', () => {
    for (const weight of [300, 400, 500]) assert.deepEqual(features(face('Montserrat', weight)).sort(), ['kern', 'tnum'], `Montserrat ${weight}`)
})

test('Fira Sans Condensed keeps every character of its master, Latin Extended-A with it, and every feature but case', () => {
    const fira = face('Fira Sans Condensed', 400)
    assert.deepEqual([...characters(fira)].sort((a, b) => a - b), [...characters(master('fira-sans-condensed-400.woff2'))].sort((a, b) => a - b))
    const range = (from, to) => String.fromCodePoint(...Array.from({ length: to - from + 1 }, (_, i) => from + i))
    assert.deepEqual(has(fira, range(0x20, 0x7e) + range(0xa0, 0x17f) + '–—‘’“”•…₂≈'), [])
    assert.deepEqual(features(fira).sort(), ['calt', 'kern', 'liga', 'tnum'])
})

test('Spline Sans Mono is its master at 400, with every character, and every rule that sets it draws at 400', () => {
    const spline = face('Spline Sans Mono', 400)
    assert.equal(spline.fvar, undefined, 'it is still variable')
    assert.deepEqual([...characters(spline)].sort((a, b) => a - b), [...characters(master('spline-sans-mono-var.woff2'))].sort((a, b) => a - b))
    const mono = sets.filter((rule) => rule.family === 'Spline Sans Mono')
    assert.ok(mono.length)
    for (const rule of mono) assert.equal(rule.weight, 400, rule.selector)
})
