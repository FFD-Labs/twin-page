// The whole check, from the link to the last block, against a gateway and an RPC that say what the test tells them to.
// What a gateway serves is checked before it is read: bytes that do not give the reference the page asked for, or whose
// reference has no anchor, are never parsed and nothing of them is painted. An RPC that lies is the one thing the page
// cannot see through, since the anchors are its word; even then, a record's values reach the page as text.
import assert from 'node:assert/strict'
import { beforeEach, mock, test } from 'node:test'
import { decodeFunctionData, encodeFunctionResult } from 'viem'
import { abi, hex, swarmHash } from '../src/lib.ts'
import { clean, hostile, openPage } from './page.mjs'

const contract = '0x240dfbca7064d091149169eff95f764d1e21cea7'
const config = {
    rpc: 'https://rpc.example',
    contract,
    gateways: ['https://gateway.example'],
    fruits: { mango: { name: 'Mango' } },
    co2: { factor_kg_per_kg: 0.6, scenario: 'an open dump', scenario_written: '2026-10-04' }
}

// ---------- the network: one RPC and one gateway ----------
const net = { head: null, anchors: new Map(), files: new Map(), asked: [] }
const answer = (body, type) => new Response(body, { headers: { 'content-type': type } })
function rpc(method, [call] = []) {
    if (method === 'eth_chainId') return '0xaa36a7'
    if (method === 'eth_getLogs') return []
    if (method === 'eth_call' && call.to.toLowerCase() === contract) {
        const { functionName, args } = decodeFunctionData({ abi, data: call.data })
        if (functionName === 'recordOf') return encodeFunctionResult({ abi, functionName, result: net.head })
        if (functionName === 'anchoredAt') return encodeFunctionResult({ abi, functionName, result: net.anchors.get(args[0]) ?? [0n, 0n] })
    }
    throw Error('execution reverted') // ownerOf: the twin is not created yet
}
globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = request.url
    net.asked.push(url)
    if (url === new URL(config.rpc).href) {
        const { id, method, params } = await request.json()
        try {
            return answer(JSON.stringify({ jsonrpc: '2.0', id, result: rpc(method, params) }), 'application/json')
        } catch (error) {
            return answer(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 3, message: error.message } }), 'application/json')
        }
    }
    const file = net.files.get(`0x${url.split('/bytes/')[1]}`)
    return file ? answer(file, 'application/octet-stream') : new Response('not found', { status: 404 })
}

// A record as the Notary would leave it: its bytes on Swarm under their own reference, and the reference anchored.
const bytes = (record) => new TextEncoder().encode(JSON.stringify(record))
function put(record) {
    const file = bytes(record)
    const ref = swarmHash(file)
    net.files.set(ref, file)
    net.anchors.set(ref, [1759400000n, 7n])
    return ref
}
const packed = (fields = {}) => ({ phase: 'packing', at: '2026-09-30T08:00:00Z', product: 'mango', bag_g: 30, lot: 'L1', ...fields })

// ---------- the page ----------
const { document, page } = await openPage(config)
const $ = (id) => document.getElementById(id)
const cards = () => [...document.querySelectorAll('#path li.step')]

// The page paces what it shows with timers. The test owns the clock: every timer runs as soon as it is set, until the check
// is done, and then what the check left for later: the fruit card, the cards opening, the arithmetic.
mock.timers.enable({ apis: ['setTimeout'] })
async function scan() {
    location.hash = `#11155111:${contract}/1`
    let done = false
    const check = page.main().finally(() => (done = true))
    while (!done) {
        mock.timers.runAll()
        await new Promise((turn) => setImmediate(turn))
    }
    for (let i = 0; i < 3; i++) mock.timers.runAll()
    return check
}

beforeEach(() => {
    net.head = null
    net.anchors.clear()
    net.files.clear()
    net.asked.length = 0
})

test('a reference is 64 hex digits, with or without 0x', () => {
    const ref = `0x${'ab'.repeat(32)}`
    assert.equal(hex(ref), ref)
    assert.equal(hex('AB'.repeat(32)), ref)
    for (const not of ['', '0x', 'ab'.repeat(31), 'ab'.repeat(33), `0x${'zz'.repeat(32)}`, ` ${ref}`, hostile('ref'), 7, null, undefined, [ref]]) assert.throws(() => hex(not), /not a Swarm reference/)
})

test('honest records: every card, the seal, the fruit and the arithmetic', async () => {
    const intake = put({ phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'mango', kg: 20, sourcing: 'rescued' })
    const cycle = put({ phase: 'cycle', at: '2026-09-29T08:00:00Z', start: '2026-09-28T10:00:00Z', end: '2026-09-29T08:00:00Z', loads: [{ trays: 10, kg: 20 }], kg_out: 2, inputs: [intake] })
    net.head = put(packed({ inputs: [cycle.slice(2)] }))
    await scan()
    assert.deepEqual(cards().map((li) => li.querySelector('h2').textContent), ['Received', 'Freeze-dried', 'Packed'])
    for (const li of cards()) assert.match(li.querySelector('.check').textContent, /^✓ Matches its Ethereum anchor of /)
    assert.equal($('step-3').querySelector('.v').textContent, '3 of 3 matches')
    assert.ok($('hero').classList.contains('verified'))
    assert.ok($('proof-fold').classList.contains('open'))
    assert.equal($('fruit-name').textContent, 'Mango')
    assert.equal($('fruit-grams').textContent, '30 g per bag')
    assert.equal($('co2').hidden, false)
    clean(document)
})

test('a gateway that serves other bytes: they are not read, and nothing of them is painted', async () => {
    net.head = put(packed())
    net.files.set(net.head, bytes(packed({ bag_g: hostile('bag_g'), version: hostile('version'), lot: 'SERVED-BY-THE-GATEWAY', inputs: [hostile('inputs')] })))
    await scan()
    assert.equal(cards().length, 1)
    assert.match(cards()[0].textContent, /Record not shown/)
    assert.equal(cards()[0].querySelector('.check').textContent, '✗ Does not match any Ethereum anchor')
    assert.ok(cards()[0].classList.contains('bad'))
    assert.equal($('step-3').querySelector('.v').textContent, '0 of 1 match')
    assert.equal($('hero').classList.contains('verified'), false)
    assert.equal($('proof-fold').classList.contains('open'), false)
    assert.equal($('fruit-name').textContent, 'This bag')
    assert.equal($('co2').hidden, true)
    assert.equal(document.documentElement.outerHTML.includes('SERVED-BY-THE-GATEWAY'), false)
    assert.equal(document.documentElement.outerHTML.includes('ffd-probe'), false)
    clean(document)
})

test('bytes that are what their reference names, with no anchor: not read either', async () => {
    net.head = put(packed({ lot: 'NEVER-ANCHORED' }))
    net.anchors.clear()
    await scan()
    assert.match(cards()[0].textContent, /Record not shown/)
    assert.equal($('step-3').querySelector('.v').textContent, '0 of 1 match')
    assert.equal(document.documentElement.outerHTML.includes('NEVER-ANCHORED'), false)
})

test('an RPC that anchors a hostile record: it is read, and its values stay text', async () => {
    net.head = put(packed({ bag_g: hostile('bag_g'), version: hostile('version'), lot: hostile('lot') }))
    await scan()
    assert.equal(cards()[0].querySelector('h2').textContent, 'Packed')
    assert.ok(cards()[0].textContent.includes(hostile('lot')))
    assert.equal($('fruit-name').textContent, 'Mango')
    assert.equal($('fruit-origin').innerHTML, '')
    assert.equal($('co2').hidden, true)
    clean(document)
})

test('a record that names something that is not a reference: the page stops and asks no one for it', async (t) => {
    t.mock.method(console, 'error', () => {}) // the page logs what stopped it
    net.head = put(packed({ inputs: [hostile('inputs')] }))
    await scan()
    assert.match($('notice').textContent, /We couldn’t reach the records right now/)
    assert.match($('notice').textContent, /not a Swarm reference/)
    assert.deepEqual(net.asked.filter((url) => url.includes('/bytes/')), [`${config.gateways[0]}/bytes/${net.head.slice(2)}`])
    clean(document)
})
