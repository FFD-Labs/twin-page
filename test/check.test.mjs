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
// the chain the stamps live on, Gnosis, with two RPCs of its own, and the records' storage as the configuration gives it
const gnosisRpcs = ['https://gnosis.example', 'https://other-gnosis.example']
const storage = { until: '2027-01-27', chain: 100, contract: '0x45a1502382541Cd610CC9068e88727426b696293', block_s: 5, stamp_page: 'https://stamptime.example/?id={stamp}' }
const config = {
    rpcs: { 11155111: rpcs, 1: rpcs, 100: gnosisRpcs },
    contract,
    gateways: ['https://gateway.example', 'https://second.example'],
    storage,
    co2: { factor_kg_per_kg: 0.6, scenario: 'an open dump', scenario_written: '2026-10-04' }
}

// ---------- the network: two RPCs and two gateways ----------
// Both gateways serve the files, unless a test says what one of them does instead (`net.instead`, by its address). Both
// RPCs say the same, they are on Sepolia and the twin is not created yet, unless a test says otherwise: `net.chain`,
// `net.owner` (an address, or a function that answers in its place), `net.ens` (what an RPC does when it is asked for a
// name) and `net.says` (what one RPC answers in place of the other's answer, by its address). The RPCs of Gnosis answer
// for the stamp (`net.stamp`, below).
const net = { head: null, anchors: new Map(), files: new Map(), asked: [], calls: [], instead: new Map(), says: new Map(), chain: '0xaa36a7', owner: null, ens: null, stamp: { chain: '0x64', remaining: 0n, price: 0n, asked: [] } }
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
// What the chain the stamps live on says, through either of its RPCs: its network (`net.stamp.chain`), what is left on
// the batch it is asked about, per chunk (`net.stamp.remaining`; null for a batch the contract has forgotten, which it
// refuses to answer for), and the price of a chunk per block (`net.stamp.price`). The batches asked about are kept.
const stampAbi = parseAbi(['function remainingBalance(bytes32 batchId) view returns (uint256)', 'function lastPrice() view returns (uint64)'])
function stampRpc(method, [call] = []) {
    if (method === 'eth_chainId') return net.stamp.chain
    if (method === 'eth_call' && call.to.toLowerCase() === storage.contract.toLowerCase()) {
        const { functionName, args } = decodeFunctionData({ abi: stampAbi, data: call.data })
        if (functionName === 'lastPrice') return encodeFunctionResult({ abi: stampAbi, functionName, result: net.stamp.price })
        net.stamp.asked.push(args[0])
        if (net.stamp.remaining === null) throw revert()
        return encodeFunctionResult({ abi: stampAbi, functionName, result: net.stamp.remaining })
    }
    throw revert()
}
globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = request.url
    const origin = new URL(url).origin
    net.asked.push(url)
    if (rpcs.includes(origin) || gnosisRpcs.includes(origin)) {
        const { id, method, params } = await request.json()
        net.calls.push(`${new URL(url).host} ${method}`)
        try {
            const says = net.says.get(origin)
            // a test may answer with a promise, to hold the answer back
            const result = await (says ? says(method, params) : gnosisRpcs.includes(origin) ? stampRpc(method, params) : rpc(method, params))
            return answer(JSON.stringify({ jsonrpc: '2.0', id, result }), 'application/json')
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
    Object.assign(net.stamp, { chain: '0x64', remaining: REMAINING, price: PRICE })
    net.stamp.asked.length = 0
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

// ---------- the files of the product: what a packing record names among its documents ----------
// A file of the product is on Swarm under its own reference, like a record, and has no anchor of its own: its reference
// is in a record that has one. The page reads it the way it reads a record, the bytes hashed before they are used.

// The page tries an image before it shows it, and holds it under an address of its own making. Here an image is one when
// its bytes begin as a WebP file does, which stands for a picture a browser can draw; the bytes behind each address are
// kept, to tell, with the type the page gave them and whether it let the address go. A picture is 720 px a side, unless
// its bytes say it is one too large to hold (`webp(mark, size, true)`). One whose mark a test puts in `undrawn` never
// loads, nor fails: the page stops waiting for it when it has waited long enough.
const pictures = new Map()
const made = []
const letGo = new Set()
const undrawn = new Set()
const createObjectURL = URL.createObjectURL.bind(URL)
const revokeObjectURL = URL.revokeObjectURL.bind(URL)
URL.createObjectURL = (blob) => {
    const url = createObjectURL(blob)
    pictures.set(url, blob.first)
    made.push({ url, type: blob.type })
    return url
}
URL.revokeObjectURL = (url) => {
    letGo.add(url)
    revokeObjectURL(url)
}
beforeEach(() => {
    made.length = 0
    letGo.clear()
    undrawn.clear()
})
const NodeBlob = globalThis.Blob
globalThis.Blob = class extends NodeBlob {
    constructor(parts, options) {
        super(parts, options)
        this.first = parts[0]
    }
}
const ascii = (file, from, to) => String.fromCharCode(...file.subarray(from, to))
globalThis.Image = class {
    set src(url) {
        const file = pictures.get(url)
        const drawn = file && ascii(file, 0, 4) === 'RIFF' && ascii(file, 8, 12) === 'WEBP'
        this.naturalWidth = this.naturalHeight = drawn && file[21] ? 20000 : 720
        if (drawn && undrawn.has(file[20])) return
        queueMicrotask(() => (drawn ? this.onload?.() : this.onerror?.()))
    }
}

// a file on Swarm under its reference, and what a record says of it
function file(name, type, content) {
    const ref = swarmHash(content)
    net.files.set(ref, content)
    return { name, type, ref: ref.slice(2) }
}
const webp = (mark, size = 64, huge = false) => {
    const content = new Uint8Array(size)
    content.set(new TextEncoder().encode('RIFF'), 0)
    content.set(new TextEncoder().encode('WEBPVP8 '), 8)
    content[20] = mark
    content[21] = huge ? 1 : 0
    return content
}
const pineapple = {
    schema: 'ffd/product-description/1.0',
    fruit: 'pineapple',
    name: 'Golden pineapple',
    nutrition: { energy_kcal: 350, carbohydrate_g: 90, sugars_g: 68, protein_g: 3.5, fat_g: 1, fibre_g: 10, micro: [['Vitamin C', 180, 'mg']], source: 'a public table' },
    photo: { alt: 'A pineapple cut in half', credit: 'A photographer' }
}
const description = (value = pineapple) => file('product-description.json', 'application/json', bytes(value))
const photo = (content = webp(1)) => file('photo.webp', 'image/webp', content)
const cover = (content = webp(2)) => file('cover.webp', 'image/webp', content)
const background = (content = webp(3)) => file('background.webp', 'image/webp', content)
// a bag of pineapple, 10 g, whose packing record names these documents
function bag(documents) {
    const intake = put({ phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'pineapple', kg: 20, sourcing: 'rescued' })
    const cycle = put({ phase: 'cycle', at: '2026-09-29T08:00:00Z', start: '2026-09-28T10:00:00Z', end: '2026-09-29T08:00:00Z', loads: [{ trays: 10, kg: 20 }], kg_out: 2, inputs: [intake] })
    net.head = put({ phase: 'packing', at: '2026-09-30T08:00:00Z', product: 'dried pineapple', bag_g: 10, lot: 'L1', documents, inputs: [cycle] })
}
// what a gateway does in place of serving one file, by its reference: every other file it serves as it is
const but = (document, instead) => (request) => {
    const ref = `0x${request.url.split('/bytes/')[1]}`
    if (ref === `0x${document.ref}`) return instead(request)
    const content = net.files.get(ref)
    return content ? answer(content, 'application/octet-stream') : new Response('not found', { status: 404 })
}
const other = () => answer(bytes({ ...pineapple, name: 'SERVED-BY-THE-GATEWAY' }), 'application/octet-stream')
const askedFor = (document) => net.asked.filter((url) => url.endsWith(`/bytes/${document.ref}`)).length
const root = () => document.documentElement
const art = (side) => root().style.getPropertyValue(`--art-${side}`)
const label = () => $('fruit-contains').textContent

test('the files of the product: the name and the label from its description, and its three images, each read against its reference', async () => {
    const files = [description(), photo(), cover(), background()]
    bag(files)
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    assert.equal($('step-3').querySelector('.v').textContent, '3 of 3 matches')
    assert.equal($('fruit-name').textContent, 'Golden pineapple')
    assert.equal(root().dataset.way, 'pineapple')
    assert.equal($('fruit-grams').textContent, '10 g per bag')
    assert.equal($('fruit-contains').hidden, false)
    assert.match(label(), /Energy35 kcal/)
    assert.match(label(), /Sugars6\.8\sg/)
    assert.match($('fruit-origin').textContent, /Vitamin C18 mg180 mg/)
    assert.match($('fruit-origin').textContent, /Source: a public table\. Photograph: A photographer\./)
    assert.match($('fruit-photo').src, /^blob:/)
    assert.equal($('fruit-photo').alt, 'A pineapple cut in half')
    assert.equal($('fruit-photo').hidden, false)
    assert.equal($('stage').hidden, false)
    assert.match(art('front'), /^url\("blob:[^"]+"\)$/)
    assert.match(art('back'), /^url\("blob:[^"]+"\)$/)
    assert.equal(root().dataset.art, 'front back')
    for (const document of files) assert.equal(askedFor(document), 1)
    // each image is held as the type the page gives it, whatever its record says, and none is let go while it is on screen
    assert.deepEqual(made.map(({ type }) => type), ['image/webp', 'image/webp', 'image/webp'])
    assert.equal(letGo.size, 0)
    clean(document)
})

test('a bag whose packing record names no file: the fruit the records name, its grams, and nothing else', async () => {
    bag([])
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    assert.equal($('fruit-name').textContent, 'Pineapple')
    assert.equal(root().dataset.way, 'pineapple')
    assert.equal($('fruit-grams').textContent, '10 g per bag')
    assert.equal($('fruit-contains').hidden, true)
    assert.equal($('stage').hidden, true)
    assert.equal(art('front'), '')
    assert.equal(root().dataset.art, undefined)
    assert.equal(net.asked.filter((url) => url.includes('/bytes/')).length, 3) // the three records, and no file
})

test('a first gateway that serves other bytes for a file, and a second that has it: it is read from the second', async () => {
    const files = [description(), cover()]
    bag(files)
    net.instead.set(first, but(files[0], other))
    await scan()
    assert.equal($('fruit-name').textContent, 'Golden pineapple')
    assert.match(label(), /Energy35 kcal/)
    assert.equal(root().dataset.art, 'front')
    assert.equal(document.documentElement.outerHTML.includes('SERVED-BY-THE-GATEWAY'), false)
    clean(document)
})

test('a description no gateway serves as its reference names it: it is not read, and the label says the grams', async () => {
    const files = [description(), photo(), cover()]
    bag(files)
    for (const gateway of [first, second]) net.instead.set(gateway, but(files[0], other))
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    assert.equal($('fruit-name').textContent, 'Pineapple')
    assert.equal($('fruit-grams').textContent, '10 g per bag')
    assert.equal($('fruit-contains').hidden, true)
    assert.equal($('fruit-origin').innerHTML, '')
    assert.equal(document.documentElement.outerHTML.includes('SERVED-BY-THE-GATEWAY'), false)
    // the images do not depend on it: each is read against its own reference, and the photograph takes the name for its text
    assert.match($('fruit-photo').src, /^blob:/)
    assert.equal($('fruit-photo').alt, 'Pineapple')
    assert.equal(root().dataset.art, 'front')
    clean(document)
})

test('an image no gateway serves as its reference names it: its place stays as it was, and the others come', async () => {
    const files = [description(), photo(), cover(), background()]
    bag(files)
    for (const gateway of [first, second]) net.instead.set(gateway, but(files[2], () => answer(webp(9), 'application/octet-stream')))
    await scan()
    assert.equal(art('front'), '')
    assert.match(art('back'), /^url\("blob:/)
    assert.equal(root().dataset.art, 'back')
    assert.match($('fruit-photo').src, /^blob:/)
    assert.deepEqual([askedFor(files[2]), askedFor(files[3])], [2, 1])
})

test('a file no gateway has, or one heavier than the page takes: it is not shown, and the page is the same without it', async () => {
    for (const instead of [down, () => answer(webp(1, 1024 * 1024 + 1), 'application/octet-stream')]) {
        const files = [description(), photo(), cover()]
        bag(files)
        for (const gateway of [first, second]) net.instead.set(gateway, but(files[1], instead))
        await scan()
        assert.ok($('hero').classList.contains('verified'))
        assert.equal($('fruit-name').textContent, 'Golden pineapple')
        assert.equal($('stage').hidden, true)
        assert.equal($('fruit-photo').hasAttribute('src'), false)
        assert.equal(root().dataset.art, 'front')
        // the credit of a photograph that is not shown is not given
        assert.equal($('fruit-origin').textContent.includes('Photograph'), false)
    }
})

test('bytes that are what their reference names and are not an image, or are one too large to hold: nothing is shown in their place', async () => {
    const files = [photo(bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="globalThis.ran=1"/>')), cover(new Uint8Array(0)), background(webp(3, 64, true))]
    bag(files)
    await scan()
    assert.equal($('stage').hidden, true)
    assert.equal($('fruit-photo').hasAttribute('src'), false)
    assert.equal(art('front'), '')
    assert.equal(art('back'), '')
    assert.equal(root().dataset.art, undefined)
    // each was tried as an image of the page's own type, never as what its bytes are, and its address was let go
    assert.deepEqual(made.map(({ type }) => type), ['image/webp', 'image/webp', 'image/webp'])
    for (const { url } of made) assert.ok(letGo.has(url))
    clean(document)
})

test('a description whose values are HTML: it is read, and its values stay text', async () => {
    const loud = { ...pineapple, name: hostile('name'), nutrition: { ...pineapple.nutrition, micro: [[hostile('micro'), 1, hostile('unit')]], source: hostile('source') }, photo: { alt: hostile('alt'), credit: hostile('credit') } }
    bag([description(loud), photo()])
    await scan()
    clean(document)
    assert.equal($('fruit-name').textContent, hostile('name'))
    assert.equal($('fruit-photo').alt, hostile('alt'))
    for (const via of ['micro', 'unit', 'source', 'credit']) assert.ok($('fruit-origin').textContent.includes(hostile(via)), via)
})

for (const [what, content] of [
    ['is not JSON', bytes('{"schema": ').slice(1, -1)],
    ['is of a kind the page does not know', bytes({ ...pineapple, schema: 'ffd/product-description/2.0' })],
    ['has a table whose figures are text', bytes({ ...pineapple, name: undefined, nutrition: { ...pineapple.nutrition, energy_kcal: '350' } })]
])
    test(`a description that ${what}: the fruit the records name, and no table`, async () => {
        bag([file('product-description.json', 'application/json', content)])
        await scan()
        assert.ok($('hero').classList.contains('verified'))
        assert.equal($('fruit-name').textContent, 'Pineapple')
        assert.equal($('fruit-grams').textContent, '10 g per bag')
        assert.equal($('fruit-contains').hidden, true)
        clean(document)
    })

test('a document that is not a file of the product is not asked for', async () => {
    const sheet = file('sheet.pdf', 'application/pdf', bytes('%PDF-1.4'))
    const png = { ...photo(), type: 'image/png' }
    const twice = cover(webp(7))
    const files = [sheet, png, { name: 'cover.webp', type: 'image/webp', ref: hostile('ref') }, cover(), twice, { ...background(), name: 'Background.webp' }]
    bag(files)
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    assert.deepEqual(files.map((document) => (typeof document.ref === 'string' && /^[0-9a-f]{64}$/.test(document.ref) ? askedFor(document) : 0)), [0, 0, 0, 1, 0, 0])
    assert.equal(root().dataset.art, 'front')
    assert.equal($('stage').hidden, true)
    clean(document)
})

test('the files of a record that did not pass the check are not asked for', async () => {
    const files = [description(), photo()]
    net.head = put({ phase: 'packing', at: '2026-09-30T08:00:00Z', product: 'dried pineapple', bag_g: 10, lot: 'L1', documents: files })
    net.anchors.clear()
    await scan()
    assert.match(cards()[0].textContent, /Record not shown/)
    assert.deepEqual(files.map(askedFor), [0, 0])
    assert.equal($('fruit-name').textContent, 'This bag')
})

test('another bag after one with its art: nothing of the first is left on the page', async () => {
    bag([description(), photo(), cover(), background()])
    await scan()
    assert.equal(root().dataset.art, 'front back')
    const before = made.map(({ url }) => url)
    net.head = put(packed())
    await scan()
    assert.equal(before.length, 3)
    for (const url of before) assert.ok(letGo.has(url))
    assert.equal($('fruit-name').textContent, 'Mango')
    assert.equal(root().dataset.way, 'jackfruit')
    assert.equal(root().dataset.art, undefined)
    assert.equal(art('front'), '')
    assert.equal(art('back'), '')
    assert.equal($('fruit-photo').hasAttribute('src'), false)
    assert.equal($('fruit-photo').alt, '')
    assert.equal($('fruit-contains').hidden, true)
})

// ---------- a file that is slow to come ----------
// the scan, a few turns at a time: for a look at the page while a file is still on its way
async function turns(count = 60) {
    for (let i = 0; i < count; i++) {
        mock.timers.runAll()
        await new Promise((turn) => setImmediate(turn))
    }
}
// a gateway that holds one file back until the test lets it through
function slow(document) {
    let open
    const gate = new Promise((resolve) => (open = resolve))
    const held = but(document, async () => {
        await gate
        return answer(net.files.get(`0x${document.ref}`), 'application/octet-stream')
    })
    for (const gateway of [first, second]) net.instead.set(gateway, held)
    return open
}

test('a description that is slow to come: the seal does not wait for it, nor the art, and the label keeps its place until it has come', async () => {
    const files = [description(), cover(), photo()]
    bag(files)
    const open = slow(files[0])
    location.hash = `#11155111:${contract}/1`
    let done = false
    const scanning = page.main().finally(() => (done = true))
    await turns()
    assert.equal(done, false)
    assert.ok($('hero').classList.contains('verified'))
    assert.ok($('proof-fold').classList.contains('open'))
    assert.equal($('co2').hidden, false)
    assert.equal($('fruit-name').textContent, 'Pineapple')
    assert.equal($('fruit-grams').textContent, '10 g per bag')
    assert.equal($('fruit-contains').hidden, false)
    assert.ok($('fruit-contains').classList.contains('skel-host'))
    assert.equal(root().dataset.art, 'front')
    // the photograph waits for it: the description gives it its text
    assert.equal($('fruit-photo').hasAttribute('src'), false)
    open()
    await turns()
    await scanning
    assert.equal($('fruit-name').textContent, 'Golden pineapple')
    assert.match(label(), /Energy35 kcal/)
    assert.equal($('fruit-contains').classList.contains('skel-host'), false)
    assert.equal($('fruit-photo').alt, 'A pineapple cut in half')
    clean(document)
})

test('a fruit the page has no pouch for, and a description that is slow to come: the label keeps its place, and then says what the description says', async () => {
    const durian = { ...pineapple, fruit: 'durian', name: 'Durian' }
    const files = [description(durian)]
    const intake = put({ phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'durian', kg: 20 })
    net.head = put({ phase: 'packing', at: '2026-09-30T08:00:00Z', product: 'dried durian', bag_g: 10, lot: 'L1', documents: files, inputs: [intake] })
    const open = slow(files[0])
    location.hash = `#11155111:${contract}/1`
    const scanning = page.main()
    await turns()
    assert.ok($('hero').classList.contains('verified'))
    assert.equal($('fruit-name').textContent, 'Dried durian')
    assert.equal($('fruit-contains').hidden, false)
    assert.ok($('fruit-contains').classList.contains('skel-host'))
    open()
    await turns()
    await scanning
    assert.equal($('fruit-name').textContent, 'Durian')
    assert.equal(root().dataset.way, undefined)
    assert.equal($('fruit-grams').textContent, '10 g per bag')
    assert.match(label(), /Energy35 kcal/)
})

test('another bag while the files of the first are still on their way: nothing of the first reaches the page', async () => {
    const files = [description(), cover(), photo()]
    bag(files)
    const open = slow(files[0])
    location.hash = `#11155111:${contract}/1`
    const scanning = page.main()
    await turns()
    assert.equal(root().dataset.art, 'front')
    const before = made.map(({ url }) => url)
    net.instead.clear()
    net.head = put(packed())
    await scan()
    open()
    await turns()
    await scanning
    assert.equal($('fruit-name').textContent, 'Mango')
    assert.equal(root().dataset.way, 'jackfruit')
    assert.equal(root().dataset.art, undefined)
    assert.equal(art('front'), '')
    assert.equal($('fruit-photo').hasAttribute('src'), false)
    assert.equal($('fruit-contains').hidden, true)
    assert.equal(before.length, 2) // the cover, on screen, and the photograph, held until the description comes
    for (const url of before) assert.ok(letGo.has(url))
})

// ---------- the images in turn: the photograph, then the cover, then the background ----------
// Each image is asked for once the one before it is in, or four seconds after it was asked for. The scan runs every timer
// at once, which would let those four seconds pass at once: here it runs until the page asks for the image the test holds
// back, and the test then moves the clock itself.
async function until(document) {
    location.hash = `#11155111:${contract}/1`
    let done = false
    const scanning = page.main().finally(() => (done = true))
    while (!askedFor(document) && !done) {
        mock.timers.runAll()
        await new Promise((turn) => setImmediate(turn))
    }
    return scanning
}
// a few turns with the clock stopped
async function still(count = 20) {
    for (let i = 0; i < count; i++) await new Promise((turn) => setImmediate(turn))
}
const firstAsked = (document) => net.asked.findIndex((url) => url.endsWith(`/bytes/${document.ref}`))

test('a photograph that is slow to come: no art is asked for until it is in, or until four seconds have passed', async () => {
    // it comes before the four seconds: the cover is asked for when it does, and then the background
    let files = [description(), photo(), cover(), background()]
    bag(files)
    let open = slow(files[1])
    let scanning = until(files[1])
    await still()
    mock.timers.tick(3999)
    await still()
    assert.deepEqual([askedFor(files[2]), askedFor(files[3])], [0, 0])
    open()
    await still()
    assert.deepEqual([askedFor(files[2]), askedFor(files[3])], [1, 1])
    await turns()
    await scanning
    assert.match($('fruit-photo').src, /^blob:/)
    assert.equal(root().dataset.art, 'front back')
    // it does not come in four seconds: the art is asked for then, and shown, and the photograph when it comes
    net.instead.clear()
    files = [description(), photo(webp(4)), cover(webp(5)), background(webp(6))]
    bag(files)
    open = slow(files[1])
    scanning = until(files[1])
    await still()
    mock.timers.tick(3999)
    await still()
    assert.deepEqual([askedFor(files[2]), askedFor(files[3])], [0, 0])
    mock.timers.tick(1)
    await still()
    assert.deepEqual([askedFor(files[2]), askedFor(files[3])], [1, 1])
    assert.equal(root().dataset.art, 'front back')
    assert.equal($('fruit-photo').hasAttribute('src'), false)
    open()
    await turns()
    await scanning
    assert.match($('fruit-photo').src, /^blob:/)
    assert.equal($('fruit-photo').alt, 'A pineapple cut in half')
    assert.equal($('stage').hidden, false)
    clean(document)
})

test('a cover that is slow to come: the background is asked for four seconds after it, and shown, and the cover when it comes', async () => {
    // its bytes are in and it is slow to be drawn: the background is asked for at once, and does not wait for it
    let files = [description(), photo(), cover(webp(8)), background()]
    undrawn.add(8)
    bag(files)
    let scanning = until(files[2])
    await still()
    assert.equal(askedFor(files[3]), 1)
    assert.equal(root().dataset.art, 'back')
    await turns()
    await scanning
    assert.equal(art('front'), '')
    assert.equal(root().dataset.art, 'back')
    // its bytes are slow to come
    net.instead.clear()
    net.asked.length = 0
    made.length = 0
    files = [description(), photo(), cover(), background()]
    bag(files)
    const open = slow(files[2])
    scanning = until(files[2])
    await still()
    // the photograph was in before the cover was asked for
    assert.match($('fruit-photo').src, /^blob:/)
    mock.timers.tick(3999)
    await still()
    assert.equal(askedFor(files[3]), 0)
    mock.timers.tick(1)
    await still()
    assert.equal(askedFor(files[3]), 1)
    assert.equal(root().dataset.art, 'back')
    assert.equal(art('front'), '')
    open()
    await turns()
    await scanning
    assert.equal(root().dataset.art, 'front back')
    assert.match(art('front'), /^url\("blob:[^"]+"\)$/)
    // none of the three is let go while it is on screen
    assert.equal(made.length, 3)
    for (const { url } of made) assert.equal(letGo.has(url), false)
})

test('another bag while the photograph of the first is on its way: the art of the first is never asked for', async () => {
    const files = [description(), photo(), cover(), background()]
    bag(files)
    const open = slow(files[1])
    const scanning = until(files[1])
    await still()
    net.instead.clear()
    net.head = put(packed())
    await scan()
    open()
    await turns()
    await scanning
    assert.deepEqual([askedFor(files[2]), askedFor(files[3])], [0, 0])
    assert.equal(root().dataset.art, undefined)
    assert.equal($('fruit-photo').hasAttribute('src'), false)
    assert.equal(made.length, 0)
})

test('a description that is slow to come, or a photograph slow to decode: the art waits for neither', async () => {
    // the description held back: the photograph waits for it, and the art is asked for once the photograph is in
    let files = [description(), photo(), cover(), background()]
    bag(files)
    const open = slow(files[0])
    let scanning = until(files[1])
    await still()
    assert.deepEqual([askedFor(files[2]), askedFor(files[3])], [1, 1])
    assert.equal(root().dataset.art, 'front back')
    assert.equal($('fruit-photo').hasAttribute('src'), false)
    open()
    await turns()
    await scanning
    assert.match($('fruit-photo').src, /^blob:/)
    // the pixels of the photograph slow to decode: the art does not wait for them
    const { prototype } = window.HTMLImageElement
    let decoded
    prototype.decode = () => new Promise((resolve) => (decoded = resolve))
    try {
        net.instead.clear()
        net.asked.length = 0
        files = [description(), photo(webp(10)), cover(webp(11)), background(webp(12))]
        bag(files)
        scanning = until(files[1])
        await still()
        assert.ok(decoded)
        assert.equal($('fruit-photo').classList.contains('in'), false)
        assert.deepEqual([askedFor(files[2]), askedFor(files[3])], [1, 1])
        assert.equal(root().dataset.art, 'front back')
        decoded()
        await turns()
        await scanning
    } finally {
        delete prototype.decode
    }
})

test('another bag while the cover, or the pixels of the photograph, of the first are on their way: nothing more of the first is asked for or shown', async () => {
    // the cover held back: the background of the first is never asked for
    let files = [description(), photo(), cover(), background()]
    bag(files)
    const open = slow(files[2])
    let scanning = until(files[2])
    await still()
    net.instead.clear()
    net.head = put(packed())
    await scan()
    open()
    await turns()
    await scanning
    assert.equal(askedFor(files[3]), 0)
    assert.equal(root().dataset.art, undefined)
    // the photograph was held, and let go; the cover came once the bag had changed, and was not held at all
    assert.equal(made.length, 1)
    for (const { url } of made) assert.ok(letGo.has(url))
    // the pixels of the photograph still to decode: it does not fade in on the bag after
    const { prototype } = window.HTMLImageElement
    let decoded
    prototype.decode = () => new Promise((resolve) => (decoded = resolve))
    try {
        net.asked.length = 0
        files = [description(), photo(webp(13))]
        bag(files)
        scanning = until(files[1])
        await still()
        assert.ok(decoded)
        net.head = put(packed())
        await scan()
        decoded()
        await turns()
        await scanning
        assert.equal($('fruit-photo').hasAttribute('src'), false)
        assert.equal($('fruit-photo').classList.contains('in'), false)
    } finally {
        delete prototype.decode
    }
})

test('a photograph whose bytes are in and that is slow to be drawn: the cover waits for it, four seconds at most', async () => {
    const files = [description(), photo(webp(9)), cover(), background()]
    undrawn.add(9)
    bag(files)
    const scanning = until(files[1])
    await still()
    mock.timers.tick(3999)
    await still()
    assert.equal(askedFor(files[2]), 0)
    mock.timers.tick(1)
    await still()
    assert.equal(askedFor(files[2]), 1)
    await turns()
    await scanning
    // the browser never drew it: its place is given back, and its address let go
    assert.equal($('stage').hidden, true)
    assert.equal(root().dataset.art, 'front back')
    assert.equal(made.length, 3)
    assert.ok(letGo.has(made[0].url))
})

test('a photograph no gateway has: its place is given back, and the art is asked for after it, in turn, and comes', async () => {
    const files = [description(), photo(), cover(), background()]
    bag(files)
    for (const gateway of [first, second]) net.instead.set(gateway, but(files[1], down))
    await scan()
    assert.equal($('stage').hidden, true)
    assert.equal(root().dataset.art, 'front back')
    assert.deepEqual(files.slice(1).map(askedFor), [2, 1, 1])
    const photoLast = net.asked.findLastIndex((url) => url.endsWith(`/bytes/${files[1].ref}`))
    assert.ok(photoLast < firstAsked(files[2]) && firstAsked(files[2]) < firstAsked(files[3]))
})

test('a photograph whose pixels are slow to decode: it is in its place, and fades in once they are, once the browser gives up on them, or four seconds after', async () => {
    const { prototype } = window.HTMLImageElement
    let decoded
    prototype.decode = () => new Promise((resolve, reject) => (decoded = { resolve, reject }))
    try {
        for (const end of ['resolve', 'reject', 'never']) {
            decoded = null
            net.asked.length = 0
            const files = [description(), photo()]
            bag(files)
            const scanning = until(files[1])
            await still()
            assert.ok(decoded, end)
            assert.match($('fruit-photo').src, /^blob:/)
            assert.equal($('fruit-photo').hidden, false)
            assert.equal($('fruit-photo').classList.contains('in'), false)
            if (end === 'never') {
                // the browser draws nothing, as for a page in the background, and never says
                mock.timers.tick(3999)
                await still()
                assert.equal($('fruit-photo').classList.contains('in'), false)
                mock.timers.tick(1)
            } else decoded[end](Error('the browser could not decode it'))
            await still()
            assert.ok($('fruit-photo').classList.contains('in'), end)
            await turns()
            await scanning
        }
    } finally {
        delete prototype.decode
    }
})

test('a photograph with a credit and a description with no table: the credit is said under the label', async () => {
    const files = [description({ ...pineapple, nutrition: undefined }), photo()]
    bag(files)
    await scan()
    assert.equal($('fruit-contains').hidden, true)
    assert.match($('fruit-photo').src, /^blob:/)
    assert.equal($('fruit-origin').textContent, 'Photograph: A photographer.')
    clean(document)
})

test('a table with more rows than a label has room for: the page takes the first twelve', async () => {
    const micro = Array.from({ length: 40 }, (_, i) => [`Mineral ${i + 1}`, i, 'mg'])
    bag([description({ ...pineapple, nutrition: { ...pineapple.nutrition, micro } })])
    await scan()
    assert.equal($('fruit-origin').querySelectorAll('tbody tr').length, 6 + 12)
    assert.ok($('fruit-origin').textContent.includes('Mineral 12'))
    assert.equal($('fruit-origin').textContent.includes('Mineral 13'), false)
})

// ---------- the plant: the file the intake record names ----------
// Where the plant is comes from a file, as what the bag holds does: the intake record names `site-location.geojson` among
// its documents, and the page reads it against its reference once the records are checked. The Received card then says
// the place, with the flag of its country after it, from the code the file gives or the name the place ends with, and the
// coordinates, which are a link to OpenStreetMap, named after them and asked for nothing.
const india = { type: 'Feature', geometry: { type: 'Point', coordinates: [85.109112, 20.235281] }, properties: { site: 'urn:bdf:site:india-1', place: 'Dhodapalli, Odisha 752077, India' } }
const site = (value = india, name = 'site-location.geojson', type = 'application/geo+json') => file(name, type, bytes(value))
// a bag of banana whose intake record names these documents; the reference of that record is returned, for a test that
// takes its anchor away
function received(documents) {
    const intake = put({ phase: 'intake', at: '2026-09-25T08:00:00Z', fruit: 'banana', kg: 20, sourcing: 'rescued', documents })
    net.head = put(packed({ product: 'dried banana', inputs: [intake] }))
    return intake
}
const receivedCard = () => cards().find((li) => li.querySelector('h2').textContent === 'Received')
const rowsOf = (li) => [...li.querySelectorAll('.row')].map((row) => [row.querySelector('.k').textContent, row.querySelector('.v').textContent])
const asIs = ['Fruit', 'Weight', 'Sourcing']
const plant = { site: 'urn:bdf:site:india-1', place: 'Dhodapalli, Odisha 752077, India', country: null, lat: 20.235281, lon: 85.109112 }

test('the plant: the Received card says where it is, from the file the intake record names, and its coordinates are a link to OpenStreetMap', async () => {
    const files = [site()]
    received(files)
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    const card = receivedCard()
    assert.deepEqual(rowsOf(card), [['Fruit', 'Banana'], ['Weight', '20 kg'], ['Sourcing', 'Rescued surplus'], ['Site', 'Dhodapalli, Odisha 752077, India 🇮🇳'], ['GPS', '20.2353° N, 85.1091° E OpenStreetMap ↗']])
    // the link holds numbers the page wrote and nothing else, and opens beside the page
    const links = card.querySelectorAll('.row a')
    assert.equal(links.length, 1)
    assert.equal(links[0].getAttribute('href'), 'https://www.openstreetmap.org/?mlat=20.235281&mlon=85.109112#map=15/20.235281/85.109112')
    assert.equal(links[0].getAttribute('target'), '_blank')
    assert.equal(links[0].getAttribute('rel'), 'noopener')
    // the two rows come after the record's own and before the check; the raw record is the record, without them
    assert.equal(card.querySelector('.check').previousElementSibling.querySelector('.k').textContent, 'GPS')
    assert.equal(card.querySelector('pre').textContent.includes('Dhodapalli'), false)
    assert.equal(askedFor(files[0]), 1)
    assert.deepEqual(page.places.plant, plant)
    clean(document)
})

test('a location file whose words are HTML: they are written as text', async () => {
    received([site({ ...india, properties: { site: hostile('site'), place: hostile('place') } })])
    await scan()
    clean(document)
    assert.deepEqual(rowsOf(receivedCard()).slice(-2), [['Site', hostile('place')], ['GPS', '20.2353° N, 85.1091° E OpenStreetMap ↗']])
    assert.equal(page.places.plant.site, hostile('site'))
})

test('the flag of a country: after the country of the farm the record names by its code, and after the plant when its file gives one', async () => {
    const farms = [{ zone: 'Odisha', country: 'IN', kg: 20 }, { zone: 'Kerala', country: 'in', kg: 2 }, { zone: 'Elsewhere', country: 'XX', kg: 1 }, { country: 'IN', kg: 1 }]
    const intake = put({ phase: 'intake', at: '2026-09-25T08:00:00Z', fruit: 'banana', kg: 24, farms, documents: [site({ ...india, properties: { ...india.properties, country: 'IN' } })] })
    net.head = put(packed({ product: 'dried banana', inputs: [intake] }))
    await scan()
    const card = receivedCard()
    // a code of two capital letters that names a country has its flag, drawn by the emoji font; another is printed as it is
    assert.deepEqual(rowsOf(card).filter(([key]) => key === 'Origin').map(([, value]) => value), ['Odisha, India 🇮🇳 · 20 kg', 'Kerala, in · 2 kg', 'Elsewhere, XX · 1 kg', 'India 🇮🇳 · 1 kg'])
    assert.deepEqual(rowsOf(card).slice(-2), [['Site', 'Dhodapalli, Odisha 752077, India 🇮🇳'], ['GPS', '20.2353° N, 85.1091° E OpenStreetMap ↗']])
    assert.equal(page.places.plant.country, 'IN')
    // the small print under the coordinates names where they open, inside the link
    assert.equal(card.querySelector('.row a small').textContent, 'OpenStreetMap ↗')
    assert.equal(card.querySelector('.row a').textContent, '20.2353° N, 85.1091° E OpenStreetMap ↗')
})

test('the flag of the plant whose file gives no code: the country its place ends with, by name; a code in the file wins', async () => {
    const siteOf = async (properties) => {
        received([site({ ...india, properties })])
        await scan()
        return rowsOf(receivedCard()).find(([key]) => key === 'Site')[1]
    }
    // the words after the last comma, compared without case, against the names ICU gives the codes of today
    assert.equal(await siteOf({ place: 'Dhodapalli, Odisha 752077, India' }), 'Dhodapalli, Odisha 752077, India 🇮🇳')
    assert.equal(await siteOf({ place: 'Mumbai, india' }), 'Mumbai, india 🇮🇳')
    assert.equal(await siteOf({ place: 'India' }), 'India 🇮🇳')
    assert.equal(await siteOf({ place: 'London, United Kingdom' }), 'London, United Kingdom 🇬🇧')
    assert.equal(await siteOf({ place: 'Berlin, Germany' }), 'Berlin, Germany 🇩🇪')
    assert.equal(await siteOf({ place: 'Hanoi, Vietnam' }), 'Hanoi, Vietnam 🇻🇳')
    // words that are not exactly such a name give no flag
    for (const place of ['Somewhere, Narnia', 'Mumbai, Maharashtra', 'Jio World Centre', 'Delhi, India.', 'USA', 'Atlanta, Georgia, USA']) assert.equal(await siteOf({ place }), place)
    // the code of the file, when it gives one, says it all
    assert.equal(await siteOf({ place: 'Dhodapalli, Odisha 752077, India', country: 'XX' }), 'Dhodapalli, Odisha 752077, India')
    assert.equal(await siteOf({ place: 'Dhodapalli, Odisha 752077, India', country: 'ES' }), 'Dhodapalli, Odisha 752077, India 🇪🇸')
    assert.equal(page.places.plant.country, 'ES')
})

for (const [what, content] of [
    ['is not JSON', bytes('{"type": "Feature", ').slice(1, -1)],
    ['is not a Feature', bytes({ ...india, type: 'FeatureCollection' })],
    ['is not a Point', bytes({ ...india, geometry: { type: 'Polygon', coordinates: [[[85, 20], [86, 20], [86, 21], [85, 20]]] } })],
    ['is a Point beyond the ends of the Earth', bytes({ ...india, geometry: { type: 'Point', coordinates: [85.109112, 90.235281] } })],
    ['is a Point whose coordinates are text', bytes({ ...india, geometry: { type: 'Point', coordinates: ['85.109112', '20.235281'] } })]
])
    test(`a location file that ${what}: the card is as it was`, async () => {
        const files = [file('site-location.geojson', 'application/geo+json', content)]
        received(files)
        await scan()
        assert.ok($('hero').classList.contains('verified'))
        assert.equal(askedFor(files[0]), 1)
        assert.deepEqual(rowsOf(receivedCard()).map(([key]) => key), asIs)
        assert.equal(receivedCard().querySelector('.row a'), null)
        assert.equal(page.places.plant, null)
        clean(document)
    })

test('a location file no gateway serves as its reference names it: it is not read, and the card is as it was', async () => {
    const files = [site()]
    received(files)
    const elsewhere = () => answer(bytes({ ...india, properties: { ...india.properties, place: 'SERVED-BY-THE-GATEWAY' } }), 'application/octet-stream')
    for (const gateway of [first, second]) net.instead.set(gateway, but(files[0], elsewhere))
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    assert.deepEqual(rowsOf(receivedCard()).map(([key]) => key), asIs)
    assert.equal(document.documentElement.outerHTML.includes('SERVED-BY-THE-GATEWAY'), false)
    assert.equal(askedFor(files[0]), 2)
    assert.equal(page.places.plant, null)
})

test('a location file under another name or of another type is not asked for, nor one named by an intake record that did not pass the check', async () => {
    const elsewhere = { ...india, properties: { ...india.properties, place: 'Elsewhere' } }
    received([site(elsewhere, 'site.geojson'), site(india, 'site-location.geojson', 'application/json'), { name: 'site-location.geojson', type: 'application/geo+json', ref: hostile('ref') }])
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    assert.deepEqual(rowsOf(receivedCard()).map(([key]) => key), asIs)
    assert.equal(net.asked.filter((url) => url.includes('/bytes/')).length, 2) // the two records, and no file
    assert.equal(page.places.plant, null)
    clean(document)
    // an intake record with no anchor is not read, and names nothing
    net.asked.length = 0
    const files = [site()]
    net.anchors.delete(received(files))
    await scan()
    assert.match(cards()[0].textContent, /Record not shown/)
    assert.equal(askedFor(files[0]), 0)
    assert.equal(page.places.plant, null)
})

test('an intake record that names no file: the card as it has been, and no one is asked for anything', async () => {
    received(undefined)
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    assert.deepEqual(rowsOf(receivedCard()).map(([key]) => key), asIs)
    assert.equal(net.asked.filter((url) => url.includes('/bytes/')).length, 2)
    assert.equal(page.places.plant, null)
})

test('another bag after one with its plant: nothing of it is left', async () => {
    received([site()])
    await scan()
    assert.deepEqual(page.places.plant, plant)
    net.head = put(packed())
    await scan()
    assert.equal(page.places.plant, null)
    assert.equal(document.documentElement.outerHTML.includes('Dhodapalli'), false)
    assert.deepEqual(cards().map((li) => li.querySelector('h2').textContent), ['Packed'])
})

test('a location file that is slow to come: the seal does not wait for it, and the card gains its rows when it has come', async () => {
    const files = [site()]
    received(files)
    const open = slow(files[0])
    location.hash = `#11155111:${contract}/1`
    const scanning = page.main()
    await turns()
    assert.ok($('hero').classList.contains('verified'))
    assert.ok($('proof-fold').classList.contains('open'))
    assert.ok(receivedCard().classList.contains('open'))
    assert.deepEqual(rowsOf(receivedCard()).map(([key]) => key), asIs)
    assert.equal(page.places.plant, null)
    open()
    await turns()
    await scanning
    assert.deepEqual(rowsOf(receivedCard()).slice(-2).map(([key]) => key), ['Site', 'GPS'])
    assert.equal(receivedCard().querySelectorAll('.row.late').length, 2)
    assert.deepEqual(page.places.plant, plant)
    clean(document)
})

// ---------- the stamp: the day under the seal, and the link to the page where the stamp is looked up ----------
// The records are stored on Swarm under a stamp, a postage batch paid for by the block, and the bag's record names it
// (`stamp`). Once every record has matched, the page asks the chain the stamp lives on, through the RPCs the
// configuration lists for it and never through a wallet, how long it is paid for, and the day under the seal is the
// stamp's. The day written in the configuration goes up first, and stands when the chain does not answer, the stamp has
// run out, or the record names none. With a stamp, the line is a link to the page where it is looked up, by its id.
const stamp = '7ccec48d'.repeat(8)
const NOW = Date.parse('2026-10-28T12:00:00Z')
const PRICE = 24_000n
const REMAINING = PRICE * 1_036_800n // 60 days of blocks of 5 s, at that price: paid up to 27 December 2026
const [gnosis, otherGnosis] = gnosisRpcs
const stamptime = `https://stamptime.example/?id=${stamp}`
const line = () => ({ shown: !$('alive').hidden, until: $('alive-until').textContent, href: $('alive').getAttribute('href'), title: $('alive').getAttribute('title') })
const linked = { shown: true, until: '27 Dec 2026', href: stamptime, title: `Swarm stamp ${stamp}` }
const written = { shown: true, until: '27 Jan 2027', href: null, title: null }
// the stamp's chain holding its answers back until the test lets them through
function hold() {
    let open
    const gate = new Promise((resolve) => (open = resolve))
    net.says.set(gnosis, (method, params) => gate.then(() => stampRpc(method, params)))
    return open
}
// a scan with another storage in the configuration
async function stored(given) {
    const inline = $('config')
    const plain = inline.textContent
    inline.textContent = JSON.stringify({ ...config, storage: given })
    try {
        await scan()
    } finally {
        inline.textContent = plain
    }
}

test('the stamp of the bag’s record: the day it is paid up to, read from its chain, and the line a link to the page where it is looked up', async (t) => {
    t.mock.method(Date, 'now', () => NOW)
    net.head = put(packed({ stamp }))
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    assert.deepEqual(line(), linked)
    assert.equal($('alive').textContent, 'Stored until 27 Dec 2026')
    assert.equal($('alive').target, '_blank')
    assert.equal($('alive').rel, 'noopener')
    // the chain is asked its network, then what is left on that batch and the price, and nothing else; its second RPC is not asked
    assert.deepEqual(callsTo(gnosis), ['eth_chainId', 'eth_call', 'eth_call'])
    assert.deepEqual(callsTo(otherGnosis), [])
    assert.deepEqual(net.stamp.asked, [`0x${stamp}`])
    clean(document)
})

test('a record that names no stamp, or one only on a record before the head: the day of the configuration, no link, and the chain is not asked', async () => {
    const before = put({ phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'mango', kg: 20, stamp })
    for (const head of [put(packed()), put(packed({ inputs: [before] }))]) {
        net.calls.length = 0
        net.head = head
        await scan()
        assert.ok($('hero').classList.contains('verified'))
        assert.deepEqual(line(), written)
        assert.deepEqual(callsTo(gnosis), [])
    }
})

test('a stamp in any other form: the day of the configuration, no link, the chain is not asked, and nothing of it reaches the page', async () => {
    for (const other of [`0x${stamp}`, stamp.toUpperCase(), stamp.slice(2), `${stamp}00`, 7, null, [stamp], { stamp }, hostile('stamp')]) {
        net.calls.length = 0
        net.head = put(packed({ stamp: other }))
        await scan()
        assert.ok($('hero').classList.contains('verified'))
        assert.deepEqual(line(), written)
        assert.deepEqual(callsTo(gnosis), [])
    }
    clean(document)
    assert.equal(document.documentElement.outerHTML.includes(stamp.toUpperCase()), false)
})

test('a stamp whose chain does not answer, is another network, or says the batch has run out: the day of the configuration, and the line still a link', async (t) => {
    t.mock.method(console, 'error', () => {}) // the page logs the RPC that failed
    t.mock.method(Date, 'now', () => NOW)
    // what each RPC of the chain is asked: an RPC on another network is asked nothing more, and the next is tried; what
    // the contract says, run out or nothing for a price, is its word, and no other RPC is asked; one that refuses is
    // passed over like one that does not answer
    const whole = ['eth_chainId', 'eth_call', 'eth_call']
    const cases = [
        ['no RPC of the chain answers', () => [gnosis, otherGnosis].forEach((rpc) => net.says.set(rpc, fails)), null],
        ['the RPC is on another network, and so is the next', () => (net.stamp.chain = '0x1'), [['eth_chainId'], ['eth_chainId']]],
        ['the batch has run out', () => (net.stamp.remaining = 0n), [whole, []]],
        ['the contract has forgotten the batch', () => (net.stamp.remaining = null), [whole, whole]],
        ['the price is nothing', () => (net.stamp.price = 0n), [whole, []]]
    ]
    for (const [what, make, asked] of cases) {
        net.calls.length = 0
        net.says.clear()
        Object.assign(net.stamp, { chain: '0x64', remaining: REMAINING, price: PRICE })
        make()
        net.head = put(packed({ stamp }))
        await scan()
        assert.ok($('hero').classList.contains('verified'), what)
        assert.deepEqual(line(), { ...written, href: stamptime, title: `Swarm stamp ${stamp}` }, what)
        if (asked) assert.deepEqual([callsTo(gnosis), callsTo(otherGnosis)], asked, what)
        else assert.equal([...callsTo(gnosis), ...callsTo(otherGnosis)].includes('eth_call'), false, what)
    }
})

test('a first RPC of the stamp’s chain that does not answer: the second is read', async (t) => {
    t.mock.method(console, 'error', () => {})
    t.mock.method(Date, 'now', () => NOW)
    net.says.set(gnosis, fails)
    net.head = put(packed({ stamp }))
    await scan()
    assert.deepEqual(line(), linked)
    assert.deepEqual(callsTo(otherGnosis), ['eth_chainId', 'eth_call', 'eth_call'])
})

test('a configuration without the chain, the contract, the seconds of a block or an RPC for the chain: the day written in it, and the chain is not asked', async (t) => {
    t.mock.method(Date, 'now', () => NOW)
    for (const given of [{ ...storage, chain: undefined }, { ...storage, contract: undefined }, { ...storage, contract: 'the postage stamp contract' }, { ...storage, block_s: undefined }, { ...storage, chain: 5 }]) {
        net.calls.length = 0
        net.head = put(packed({ stamp }))
        await stored(given)
        assert.deepEqual(line(), { ...written, href: stamptime, title: `Swarm stamp ${stamp}` })
        assert.deepEqual(callsTo(gnosis), [])
    }
})

test('no page for a stamp, one that is not https, or one with no place for the id: the stamp’s day, and no link', async (t) => {
    t.mock.method(Date, 'now', () => NOW)
    for (const given of [{ ...storage, stamp_page: undefined }, { ...storage, stamp_page: 'http://stamptime.example/?id={stamp}' }, { ...storage, stamp_page: 'https://stamptime.example/' }]) {
        net.head = put(packed({ stamp }))
        await stored(given)
        assert.deepEqual(line(), { ...linked, href: null, title: null })
    }
    clean(document)
})

test('no day written in the configuration: the stamp’s day when its chain answers, and no line when it does not', async (t) => {
    t.mock.method(console, 'error', () => {})
    t.mock.method(Date, 'now', () => NOW)
    net.head = put(packed({ stamp }))
    await stored({ ...storage, until: undefined })
    assert.deepEqual(line(), linked)
    net.says.set(gnosis, fails)
    net.says.set(otherGnosis, fails)
    net.head = put(packed({ stamp }))
    await stored({ ...storage, until: undefined })
    assert.equal($('alive').hidden, true)
    // and a configuration that says nothing of the storage: the page as it was
    net.says.clear()
    net.calls.length = 0
    net.head = put(packed({ stamp }))
    await stored(undefined)
    assert.ok($('hero').classList.contains('verified'))
    assert.equal($('alive').hidden, true)
    assert.deepEqual(callsTo(gnosis), [])
})

test('a record that did not match, before or at the head: the chain is not asked for the stamp, and the line stays folded', async () => {
    const before = put({ phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'mango', kg: 20 })
    net.head = put(packed({ stamp, inputs: [before] }))
    net.anchors.delete(before)
    await scan()
    assert.equal($('step-3').querySelector('.v').textContent, '1 of 2 matches')
    assert.equal($('proof-fold').classList.contains('open'), false)
    assert.equal($('alive').hidden, true)
    assert.deepEqual(callsTo(gnosis), [])
    // the head record itself: not read, so it names no stamp
    net.head = put(packed({ stamp }))
    net.anchors.clear()
    await scan()
    assert.match(cards()[0].textContent, /Record not shown/)
    assert.equal($('alive').hidden, true)
    assert.deepEqual(callsTo(gnosis), [])
})

test('a wallet in the browser is not asked for the stamp: its chain is read through the RPCs of the configuration', async (t) => {
    t.mock.method(console, 'error', () => {}) // the wallet of the test knows no names, and the page logs that
    t.mock.method(Date, 'now', () => NOW)
    net.head = put(packed({ stamp }))
    net.owner = holder
    const asked = []
    window.ethereum = {
        request: async ({ method, params }) => {
            asked.push(method === 'eth_call' ? `eth_call ${params[0].to.toLowerCase()}` : method)
            return method === 'eth_chainId' ? '0xaa36a7' : rpc(method, params)
        }
    }
    await scan()
    assert.match($('twin').textContent, /Twin held by 0x1111…1111/) // the bag was read through the wallet
    assert.deepEqual(line(), linked)
    assert.ok(asked.includes(`eth_call ${contract}`))
    assert.equal(asked.some((call) => call.includes(storage.contract.toLowerCase())), false)
    assert.deepEqual(callsTo(gnosis), ['eth_chainId', 'eth_call', 'eth_call'])
})

test('a stamp whose chain answers after the seal: the day of the configuration first, and the stamp’s in its place when it comes', async (t) => {
    t.mock.method(Date, 'now', () => NOW)
    net.head = put(packed({ stamp }))
    const open = hold()
    location.hash = `#11155111:${contract}/1`
    const scanning = page.main()
    await turns()
    assert.ok($('hero').classList.contains('verified'))
    assert.ok($('proof-fold').classList.contains('open'))
    assert.deepEqual(line(), { ...linked, until: '27 Jan 2027' })
    open()
    await turns()
    await scanning
    assert.deepEqual(line(), linked)
})

test('another bag while the stamp’s chain is still to answer for the first: its day does not reach the page', async (t) => {
    t.mock.method(Date, 'now', () => NOW)
    net.head = put(packed({ stamp }))
    const open = hold()
    location.hash = `#11155111:${contract}/1`
    const scanning = page.main()
    await turns()
    assert.deepEqual(line(), { ...linked, until: '27 Jan 2027' })
    net.head = put(packed())
    await scan()
    assert.deepEqual(line(), written)
    open()
    await turns()
    await scanning
    assert.deepEqual(line(), written)
})

// ---------- the curves of a cycle: the light file its record names ----------
// A cycle record names its curves twice: the readings of the machine as SenML, which the page links and never downloads,
// and a preview in columns the Notary publishes for the page, which the page reads like a file of the product: hashed
// against its reference, found out once, and drawn in the card of the cycle. Nothing written in the file reaches the page.
const raw = (text) => new TextEncoder().encode(text)
// a file on Swarm under its reference, as a record names it: 64 hex digits, no 0x
function blob(content) {
    const ref = swarmHash(content)
    net.files.set(ref, content)
    return ref.slice(2)
}
const senml = () => blob(bytes({ schema: 'ffd/telemetry/1.0', cycle: '5201', senml: [{ n: 'chamber_temperature', u: 'Cel', t: 0, v: 21.4 }] }))
// the preview of a cycle of four hours, read every hour: the chamber, its pressure, one shelf that did not read once, and the power, which the page does not draw
const curves = (fields = {}) => ({
    schema: 'ffd/telemetry-preview/1.0',
    cycle: '5201',
    site: 'urn:bdf:site:india-1',
    bn: 'urn:bdf:device:india-1:IND-L-1:',
    bt: 1790911800,
    every: 5,
    t: [0, 3600, 7200, 10800, 14400],
    series: [
        { n: 'chamber_temperature', u: 'Cel', v: [21.4, -10.5, -38.2, -30.1, -20] },
        { n: 'chamber_pressure', u: 'Pa', v: [101325, 5000, 21.3, 40.2, 60] },
        { n: 'shelf_1_temperature', u: 'Cel', v: [20, 0, -20, null, 10] },
        { n: 'power', u: 'W', v: [400, 3100, 1000, 900, 800] }
    ],
    ...fields
})
// a bag of mango whose cycle names its curves, the SenML and the preview, unless the test says what it names instead
function dried(cycleFields = {}) {
    const intake = put({ phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'mango', kg: 20, sourcing: 'rescued' })
    const cycle = put({ phase: 'cycle', at: '2026-09-29T08:00:00Z', start: '2026-09-28T10:00:00Z', end: '2026-09-29T08:00:00Z', min_temperature_c: -38.2, min_pressure_pa: 21.3, loads: [{ trays: 10, kg: 20 }], kg_out: 2, telemetry: senml(), telemetry_preview: blob(bytes(curves())), inputs: [intake], ...cycleFields })
    net.head = put(packed({ inputs: [cycle] }))
    return cycle
}
const cycleCard = () => cards().find((li) => li.querySelector('h2').textContent === 'Freeze-dried')
const askedRef = (ref) => net.asked.filter((url) => url.endsWith(`/bytes/${ref}`)).length
const strokes = (path) => path.getAttribute('d').match(/[ML]/g).length

test('a cycle that names its curves: the preview is read against its reference and drawn in the card, the SenML is linked and never asked for', async () => {
    const preview = blob(bytes(curves()))
    const full = senml()
    dried({ telemetry: full, telemetry_preview: preview })
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    const card = cycleCard()
    const chart = card.querySelector('.curves')
    assert.ok(chart)
    // the chart sits between the rows and the check line
    assert.ok(chart.previousElementSibling.classList.contains('row'))
    assert.ok(chart.nextElementSibling.classList.contains('check'))
    // the chamber and the pressure have one point per tick of the clock; the shelf did not read once, and its line lifts there
    assert.equal(strokes(chart.querySelector('path.temp')), 5)
    assert.equal(strokes(chart.querySelector('path.press')), 5)
    assert.equal(chart.querySelector('path.shelf').getAttribute('d').match(/M/g).length, 2)
    // the power, which the page does not know, is not drawn: three lines
    assert.equal(chart.querySelectorAll('path.line').length, 3)
    // the marks of the three scales, and the two minima the record declares
    assert.match(chart.textContent, /°C/)
    assert.match(chart.textContent, /100k/)
    assert.match(chart.textContent, /4 h/)
    assert.deepEqual([...chart.querySelectorAll('.minima b')].map((b) => b.textContent), ['-38.2 °C', '21.3 Pa'])
    assert.equal(chart.querySelectorAll('svg .min').length, 2)
    // the two rows of the minima gave way to the figures above the chart
    assert.equal([...card.querySelectorAll('.row .k')].some((k) => k.textContent === 'Coldest' || k.textContent === 'Lowest pressure'), false)
    assert.equal(chart.querySelector('.key').textContent, 'ChamberShelvesPressure')
    // the link to the full curves, from the gateway that served the record; the SenML itself is never asked for
    const link = card.querySelector('.quiet a')
    assert.equal(link.textContent, 'Full curve data ↗')
    assert.equal(card.querySelectorAll('.links a').length, 2)
    assert.equal(link.href, `${first}/bytes/${full}`)
    assert.equal(link.rel, 'noopener')
    assert.deepEqual([askedRef(preview), askedRef(full)], [1, 0])
    clean(document)
})

for (const [what, file] of [
    ['is of a kind the page does not know', bytes(curves({ schema: 'ffd/telemetry-preview/2.0' }))],
    ['has a clock that goes back', bytes(curves({ t: [0, 7200, 3600, 10800, 14400] }))],
    ['has a clock that does not advance', bytes(curves({ t: [0, 0, 0, 0, 0] }))],
    ['has a clock of text', bytes(curves({ t: ['0', '3600', '7200', '10800', '14400'] }))],
    ['has a series out of step with its clock', bytes(curves({ series: [{ n: 'chamber_temperature', u: 'Cel', v: [21.4, -10.5] }] }))],
    ['has a reading that is not a number', raw(JSON.stringify(curves()).replace('21.4', 'NaN'))],
    ['has a reading that is text', bytes(curves({ series: [{ n: 'chamber_temperature', u: 'Cel', v: ['21.4', -10.5, -38.2, -30.1, -20] }] }))],
    ['has more points than the page draws', bytes(curves({ t: Array.from({ length: 2001 }, (_, i) => i * 60), series: [{ n: 'chamber_temperature', u: 'Cel', v: Array.from({ length: 2001 }, () => -20) }] }))],
    ['names its series with HTML', bytes(curves({ series: [{ n: hostile('n'), u: hostile('u'), v: [21.4, -10.5, -38.2, -30.1, -20] }] }))],
    ['has series that are not a list', bytes(curves({ series: 'chamber_temperature' }))],
    ['names no series the page knows', bytes(curves({ series: [{ n: 'power', u: 'W', v: [1, 2, 3, 4, 5] }] }))],
    ['is not JSON', raw('{"schema": ')]
])
    test(`a preview that ${what}: it is not drawn, and the card is as it would be without it`, async () => {
        const preview = blob(file)
        dried({ telemetry_preview: preview })
        await scan()
        assert.ok($('hero').classList.contains('verified'))
        const card = cycleCard()
        assert.equal(card.querySelector('.curves'), null)
        assert.equal(card.querySelector('svg:not(.glyph)'), null) // the glyph at the head of the card is the page's own
        assert.equal(card.querySelectorAll('.row').length, 5)
        assert.equal(card.querySelectorAll('.links a').length, 2)
        assert.ok(card.querySelector('.quiet a'))
        assert.equal(askedRef(preview), 1)
        assert.equal(document.documentElement.outerHTML.includes('ffd-probe'), false)
        clean(document)
    })

test('a preview no gateway serves as its reference names it: it is not drawn, and both were asked', async () => {
    const preview = blob(bytes(curves()))
    dried({ telemetry_preview: preview })
    for (const gateway of [first, second]) net.instead.set(gateway, but({ ref: preview }, () => answer(bytes(curves({ cycle: 'SERVED-BY-THE-GATEWAY' })), 'application/octet-stream')))
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    assert.equal(cycleCard().querySelector('.curves'), null)
    assert.equal(askedRef(preview), 2)
    assert.equal(document.documentElement.outerHTML.includes('SERVED-BY-THE-GATEWAY'), false)
})

test('a cycle that names no curves: nothing is drawn, no one is asked, and there is no link', async () => {
    dried({ telemetry: null, telemetry_preview: null })
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    const card = cycleCard()
    assert.equal(card.querySelector('.curves'), null)
    assert.equal(card.querySelector('.quiet'), null)
    assert.equal(net.asked.filter((url) => url.includes('/bytes/')).length, 3) // the three records, and no file
})

test('a cycle whose curves are named by something that is not a reference: no one is asked for them, and nothing is linked', async () => {
    dried({ telemetry: hostile('telemetry'), telemetry_preview: hostile('telemetry_preview') })
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    const card = cycleCard()
    assert.equal(card.querySelector('.curves'), null)
    assert.equal(card.querySelectorAll('.links a').length, 2)
    assert.equal(net.asked.filter((url) => url.includes('/bytes/')).length, 3)
    clean(document)
})

test('the curves of a cycle that did not pass the check are not asked for', async () => {
    const preview = blob(bytes(curves()))
    const cycle = dried({ telemetry_preview: preview })
    net.anchors.delete(cycle)
    await scan()
    // the cycle was not read, so the intake it names was not followed either: two records, one of them matched
    assert.equal($('step-3').querySelector('.v').textContent, '1 of 2 matches')
    assert.equal(cycleCard(), undefined)
    assert.equal(askedRef(preview), 0)
})

test('a bag from two cycles: each card draws what its own record names', async () => {
    const intake = put({ phase: 'intake', at: '2026-09-28T08:00:00Z', fruit: 'mango', kg: 20 })
    const one = put({ phase: 'cycle', at: '2026-09-29T08:00:00Z', plant_id: '5203', telemetry: senml(), telemetry_preview: blob(bytes(curves({ cycle: '5203' }))), inputs: [intake] })
    const two = put({ phase: 'cycle', at: '2026-09-29T09:00:00Z', plant_id: '5204', telemetry: null, telemetry_preview: null, inputs: [intake] })
    net.head = put(packed({ inputs: [one, two] }))
    await scan()
    const dryings = cards().filter((li) => li.querySelector('h2').textContent === 'Freeze-dried')
    assert.equal(dryings.length, 2)
    assert.deepEqual(dryings.map((li) => !!li.querySelector('.curves')), [true, false])
    clean(document)
})

test('another bag while the curves of the first are still on their way: nothing of them reaches the page', async () => {
    const preview = blob(bytes(curves()))
    dried({ telemetry_preview: preview })
    const open = slow({ ref: preview })
    location.hash = `#11155111:${contract}/1`
    const scanning = page.main()
    await turns()
    assert.ok($('hero').classList.contains('verified'))
    assert.equal(cycleCard().querySelector('.curves'), null)
    net.instead.clear()
    dried({ telemetry: null, telemetry_preview: null })
    await scan()
    open()
    await turns()
    await scanning
    assert.ok(cycleCard())
    assert.equal(document.querySelector('.curves'), null)
})

// ---------- the route: the file the transport record names, and the map of the Delivered card ----------
// Where the bag went comes from a file too: the transport record names `destination-location.geojson` among its
// documents, and the page reads it like the plant's. The Delivered card then gains the coordinates on its To row and,
// once the plant has come as well and the transport names its site as the origin, the map: the two places joined by a
// line, the distance and the days under it, and at the end of that line a link that opens OpenStreetMap over the two
// places, which is asked for nothing. The map is the page's own drawing: no tile, no script and no image from anyone.
const mumbai = { type: 'Feature', geometry: { type: 'Point', coordinates: [72.867442, 19.064192] }, properties: { place: 'Jio World Convention Centre, G Block, Bandra Kurla Complex, Bandra East, Mumbai 400098, India' } }
const destination = (value = mumbai, name = 'destination-location.geojson', type = 'application/geo+json') => file(name, type, bytes(value))
const devcon = { site: null, place: mumbai.properties.place, country: null, lat: 19.064192, lon: 72.867442 }
// a bag of banana that went from the plant to Devcon: its intake names the plant's file and its transport the destination's,
// unless a test names other documents (`plant`, `went`) or says otherwise of the transport; the reference of the transport
// record is returned
function delivered({ plant = [site()], went = [destination()], ...transport } = {}) {
    const intake = put({ phase: 'intake', at: '2026-09-25T08:00:00Z', fruit: 'banana', kg: 20, sourcing: 'rescued', documents: plant })
    const packing = put(packed({ product: 'dried banana', inputs: [intake] }))
    net.head = put({ phase: 'transport', at: '2026-11-02T10:00:00Z', product: 'dried banana', origin: 'urn:bdf:site:india-1', destination: 'Devcon 8, Mumbai', departure: '2026-10-27T03:26:59Z', arrival: '2026-11-02T09:20:36Z', carrier: 'road courier', documents: went, inputs: [packing], ...transport })
    return net.head
}
const deliveredCard = () => cards().find((li) => li.querySelector('h2').textContent === 'Delivered')
const toRow = (li) => rowsOf(li).find(([key]) => key === 'To')
const asDelivered = ['Product', 'From', 'To', 'Departed', 'Arrived', 'Carrier']
const toDevcon = ['To', 'Devcon 8, Mumbai19.0642° N, 72.8674° E OpenStreetMap ↗']
const point = 'https://www.openstreetmap.org/?mlat=19.064192&mlon=72.867442#map=15/19.064192/72.867442'
// the view of OpenStreetMap over the two places: the destination marked, and zoom 6, the widest at which both fit, centred between them
const view = 'https://www.openstreetmap.org/?mlat=19.064192&mlon=72.867442#map=6/19.649736/78.988277'
// the map of a card, when it has one, and the links under it
const mapOf = (li) => li.querySelector('.route')
const opens = (li) => [...li.querySelectorAll('.leg a')].map((a) => a.getAttribute('href'))

test('the route: the Delivered card draws it from the two files, says the distance and the days, and opens it on OpenStreetMap', async () => {
    const files = [site(), destination()]
    delivered({ plant: [files[0]], went: [files[1]] })
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    assert.equal($('step-3').querySelector('.v').textContent, '3 of 3 matches')
    const card = deliveredCard()
    const map = mapOf(card)
    assert.ok(map)
    // the map sits between the rows and the check line, as the curves of a cycle do
    assert.ok(map.previousElementSibling.classList.contains('row'))
    assert.ok(map.nextElementSibling.classList.contains('check'))
    // the two places, named by the words before the first comma of each file, and the line between them, drawn as it lands
    assert.equal(map.querySelectorAll('.plant').length, 1)
    assert.equal(map.querySelectorAll('.dest').length, 1)
    const way = map.querySelector('path.way')
    assert.equal(way.getAttribute('pathLength'), '1')
    assert.match(way.getAttribute('d'), /^M[\d. ]+Q[\d. ]+$/)
    assert.deepEqual([...map.querySelectorAll('text')].map((t) => t.textContent), ['Dhodapalli', 'Jio World Convention Centre'])
    assert.equal(map.querySelector('.leg .far').textContent, '≈ 1,290 km · 6 days')
    assert.equal(map.querySelector('svg').getAttribute('aria-label'), 'The route from Dhodapalli to Jio World Convention Centre: about 1,290 km in 6 days')
    // the To row gains the coordinates of the destination under the record's words, linked as the GPS of the plant is
    assert.deepEqual(toRow(card), toDevcon)
    const links = card.querySelectorAll('.row a')
    assert.equal(links.length, 1)
    assert.equal(links[0].getAttribute('href'), point)
    assert.equal(links[0].getAttribute('rel'), 'noopener')
    assert.ok(links[0].closest('.late'))
    // the link at the end of the line under the map: OpenStreetMap over the two places, from numbers the page wrote and
    // nothing of the files; the small print of the card has no line of its own for it
    const open = map.querySelector('.leg a')
    assert.equal(open.textContent, 'Open in OpenStreetMap ↗')
    assert.equal(open.getAttribute('href'), view)
    assert.equal(open.getAttribute('target'), '_blank')
    assert.equal(open.getAttribute('rel'), 'noopener')
    assert.equal(open.previousElementSibling.textContent, '≈ 1,290 km · 6 days')
    assert.equal(card.querySelector('.quiet'), null)
    assert.equal(card.querySelectorAll('.links a').length, 2)
    // the Received card has its own rows, and the raw records are the records
    assert.deepEqual(rowsOf(receivedCard()).slice(-2).map(([key]) => key), ['Site', 'GPS'])
    assert.equal(card.querySelector('pre').textContent.includes('Jio'), false)
    assert.deepEqual(files.map(askedFor), [1, 1])
    assert.deepEqual(page.places, { plant, destination: devcon })
    clean(document)
})

test('a destination without the plant: the To row has its coordinates, and there is no map and no route', async () => {
    delivered({ plant: [] })
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    const card = deliveredCard()
    assert.deepEqual(toRow(card), toDevcon)
    assert.equal(card.querySelector('.row a').getAttribute('href'), point)
    assert.equal(mapOf(card), null)
    assert.equal(card.querySelector('svg:not(.glyph)'), null) // the glyph at the head of the card is the page's own
    assert.deepEqual(opens(card), [])
    assert.deepEqual(rowsOf(receivedCard()).map(([key]) => key), asIs)
    assert.deepEqual(page.places, { plant: null, destination: devcon })
    clean(document)
})

test('a plant that is not the origin of the transport: both cards say where their place is, and there is no map', async () => {
    for (const [what, make] of [
        ['the transport names another site', () => delivered({ origin: 'urn:bdf:site:india-2' })],
        ['the transport names no origin', () => delivered({ origin: undefined })],
        ["the plant's file names no site", () => delivered({ plant: [site({ ...india, properties: { place: india.properties.place } })] })]
    ]) {
        make()
        await scan()
        assert.ok($('hero').classList.contains('verified'), what)
        const card = deliveredCard()
        assert.deepEqual(toRow(card), toDevcon, what)
        assert.equal(mapOf(card), null, what)
        assert.deepEqual(opens(card), [], what)
        assert.deepEqual(rowsOf(receivedCard()).slice(-2).map(([key]) => key), ['Site', 'GPS'], what)
        assert.equal(page.places.destination.place, devcon.place, what)
    }
    clean(document)
})

test('a destination that is the plant, or within a kilometre of it: the coordinates on the To row, and no map', async () => {
    for (const where of [india.geometry.coordinates, [85.1092, 20.2353]]) {
        delivered({ went: [destination({ ...mumbai, geometry: { type: 'Point', coordinates: where } })] })
        await scan()
        assert.ok($('hero').classList.contains('verified'))
        const card = deliveredCard()
        assert.match(toRow(card)[1], /^Devcon 8, Mumbai20\.235\d° N, 85\.109\d° E OpenStreetMap ↗$/)
        assert.equal(mapOf(card), null)
        assert.deepEqual(opens(card), [])
        assert.deepEqual(page.places.plant, plant)
    }
})

test('a destination file whose words are HTML, and a transport whose dates are not dates: text on the map, and the distance alone under it', async () => {
    delivered({ went: [destination({ ...mumbai, properties: { place: hostile('place') } })], departure: hostile('departure'), arrival: hostile('arrival') })
    await scan()
    clean(document)
    const card = deliveredCard()
    const map = mapOf(card)
    assert.ok(map)
    // a name is cut at 32 characters; the words reach the map as text and the label of the map as an attribute, escaped
    assert.deepEqual([...map.querySelectorAll('text')].map((t) => t.textContent), ['Dhodapalli', `${hostile('place').slice(0, 32)}…`])
    assert.equal(map.querySelector('.leg .far').textContent, '≈ 1,290 km')
    assert.equal(map.querySelector('svg').getAttribute('aria-label'), `The route from Dhodapalli to ${hostile('place').slice(0, 32)}…: about 1,290 km`)
    assert.deepEqual(opens(card), [view])
    assert.equal(page.places.destination.place, hostile('place'))
})

test('a destination file under another name or of another type is not asked for, nor one named by a transport record that did not pass the check', async () => {
    const elsewhere = { ...mumbai, properties: { place: 'Elsewhere' } }
    delivered({ went: [destination(elsewhere, 'destination.geojson'), destination(mumbai, 'destination-location.geojson', 'application/json'), { name: 'destination-location.geojson', type: 'application/geo+json', ref: hostile('ref') }] })
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    const card = deliveredCard()
    assert.deepEqual(rowsOf(card).map(([key]) => key), asDelivered)
    assert.deepEqual(toRow(card), ['To', 'Devcon 8, Mumbai'])
    assert.equal(card.querySelector('.row a'), null)
    assert.equal(mapOf(card), null)
    assert.deepEqual(opens(card), [])
    assert.equal(net.asked.filter((url) => url.includes('/bytes/')).length, 4) // the three records, the plant's file, and no other
    assert.deepEqual(page.places, { plant, destination: null })
    assert.equal(document.documentElement.outerHTML.includes('Elsewhere'), false)
    clean(document)
    // a transport record with no anchor is not read, and names nothing
    net.asked.length = 0
    const went = destination()
    net.anchors.delete(delivered({ went: [went] }))
    await scan()
    assert.match(cards()[0].textContent, /Record not shown/)
    assert.equal(askedFor(went), 0)
    assert.deepEqual(page.places, { plant: null, destination: null })
})

test('a destination file no gateway serves as its reference names it, or that is not a point: nothing of it, and the card is as it was', async () => {
    const served = () => answer(bytes({ ...mumbai, properties: { place: 'SERVED-BY-THE-GATEWAY' } }), 'application/octet-stream')
    const went = destination()
    delivered({ went: [went] })
    for (const gateway of [first, second]) net.instead.set(gateway, but(went, served))
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    let card = deliveredCard()
    assert.deepEqual(toRow(card), ['To', 'Devcon 8, Mumbai'])
    assert.equal(mapOf(card), null)
    assert.deepEqual(opens(card), [])
    assert.equal(askedFor(went), 2)
    assert.equal(document.documentElement.outerHTML.includes('SERVED-BY-THE-GATEWAY'), false)
    assert.deepEqual(page.places, { plant, destination: null })
    // a file that is what its reference names, and says nothing: a polygon where a point should be
    net.instead.clear()
    const shape = destination({ ...mumbai, geometry: { type: 'Polygon', coordinates: [[[72, 19], [73, 19], [73, 20], [72, 19]]] } })
    delivered({ went: [shape] })
    await scan()
    card = deliveredCard()
    assert.deepEqual(toRow(card), ['To', 'Devcon 8, Mumbai'])
    assert.equal(mapOf(card), null)
    assert.equal(askedFor(shape), 1)
    assert.deepEqual(page.places, { plant, destination: null })
    clean(document)
})

test('a transport record that names no file: the card as it has been, and no one is asked for anything', async () => {
    delivered({ went: null })
    await scan()
    assert.ok($('hero').classList.contains('verified'))
    const card = deliveredCard()
    assert.deepEqual(rowsOf(card).map(([key]) => key), asDelivered)
    assert.equal(card.querySelector('.row a'), null)
    assert.equal(mapOf(card), null)
    assert.deepEqual(opens(card), [])
    assert.equal(net.asked.filter((url) => url.includes('/bytes/')).length, 4) // the three records and the plant's file
    assert.deepEqual(page.places, { plant, destination: null })
})

test('another bag after one with its route: nothing of it is left', async () => {
    delivered()
    await scan()
    assert.ok(mapOf(deliveredCard()))
    net.head = put(packed())
    await scan()
    assert.deepEqual(page.places, { plant: null, destination: null })
    assert.deepEqual(cards().map((li) => li.querySelector('h2').textContent), ['Packed'])
    for (const word of ['Jio', 'Dhodapalli', 'map=6/', 'class="route"']) assert.equal(document.documentElement.outerHTML.includes(word), false, word)
})

test('a file of the route that is slow to come: the seal does not wait for it, the other place takes its card, and the map comes when both are in', async () => {
    // the destination held back: the plant lands on the Received card, and the map waits
    let files = [site(), destination()]
    delivered({ plant: [files[0]], went: [files[1]] })
    let open = slow(files[1])
    location.hash = `#11155111:${contract}/1`
    let scanning = page.main()
    await turns()
    assert.ok($('hero').classList.contains('verified'))
    assert.ok($('proof-fold').classList.contains('open'))
    assert.deepEqual(rowsOf(receivedCard()).slice(-2).map(([key]) => key), ['Site', 'GPS'])
    assert.deepEqual(toRow(deliveredCard()), ['To', 'Devcon 8, Mumbai'])
    assert.equal(mapOf(deliveredCard()), null)
    assert.deepEqual(page.places, { plant, destination: null })
    open()
    await turns()
    await scanning
    assert.deepEqual(toRow(deliveredCard()), toDevcon)
    assert.ok(mapOf(deliveredCard()))
    assert.deepEqual(opens(deliveredCard()), [view])
    // the plant held back: the destination lands on the Delivered card, and the map waits for the plant
    net.instead.clear()
    files = [site(), destination()]
    delivered({ plant: [files[0]], went: [files[1]] })
    open = slow(files[0])
    location.hash = `#11155111:${contract}/1`
    scanning = page.main()
    await turns()
    assert.ok($('hero').classList.contains('verified'))
    assert.deepEqual(toRow(deliveredCard()), toDevcon)
    assert.equal(mapOf(deliveredCard()), null)
    assert.deepEqual(rowsOf(receivedCard()).map(([key]) => key), asIs)
    assert.deepEqual(page.places, { plant: null, destination: devcon })
    open()
    await turns()
    await scanning
    assert.deepEqual(rowsOf(receivedCard()).slice(-2).map(([key]) => key), ['Site', 'GPS'])
    assert.ok(mapOf(deliveredCard()))
    assert.ok(mapOf(deliveredCard()).nextElementSibling.classList.contains('check'))
    clean(document)
})

test('another bag while the files of the route are still on their way: nothing of them reaches the page', async () => {
    const files = [site(), destination()]
    delivered({ plant: [files[0]], went: [files[1]] })
    const open = slow(files[1])
    location.hash = `#11155111:${contract}/1`
    const scanning = page.main()
    await turns()
    assert.ok($('hero').classList.contains('verified'))
    assert.equal(mapOf(deliveredCard()), null)
    net.instead.clear()
    net.head = put(packed())
    await scan()
    open()
    await turns()
    await scanning
    assert.deepEqual(page.places, { plant: null, destination: null })
    assert.deepEqual(cards().map((li) => li.querySelector('h2').textContent), ['Packed'])
    assert.equal(document.querySelector('.route'), null)
    assert.equal(document.documentElement.outerHTML.includes('Jio'), false)
})
