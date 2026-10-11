// The whole check, from the link to the last block, against a gateway and an RPC that say what the test tells them to.
// What a gateway serves is checked before it is read: bytes that do not give the reference the page asked for, or whose
// reference has no anchor, are never parsed and nothing of them is painted. An RPC that lies is the one thing the page
// cannot see through, since the anchors are its word; even then, a record's values reach the page as text.
import assert from 'node:assert/strict'
import { beforeEach, mock, test } from 'node:test'
import { decodeFunctionData, encodeErrorResult, encodeFunctionResult, parseAbi } from 'viem'
import { abi, hex, swarmHash } from '../src/lib.ts'
import { clean, hostile, loads, openPage } from './page.mjs'

const contract = '0x240dfbca7064d091149169eff95f764d1e21cea7'
const rpcs = ['https://rpc.example', 'https://other-rpc.example']
const config = {
    rpcs: { 11155111: rpcs, 1: rpcs },
    contract,
    gateways: ['https://gateway.example', 'https://second.example'],
    fruits: { mango: { name: 'Mango' } },
    co2: { factor_kg_per_kg: 0.6, scenario: 'an open dump', scenario_written: '2026-10-04' }
}

// ---------- the network: two RPCs and two gateways ----------
// Both gateways serve the files, unless a test says what one of them does instead (`net.instead`, by its address). Both
// RPCs say the same, they are on Sepolia and the twin is not created yet, unless a test says otherwise: `net.chain`,
// `net.owner` (an address, or a function that answers in its place), `net.ens` (what an RPC does when it is asked for a
// name) and `net.says` (what one RPC answers in place of the other's answer, by its address).
const net = { head: null, anchors: new Map(), files: new Map(), asked: [], calls: [], instead: new Map(), says: new Map(), chain: '0xaa36a7', owner: null, ens: null }
const [first, second] = config.gateways
const answer = (body, type) => new Response(body, { headers: { 'content-type': type } })
// what a contract says when it stops a call: the error it names, as an RPC hands it on
const revert = (data) => Object.assign(Error('execution reverted'), { code: 3, data })
const others = parseAbi(['error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)', 'error ResolverNotFound(bytes name)'])
function rpc(method, [call] = []) {
    if (method === 'eth_chainId') return net.chain
    if (method === 'eth_getLogs') return []
    if (method === 'eth_call' && call.to.toLowerCase() === contract) {
        const { functionName, args } = decodeFunctionData({ abi, data: call.data })
        if (functionName === 'recordOf') return encodeFunctionResult({ abi, functionName, result: net.head })
        if (functionName === 'anchoredAt') return encodeFunctionResult({ abi, functionName, result: net.anchors.get(args[0]) ?? [0n, 0n] })
        if (typeof net.owner === 'function') return net.owner()
        if (net.owner) return encodeFunctionResult({ abi, functionName, result: net.owner })
        throw revert(encodeErrorResult({ abi, errorName: 'ERC721NonexistentToken', args }))
    }
    if (net.ens) return net.ens()
    throw revert()
}
globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = request.url
    net.asked.push(url)
    if (rpcs.includes(new URL(url).origin)) {
        const { id, method, params } = await request.json()
        net.calls.push(`${new URL(url).host} ${method}`)
        try {
            const says = net.says.get(new URL(url).origin)
            return answer(JSON.stringify({ jsonrpc: '2.0', id, result: says ? says(method, params) : rpc(method, params) }), 'application/json')
        } catch (error) {
            if (error instanceof Response) return error
            return answer(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 3, message: error.message, data: error.data } }), 'application/json')
        }
    }
    const instead = net.instead.get(new URL(url).origin)
    if (instead) return instead(request)
    const file = net.files.get(`0x${url.split('/bytes/')[1]}`)
    return file ? answer(file, 'application/octet-stream') : new Response('not found', { status: 404 })
}
const down = () => new Response('bad gateway', { status: 502 })
// it takes the request and never answers: the wait ends when the page gives up
const silent = (request) => new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason)))
const asked = (gateway) => net.asked.filter((url) => url.startsWith(`${gateway}/bytes/`)).length

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
async function scan(link = `11155111:${contract}/1`) {
    location.hash = `#${link}`
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
    net.calls.length = 0
    net.instead.clear()
    net.says.clear()
    Object.assign(net, { chain: '0xaa36a7', owner: null, ens: null })
    delete window.ethereum
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

test('a first gateway that serves other bytes, and a second that has the record: it is read from the second', async () => {
    net.head = put(packed())
    net.instead.set(first, () => answer(bytes(packed({ lot: 'SERVED-BY-THE-FIRST', inputs: [hostile('inputs')] })), 'application/octet-stream'))
    await scan()
    assert.equal(cards()[0].querySelector('h2').textContent, 'Packed')
    assert.match(cards()[0].querySelector('.check').textContent, /^✓ Matches its Ethereum anchor of /)
    assert.ok($('hero').classList.contains('verified'))
    assert.ok(cards()[0].querySelector('.links a:not(.anchor)').href.startsWith(`${second}/bytes/`))
    assert.equal(document.documentElement.outerHTML.includes('SERVED-BY-THE-FIRST'), false)
    assert.deepEqual([asked(first), asked(second)], [1, 1])
    clean(document)
})

test('a first gateway that is down, or serves more than a record weighs: the second is asked', async () => {
    for (const instead of [down, () => answer(new Uint8Array(1024 * 1024 + 1), 'application/octet-stream')]) {
        net.asked.length = 0
        net.head = put(packed())
        net.instead.set(first, instead)
        await scan()
        assert.match(cards()[0].querySelector('.check').textContent, /^✓ Matches its Ethereum anchor of /)
        assert.ok($('hero').classList.contains('verified'))
        assert.deepEqual([asked(first), asked(second)], [1, 1])
    }
})

test('a first gateway that takes the request and never answers: the page gives up on it and asks the second', async (t) => {
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    t.mock.method(AbortSignal, 'timeout', () => timeout(5)) // the wait, cut short for the test
    net.head = put(packed())
    net.instead.set(first, silent)
    await scan()
    assert.match(cards()[0].querySelector('.check').textContent, /^✓ Matches its Ethereum anchor of /)
    assert.ok($('hero').classList.contains('verified'))
    assert.deepEqual([asked(first), asked(second)], [1, 1])
})

test('no gateway answers: that is the network, not the record, and the page offers to try again', async (t) => {
    t.mock.method(console, 'error', () => {}) // the page logs what stopped it
    net.head = put(packed())
    net.instead.set(first, down)
    net.instead.set(second, down)
    await scan()
    assert.match($('notice').textContent, /We couldn’t reach the records right now/)
    assert.match($('notice').textContent, /Tried gateway\.example, second\.example\./)
    assert.ok(document.getElementById('retry'))
    assert.equal(cards().length, 0)
    assert.equal(document.documentElement.outerHTML.includes('Does not match'), false)
    assert.equal($('hero').classList.contains('verified'), false)
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

test('a record that names something that is not a reference: it is not understood, and no one is asked for it', async () => {
    net.head = put(packed({ inputs: [hostile('inputs')] }))
    await scan()
    assert.equal(cards()[0].querySelector('h2').textContent, 'Record not understood')
    assert.equal($('notice').hidden, true)
    assert.deepEqual(net.asked.filter((url) => url.includes('/bytes/')), [`${config.gateways[0]}/bytes/${net.head.slice(2)}`])
    clean(document)
})

// A record that passed the check and is not one the page knows how to show. The types of a record are what it should be:
// what it is, is whatever was anchored. None of these may stop the page, and none may put its own words where the page's go.
const odd = {
    'is not JSON': 'freeze-dried, not JSON',
    'is a number': '7',
    'is null': 'null',
    'is a list': '[]',
    'has a phase the page does not know': JSON.stringify(packed({ phase: 'recall' })),
    'has a phase that is a list': JSON.stringify(packed({ phase: ['packing'] })),
    'has no phase': JSON.stringify({ at: '2026-09-30T08:00:00Z' }),
    'names its own card': JSON.stringify(packed({ phase: 'constructor', title: 'CERTIFIED-BY-THE-RECORD', twin: true, rows: [['Certificate', 'CERTIFIED-BY-THE-RECORD']] })),
    'has __proto__ for a phase': '{"phase":"__proto__","at":"2026-09-30T08:00:00Z"}',
    'has no date': JSON.stringify(packed({ at: undefined })),
    'has a date that is not one': JSON.stringify(packed({ at: 'the day before yesterday' })),
    'has a date that is a number': JSON.stringify(packed({ at: 1759400000 })),
    'has a product that is a number': JSON.stringify({ phase: 'cycle', at: '2026-09-29T08:00:00Z', product: 5 }),
    'has loads that are text': JSON.stringify({ phase: 'cycle', at: '2026-09-29T08:00:00Z', loads: 'twenty kilos' }),
    'has a farm that is null': JSON.stringify({ phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'mango', farms: [null] }),
    'has an origin that is null': JSON.stringify({ phase: 'transport', at: '2026-10-01T08:00:00Z', origin: null }),
    'has a field that cannot be written as text': JSON.stringify(packed({ lot: { toString: 1 } })),
    'has inputs that are text': JSON.stringify(packed({ inputs: 'the cycle' }))
}
for (const [what, text] of Object.entries(odd))
    test(`a record that ${what}: its own card, checked, and the page goes on`, async () => {
        const file = new TextEncoder().encode(text)
        net.head = swarmHash(file)
        net.files.set(net.head, file)
        net.anchors.set(net.head, [1759400000n, 7n])
        await scan()
        assert.equal($('notice').hidden, true)
        assert.equal(cards().length, 1)
        assert.equal(cards()[0].querySelector('h2').textContent, 'Record not understood')
        assert.equal(cards()[0].querySelectorAll('.row, .twin-born').length, 0)
        assert.equal(cards()[0].querySelector('pre').textContent, text)
        assert.match(cards()[0].querySelector('.check').textContent, /^✓ Matches its Ethereum anchor of /)
        assert.equal($('step-3').querySelector('.v').textContent, '1 of 1 match')
        assert.equal($('fruit-name').textContent, 'This bag')
        assert.equal($('co2').hidden, true)
        clean(document)
    })

test('a record the page does not understand, in the middle of the path: what came before it is still read', async () => {
    const intake = put({ phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'mango', kg: 20, sourcing: 'rescued' })
    const cycle = put({ phase: 'cycle', at: '2026-09-29T08:00:00Z', start: '2026-09-28T10:00:00Z', end: '2026-09-29T08:00:00Z', loads: [{ trays: 10, kg: 20 }], kg_out: 2, inputs: [intake] })
    const recall = put({ phase: 'recall', at: '2026-09-29T12:00:00Z', inputs: [cycle] })
    net.head = put(packed({ inputs: [recall] }))
    await scan()
    assert.deepEqual(cards().map((li) => li.querySelector('h2').textContent), ['Record not understood', 'Received', 'Freeze-dried', 'Packed'])
    assert.equal($('step-3').querySelector('.v').textContent, '4 of 4 matches')
    assert.ok($('hero').classList.contains('verified'))
    assert.equal($('fruit-name').textContent, 'Mango')
    assert.equal($('fruit-grams').textContent, '30 g per bag')
    assert.equal($('co2').hidden, false)
    clean(document)
})

// ---------- who holds the twin, and whose contract it is ----------
// An RPC that fails says nothing about the twin or about the contract: the page may not turn its silence into a statement.
const holder = '0x1111111111111111111111111111111111111111'
const stranger = '0x2222222222222222222222222222222222222222'
const fails = () => {
    throw new Response('too many requests', { status: 429 })
}

test('a twin the contract says is not created yet: the page says so', async () => {
    net.head = put(packed())
    await scan()
    assert.equal($('twin').hidden, false)
    assert.match($('twin').textContent, /Not created yet/)
})

test('a twin that has a holder: its address', async (t) => {
    t.mock.method(console, 'error', () => {}) // the RPC of the test knows no names, and the page logs that
    net.head = put(packed())
    net.owner = holder
    await scan()
    assert.match($('twin').textContent, /Twin held by 0x1111…1111/)
})

test('an RPC that fails when asked who holds the twin: the page does not say the twin was never created', async (t) => {
    t.mock.method(console, 'error', () => {})
    net.head = put(packed())
    net.owner = fails
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    assert.equal($('twin').hidden, true)
    assert.equal($('twin').textContent, '')
})

test('an RPC that answers with a lookup to make somewhere else: the page asks no one else', async (t) => {
    t.mock.method(console, 'error', () => {})
    net.head = put(packed())
    net.owner = () => {
        throw revert(encodeErrorResult({ abi: others, errorName: 'OffchainLookup', args: [contract, ['https://elsewhere.example/{sender}/{data}'], '0x', '0x12345678', '0x'] }))
    }
    await scan()
    assert.deepEqual(net.asked.filter((url) => !rpcs.includes(new URL(url).origin) && !url.includes('/bytes/')), [])
    assert.ok($('hero').classList.contains('verified'))
    assert.equal($('twin').hidden, true)
})

test('a contract the page does not list: nothing of it is shown', async (t) => {
    t.mock.method(console, 'error', () => {})
    net.head = put(packed())
    await scan(`11155111:${stranger}/1`)
    assert.match($('notice').textContent, /This is not a Fair Food Data bag/)
    assert.equal(document.getElementById('retry'), null)
    assert.equal(cards().length, 0)
})

test('on mainnet, a contract that fairfooddata.eth does not name: not a Fair Food Data bag', async (t) => {
    t.mock.method(console, 'error', () => {})
    net.chain = '0x1'
    net.ens = () => {
        throw revert(encodeErrorResult({ abi: others, errorName: 'ResolverNotFound', args: ['0x'] }))
    }
    await scan(`1:${stranger}/1`)
    assert.match($('notice').textContent, /This is not a Fair Food Data bag/)
    assert.equal(document.getElementById('retry'), null)
})

test('on mainnet, an RPC that fails when asked what fairfooddata.eth names: that is the network, and the page offers to try again', async (t) => {
    t.mock.method(console, 'error', () => {})
    net.chain = '0x1'
    net.ens = fails
    await scan(`1:${stranger}/1`)
    assert.match($('notice').textContent, /We couldn’t reach the records right now/)
    assert.equal($('notice').textContent.includes('not a Fair Food Data bag'), false)
    assert.ok(document.getElementById('retry'))
})

test('another bag in the link: the page is loaded again, not left under the seal of the bag before', async () => {
    net.head = put(packed())
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    const before = loads.length
    location.hash = `#11155111:${contract}/2`
    await new Promise((turn) => setImmediate(turn))
    assert.equal(loads.length, before + 1)
    assert.match(loads.at(-1), /navigation/)
})

// ---------- where Ethereum is read from ----------
// What is anchored is the word of a source, and a source that lied could seal anything. So the page reads with the first
// that answers and asks the next whether it says the same. The plate closes on the first; what the second said is kept on
// the plate (`data-sources`) and is not in sight yet.
const [rpc1, rpc2] = rpcs
const plate = () => ({ sealed: $('hero').classList.contains('verified'), open: $('proof-fold').classList.contains('open'), sources: $('hero').dataset.sources })
const callsTo = (url) => net.calls.filter((call) => call.startsWith(`${new URL(url).host} `)).map((call) => call.split(' ')[1])

test('two sources that say the same: the plate closes, and keeps that they agree', async () => {
    net.head = put(packed())
    await scan()
    assert.deepEqual(plate(), { sealed: true, open: true, sources: 'agree' })
    assert.deepEqual(callsTo(rpc1).slice(0, 3), ['eth_chainId', 'eth_call', 'eth_call'])
    // the second is asked which record the bag has and whether each record has its anchor, and nothing else
    assert.deepEqual(callsTo(rpc2), ['eth_chainId', 'eth_call', 'eth_call'])
})

test('a second source that does not answer: the plate closes on one, and keeps that it was one', async (t) => {
    t.mock.method(console, 'error', () => {}) // the page logs the source that failed
    net.head = put(packed())
    net.says.set(rpc2, fails)
    await scan()
    assert.deepEqual(plate(), { sealed: true, open: true, sources: 'single' })
    assert.match(cards()[0].querySelector('.check').textContent, /^✓ Matches its Ethereum anchor of /)
    assert.equal($('notice').hidden, true)
})

test('a first source that does not answer: the page reads with the second, which is then the only one', async () => {
    net.head = put(packed())
    net.says.set(rpc1, fails)
    await scan()
    assert.deepEqual(plate(), { sealed: true, open: true, sources: 'single' })
    assert.equal(cards()[0].querySelector('h2').textContent, 'Packed')
})

for (const [what, lie] of [
    ['names another record for the bag', (method, params) => (method === 'eth_call' && params[0].data.startsWith('0x55d742e4') ? `0x${'ab'.repeat(32)}` : rpc(method, params))],
    ['says a record has no anchor', (method, params) => (method === 'eth_call' && !params[0].data.startsWith('0x55d742e4') ? encodeFunctionResult({ abi, functionName: 'anchoredAt', result: [0n, 0n] }) : rpc(method, params))],
    ['gives a record another anchor', (method, params) => (method === 'eth_call' && !params[0].data.startsWith('0x55d742e4') ? encodeFunctionResult({ abi, functionName: 'anchoredAt', result: [1759400001n, 7n] }) : rpc(method, params))]
])
    test(`a second source that ${what}: nothing in sight changes yet, and the plate keeps that they differ`, async () => {
        net.head = put(packed())
        net.says.set(rpc2, lie)
        await scan()
        assert.deepEqual(plate(), { sealed: true, open: true, sources: 'differ' })
        assert.equal($('notice').hidden, true)
        assert.equal(cards()[0].querySelector('h2').textContent, 'Packed')
    })

// A wallet in the browser is the visitor's own way to the chain. It is asked to read, and nothing else.
function wallet(chain = '0xaa36a7') {
    const asked = []
    window.ethereum = {
        request: async ({ method, params }) => {
            asked.push(method)
            return method === 'eth_chainId' ? chain : rpc(method, params)
        }
    }
    return asked
}

test('a wallet on the network of the link: the page reads through it, and the first RPC is the second opinion', async (t) => {
    t.mock.method(console, 'error', () => {}) // the wallet of the test knows no names, and the page logs that
    net.head = put(packed())
    net.owner = holder
    const asked = wallet()
    await scan()
    assert.equal(plate().sealed, true)
    assert.match($('twin').textContent, /Twin held by 0x1111…1111/)
    // reads only: no account, no signature, no change of network
    assert.deepEqual([...new Set(asked)].sort(), ['eth_call', 'eth_chainId', 'eth_getLogs'])
    assert.deepEqual(callsTo(rpc1), ['eth_chainId', 'eth_call', 'eth_call'])
    assert.deepEqual(callsTo(rpc2), [])
})

test('a wallet on another network: it is passed over, and never asked to change', async () => {
    net.head = put(packed())
    const asked = wallet('0x1')
    await scan()
    assert.equal(plate().sealed, true)
    assert.deepEqual(asked, ['eth_chainId'])
    assert.deepEqual(callsTo(rpc2), ['eth_chainId', 'eth_call', 'eth_call'])
})

test('a wallet that does not answer: the page reads with the RPCs', async () => {
    net.head = put(packed())
    window.ethereum = { request: async () => { throw Object.assign(Error('the provider is disconnected'), { code: 4900 }) } }
    await scan()
    assert.equal(plate().sealed, true)
    assert.deepEqual(callsTo(rpc2), ['eth_chainId', 'eth_call', 'eth_call'])
})

test('a link to a network the page has no RPC for: a wallet that is on it is not asked', async (t) => {
    t.mock.method(console, 'error', () => {})
    const asked = wallet('0x89')
    await scan(`137:${contract}/1`)
    assert.match($('notice').textContent, /We couldn’t reach the records right now/)
    assert.match($('notice').textContent, /no RPC for chain 137/)
    assert.deepEqual(asked, [])
    assert.deepEqual(net.calls, [])
})
