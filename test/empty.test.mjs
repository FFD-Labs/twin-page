// The page with nothing after `#` in its link, or with a link cut short: it says so and shows how it works, from the first
// paint, and it reads no network. Opened from the web it asks for one thing, its own file once more, whose hash is the
// fingerprint in the footer; opened from disk, for nothing. The page is opened at https, as fairfooddata.eth.limo serves
// it, with a wallet in the browser and a fetch that serves the file and keeps every request. A process of its own:
// importing the script runs the page once.
//
// jsdom runs no script of the markup, so the two lines of the head that set the first paint are run here as text, from the
// source and from the built file, against the links they tell apart.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { JSDOM, VirtualConsole } from 'jsdom'
import { inspect } from '../scripts/inspect.mjs'
import { parseSticker } from '../src/lib.ts'
import { clean, openPage } from './page.mjs'

const root = resolve(import.meta.dirname, '..')
const text = (file) => readFileSync(resolve(root, file), 'utf8')
const config = JSON.parse(text('web/public/config.json'))
const contract = config.contract
const at = 'https://fairfooddata.eth.limo/devcon8.html'

// whoever served the page answers with these bytes, and every request is kept
const served = new TextEncoder().encode('<!doctype html><title>Twin</title>')
const asked = []
globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    asked.push(`${request.method} ${request.url}`)
    return new Response(served)
}
// a wallet in the browser, which keeps what it is asked
const wallet = []
const ethereum = { request: async (call) => void wallet.push(call.method) }

const { document, page } = await openPage(config, { url: at, ethereum })
const $ = (id) => document.getElementById(id)
const shown = (id) => document.defaultView.getComputedStyle($(id)).display !== 'none'
const hash = [...createHash('sha256').update(served).digest('hex').match(/.{16}/g)]
const groups = () => [...$('fp-hash').querySelectorAll('span')].map((span) => span.textContent)
// the page that opened settles on its own: its fingerprint is in once the file has been asked for and hashed
for (let i = 0; i < 200 && groups().join('') !== hash.join(''); i++) await new Promise((turn) => setTimeout(turn, 5))
// the page again, with another link or another configuration
async function again(hash, given = config) {
    const inline = $('config')
    const plain = inline.textContent
    inline.textContent = JSON.stringify(given)
    location.hash = hash
    asked.length = 0
    try {
        await page.main()
    } finally {
        inline.textContent = plain
    }
}
const empty = { title: 'No bag to show yet. Go get one. They are yummy.', text: 'Scan the QR code on a bag to follow its fruit from the plant to your hands.' }
const cut = { title: 'This link is incomplete.', text: 'Scan the QR code on the bag again. The link may have been cut short when it was copied.' }
const notice = () => ({ title: $('notice').querySelector('strong').textContent, text: $('notice').lastChild.textContent })

test('nothing after #: the notice and how the page works, and not the front of a bag', () => {
    assert.equal(document.documentElement.dataset.empty, '')
    assert.deepEqual(notice(), empty)
    for (const id of ['notice', 'about']) assert.ok(shown(id), id)
    for (const id of ['hero', 'fruit']) assert.equal(shown(id), false, id)
    assert.equal($('path').innerHTML, '')
    const about = $('about')
    assert.equal(about.querySelector('h2').textContent, 'How this page works')
    // the networks it names are two, and no other
    assert.deepEqual([...about.querySelectorAll('dt')].map((dt) => dt.textContent), ['Ethereum', 'Swarm'])
    assert.deepEqual([...about.querySelectorAll('p')].map((p) => p.textContent).slice(0, 4), [
        'This page is one file: its code, its fonts and the addresses it reads from. The bag comes in the link, after the #: a network, a contract and a bag number.',
        'With a bag, your device reads two public networks:',
        'It also loads a holder’s ENS picture from wherever they keep it, and asks for this file once more to compute its fingerprint.',
        'Without a bag, it asks neither of them for anything.'
    ])
    assert.equal(document.querySelector('.asks').textContent, 'The page asks nothing of you. With a bag in its link, it reads two public networks, Ethereum and Swarm, and shows what it finds.')
    clean(document)
})

test('nothing after #, from the web: one request, for its own file without the #, whose hash is the fingerprint; the wallet is not asked', () => {
    assert.deepEqual(asked, [`GET ${at}`])
    assert.deepEqual(wallet, [])
    assert.equal(document.documentElement.dataset.fingerprint, '')
    assert.ok(shown('fingerprint'))
    assert.deepEqual(groups(), hash)
    assert.equal($('fp-source').href, config.source)
    assert.equal($('fp-source').textContent, 'github.com/FFD-Labs/twin-page')
    assert.match($('fingerprint').textContent, /Computed by your device from this file, fetched once more from where it came\./)
})

test('the footer, the same without a bag: the code at the root of the repository, and the contract on the explorer of its network', async () => {
    assert.ok(shown('code'))
    assert.equal($('code-link').href, 'https://github.com/FFD-Labs/twin-page')
    assert.equal($('code-link').textContent, 'github.com/FFD-Labs/twin-page')
    assert.ok(shown('contract'))
    assert.equal($('contract-link').href, `https://sepolia.etherscan.io/address/${contract}`)
    assert.equal($('contract-addr').textContent, contract)
    // a release names the SHA256SUMS of its folder: the fingerprint links to it, and the code is still the root
    await again('', { ...config, source: `${config.source}/blob/main/releases/0.5/SHA256SUMS` })
    assert.equal($('code-link').href, 'https://github.com/FFD-Labs/twin-page')
    assert.equal($('fp-source').href, 'https://github.com/FFD-Labs/twin-page/blob/main/releases/0.5/SHA256SUMS')
    assert.equal($('fp-source').textContent, 'github.com/FFD-Labs/twin-page/releases/0.5')
    // no source: no code row, and no fingerprint; no network for the contract, or one with no explorer: no contract row
    await again('', { ...config, source: undefined, chain: undefined })
    assert.deepEqual(asked, [])
    for (const id of ['code', 'fingerprint', 'contract']) assert.equal(shown(id), false, id)
    await again('', { ...config, chain: 100 })
    assert.equal(shown('contract'), false)
    await again('')
    for (const id of ['code', 'fingerprint', 'contract']) assert.ok(shown(id), id)
})

test('a link cut short, or a bare #: it says so, over how the page works, and asks for nothing but its own file', async () => {
    for (const link of [`#11155111:${contract}`, `#11155111:${contract}/`, `#11155111:${contract.slice(0, 30)}/1`, '#hello']) {
        await again(link)
        assert.equal(document.documentElement.dataset.empty, '', link)
        assert.deepEqual(notice(), cut, link)
        for (const id of ['notice', 'about']) assert.ok(shown(id), `${link} ${id}`)
        for (const id of ['hero', 'fruit']) assert.equal(shown(id), false, `${link} ${id}`)
        assert.deepEqual(asked, [`GET ${at}`], link)
    }
    await again('#')
    assert.deepEqual(notice(), empty)
    assert.ok(shown('about'))
    assert.deepEqual(wallet, [])
    clean(document)
})

// ---------- the two lines of the head ----------
// They set the root before the first paint: data-empty when what follows # is not a bag, by the test of parseSticker, and
// data-fingerprint when the page is opened from the web where it can hash, so that the footer keeps the row's place.
const headOf = (html) => /<script>([^<]*)<\/script>/.exec(html.slice(0, html.indexOf('</head>')))?.[1]
function firstPaint(script, { hash = '', protocol = 'https:', secure = true } = {}) {
    const dataset = {}
    new Function('location', 'document', 'isSecureContext', script)({ hash, protocol }, { documentElement: { dataset } }, secure)
    return dataset
}
const links = ['', '#', `#11155111:${contract}`, `#11155111:${contract}/`, `#11155111:${contract.slice(0, 30)}/1`, '#hello', `#11155111:${contract}/1`, `#11155111:${contract}/2501`, `#1:${contract.toUpperCase().replace('0X', '0x')}/15000`, `#11155111:${contract}/1?from=qr`]
function tellsApart(script) {
    for (const hash of links) assert.equal('empty' in firstPaint(script, { hash }), parseSticker(hash) === null, hash || '(nothing)')
    assert.deepEqual(firstPaint(script, { hash: '' }), { empty: '', fingerprint: '' })
    assert.deepEqual(firstPaint(script, { hash: `#11155111:${contract}/1` }), { fingerprint: '' })
    // from disk, or over plain http, where a device cannot hash: no place kept for the fingerprint
    assert.deepEqual(firstPaint(script, { hash: `#11155111:${contract}/1`, protocol: 'file:' }), {})
    assert.deepEqual(firstPaint(script, { hash: `#11155111:${contract}/1`, protocol: 'http:', secure: false }), {})
    assert.deepEqual(firstPaint(script, { hash: `#11155111:${contract}/1`, protocol: 'http:', secure: true }), { fingerprint: '' })
}

test('the two lines of the head tell a bag from none as parseSticker does, and keep the fingerprint’s place only from the web', () => {
    const script = headOf(text('web/devcon8.html'))
    assert.ok(script)
    tellsApart(script)
})

// the file as the build writes it, into a folder of the test's own so that dist/ stays as it was; a release's, given its folder
function build(t, ...args) {
    const out = mkdtempSync(join(tmpdir(), 'twin-'))
    t.after(() => rmSync(out, { recursive: true, force: true }))
    execFileSync(process.execPath, [resolve(root, 'scripts/standalone.mjs'), '--out', out, ...args], { cwd: root, stdio: 'pipe' })
    return readFileSync(join(out, 'devcon8.html'), 'utf8')
}
const linkOf = (html, id) => {
    const a = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document.getElementById(id)
    return [a.getAttribute('href'), a.textContent]
}

test('the built file: the two lines of its head, named by its policy, and the rules that show the page with no bag from the first paint', (t) => {
    const html = build(t, '--release', '0.5')
    assert.equal(inspect(html, 3).scripts, 3)
    const script = headOf(html)
    assert.equal(script, headOf(text('web/devcon8.html')))
    tellsApart(script)
    const { document: built } = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window
    const [policy] = built.head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
    assert.ok(policy.getAttribute('content').includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`))
    // in the head, after the policy and before the styles
    const first = built.head.querySelector('script')
    assert.equal(first.textContent, script)
    assert.ok(policy.compareDocumentPosition(first) & 4)
    assert.ok(first.compareDocumentPosition(built.head.querySelector('style')) & 4)
    const styles = [...built.querySelectorAll('style')].map((style) => style.textContent).join('\n')
    for (const rule of [
        ':root[data-empty] #hero, :root[data-empty] #fruit, :root:not([data-empty]) #about { display: none; }',
        ':root[data-empty] #notice { display: block !important; }',
        ':root:not([data-fingerprint]) #fingerprint { display: none; }'
    ])
        assert.ok(styles.includes(rule), rule)
    // what the first paint shows is in the markup: the notice of no bag as the script writes it, and how the page works
    assert.equal(built.getElementById('notice').innerHTML, `<strong>${empty.title}</strong><br>${empty.text}`)
    for (const id of ['about', 'fingerprint', 'code']) assert.equal(built.getElementById(id).hasAttribute('hidden'), false, id)
    assert.equal(built.getElementById('fp-hash').querySelectorAll('.skel').length, 4)
    // The chain Swarm's stamps are paid on is not named in the file, but in the addresses of its RPCs, which carry its name
    const stampRpcs = config.rpcs[config.storage.chain]
    const name = new URL(stampRpcs[0]).host.split('.')[1]
    assert.equal(stampRpcs.reduce((rest, url) => rest.replaceAll(url, ''), html).toLowerCase().includes(name), false)
})

test('the built file’s footer links to the source as the script will write them, a release’s and any other, so the rows keep their height', async (t) => {
    const release = `${config.source}/blob/main/releases/0.5/SHA256SUMS`
    for (const [html, source] of [[build(t, '--release', '0.5'), release], [build(t), config.source]]) {
        // what the script writes into the same two links, from the same source
        await again('', { ...config, source })
        assert.deepEqual(linkOf(html, 'fp-source'), [$('fp-source').getAttribute('href'), $('fp-source').textContent], source)
        assert.deepEqual(linkOf(html, 'code-link'), [$('code-link').getAttribute('href'), $('code-link').textContent], source)
    }
    assert.deepEqual(linkOf(build(t, '--release', '0.5'), 'fp-source'), [release, 'github.com/FFD-Labs/twin-page/releases/0.5'])
})

test('nothing after #, from disk: no request at all, and no row for the fingerprint', async () => {
    const window = new JSDOM(text('web/devcon8.html'), { url: 'file:///devcon8.html', virtualConsole: new VirtualConsole() }).window
    const inline = Object.assign(window.document.createElement('script'), { type: 'application/json', id: 'config', textContent: JSON.stringify(config) })
    window.document.body.append(inline)
    Object.assign(globalThis, { window, document: window.document, location: window.location })
    asked.length = 0
    await page.main()
    const $ = (id) => window.document.getElementById(id)
    assert.deepEqual(asked, [])
    assert.equal(window.document.documentElement.dataset.empty, '')
    assert.equal(window.document.documentElement.hasAttribute('data-fingerprint'), false)
    assert.equal(window.getComputedStyle($('fingerprint')).display, 'none')
    assert.notEqual(window.getComputedStyle($('about')).display, 'none')
    assert.equal($('code-link').href, 'https://github.com/FFD-Labs/twin-page')
    assert.equal($('contract-link').href, `https://sepolia.etherscan.io/address/${contract}`)
})
