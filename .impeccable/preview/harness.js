// A bag that does not exist, for looking at the page. The page in the frame is the real one, as the dev server serves it;
// what is made up is the network: a wallet that answers for Ethereum and a fetch that answers for Swarm, with records
// written here, hashed the way Swarm does and anchored. The page's own check runs on them, and passes or fails as it would.
//   fruit=jackfruit|pineapple|banana|mango   id=<bag number>   art=0 the art is asked for and never comes   art=photo only the photograph   art=none there is none
//   state=bad serves other bytes for one record   stop=eth|swarm never answers that read   slow=<ms> per read   h=<frame height>|full
//   still=1 no transitions and no animations: every state is shown as it ends, for a capture
import { decodeFunctionData, encodeFunctionResult } from 'viem'
import { abi, swarmHash } from '../../src/lib.ts'

const q = new URLSearchParams(location.search)
const fruit = q.get('fruit') ?? 'jackfruit'
const id = q.get('id') ?? '15000'
const slow = Number(q.get('slow') ?? 0)
const stop = q.get('stop')
const frame = document.querySelector('iframe')
// h=full: the frame grows to the whole page, for a capture from top to bottom
if (q.get('h') === 'full') {
    frame.style.height = '800px'
    setInterval(() => (frame.style.height = `${frame.contentDocument?.documentElement.scrollHeight ?? 800}px`), 150)
} else if (q.get('h')) frame.style.height = `${q.get('h')}px`
if (q.get('w')) frame.style.width = `${q.get('w')}px`

const loaded = new Promise((done) => frame.addEventListener('load', done, { once: true }))
frame.src = '/devcon8.html'
await loaded
const w = frame.contentWindow
const real = w.fetch.bind(w)
const config = await (await real('/config.json')).json()

// ---------- the records: the four of a bag, each naming the one before ----------
const files = new Map()
const anchors = new Map()
const put = (record, anchored) => {
    const bytes = new TextEncoder().encode(JSON.stringify(record))
    const ref = swarmHash(bytes)
    files.set(ref, bytes)
    anchors.set(ref, [BigInt(Date.parse(anchored) / 1000), 9_400_000n + BigInt(files.size)])
    return ref
}
const intake = put({ phase: 'intake', at: '2026-10-01T06:30:00Z', plant_id: 'REC/20261001/9021-1', fruit, kg: 100, supplier: 'Cooperative Nashik 3', sourcing: 'undeclared', farms: [{ zone: 'Nashik', country: 'IN', variety: null, harvested: '2026-09-29', kg: 100 }], delivery_note: 'DN-2610-0147' }, '2026-10-03T08:30:00Z')
const cycle = put({ phase: 'cycle', at: '2026-10-04T08:00:00Z', plant_id: '5201', machine: 'IND-L-1', start: '2026-10-02T10:00:00Z', end: '2026-10-04T08:00:00Z', min_temperature_c: -38.2, min_pressure_pa: 21.3, kwh: 87.6, loads: [{ trays: 16, kg: 32 }], kg_out: 5.6, moisture_pct: 2.4, inputs: [intake] }, '2026-10-04T17:48:00Z')
const packing = put({ phase: 'packing', at: '2026-10-05T09:00:00Z', plant_id: 'WH/MO/00057', product: `dried ${fruit}`, bags: 560, bag_g: 10, lot: 'L-1026', inputs: [cycle] }, '2026-10-05T17:48:00Z')
const head = put({ phase: 'transport', at: '2026-11-02T09:00:00Z', product: `dried ${fruit}`, origin: 'urn:bdf:site:india-1', destination: 'Devcon 8 venue, Mumbai', departure: '2026-10-30T04:00:00Z', arrival: '2026-11-02T09:00:00Z', carrier: 'road courier', tracking: 'TEST-SHIP-0001', inputs: [packing] }, '2026-11-02T17:50:00Z')

// ---------- the network ----------
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const never = new Promise(() => {})
const reverted = () => Object.assign(Error('execution reverted'), { code: 3 })
w.ethereum = {
    request: async ({ method, params = [] }) => {
        if (method === 'eth_chainId') return '0xaa36a7'
        if (method === 'eth_getLogs') return []
        const [call] = params
        if (method !== 'eth_call' || call.to?.toLowerCase() !== config.contract.toLowerCase()) throw reverted()
        const { functionName, args } = decodeFunctionData({ abi, data: call.data })
        if (functionName === 'recordOf') {
            if (stop === 'eth') await never
            await sleep(slow)
            return encodeFunctionResult({ abi, functionName, result: head })
        }
        if (functionName === 'anchoredAt') return encodeFunctionResult({ abi, functionName, result: anchors.get(args[0]) ?? [0n, 0n] })
        return encodeFunctionResult({ abi, functionName, result: config.custody })
    }
}
// what the page is given as its configuration: the real one, with no other RPC to ask, and without the art when art=0
const served = structuredClone(config)
served.rpcs = { 11155111: ['https://preview.invalid'] }
// art=0: the art and the photograph are asked for and do not come, so the page stays as it is before they arrive
if (q.get('art') === '0') w.Image = class { set src(_) {} }
// art=photo: the config names no illustration, and the photograph comes: the page without its artwork
if (q.get('art') === 'photo') delete served.art
// art=none: the config names no art and no photograph, as for a fruit that has none yet
if (q.get('art') === 'none') {
    delete served.art
    for (const entry of Object.values(served.fruits)) entry.photo = null
}
w.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/bytes/')) {
        if (stop === 'swarm') await never
        await sleep(slow)
        const ref = `0x${url.split('/bytes/')[1]}`
        const file = q.get('state') === 'bad' && ref === cycle ? new TextEncoder().encode('{"phase":"cycle"}') : files.get(ref)
        return file ? new Response(file, { headers: { 'content-type': 'application/octet-stream' } }) : new Response('not found', { status: 404 })
    }
    if (url.endsWith('config.json')) return new Response(JSON.stringify(served), { headers: { 'content-type': 'application/json' } })
    if (url.includes('preview.invalid')) return new Response('', { status: 503 })
    return real(input, init)
}

if (q.get('still')) w.document.head.insertAdjacentHTML('beforeend', '<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>')

// ---------- the scan ----------
w.history.replaceState(null, '', `#11155111:${config.contract}/${id}`)
const script = w.document.querySelector('script[type="module"][src*="devcon8"]').src
const page = await w.eval(`import(${JSON.stringify(script)})`)
await page.main()
document.documentElement.dataset.done = ''
