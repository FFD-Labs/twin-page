// The page a bag opens: seven blocks, the states, a loading that tells the check as it happens, a list of gateways, the
// small print of the footer. The looks live in devcon8.html; this file reads, checks and paints.
//
// Reads ./config.json. The keys of the blocks are optional: a block whose data or assumptions are missing is not painted.
// What the page says of the fruit, where the plant is and where the bag went, is not in the config: the bag's records name
// the files, the packing record those of its product, the intake record the location of the plant and the transport record
// that of its destination, and the page reads them from Swarm against their references, as it reads the records.

import { NotOfficial, abi, download, hex, parseSticker, swarmHash, type Config } from '../src/lib.ts'
import './life-grid.ts'
import { BaseError, ContractFunctionRevertedError, createClient, custom, getChainId, getContractEvents, getEnsAvatar, getEnsName, getEnsText, http, isAddress, isAddressEqual, mainnet, parseAbi, readContract, sepolia, zeroHash, type Address, type Hex, type Transport } from '../src/rails.ts'

type Farm = { zone: string | null; country: string | null; variety: string | null; harvested: string | null; kg: number | null }

type Record = {
    phase: 'intake' | 'cycle' | 'packing' | 'transport'
    // the version of a record is written in its raw record, and nowhere else on its card
    version?: number
    at: string
    plant_id?: string | null
    fruit?: string
    product?: string
    kg?: number
    supplier?: string
    sourcing?: string
    farms?: Farm[]
    delivery_note?: string | null
    machine?: string
    start?: string
    end?: string
    min_temperature_c?: number
    min_pressure_pa?: number
    kwh?: number
    loads?: { trays: number | null; kg: number }[]
    kg_out?: number | null
    moisture_pct?: number | null
    // the curves of a cycle, as its record names them: the SenML the page links, and the light file it draws. Read by refOf, never taken as they come
    telemetry?: unknown
    telemetry_preview?: unknown
    bags?: number
    bag_g?: number
    stickers?: { from: number; to: number }
    lot?: string
    origin?: string
    destination?: string
    departure?: string
    arrival?: string
    carrier?: string | null
    tracking?: string | null
    // the files behind the record, as it names them: read by documentOf, never taken as they come
    documents?: unknown
    // the postage batch the record was stored with, as it names it: read by stampOf, never taken as it comes
    stamp?: unknown
    inputs?: Hex[]
}

// The fruit (block 2): what the description of the bag's product says, when the page can show it.
type Nutrition = {
    energy_kcal: number
    carbohydrate_g: number
    sugars_g: number
    protein_g: number
    fat_g: number
    fibre_g: number
    // the rest of a label, when the description gives it
    energy_kj: number | null
    saturated_fat_g: number | null
    salt_g: number | null
    micro: [string, number, string][]
    source: string | null
}
// The two dates of the pouch's label, as the description gives them: `manufactured` and `expires`, a month (`2026-09`) or
// a day (`2026-09-24`), and null when the description leaves one out or writes it another way.
type Description = { fruit: string | null; name: string | null; nutrition: Nutrition | null; alt: string | null; credit: string | null; manufactured: string | null; expires: string | null }

// A place of the path, from the file a record names: the key the records call it by (`urn:bdf:site:india-1`), the words
// for it, the code of its country when the file gives one, and where it is. The intake record names the file of the
// plant, the transport record that of its destination.
type Point = { site: string | null; place: string | null; country: string | null; lat: number; lon: number }

// The arithmetic of block 5.
type Co2 = {
    factor_kg_per_kg: number
    factor_source?: string
    scenario: string
    scenario_written: string
    yield_pct?: number
    label?: string | null
    closing?: string | null
}

// The records' storage on Swarm. The stamp (postage batch) they live on is not here: the bag's record names it. Here is
// where it is read from, the chain and the PostageStamp contract, with the seconds of one of that chain's blocks; the day
// written by hand, which stands until the stamp says better; and the page where a stamp is looked up by its id, with
// {stamp} where the id goes.
type Storage = { until?: string; chain?: number; contract?: Address; block_s?: number; stamp_page?: string }

type Page = Config & {
    gateways?: string[]
    links?: { ethereum?: string; swarm?: string; ens?: string }
    co2?: Co2
    storage?: Storage
    source?: string
}

// One record of the path. `verified`: hashed the way Swarm does, the bytes a gateway served give `ref`, and `ref` has its
// anchor. `data` is what the record says, and it is there only when that holds: bytes that fail the check are never parsed.
// A record that passed the check and is not one the page knows how to show has no `data` either: `raw` is its text.
type Event = {
    ref: Hex
    at: string | null
    block: bigint
    data: Record | null
    raw?: string | null
    gateway: string
    verified: boolean
    tx: string | null
}

// The explorer the page's links to the chain open, by network. The page asks it for nothing: a link is followed only when
// it is tapped.
const explorers: { [chainId: number]: string } = { 1: 'https://eth.blockscout.com', 11155111: 'https://eth-sepolia.blockscout.com' }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const date = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const place = (value = '') => (value.startsWith('urn:bdf:site:') ? `Plant ${value.split(':').pop()}` : value)
const hours = (from = '', to = '') => `${Math.round((Date.parse(to) - Date.parse(from)) / 36e5)} h`
const sum = (list: { trays: number | null; kg: number }[], key: 'trays' | 'kg') => list.reduce((total, load) => total + (load[key] ?? 0), 0)
const loaded = (loads: { trays: number | null; kg: number }[] | null = []) =>
    loads?.length ? `${Number(sum(loads, 'kg').toFixed(3))} kg${loads.every(load => load.trays != null) ? ` on ${sum(loads, 'trays')} trays` : ''}` : null
const sourcings: { [key: string]: string } = { first_hand: 'Bought as usual', second_grade: 'Second grade', rescued: 'Rescued surplus', undeclared: 'Not stated' }
const cap = (value?: string) => value && value.replace(/^./, c => c.toUpperCase())
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`
// A country by its code, IN: its name, India, or the code as it is when no region is known by it
const regionName = (code: string) => {
    try {
        return new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(code) ?? null
    } catch {
        return null
    }
}
const country = (code: string) => regionName(code) ?? code
// The flag of a country whose code is two capital letters that name a region: the letters as the regional indicators an
// emoji font draws as the flag, 🇮🇳 for IN, set after the name of the country, or after the words of a place that ends
// with it. A code of another shape has no flag.
const flag = (code: unknown) => (typeof code === 'string' && /^[A-Z]{2}$/.test(code) && regionName(code) !== null ? String.fromCodePoint(...[...code].map(c => 0x1f1e6 + c.charCodeAt(0) - 65)) : null)
const flagged = (code: unknown, words: string | null) => {
    const banner = words ? flag(code) : null
    return banner ? `${words} ${banner}` : words
}
// The code of a country by its name, India → IN, for a place whose words end with one. Built once from every pair of
// letters, keeping those that name a region and are its code today (ICU knows DD as Germany too, and gives it DE), so
// that the page carries no list of its own. Names are compared without case; one that two codes share gives nothing.
const current = (code: string) => {
    try {
        return new Intl.Locale(`und-${code}`).region === code
    } catch {
        return false
    }
}
let codes: Map<string, string | null> | null = null
const codeOf = (name: string) => {
    if (!codes) {
        codes = new Map()
        for (let a = 65; a <= 90; a++)
            for (let b = 65; b <= 90; b++) {
                const code = String.fromCharCode(a, b)
                const known = regionName(code)?.toLowerCase()
                if (known && current(code)) codes.set(known, codes.has(known) ? null : code)
            }
    }
    return codes.get(name.trim().toLowerCase()) ?? null
}
// The country a place is in, by the words after its last comma, as the addresses of the files end: Dhodapalli, Odisha
// 752077, India. None when they are not the name of one.
const countryOf = (place: string | null) => {
    const words = place?.split(',').pop()
    return words ? codeOf(words) : null
}
const farm = (f: Farm) =>
    [[f.zone, f.country && flagged(f.country, country(f.country))].filter(Boolean).join(', '), f.variety, f.harvested && `harvested ${day(f.harvested)}`, f.kg != null && `${f.kg} kg`]
        .filter(Boolean)
        .join(' · ') || null
// A value that is a link: to an address of the page's own making, opened beside the page; nothing a record or a file says
// is ever one. Where it opens, when named, is small print under the value.
const linked = (value: unknown, href: string, via?: string | null) =>
    `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(value)} ${via ? `<small>${esc(via)} ↗</small>` : '↗'}</a>`
// The rows of a card: a key and a value, written as text. A third element is an address, and the value is then a link to
// it; a fourth names where the address opens.
const rows = (list: (string | null | undefined)[][]) =>
    list
        .filter(([, value]) => value != null && value !== '')
        .map(([key, value, href, via]) => `<div class="row"><span class="k">${esc(key)}</span><span class="v">${href ? linked(value, href, via) : esc(value)}</span></div>`)
        .join('')

const EDGE_GAP = 420
let edgeDue = 0
const edgesPlanned = new Set<string>()
const edgeTimers = new Set<ReturnType<typeof setTimeout>>()
const edge = (name: string, bad = false) => {
    if (edgesPlanned.has(name)) return
    edgesPlanned.add(name)
    const tri = document.getElementById('tri')!
    const now = performance.now()
    const at = Math.max(now, edgeDue)
    edgeDue = at + EDGE_GAP
    const apply = () => {
        tri.classList.add(name)
        if (bad) tri.classList.add('bad')
    }
    if (at <= now) apply()
    else edgeTimers.add(setTimeout(apply, at - now))
}
const edgesSettled = () => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, edgeDue - performance.now())))
const resetEdges = () => {
    for (const timer of edgeTimers) clearTimeout(timer)
    edgeTimers.clear()
    edgesPlanned.clear()
    edgeDue = 0
}

const swapTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
const swap = (el: HTMLElement, text: string) => {
    if (el.textContent === text) return
    el.classList.add('swap', 'out')
    clearTimeout(swapTimers.get(el))
    swapTimers.set(
        el,
        setTimeout(() => {
            el.textContent = text
            el.classList.remove('out')
        }, 140)
    )
}

// The three reads under the crystal: what each read gave. Each draws its stretch of the line and its two edges of the window's frame.
const row = (step: number, value: string, state: 'busy' | 'lit' | 'idle' | 'bad' = 'lit') => {
    const li = $(`step-${step}`)
    li.classList.remove('busy', 'lit', 'idle', 'bad')
    li.classList.add(state)
    if (state === 'bad') li.classList.add('lit')
    swap(li.querySelector<HTMLElement>('.v')!, value)
    if ((state === 'lit' || state === 'bad') && step <= 3) edge(`e${step}`, step === 3 && state === 'bad')
}
const status = (state: 'checking' | 'verified' | 'mismatch' | 'idle') => {
    $('hero').classList.toggle('verified', state === 'verified')
    delete $('hero').dataset.sources
}

// ---------- config ----------

async function loadConfig(): Promise<Page> {
    // The single file carries the config inline; the served page fetches config.json.
    const inline = document.getElementById('config')?.textContent
    return inline ? (JSON.parse(inline) as Page) : ((await (await fetch('./config.json')).json()) as Page)
}

// A client reads what its RPC answers and asks no one else. viem would otherwise follow an off-chain lookup (CCIP-Read): a
// call that reverts naming URLs is a request to fetch them, and the URLs would be the RPC's to choose, or those of the
// contract a holder's name or avatar points at. A name kept off-chain is then not resolved, and its holder is shown by address.
const ownRpc = { ccipRead: false } as const

// Where the page reads Ethereum from. A wallet in the browser, when there is one, is the visitor's own way to the chain:
// it is asked first, for reads only, never for an account, a signature or a change of network. Then the RPCs of the
// configuration, in order. A wallet is asked only on a network the page has RPCs for: it is another way to the same
// chain, not a way to another one.
type Source = { name: string; transport: Transport }
function sources(config: Page, chainId: number): Source[] {
    const rpcs = (config.rpcs?.[chainId] ?? []).map(url => ({ name: new URL(url).host, transport: http(url, { retryCount: 1, timeout: 8_000 }) }))
    const wallet = (window as unknown as { ethereum?: Parameters<typeof custom>[0] }).ethereum
    return rpcs.length && typeof wallet?.request === 'function' ? [{ name: 'your wallet', transport: custom(wallet, { retryCount: 0 }) }, ...rpcs] : rpcs
}
const when = (anchored: bigint) => (anchored ? new Date(Number(anchored) * 1000).toISOString() : null)

// What the page asks the contract: four questions, through viem.
type Reader = {
    recordOf: (id: bigint) => Promise<Hex>
    ownerOf: (id: bigint) => Promise<Address | null>
    anchoredAt: (ref: Hex) => Promise<readonly [bigint, bigint]>
    anchorTx: (ref: Hex, block: bigint) => Promise<Hex | null>
}
function liveReader(client: ReturnType<typeof createClient>, address: Address): Reader {
    const contract = { address, abi } as const
    return {
        recordOf: id => readContract(client, { ...contract, functionName: 'recordOf', args: [id] }),
        // null is the contract's own word that the twin is not created yet; an RPC that fails has said nothing about the twin
        ownerOf: id =>
            readContract(client, { ...contract, functionName: 'ownerOf', args: [id] }).catch(error => {
                const revert = error instanceof BaseError ? error.walk(cause => cause instanceof ContractFunctionRevertedError) : null
                if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName === 'ERC721NonexistentToken') return null
                throw error
            }),
        anchoredAt: ref => readContract(client, { ...contract, functionName: 'anchoredAt', args: [ref] }),
        anchorTx: async (ref, block) => {
            const logs = await getContractEvents(client, { ...contract, eventName: 'Anchored', args: { ref }, fromBlock: block, toBlock: block }).catch(() => [])
            return logs[0]?.transactionHash ?? null
        }
    }
}

// Is this contract one of ours: listed in the config or, on mainnet, named by fairfooddata.eth.
async function isOfficial(config: Page, chainId: number, contract: Address, source: Source) {
    if ([config.contract, ...(config.contracts ?? [])].some(listed => isAddressEqual(listed, contract))) return true
    if (chainId !== 1) return false
    const client = createClient({ chain: mainnet, transport: source.transport, ...ownRpc })
    // no record under that name is an answer, and it is null; an RPC that fails is not one, and it is thrown
    const listed = await getEnsText(client, { name: 'fairfooddata.eth', key: 'ffd.contract' })
    return !!listed && isAddress(listed) && isAddressEqual(listed, contract)
}

// The second opinion. What Ethereum says is anchored reaches the page through a source, and a source that lied could seal
// anything. So another one is asked the two things the check rests on, and nothing else: which record the bag has, and
// whether each record has its anchor, and since when. The answer is whether it says the same; null is that there was no
// other source, or that none of them answered.
async function secondOpinion(others: Source[], chainId: number, contract: Address, id: bigint, run: Hex, events: Event[]) {
    for (const source of others) {
        try {
            const client = createClient({ transport: source.transport, ...ownRpc })
            if ((await getChainId(client)) !== chainId) continue
            const reader = liveReader(client, contract)
            const [head, anchors] = await Promise.all([reader.recordOf(id), Promise.all(events.map(event => reader.anchoredAt(event.ref)))])
            const same = head === run && events.every((event, i) => when(anchors[i]![0]) === event.at && anchors[i]![1] === event.block)
            return { name: source.name, same }
        } catch (error) {
            console.error(error)
        }
    }
    return null
}

// Two sources that do not say the same: one of them is not telling what is anchored, and the page cannot tell which. So the
// plate opens again, as for a record that does not match: the Ethereum read says so, the edge of the anchor breaks, the
// line under the seal and the day of the stamp go, and a notice says it, with Try again. What was read stays below, as read.
function disagree() {
    $('hero').classList.remove('verified')
    $('proof-fold').classList.remove('open')
    $('alive').hidden = true
    $('tri').classList.add('bad')
    row(1, 'sources disagree', 'bad')
    notice('Two sources disagree about this bag.', 'Two sources of Ethereum gave different answers about its records, so the page cannot say which one is right. Try again in a moment.', true)
}

// ---------- the record cards (block 4) ----------

// The two minima of a cycle, as its card names them: rows at first, and the figures above the chart once the curves are drawn.
const COLDEST = 'Coldest'
const LOWEST = 'Lowest pressure'

const steps = {
    intake: (r: Record) => ({
        title: 'Received',
        twin: true,
        rows: [
            ['Fruit', cap(r.fruit)],
            ['Weight', `${r.kg} kg`],
            ['Supplier', r.supplier],
            ['Sourcing', sourcings[r.sourcing ?? '']],
            ...(r.farms ?? []).map(f => ['Origin', farm(f)]),
            ['Delivery note', r.delivery_note],
            ['Plant lot', r.plant_id]
        ]
    }),
    cycle: (r: Record) => ({
        title: 'Freeze-dried',
        twin: false,
        rows: [
            ['Machine', r.machine],
            ['Duration', hours(r.start, r.end)],
            ['Loaded', loaded(r.loads)],
            ['Dried out', r.kg_out != null ? `${r.kg_out} kg` : null],
            [COLDEST, r.min_temperature_c != null ? `${r.min_temperature_c} °C` : null],
            [LOWEST, r.min_pressure_pa != null ? `${r.min_pressure_pa} Pa` : null],
            ['Moisture left', r.moisture_pct != null ? `${r.moisture_pct} %` : null],
            ['Energy', r.kwh != null ? `${r.kwh} kWh` : null],
            ['Cycle', r.plant_id]
        ]
    }),
    packing: (r: Record) => ({
        title: 'Packed',
        twin: false,
        rows: [
            ['Product', cap(r.product)],
            ['Bag', r.bag_g != null ? `${r.bag_g} g` : null],
            ['Lot', r.lot],
            ['Order', r.plant_id]
        ]
    }),
    transport: (r: Record) => ({
        title: 'Delivered',
        twin: false,
        rows: [
            ['Product', cap(r.product)],
            ['From', place(r.origin)],
            ['To', r.destination],
            ['Departed', r.departure && date(r.departure)],
            ['Arrived', r.arrival && date(r.arrival)],
            ['Carrier', r.carrier],
            ['Tracking', r.tracking]
        ]
    })
}

// What a record says, when the page can show it: an object, of a phase the page knows, written at a moment it can place,
// whose inputs are references and whose rows can be drawn. The types above are what a record should be, not what it is.
// This is where that is found out, once, before anything is painted from it. A record that passed the check and is not
// that is a record all the same: it has no `data`, it gets a card that says so, and the rest of the page goes on. The
// records it names are followed either way, when it names them as references: a phase the page does not know yet must
// not hide what came before it.
export function read(text: string): { data: Record | null; inputs: Hex[] } {
    let inputs: Hex[] = []
    try {
        const data = JSON.parse(text) as Record
        if (data.inputs != null) inputs = data.inputs.map(input => hex(input))
        const known = typeof data.phase === 'string' && Object.hasOwn(steps, data.phase)
        const placed = typeof data.at === 'string' && !Number.isNaN(Date.parse(data.at))
        const named = data.product == null || typeof data.product === 'string'
        if (!known || !placed || !named) return { data: null, inputs }
        rows(steps[data.phase](data).rows)
        return { data, inputs }
    } catch {
        return { data: null, inputs }
    }
}

// The most of a record's text a card shows when the page could not read it as a record.
const RAW_SHOWN = 4000

// ---------- the glyphs of the path ----------

// One per record, at the head of its card, drawn from the geometry of the pack: the hexagon of the crystal and the diamond
// of its ornament. Received is the fruit in its crate; Freeze-dried, the crystal grown from the hexagon; Packed, the pouch
// with its window; Delivered, the route out of the diamond to where the bag went. Filled in the three tints of the pouch's
// crystal (ga, gb, gc) and outlined in the deep one (gs). They are the page's own markup: nothing of a record is in them.
const HEXAGON_MID = 'M15.12 13.8L12 15.6L8.88 13.8L8.88 10.2L12 8.4L15.12 10.2Z'
const HEXAGON_LOW = 'M15.12 16L12 17.8L8.88 16L8.88 12.4L12 10.6L15.12 12.4Z'
const CRYSTAL =
    'M12 8.6V2.6M12 5.4l-1.99-1.15M12 5.4l1.99-1.15M14.94 10.3l5.2-3M17.72 8.7V6.4M17.72 8.7l1.99 1.15M14.94 13.7l5.2 3M17.72 15.3l1.99-1.15M17.72 15.3v2.3M12 15.4v6M12 18.6l1.99 1.15M12 18.6l-1.99 1.15M9.06 13.7l-5.2 3M6.28 15.3v2.3M6.28 15.3l-1.99-1.15M9.06 10.3l-5.2-3M6.28 8.7l-1.99 1.15M6.28 8.7V6.4'
const GLYPHS: { [phase: string]: string } = {
    intake: '<path class="gb" d="M4.2 11.5h15.6l-1.5 8.3H5.7z"/><path class="ga" opacity=".5" d="M7.1 11.5h9.8l-.9 5H8z"/><circle class="ga" cx="9.4" cy="7.6" r="3.2"/><circle class="gc" cx="14.9" cy="8.1" r="2.9"/><path class="gs" d="M14.4 5.2c.6-1.5 1.9-2.3 3.5-2.2"/>',
    cycle: `<path class="ga" d="${HEXAGON_MID}"/><path class="gs gw" d="${CRYSTAL}"/><path class="gc" d="M12 10.6l1.4 1.4-1.4 1.4-1.4-1.4z"/>`,
    packing: `<path class="gb" d="M7.2 3.6h9.6l1.8 2.6v12.9a1.5 1.5 0 0 1-1.5 1.5H6.9a1.5 1.5 0 0 1-1.5-1.5V6.2z"/><path class="ga" d="M5.6 8.2h12.8v1.2H5.6z"/><path class="ga" d="${HEXAGON_LOW}"/><path class="gc" d="M12 12.8l1.4 1.4-1.4 1.4-1.4-1.4z"/>`,
    transport:
        '<path class="gc" d="M5 16.2l2.2 2.2-2.2 2.2-2.2-2.2z"/><path class="gs" stroke-dasharray="2.4 2.2" d="M6.9 18.4c3.4 0 3.1-5.4 6.4-5.4 2.3 0 2.6 1.8 4.7 1.8"/><path class="gb" d="M19 5.3a3.1 3.1 0 0 1 3.1 3.1c0 2.4-3.1 5.8-3.1 5.8s-3.1-3.4-3.1-5.8A3.1 3.1 0 0 1 19 5.3z"/><circle class="ga" cx="19" cy="8.4" r="1.3"/>'
}
const glyph = (phase: string) => (Object.hasOwn(GLYPHS, phase) ? `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[phase]}</svg>` : '')

function card(event: Event, explorer: string | undefined) {
    const data = event.data
    // A record that did not pass the check was not read: its card carries the reference the page asked for and nothing of what arrived.
    if (!event.verified)
        return `
        <h2>Record not shown</h2>
        <p class="check pending">Checking against its Ethereum anchor…</p>
        <details><summary>Reference</summary><p>Swarm <code>${esc(event.ref)}</code></p></details>`
    // the check and the links of a record that was read: its anchor, its file, and what else the record names (`more`)
    const links = (more = '') => `
        <p class="check pending">Checking against its Ethereum anchor…</p>
        <div class="links">
            ${explorer && event.block ? `<a class="btn anchor" href="${esc(`${explorer}/block/${event.block}`)}" target="_blank" rel="noopener">Ethereum anchor ↗</a>` : ''}
            <a class="btn" href="${esc(`${event.gateway}/bytes/${event.ref.slice(2)}`)}" target="_blank" rel="noopener">Swarm file ↗</a>${more}
        </div>`
    // A record that passed the check and is not one the page knows how to show: what it says, as it was written, and no rows.
    if (!data) {
        const raw = event.raw ?? ''
        return `
        <h2>Record not understood</h2>
        <div class="chips"><span class="chip wait">A kind this page does not know</span></div>${links()}
        <details><summary>Raw record</summary><pre>${esc(raw.length > RAW_SHOWN ? `${raw.slice(0, RAW_SHOWN)}…` : raw)}</pre><p>Swarm <code>${esc(event.ref)}</code></p></details>`
    }
    const { title, twin, rows: list } = steps[data.phase](data)
    // A cycle names the SenML of its curves, which the page links and never downloads: a line in the small print of the
    // card, beside the raw record, there when the record names a reference, from the gateway that served the record, and
    // nowhere otherwise. The curves themselves come later, drawn from the light file the record also names (drawCurves).
    const telemetry = data.phase === 'cycle' ? refOf(data.telemetry) : null
    const curves = telemetry ? `<p class="quiet"><a href="${esc(`${event.gateway}/bytes/${telemetry.slice(2)}`)}" target="_blank" rel="noopener">Full curve data ↗</a></p>` : ''
    return `
        <h2>${glyph(data.phase)}${esc(title)}</h2>
        ${twin ? '<p class="twin-born">This bag’s twin starts here.</p>' : ''}
        ${rows(list)}${links()}
        ${curves}
        <details><summary>Raw record</summary><pre>${esc(JSON.stringify(data, null, 2))}</pre><p>Swarm <code>${esc(event.ref)}</code></p></details>`
}

// Cards are painted as their record arrives and kept in the order of the events.
const UNFOLD_GAP = 220
const laterTimers = new Set<ReturnType<typeof setTimeout>>()
const later = (fn: () => void, ms: number) => laterTimers.add(setTimeout(fn, ms))
const openPath = (path: HTMLOListElement, from: number) => {
    const cards = [...path.querySelectorAll<HTMLElement>('li.step')]
    cards.forEach((li, i) => later(() => li.classList.add('open'), from + i * UNFOLD_GAP))
    return from + Math.max(0, cards.length - 1) * UNFOLD_GAP
}
const resetLater = () => {
    for (const timer of laterTimers) clearTimeout(timer)
    laterTimers.clear()
}

// The station of a card on the line: the day and the month the record gives. A record that was not read, or not understood, has no date to give.
function tile({ data, verified }: Event) {
    if (!data) return `<span class="tile"><b>${verified ? '?' : '✗'}</b></span>`
    const when = new Date(data.at)
    const d = when.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })
    const m = when.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    return `<time class="tile" datetime="${esc(data.at)}"><b>${d}</b><span>${m}</span></time>`
}

export function placeCard(path: HTMLOListElement, events: Event[], event: Event, explorer: string | undefined) {
    const li = document.createElement('li')
    li.className = 'step'
    li.dataset.ref = event.ref
    li.innerHTML = `<div class="unfold"><div class="unfold-in">${tile(event)}<div class="card">${card(event, explorer)}</div></div></div>`
    const index = events.indexOf(event)
    const next = events[index + 1]
    const before = next ? path.querySelector<HTMLLIElement>(`li[data-ref="${next.ref}"]`) : null
    path.insertBefore(li, before)
    return li
}

function markCheck(li: HTMLElement, event: Event) {
    li.classList.add(event.verified ? 'ok' : 'bad')
    const check = li.querySelector('.check')!
    check.classList.remove('pending')
    check.classList.add(event.verified ? 'ok' : 'bad')
    swap(check as HTMLElement, event.verified ? `✓ Matches its Ethereum anchor of ${date(event.at!)}` : '✗ Does not match any Ethereum anchor')
}

// ---------- the files a record names ----------

// A record names files among its documents, each by its name, its type and its reference. The page knows the ones it reads
// by their name and the type each must declare, and looks for each in the record that names it: the packing record names
// the files of the product, the intake record the location of the plant, the transport record its destination. A document
// under another name, of another type, or whose reference is not one, is not that file, and the page does not ask for it;
// a record that was not read, or not understood, names nothing.
export function documentOf(record: Record | null | undefined, name: string, type: string): Hex | null {
    const documents = record?.documents
    if (!Array.isArray(documents)) return null
    for (const entry of documents as unknown[]) {
        if (typeof entry !== 'object' || entry === null) continue
        const { name: named, type: typed, ref } = entry as { name?: unknown; type?: unknown; ref?: unknown }
        if (named !== name || typed !== type) continue
        try {
            return hex(ref)
        } catch {
            // not a reference: there is nothing to ask a gateway for, and the next of that name may be one
        }
    }
    return null
}

// ---------- the gateways: in order, and one that did not answer last ----------

// The gateways are asked in the order of the configuration. One that did not answer, that kept the page waiting until it
// gave up or could not be reached at all, is asked after the others for whatever the page asks from then on, so that it
// costs its wait once and not once per file; what was already asked of it waits for it as before. One that answered,
// with an error or with other bytes, keeps its place. Try again starts from the order of the configuration.
const stalled = new Set<string>()
const unanswered = (error: unknown) => error instanceof Error && ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)
const inTurn = (gateways: string[]) => [...gateways.filter(gateway => !stalled.has(gateway)), ...gateways.filter(gateway => stalled.has(gateway))]

// ---------- the product: the files the packing record names ----------

// What the page says of the fruit hangs from the bag's packing record: among its documents, four files. The description
// says what the bag holds; the other three are the photograph of the fruit and the two illustrations of the twin, taken
// from the art of its pouch: the cover, which opens the page, and the background of the label.
const DESCRIPTION = 'product-description.json'
const PHOTO = 'photo.webp'
const COVER = 'cover.webp'
const BACKGROUND = 'background.webp'
const PRODUCT_FILES: { [name: string]: string } = { [DESCRIPTION]: 'application/json', [PHOTO]: 'image/webp', [COVER]: 'image/webp', [BACKGROUND]: 'image/webp' }

export function productFiles(events: Event[]) {
    const files = new Map<string, Hex>()
    const packing = events.find(e => e.data?.phase === 'packing')?.data
    for (const [name, type] of Object.entries(PRODUCT_FILES)) {
        const ref = documentOf(packing, name, type)
        if (ref) files.set(name, ref)
    }
    return files
}

// A file of the product, by its reference: the bytes of the first gateway that serves what the reference names. What a
// gateway serves is hashed the way Swarm does before a byte of it is used, as a record is; the reference is in a record
// that has its anchor, so the file is the one that record was sealed with. Null when no gateway has it, when none answers,
// or when it weighs more than the page takes.
async function fileOf(gateways: string[], ref: Hex) {
    for (const gateway of inTurn(gateways)) {
        try {
            const bytes = await download(gateway, ref)
            if (swarmHash(bytes) === ref) return bytes
        } catch (error) {
            // the next gateway is asked
            if (unanswered(error)) stalled.add(gateway)
        }
    }
    return null
}

const DESCRIPTION_SCHEMA = 'ffd/product-description/1.0'
const LINE_MOST = 300
// the rows a table takes beyond its six figures: a label has room for these, and a file could name any number
const MICRO_MOST = 12
// a line of text the page can show: a string, not empty, of a length a line has
const line = (value: unknown) => (typeof value === 'string' && value.trim() !== '' && value.length <= LINE_MOST ? value : null)
// an amount per 100 g: a number from 0
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
// a date of the label: a month, 2026-09, or a day, 2026-09-24, and nothing else
const DATE = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/
const labelDate = (value: unknown) => (typeof value === 'string' && DATE.test(value) ? value : null)

// What a description says, when the page can show it. Like a record, it is found out here, once, before anything is
// painted from it: the table is there only when its six figures are numbers, and a name, a text or a credit only when
// it is a line of text. A description of another kind, or that is not JSON, says nothing.
export function readDescription(bytes: Uint8Array): Description | null {
    try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { [key: string]: unknown } | null
        if (typeof value !== 'object' || value === null || value.schema !== DESCRIPTION_SCHEMA) return null
        const n = (typeof value.nutrition === 'object' && value.nutrition !== null ? value.nutrition : {}) as { [key: string]: unknown }
        const figures = [n.energy_kcal, n.carbohydrate_g, n.sugars_g, n.protein_g, n.fat_g, n.fibre_g]
        const micro = (Array.isArray(n.micro) ? n.micro : []).filter((m): m is [string, number, string] => Array.isArray(m) && line(m[0]) !== null && amount(m[1]) && line(m[2]) !== null).slice(0, MICRO_MOST)
        const [energy_kcal, carbohydrate_g, sugars_g, protein_g, fat_g, fibre_g] = figures as number[]
        const more = (value: unknown) => (amount(value) ? value : null)
        const rest = { energy_kj: more(n.energy_kj), saturated_fat_g: more(n.saturated_fat_g), salt_g: more(n.salt_g), micro, source: line(n.source) }
        const nutrition = figures.every(amount) ? { energy_kcal: energy_kcal!, carbohydrate_g: carbohydrate_g!, sugars_g: sugars_g!, protein_g: protein_g!, fat_g: fat_g!, fibre_g: fibre_g!, ...rest } : null
        const photo = (typeof value.photo === 'object' && value.photo !== null ? value.photo : {}) as { [key: string]: unknown }
        return { fruit: line(value.fruit), name: line(value.name), nutrition, alt: line(photo.alt), credit: line(photo.credit), manufactured: labelDate(value.manufactured), expires: labelDate(value.expires) }
    } catch {
        return null
    }
}

// The product of the bag on screen: the files its packing record names, the gateways to ask for them, and what its
// description says, which is asked for as soon as the records are read and may come after the seal.
type Product = { files: Map<string, Hex>; gateways: string[]; description: Promise<Description | null> }
let product: Product | null = null

function readProduct(gateways: string[], events: Event[]): Product {
    const files = productFiles(events)
    const ref = files.get(DESCRIPTION)
    const description = ref ? fileOf(gateways, ref).then(bytes => (bytes ? readDescription(bytes) : null)) : Promise.resolve(null)
    return { files, gateways, description }
}

// ---------- the plant: where the intake record says it is ----------

const SITE_LOCATION = 'site-location.geojson'
const GEOJSON = 'application/geo+json'
// a coordinate: a number, finite, within so many degrees of zero
const coordinate = (value: unknown, most: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= most

// Where a location file says a place is, when the page can show it: a GeoJSON Feature whose geometry is a Point, with two
// coordinates, the longitude and then the latitude, as GeoJSON writes them, that are on Earth; the words for the place
// and the key of the site, each when it is a line of text; and the code of the country, when it is two capital letters.
// Like a description it is found out here, once, before anything is painted from it. A file of another shape, or that
// is not JSON, says nothing.
export function readPoint(bytes: Uint8Array): Point | null {
    try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { [key: string]: unknown } | null
        if (typeof value !== 'object' || value === null || value.type !== 'Feature') return null
        const geometry = (typeof value.geometry === 'object' && value.geometry !== null ? value.geometry : {}) as { [key: string]: unknown }
        const coordinates = Array.isArray(geometry.coordinates) ? (geometry.coordinates as unknown[]) : []
        const [lon, lat] = coordinates
        if (geometry.type !== 'Point' || coordinates.length !== 2 || !coordinate(lon, 180) || !coordinate(lat, 90)) return null
        const properties = (typeof value.properties === 'object' && value.properties !== null ? value.properties : {}) as { [key: string]: unknown }
        const code = typeof properties.country === 'string' && /^[A-Z]{2}$/.test(properties.country) ? properties.country : null
        return { site: line(properties.site), place: line(properties.place), country: code, lat, lon }
    } catch {
        return null
    }
}

// The places of the path, kept as each file comes, with their coordinates: the plant, from the file the intake record
// names, and where the bag went, from the file the transport record names, for the map of the Delivered card to join
// them. Another bag starts from none.
export const places: { plant: Point | null; destination: Point | null } = { plant: null, destination: null }

// The coordinates as a visitor reads them, 20.2353° N, 85.1091° E, and as OpenStreetMap takes them: in the address only
// numbers of the page's own making, to six decimals, and nothing the file said.
const geo = ({ lat, lon }: Point) => `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`
const osm = ({ lat, lon }: Point) => `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=15/${lat.toFixed(6)}/${lon.toFixed(6)}`
// the coordinates of a place as a row: linked to OpenStreetMap, which the small print under them names
const geoRow = (key: string, point: Point) => [key, geo(point), osm(point), 'OpenStreetMap']

// The rows a file adds to a card already on screen, set before the element given: they land as the blocks do.
function landRows(before: Element, list: (string | null | undefined)[][]) {
    const late = document.createElement('template')
    late.innerHTML = rows(list)
    late.content.querySelectorAll('.row').forEach(row => row.classList.add('late'))
    before.before(late.content)
}

// Where the plant is. The intake record names the file among its documents; it is asked for once the records are checked,
// with the description, and read like it: hashed against its reference, then found out once. When it has come, the
// Received card, already on screen, gains two rows before its check: the place, with the flag of its country after it,
// by the code the file gives or else the name its words end with, and the coordinates, linked to OpenStreetMap, which
// is asked for nothing unless the link is tapped.
async function placePlant(mine: Product, events: Event[], cards: Map<Hex, HTMLElement>) {
    const intake = events.find(e => e.data?.phase === 'intake')
    const ref = documentOf(intake?.data, SITE_LOCATION, GEOJSON)
    if (!intake || !ref) return
    const bytes = await fileOf(mine.gateways, ref)
    const point = bytes ? readPoint(bytes) : null
    if (!point || product !== mine) return // it did not come, or another bag is being read
    places.plant = point
    const check = cards.get(intake.ref)?.querySelector('.check')
    if (check) landRows(check, [['Site', flagged(point.country ?? countryOf(point.place), point.place)], geoRow('GPS', point)])
}

// ---------- the curves of a cycle: the light file its record names ----------

// A cycle record names its curves twice: `telemetry`, the readings of the machine as SenML, about 2 MB, which the page
// links and never downloads, and `telemetry_preview`, the same curves in columns, one clock and one list of values per
// series, which the Notary publishes for the page. The page draws the second, read like a file of the product: hashed
// against its reference, found out once, and drawn from its numbers alone. The names of its series are matched against
// the ones the page knows, and nothing written in the file reaches the markup.
const PREVIEW_SCHEMA = 'ffd/telemetry-preview/1.0'
// a preview carries at most 600 points per series; the page draws up to this many
const POINTS_MOST = 2000
// the series the page draws, each in the unit the SenML gives it: the chamber, its pressure and up to eight shelves
const CHAMBER = 'chamber_temperature'
const PRESSURE = 'chamber_pressure'
const SHELVES = Array.from({ length: 8 }, (_, i) => `shelf_${i + 1}_temperature`)
const SERIES: { [name: string]: string } = { [CHAMBER]: 'Cel', [PRESSURE]: 'Pa', ...Object.fromEntries(SHELVES.map(name => [name, 'Cel'])) }
type Preview = { t: number[]; series: Map<string, (number | null)[]> }

// A Swarm reference a record names, or null: what is not one is asked of no gateway and linked nowhere.
const refOf = (value: unknown) => {
    try {
        return hex(value)
    } catch {
        return null
    }
}

// What a preview says, when the page can draw it: a clock of two to 2000 finite seconds that never goes back and does
// advance, and for each series the page knows, in its unit, one number or null per tick of the clock. A series the page
// does not know, or one in another unit, is passed over; one it knows whose values do not fit the clock makes the file
// one the page does not draw. The cycle, the site and the device the file names are not read: the record says them.
export function readPreview(bytes: Uint8Array): Preview | null {
    try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { [key: string]: unknown } | null
        if (typeof value !== 'object' || value === null || value.schema !== PREVIEW_SCHEMA) return null
        const t = value.t
        if (!Array.isArray(t) || t.length < 2 || t.length > POINTS_MOST || !Array.isArray(value.series)) return null
        if (!t.every((s, i) => typeof s === 'number' && Number.isFinite(s) && (i === 0 || s >= t[i - 1])) || t[t.length - 1] <= t[0]) return null
        const series = new Map<string, (number | null)[]>()
        for (const entry of value.series as unknown[]) {
            if (typeof entry !== 'object' || entry === null) continue
            const { n, u, v } = entry as { n?: unknown; u?: unknown; v?: unknown }
            if (typeof n !== 'string' || !Object.hasOwn(SERIES, n) || series.has(n) || (u != null && u !== SERIES[n])) continue
            if (!Array.isArray(v) || v.length !== t.length || !v.every(x => x === null || (typeof x === 'number' && Number.isFinite(x)))) return null
            series.set(n, v as (number | null)[])
        }
        return series.size ? { t: t as number[], series } : null
    } catch {
        return null
    }
}

// The chart: a box in units of its own, scaled to the width of the card, with the plot inside margins that hold the marks
const CHART = { w: 300, h: 172, x0: 30, x1: 266, y0: 16, y1: 150 }
// the steps a scale of °C may take, and the ones a scale of hours may
const DEGREE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]
const HOUR_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 24, 48, 96, 168, 336, 720]
// a number as a mark reads it, without the noise of the arithmetic of the scale
const num = (value: number) => String(Number(value.toPrecision(12)))
// a pressure as the scale of Pa marks it: 20, 500, 1k, 100k
const pascal = (value: number) => (value < 1000 ? num(value) : value < 1e6 ? `${num(value / 1000)}k` : value < 1e9 ? `${num(value / 1e6)}M` : `1e${Math.round(Math.log10(value))}`)
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
// the step of a scale: the first of the steps it may take that divides the span into `parts` or fewer, else a round number that does
function stepOf(span: number, parts: number, steps: number[]) {
    const least = span / parts
    const fit = steps.find(step => step >= least)
    if (fit) return fit
    const pow = 10 ** Math.floor(Math.log10(least))
    return [1, 2, 2.5, 5, 10].map(m => m * pow).find(step => step >= least) ?? least
}
const given = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const numbers = (values: (number | null)[]) => values.filter((v): v is number => v !== null)
const minOf = (values: number[]) => values.reduce((a, b) => Math.min(a, b), Infinity)
const maxOf = (values: number[]) => values.reduce((a, b) => Math.max(a, b), -Infinity)
// where a series is lowest: the index of its smallest number
const lowestAt = (values: (number | null)[]) => {
    let at = -1
    values.forEach((v, i) => {
        if (v !== null && (at < 0 || v < values[at]!)) at = i
    })
    return at
}
// the line of a series: its numbers joined in the order of the clock, lifted where the series did not read
function curve(values: (number | null)[], x: number[], y: (v: number) => number | null) {
    let d = ''
    let pen = false
    values.forEach((v, i) => {
        const py = v === null ? null : y(v)
        if (py === null) return void (pen = false)
        d += `${pen ? 'L' : 'M'}${x[i]!.toFixed(1)} ${py.toFixed(1)}`
        pen = true
    })
    return d
}
// The ground under a series: each unbroken run of its line, closed down to the base of the chart
function band(values: (number | null)[], x: number[], y: (v: number) => number | null, base: number) {
    let d = ''
    let run: string[] = []
    let from = -1
    const close = (to: number) => {
        if (run.length) d += `M${run.join('L')}L${x[to]!.toFixed(1)} ${base.toFixed(1)}L${x[from]!.toFixed(1)} ${base.toFixed(1)}Z`
        run = []
    }
    values.forEach((v, i) => {
        const py = v === null ? null : y(v)
        if (py === null) return close(i - 1)
        if (!run.length) from = i
        run.push(`${x[i]!.toFixed(1)} ${py.toFixed(1)}`)
    })
    close(values.length - 1)
    return d
}
const caption = (x: number, y: number, label: string, cls: string, anchor: 'start' | 'middle' | 'end' = 'start') =>
    `<text class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${esc(label)}</text>`

// The cycle drawn: the chamber temperature and the shelves on a scale of °C at the left, the pressure on a scale of Pa
// at the right in powers of ten, both over the hours since the cycle began, with three or four marks per scale, and the
// two minima the record declares, each set on its curve where the curve is lowest. The markup is the page's own words
// and numbers: nothing written in the file, or in the record, reaches it. Empty when the file has nothing to draw.
export function drawCycle(preview: Preview, record: Record): string {
    const { w, h, x0, x1, y0, y1 } = CHART
    const clock = preview.t.map(s => s / 3600)
    const h0 = clock[0]!, h1 = clock[clock.length - 1]!
    const sx = (hr: number) => x0 + ((hr - h0) / (h1 - h0)) * (x1 - x0)
    const x = clock.map(sx)
    const chamber = preview.series.get(CHAMBER) ?? null
    const shelves = SHELVES.map(name => preview.series.get(name)).filter((v): v is (number | null)[] => v !== undefined)
    const pressure = preview.series.get(PRESSURE) ?? null
    const pascals = pressure ? numbers(pressure).filter(p => p > 0) : []
    // the minima the record declares, when they are numbers and there is a curve to set them on
    const coldest = chamber && numbers(chamber).length && given(record.min_temperature_c) ? record.min_temperature_c : null
    const lowestPa = pascals.length && given(record.min_pressure_pa) && record.min_pressure_pa > 0 ? record.min_pressure_pa : null
    // the scale of °C: what the chamber and the shelves read, and the coldest, rounded out to a step of the scale
    const degrees = [...(chamber ? numbers(chamber) : []), ...shelves.flatMap(numbers), ...(coldest === null ? [] : [coldest])]
    let left: { lo: number; hi: number; ticks: number[] } | null = null
    if (degrees.length) {
        const min = minOf(degrees), max = maxOf(degrees)
        const step = stepOf(max - min, 3, DEGREE_STEPS)
        const lo = Math.floor(min / step) * step
        const hi = Math.max(Math.ceil(max / step) * step, lo + step)
        const count = Math.round((hi - lo) / step)
        if (hi > lo && count <= 12) left = { lo, hi, ticks: Array.from({ length: count + 1 }, (_, i) => lo + i * step) }
    }
    // the scale of Pa, in powers of ten: from a little under the lowest reading, or the lowest declared, to a little over the highest
    let right: { lo: number; hi: number; ticks: number[] } | null = null
    if (pascals.length) {
        const min = Math.log10(minOf([...pascals, ...(lowestPa === null ? [] : [lowestPa])])), max = Math.log10(maxOf(pascals))
        const pad = Math.max((max - min) * 0.05, 0.05)
        const lo = min - pad, hi = max + pad
        // the marks, in powers of ten: the decades inside the scale or, when it holds fewer than three, the 1, 2 and 5 of each
        const inside = (marks: number[]) => marks.filter(mark => mark >= lo && mark <= hi)
        const decades = range(Math.floor(lo), Math.ceil(hi))
        let ticks = inside(decades)
        if (ticks.length < 3) ticks = inside(decades.flatMap(k => [k, k + Math.log10(2), k + Math.log10(5)]))
        const every = Math.max(1, Math.ceil(ticks.length / 4))
        right = { lo, hi, ticks: ticks.filter((_, i) => i % every === 0) }
    }
    if (!left && !right) return ''
    const scale = (lo: number, hi: number) => (v: number) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0)
    const yT = left ? scale(left.lo, left.hi) : null
    const yP = right ? scale(right.lo, right.hi) : null
    // the marks: the hours along the bottom, the degrees at the left with a faint line across, the powers of ten at the right
    const axis = [`M${x0} ${y1}H${x1}`], grid: string[] = [], marks: string[] = []
    const hourStep = stepOf(h1 - h0, 4, HOUR_STEPS)
    const firstHour = Math.ceil(h0 / hourStep) * hourStep
    for (let i = 0; i < 12; i++) {
        const hr = firstHour + i * hourStep
        if (hr > h1 + 1e-9) break
        axis.push(`M${sx(hr).toFixed(1)} ${y1}v3`)
        marks.push(caption(sx(hr), h - 4, hr + hourStep > h1 ? `${num(hr)} h` : num(hr), 'hour', 'middle'))
    }
    if (left && yT) {
        marks.push(caption(x0 - 4, y0 - 7, '°C', 'unit', 'end'))
        for (const v of left.ticks) {
            grid.push(`M${x0} ${yT(v).toFixed(1)}H${x1}`)
            marks.push(caption(x0 - 4, yT(v) + 3, num(v), 'degree', 'end'))
        }
    }
    if (right && yP) {
        marks.push(caption(x1 + 4, y0 - 7, 'Pa', 'unit'))
        for (const k of right.ticks) {
            axis.push(`M${x1} ${yP(k).toFixed(1)}h3`)
            marks.push(caption(x1 + 5, yP(k) + 3, pascal(10 ** k), 'pascal'))
        }
    }
    // the lines: the ground under the chamber, then the shelves behind, the pressure, and the chamber in front
    const lines: string[] = []
    if (yT && chamber) lines.push(`<path class="fill" d="${band(chamber, x, yT, y1)}"/>`)
    if (yT) for (const shelf of shelves) lines.push(`<path class="line shelf" d="${curve(shelf, x, yT)}"/>`)
    if (yP && pressure) lines.push(`<path class="line press" d="${curve(pressure, x, p => (p > 0 ? yP(Math.log10(p)) : null))}"/>`)
    if (yT && chamber) lines.push(`<path class="line temp" pathLength="1" d="${curve(chamber, x, yT)}"/>`)
    // the two minima the record declares: each named above the chart, with the hour its curve was lowest, and marked on
    // the curve there, the coldest as the filled diamond and the lowest pressure as the ring
    const marksOn: string[] = [], stats: string[] = []
    const diamond = (cx: number, cy: number) => `<path class="min dot" d="M${cx.toFixed(1)} ${(cy - 3.6).toFixed(1)}l3.6 3.6-3.6 3.6-3.6-3.6z"/>`
    const ring = (cx: number, cy: number) => `<circle class="min ring" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.1"/>`
    const hour = (at: number) => num(Number(clock[at]!.toFixed(clock[at]! < 10 ? 1 : 0)))
    const stat = (row: string, mark: string, value: string, at: number) =>
        `<div class="stat" data-row="${esc(row)}"><dt><i class="mk ${mark}"></i>${esc(row)}</dt><dd><b>${esc(value)}</b><small>at ${hour(at)} h</small></dd></div>`
    if (coldest !== null && chamber && yT) {
        const at = lowestAt(chamber)
        marksOn.push(diamond(x[at]!, yT(coldest)))
        stats.push(stat(COLDEST, 'mk-cold', `${num(coldest)} °C`, at))
    }
    if (lowestPa !== null && pressure && yP) {
        const at = lowestAt(pressure.map(p => (p !== null && p > 0 ? p : null)))
        marksOn.push(ring(x[at]!, yP(Math.log10(lowestPa))))
        stats.push(stat(LOWEST, 'mk-low', `${num(lowestPa)} Pa`, at))
    }
    // the key under the chart names what is drawn, and so does the chart to whoever cannot see it
    const drawn: [boolean, string, string, string][] = [
        [!!chamber && !!yT && numbers(chamber).length > 0, 'temp', 'Chamber', 'the chamber temperature'],
        [!!yT && shelves.some(shelf => numbers(shelf).length > 0), 'shelf', 'Shelves', 'the shelves'],
        [!!pressure && !!yP, 'press', 'Pressure', 'the pressure']
    ]
    const there = drawn.filter(([is]) => is)
    return `<figure class="curves">
        ${stats.length ? `<dl class="minima">${stats.join('')}</dl>` : ''}
        <svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="The cycle over ${num(Number((h1 - h0).toFixed(1)))} hours: ${there.map(([, , , said]) => said).join(', ')}">
            ${grid.length ? `<path class="axis grid" d="${grid.join('')}"/>` : ''}
            <path class="axis" d="${axis.join('')}"/>
            ${marks.join('')}
            ${lines.join('')}
            ${marksOn.join('')}
        </svg>
        <figcaption class="key">${there.map(([, cls, name]) => `<span><i class="sw ${cls}"></i>${name}</span>`).join('')}</figcaption>
    </figure>`
}

// The curves of a cycle, drawn in its card once their file has come: asked for after the check, with the description of
// the product, and set between the rows and the check line of the card, which is already on screen. Nothing is drawn of
// a file that does not come, that is not what its reference names or that is not a preview the page can read, and
// nothing of one that comes once another bag is being read.
async function drawCurves(mine: Product, event: Event, li: HTMLElement) {
    const data = event.data
    const ref = refOf(data?.telemetry_preview)
    if (!ref || !data) return
    const bytes = await fileOf(mine.gateways, ref)
    const preview = bytes && readPreview(bytes)
    if (!preview || product !== mine) return
    const drawn = drawCycle(preview, data)
    if (!drawn) return
    li.querySelector('.card .check')?.insertAdjacentHTML('beforebegin', drawn)
    // the two minima now stand above the chart, with the hour they came: their rows give way to them
    const named = new Set([...li.querySelectorAll<HTMLElement>('.minima .stat')].map(stat => stat.dataset.row))
    for (const row of li.querySelectorAll<HTMLElement>('.card .row')) if (named.has(row.querySelector('.k')?.textContent ?? '')) row.remove()
    requestAnimationFrame(() => requestAnimationFrame(() => li.querySelector('.curves')?.classList.add('drawn')))
}

// ---------- the route: where the transport record says the bag went ----------

// The transport record names the file of its destination among its documents, as the intake record names the plant's,
// and the page reads it the same way. The Delivered card then says where the bag went and, once the plant has come as
// well and the transport names its site as the origin, draws the route between the two: a map of the page's own making,
// since the page loads no tile and no script from anyone. One transport, two places: the map never holds more.
const DESTINATION_LOCATION = 'destination-location.geojson'

// Where the bag went. Asked for with the plant's file, once the records are checked, and read like it. When it has come,
// the To row of the Delivered card, already on screen, gains the coordinates under the record's own words, linked to
// OpenStreetMap as the GPS of the plant is; a record that gave no words for its destination gets the row with the
// coordinates alone.
async function placeDestination(mine: Product, events: Event[], cards: Map<Hex, HTMLElement>) {
    const transport = events.find(e => e.data?.phase === 'transport')
    const ref = documentOf(transport?.data, DESTINATION_LOCATION, GEOJSON)
    if (!transport || !ref) return
    const bytes = await fileOf(mine.gateways, ref)
    const point = bytes ? readPoint(bytes) : null
    if (!point || product !== mine) return // it did not come, or another bag is being read
    places.destination = point
    const li = cards.get(transport.ref)
    const check = li?.querySelector('.card .check')
    if (!li || !check) return
    const to = [...li.querySelectorAll<HTMLElement>('.card .row')].find(row => row.querySelector('.k')?.textContent === 'To')
    if (to) to.querySelector('.v')?.insertAdjacentHTML('beforeend', `<span class="geo late">${linked(geo(point), osm(point), 'OpenStreetMap')}</span>`)
    else landRows(check, [geoRow('To', point)])
}

// The distance between two places as the crow flies, in kilometres, on a round Earth
const EARTH_KM = 6371
const rad = (degrees: number) => (degrees * Math.PI) / 180
function distance(a: Point, b: Point) {
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}
// a distance as the line under the map says it, to three figures and in whole kilometres: 1,290
const kilometres = (km: number) => Number(km.toPrecision(3)).toLocaleString('en-GB', { maximumFractionDigits: 0 })
// The days of a journey, from its departure to its arrival, rounded: null when the record does not give both as moments
function daysBetween(from: unknown, to: unknown) {
    const ms = typeof from === 'string' && typeof to === 'string' ? Date.parse(to) - Date.parse(from) : NaN
    return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 864e5) : null
}

// The map of OpenStreetMap over the two places, for the link under the map: the destination marked, the view centred
// between them at the widest zoom, 2 to 15, at which both fit in about 700 by 500 pixels of its Web Mercator, where the
// world is 256 pixels wide at zoom 0 and twice as wide each zoom in. In the address, numbers of the page's own making.
const VIEW = { w: 700, h: 500, tile: 256, least: 2, most: 15 }
const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))
function zoomOver(from: Point, to: Point) {
    const fits = (span: number, px: number, world: number) => Math.log2((px * world) / (VIEW.tile * span))
    const z = Math.min(fits(Math.abs(to.lon - from.lon), VIEW.w, 360), fits(Math.abs(mercator(to.lat) - mercator(from.lat)), VIEW.h, 2 * Math.PI))
    return z >= VIEW.most ? VIEW.most : z >= VIEW.least ? Math.floor(z) : VIEW.least
}
const osmView = (from: Point, to: Point) =>
    `https://www.openstreetmap.org/?mlat=${to.lat.toFixed(6)}&mlon=${to.lon.toFixed(6)}#map=${zoomOver(from, to)}/${((from.lat + to.lat) / 2).toFixed(6)}/${((from.lon + to.lon) / 2).toFixed(6)}`

// The map: a box in units of its own, scaled to the width of the card, with the two places inside margins that hold their
// names; the line between them bows to the north by this much of its length
const MAP = { w: 300, h: 170, x0: 36, x1: 264, y0: 24, y1: 146 }
const BOW = 0.22
// the name of a place on the map: the words before the first comma of what the file says, cut at this many
const NAME_MOST = 32
function nameOf(place: string | null) {
    const name = (place ?? '').split(',')[0]!.trim()
    return name === '' ? null : name.length > NAME_MOST ? `${name.slice(0, NAME_MOST)}…` : name
}

// The route drawn: the plant as the filled diamond and where the bag went as the ring, set on a flat map, degrees east
// scaled by the cosine of the middle latitude and degrees north upward, framed with a margin, and joined by a line that
// bows to the north and is drawn once the map has landed; under it, the distance as the crow flies and the days from
// departure to arrival, and at the end of that line the link that opens OpenStreetMap over the two places. The names
// are the words of the files before their first comma, written as text; the rest of the markup is the page's own words
// and numbers. Empty when the two places are one, within a kilometre of each other.
export function drawRoute(from: Point, to: Point, record: Record): string {
    const km = distance(from, to)
    if (!(km >= 1)) return ''
    const { w, h, x0, x1, y0, y1 } = MAP
    const east = Math.cos(rad((from.lat + to.lat) / 2))
    const flat = ({ lat, lon }: Point) => ({ x: lon * east, y: -lat })
    const a = flat(from), b = flat(to)
    const sx = Math.abs(b.x - a.x), sy = Math.abs(b.y - a.y)
    const scale = Math.min(sx > 0 ? (x1 - x0) / sx : Infinity, sy > 0 ? (y1 - y0) / sy : Infinity)
    // the two places fitted to the frame: the middle of the line between them is the middle of the frame
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const at = ({ x, y }: { x: number; y: number }) => ({ x: cx + (x - (a.x + b.x) / 2) * scale, y: cy + (y - (a.y + b.y) / 2) * scale })
    const p = at(a), q = at(b)
    const bow = cy - BOW * Math.hypot(q.x - p.x, q.y - p.y)
    const n = (value: number) => value.toFixed(1)
    // each name under its place, set towards the middle so that it stays in the frame
    const name = (point: Point, { x, y }: { x: number; y: number }, cls: string) => {
        const words = nameOf(point.place)
        return words ? caption(x < w / 2 ? x - 5 : x + 5, y + 15, words, cls, x < w / 2 ? 'start' : 'end') : ''
    }
    const days = daysBetween(record.departure, record.arrival)
    const journey = days === null ? null : days === 0 ? 'under a day' : days === 1 ? '1 day' : `${days} days`
    const said = `The route from ${nameOf(from.place) ?? 'the plant'} to ${nameOf(to.place) ?? 'where the bag went'}: about ${kilometres(km)} km${journey ? ` in ${journey}` : ''}`
    return `<figure class="route">
        <svg class="map" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(said)}">
            <rect class="ground" x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="6"/>
            <path class="way" pathLength="1" d="M${n(p.x)} ${n(p.y)}Q${n(cx)} ${n(bow)} ${n(q.x)} ${n(q.y)}"/>
            <path class="plant" d="M${n(p.x)} ${n(p.y - 4)}l4 4-4 4-4-4z"/>
            <circle class="dest" cx="${n(q.x)}" cy="${n(q.y)}" r="3.8"/>
            ${name(from, p, 'from')}${name(to, q, 'to')}
        </svg>
        <figcaption class="leg"><span class="far">≈ ${kilometres(km)} km${journey ? ` · ${journey}` : ''}</span>${linked('Open in OpenStreetMap', osmView(from, to))}</figcaption>
    </figure>`
}

// The route of the bag, drawn in the Delivered card once both places have come: from the plant, when the transport record
// names its site as the origin, to where the bag went. Set between the rows and the check line, as the curves are in the
// card of a cycle. Nothing is drawn without both places, from a plant that is not the transport's origin, or once another
// bag is being read.
function drawMap(mine: Product, events: Event[], cards: Map<Hex, HTMLElement>) {
    const transport = events.find(e => e.data?.phase === 'transport')
    const record = transport?.data
    const { plant, destination } = places
    if (!transport || !record || !plant || !destination || product !== mine) return
    if (plant.site === null || plant.site !== record.origin) return
    const drawn = drawRoute(plant, destination, record)
    const li = cards.get(transport.ref)
    if (!drawn || !li) return
    li.querySelector('.card .check')?.insertAdjacentHTML('beforebegin', drawn)
    requestAnimationFrame(() => requestAnimationFrame(() => li.querySelector('.route')?.classList.add('drawn')))
}

// ---------- the fruit (block 2) ----------

const g = (value: number) => `${Number(value.toFixed(1))} g`
// The grams of a bag as its packing record gives them: a positive number, or none. Anything else in that field is not grams,
// and the two blocks that compute with them, the fruit card and the arithmetic, are not painted from it.
const bagGrams = (packing?: Record | null) => (typeof packing?.bag_g === 'number' && Number.isFinite(packing.bag_g) && packing.bag_g > 0 ? packing.bag_g : null)

// A date of the label as the pouch prints it, SEP/2026: the month and the year, whether the description gives a day or not.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const printed = (value: string) => `${MONTHS[Number(value.slice(5, 7)) - 1]}/${value.slice(0, 4)}`

// What the bag holds, as the rows of its label: the energy, then sugars, protein, fat and fibre, scaled to the grams of the bag.
// Under the full table go the two dates of the pouch, when the description gives them.
function holds(n: Nutrition, grams: number, dates: Pick<Description, 'manufactured' | 'expires'> = { manufactured: null, expires: null }) {
    const scale = grams / 100
    const shown: (readonly [string, string])[] = [
        ['Energy', `${Math.round(n.energy_kcal * scale)} kcal`],
        ['Sugars', g(n.sugars_g * scale)],
        ['Protein', g(n.protein_g * scale)],
        ['Fat', g(n.fat_g * scale)],
        ['Fibre', g(n.fibre_g * scale)]
    ]
    const facts = shown.map(([label, value], i) => `<div style="--i:${i}"><dt>${label}</dt><dd>${value}</dd></div>`).join('')
    // an amount as a label gives it: the energy and anything from a hundred up as a whole number, the rest to three
    // figures, and "less than" where a label says no more of so little
    const whole = (value: number, unit: string) => unit === 'kJ' || unit === 'kcal' || value >= 100
    const fmt = (value: number, unit: string, least = 0) => esc(value < least ? `<${least} ${unit}` : `${whole(value, unit) ? Math.round(value) : Number(value.toPrecision(3))} ${unit}`)
    // the rows of a label, in its order: the energy in both units, fat and its saturates, carbohydrate and its sugars,
    // fibre, protein and salt, and after them what else the description names
    const table = ([
        ...(n.energy_kj != null ? [['Energy', n.energy_kj, 'kJ'] as const] : []),
        [n.energy_kj != null ? '' : 'Energy', n.energy_kcal, 'kcal'],
        ['Fat', n.fat_g, 'g'],
        ...(n.saturated_fat_g != null ? [['of which saturates', n.saturated_fat_g, 'g', 0.1] as const] : []),
        ['Carbohydrate', n.carbohydrate_g, 'g'],
        ['of which sugars', n.sugars_g, 'g'],
        ['Fibre', n.fibre_g, 'g'],
        ['Protein', n.protein_g, 'g'],
        ...(n.salt_g != null ? [['Salt', n.salt_g, 'g', 0.01] as const] : []),
        ...n.micro
    ] as (readonly [string, number, string, number?])[])
        .map(([label, per100, unit, least]) => `<tr><th scope="row">${esc(label)}</th><td>${fmt(per100 * scale, unit, least)}</td><td>${fmt(per100, unit, least)}</td></tr>`)
        .join('')
    // the dates as the pouch prints them, in its words: Mfg. date and Expiry date
    const label = [dates.manufactured && `Mfg. date ${printed(dates.manufactured)}`, dates.expires && `Expiry date ${printed(dates.expires)}`].filter(Boolean)
    return [
        `<dl class="facts">${facts}</dl>`,
        `<details class="origin"><summary>Full table and sources</summary>
            <table class="nutri"><thead><tr><th></th><th scope="col">this bag · ${grams} g</th><th scope="col">per 100 g</th></tr></thead><tbody>${table}</tbody></table>
            ${label.length ? `<p class="origin-dates">${label.join(' · ')}</p>` : ''}
            <p class="origin-note">Figures for 100 g of the dried fruit, as published, scaled to the ${grams} g of this bag.${n.source ? ` Source: ${esc(n.source)}.` : ''}</p>
        </details>`
    ] as const
}

// The pouches the page has colours for, by the fruit a record names. Mango, the fruit of the test records, wears the
// jackfruit pouch.
const WAYS: { [fruit: string]: string } = { pineapple: 'pineapple', banana: 'banana', jackfruit: 'jackfruit', mango: 'jackfruit' }

// The fruit on screen: its key, what its description said once it came (null when there is none), and the label painted.
const fruitState = { key: null as string | null, described: undefined as Description | null | undefined, table: null as string | null }

function fruitKey(events: Event[]): string | null {
    const keys = Object.keys(WAYS)
    const intake = events.find(e => e.data?.phase === 'intake')?.data
    if (typeof intake?.fruit === 'string' && keys.includes(intake.fruit)) return intake.fruit
    for (const event of events) {
        const named = event.data?.product?.toLowerCase()
        const hit = named && keys.find(key => named.includes(key))
        if (hit) return hit
    }
    return null
}

// What the fruit card can say. It is painted when the records are in, from what they say: the fruit they name, with the
// colours of its pouch, and the grams of the bag. And again when the description of the product has come, with the name
// and the table it gives, or has not, and then the label says the grams and nothing else. `said` is what the
// description says, null when there is none; it is left out while the description is still awaited, and kept once given.
export function revealFruit(events: Event[], said?: Description | null) {
    if (said !== undefined) fruitState.described = said
    const described = fruitState.described
    const packing = events.find(e => e.data?.phase === 'packing')?.data
    const named = events.find(e => e.data?.product)?.data?.product
    const key = (described?.fruit && Object.hasOwn(WAYS, described.fruit) ? described.fruit : null) ?? fruitState.key ?? fruitKey(events)
    const awaited = described === undefined && !!product?.files.has(DESCRIPTION)
    fruitState.key = key
    $('fruit-name').textContent = described?.name ?? cap(key ?? named) ?? 'This bag'
    $('fruit-name').classList.add('in')
    $('stage-cap').hidden = true
    // the page takes the colourway of the bag's pouch, now that a record that passed the check has named its fruit
    if (key) document.documentElement.dataset.way = WAYS[key]!
    // the photograph keeps its place and comes last, with the art (dress)
    $('stage').hidden = !product?.files.has(PHOTO)
    const grams = bagGrams(packing)
    // the label has nothing to say of a bag whose grams are not grams, or whose fruit neither a record nor a description
    // names; while a description that may name it is awaited, its place is kept
    const mute = !grams || (!key && !described && !awaited)
    if (mute || (!awaited && !described?.nutrition)) {
        fruitState.table = null
        $('fruit-contains').hidden = true
        $('fruit-origin').innerHTML = ''
    }
    if (!grams || mute) return void ($('fruit-grams').innerHTML = '')
    if (key || described) {
        $('fruit-grams').textContent = `${grams} g per bag`
        $('fruit-grams').classList.add('in')
    }
    // the rows of the label keep their place until the description says what goes in them
    if (awaited || !described?.nutrition) return
    const [contains, origin] = holds(described.nutrition, grams, described)
    if (fruitState.table === contains + origin) return
    fruitState.table = contains + origin
    $('fruit-contains').hidden = false
    $('fruit-contains').classList.remove('skel-host')
    $('fruit-contains').innerHTML = contains
    $('fruit-origin').innerHTML = origin
    requestAnimationFrame(() => requestAnimationFrame(() => $('fruit-contains').classList.add('drawn')))
}

function resetFruit() {
    fruitState.key = null
    fruitState.described = undefined
    fruitState.table = null
    product = null
    resetEdges()
    $('tri').setAttribute('class', 'tri')
    undress()
    $('stage').hidden = false
    $('stage').classList.remove('on')
    const photo = $<HTMLImageElement>('fruit-photo')
    photo.hidden = true
    photo.classList.remove('in')
    photo.removeAttribute('src')
    photo.alt = ''
    $('stage-cap').textContent = 'Reading the bag…'
    $('stage-cap').hidden = false
    $('fruit-name').classList.remove('in')
    $('fruit-grams').classList.remove('in')
    $('fruit-name').innerHTML = '<span class="skel name"></span>'
    $('fruit-grams').innerHTML = '<span class="skel grams"></span>'
    $('fruit-contains').hidden = false
    $('fruit-contains').classList.remove('drawn')
    $('fruit-contains').classList.add('skel-host')
    $('fruit-contains').innerHTML =
        '<dl class="facts" aria-hidden="true"><div><span class="skel"></span></div><div><span class="skel"></span></div><div><span class="skel"></span></div><div><span class="skel"></span></div></dl>'
    $('fruit-origin').innerHTML = ''
}

// ---------- the arithmetic (block 5) ----------

export function renderCo2(config: Page, events: Event[]) {
    const co2 = config.co2
    const intake = events.find(e => e.data?.phase === 'intake')?.data
    const cycle = events.find(e => e.data?.phase === 'cycle')?.data
    const packing = events.find(e => e.data?.phase === 'packing')?.data
    const bag = bagGrams(packing)
    const loadedKg = cycle?.loads?.length ? sum(cycle.loads, 'kg') : 0
    // The yield comes from the cycle when the plant declared both sides of it; otherwise from the config.
    const declared = cycle?.kg_out != null && loadedKg > 0 ? cycle.kg_out / loadedKg : null
    const yieldRatio = declared ?? (co2?.yield_pct != null ? co2.yield_pct / 100 : null)
    if (!co2 || !bag || !yieldRatio || !co2.factor_kg_per_kg || !co2.scenario || !co2.scenario_written) return
    const fresh = bag / yieldRatio
    const avoided = fresh * co2.factor_kg_per_kg
    const ratio = avoided / bag
    const times = ratio >= 10 ? Math.round(ratio).toString() : ratio.toFixed(1)
    const rescued = intake?.sourcing === 'rescued'
    const lead = rescued
        ? `The plant declared this fruit as rescued surplus. If it had gone to ${esc(co2.scenario)} instead, this is the arithmetic.`
        : `If this fruit had been rescued on its way to ${esc(co2.scenario)}, this is the arithmetic.`
    const r = 50, c = 2 * Math.PI * r, bagArc = Math.min(1, bag / avoided) * c, greenArc = c - bagArc
    const leaf = '<svg class="leaf" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4c-9 .4-15.2 6.2-16 16 9.8-.8 15.6-7 16-16z"/><path class="rib" d="M5.5 18.5 17 7"/></svg>'
    $('co2').innerHTML = `
        <div class="card co2-card">
            <div class="orn" aria-hidden="true"><i></i></div>
            <h2>What a rescued bag would avoid</h2>
            ${co2.label ? `<div class="chips"><span class="chip">${esc(co2.label)}</span></div>` : ''}
            <p class="lead">${lead}</p>
            <div class="avoid">
                <svg class="ring" viewBox="0 0 120 120" role="img" aria-label="${bag} g of fruit against ${Math.round(avoided)} g of CO₂e not emitted">
                    <circle class="bagarc" cx="60" cy="60" r="${r}" stroke-dasharray="${bagArc.toFixed(2)} ${greenArc.toFixed(2)}"/>
                    <circle class="arc" cx="60" cy="60" r="${r}" stroke-dasharray="${greenArc.toFixed(2)} ${bagArc.toFixed(2)}" stroke-dashoffset="${(-bagArc).toFixed(2)}"/>
                    <text class="times" x="60" y="66" text-anchor="middle">≈${times}×</text>
                </svg>
                <div class="avoid-text">
                    <p class="avoid-lead">${leaf}its own weight in CO₂e that stays out of the air</p>
                    <ul class="avoid-key">
                        <li><i class="sw bag"></i>the bag · ${bag} g</li>
                        <li><i class="sw green"></i>CO₂e not emitted · ≈${Math.round(avoided)} g</li>
                    </ul>
                </div>
            </div>
            <ol class="ledger">
                <li style="--i:0"><b class="amt">${bag}<small>g</small></b><span class="lb">dried, in this bag</span></li>
                <li class="op" style="--i:1"><b>÷ ${Number((yieldRatio * 100).toPrecision(3))} %</b><span class="lb">freeze-dry yield</span></li>
                <li style="--i:2"><b class="amt">≈${Math.round(fresh)}<small>g</small></b><span class="lb">fresh fruit it came from</span></li>
                <li class="op" style="--i:3"><b>× ${co2.factor_kg_per_kg}</b><span class="lb">kg CO₂e per kg at ${esc(co2.scenario)}</span></li>
                <li class="total" style="--i:4"><b class="amt">≈${Math.round(avoided)}<small>g CO₂e</small></b><span class="lb">not emitted</span></li>
            </ol>
            <details><summary>How this is computed</summary><pre>fresh   = bag ÷ yield   = ${bag} g ÷ ${Number(yieldRatio.toPrecision(3))} = ${fresh.toFixed(1)} g
avoided = fresh × factor = ${fresh.toFixed(1)} g × ${co2.factor_kg_per_kg} kg CO₂e/kg = ${avoided.toFixed(1)} g CO₂e
ratio   = avoided ÷ bag  = ${avoided.toFixed(1)} ÷ ${bag} = ${ratio.toFixed(2)}</pre></details>
            ${co2.closing ? `<p class="closing">${esc(co2.closing)}</p>` : ''}
        </div>`
    $('co2').hidden = false
    requestAnimationFrame(() => requestAnimationFrame(() => $('co2').classList.add('drawn')))
}

// ---------- the twin (block 6) ----------

function renderTwin(id: bigint, owner: Address | null, config: Page, explorer: string | undefined, contract: Address) {
    // returns the state, so the caller can look the holder up on ENS once the card is painted
    const state: 'none' | 'custody' | 'held' =
        owner === null ? 'none' : config.custody && isAddress(config.custody) && isAddressEqual(owner, config.custody) ? 'custody' : 'held'
    // The twin is not created yet, held by Fair Food Data, or held by an address.
    const pic = owner ? jazzicon(owner) : '<span class="pic blank" aria-hidden="true"></span>'
    const who = {
        none: 'Not created yet',
        custody: 'Twin held by <b>Fair Food Data</b>',
        held: `Twin held by <b class="addr">${esc(short(owner ?? ''))}</b>`
    }[state]
    $('twin').innerHTML = `
        <div class="card holder-line" id="holder">
            ${pic}
            <p class="who">${who}</p>
            ${explorer && state !== 'none' ? `<a class="go" href="${explorer}/token/${contract}/instance/${id}" target="_blank" rel="noopener">Blockscout ↗</a>` : ''}
        </div>`
    $('twin').hidden = false
    return state
}

// ---------- the holder's image ----------

// The image of an address, the jazzicon of the wallets
function jazzicon(address: string, d = 40): string {
    const N = 624, M = 397, mt = new Array<number>(N)
    let mti: number
    mt[0] = parseInt(address.slice(2, 10), 16) >>> 0
    for (mti = 1; mti < N; mti++) {
        const s = mt[mti - 1]! ^ (mt[mti - 1]! >>> 30)
        mt[mti] = (((((s & 0xffff0000) >>> 16) * 1812433253) << 16) + (s & 0x0000ffff) * 1812433253 + mti) >>> 0
    }
    const twist = (y: number) => (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)
    const int32 = () => {
        let y: number
        if (mti >= N) {
            let kk = 0
            for (; kk < N - M; kk++) mt[kk] = mt[kk + M]! ^ twist((mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff))
            for (; kk < N - 1; kk++) mt[kk] = mt[kk + (M - N)]! ^ twist((mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff))
            mt[N - 1] = mt[M - 1]! ^ twist((mt[N - 1]! & 0x80000000) | (mt[0]! & 0x7fffffff))
            mti = 0
        }
        y = mt[mti++]!
        y ^= y >>> 11
        y ^= (y << 7) & 0x9d2c5680
        y ^= (y << 15) & 0xefc60000
        y ^= y >>> 18
        return y >>> 0
    }
    const random = () => int32() * (1.0 / 4294967296.0)
    const palette = ['#01888C', '#FC7500', '#034F5D', '#F73F01', '#FC1960', '#C7144C', '#F3C100', '#1598F2', '#2465E1', '#F19E02']
    const wobble = random() * 30 - 15
    const colours = palette.map(hex => rotateHue(hex, wobble))
    const take = () => {
        random()
        return colours.splice(Math.floor(colours.length * random()), 1)[0]!
    }
    const paper = take()
    let shapes = ''
    for (let i = 0; i < 3; i++) {
        const first = random()
        const angle = Math.PI * 2 * first
        const velocity = (d / 3) * random() + (i * d) / 3
        const tx = Math.cos(angle) * velocity
        const ty = Math.sin(angle) * velocity
        const rot = first * 360 + random() * 180
        shapes += `<rect width="${d}" height="${d}" transform="translate(${tx} ${ty}) rotate(${rot.toFixed(1)} ${d / 2} ${d / 2})" fill="${take()}"/>`
    }
    return `<span class="pic jazz" style="background:${paper}" aria-hidden="true"><svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}">${shapes}</svg></span>`
}

// A hex colour with its hue turned by some degrees, as the colour library jazzicon uses does; returned as hsl().
function rotateHue(hex: string, degrees: number): string {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
    let h = 0, s = 0
    if (max !== min) {
        const delta = max - min
        s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
        h = (max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60
    }
    return `hsl(${((h + degrees + 360) % 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`
}

// The holder's name and image, when its address has them on ENS
async function nameHolder(owner: Address, chainId: number, { transport }: Source) {
    const chain = chainId === 1 ? mainnet : chainId === 11155111 ? sepolia : null
    if (!chain) return
    try {
        const client = createClient({ chain, transport, ...ownRpc })
        const name = await getEnsName(client, { address: owner })
        if (!name) return
        const who = $('holder').querySelector<HTMLElement>('.who b')
        if (who) {
            who.classList.remove('addr')
            swap(who, name)
        }
        const avatar = await getEnsAvatar(client, { name, assetGatewayUrls: { ipfs: 'https://ipfs.io' } }).catch(() => null)
        if (avatar) await holderPicture(avatar)
    } catch (error) {
        console.error(error)
    }
}

// The holder's picture, from wherever they keep it. Its host is not told which page asked for it, and it takes the place of
// the jazzicon only once a browser has drawn it within the art's cap: a picture too large for a phone to hold, or one that
// does not come, leaves the jazzicon.
export async function holderPicture(src: string) {
    if (!(await arrive(src))) return
    const img = document.createElement('img')
    img.className = 'pic arrives'
    img.alt = ''
    img.setAttribute('referrerpolicy', 'no-referrer')
    img.decoding = 'async'
    img.src = src
    $('holder').querySelector('.pic')?.replaceWith(img)
    requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('in')))
}

// ---------- the art: last of all ----------

// The page is complete without an image: the crystal is drawn, the colours are its own, and the photograph has its place
// kept. When everything else is on screen, and only then, it asks Swarm for the photograph of the bag's fruit and then for
// the illustrations of its pouch, the cover and then the background, by the references the packing record names, and
// checks each against its reference before it is shown. One that does not come, does not match, or is not an image a
// browser can draw, leaves the page as it was.
const ART_WAIT = 20_000
const PIXELS_MOST = 4096 * 4096
const arrive = (src: string) =>
    new Promise<string | null>(resolve => {
        const image = new Image()
        const done = (value: string | null) => {
            clearTimeout(timer)
            resolve(value)
        }
        const timer = setTimeout(() => done(null), ART_WAIT)
        // a small file can still name a picture too large for a phone to hold: that one is not shown either
        image.onload = () => done(image.naturalWidth * image.naturalHeight <= PIXELS_MOST ? src : null)
        image.onerror = () => done(null)
        // the art is the page's own address; a holder's picture is not, and its host is not told which page asked
        image.referrerPolicy = 'no-referrer'
        image.src = src
    })

// The images on screen are the bytes that were checked, held by the page under an address of its own making.
const held = new Set<string>()
const release = (url: string | null | undefined) => {
    if (!url || !held.delete(url)) return
    URL.revokeObjectURL(url)
}

// An image of the product: its bytes from Swarm, checked against their reference and held under an address of the
// page's own making (checked), and then tried as an image (tried).
async function checked(mine: Product, name: string) {
    const ref = mine.files.get(name)
    const bytes = ref ? await fileOf(mine.gateways, ref) : null
    if (!bytes || product !== mine) return null // it did not come, or another bag is being read
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: PRODUCT_FILES[name]! }))
    held.add(url)
    return url
}
async function tried(url: string | null) {
    if (!url || (await arrive(url))) return url
    release(url)
    return null
}
const picture = (mine: Product, name: string) => checked(mine, name).then(tried)

// The images come one after another: each is asked for once the one before it is in, or has not come, or ART_TURN has
// passed, whichever is first, so that one held up by its gateways, which may take 12 s each, does not hold back the next.
const ART_TURN = 4_000
const waitTurn = (before: Promise<unknown>) =>
    new Promise<void>(resolve => {
        const timer = setTimeout(resolve, ART_TURN)
        const done = () => {
            clearTimeout(timer)
            resolve()
        }
        void before.then(done, done)
    })

async function dress() {
    const mine = product
    if (!mine) return
    const root = document.documentElement
    // each illustration is shown as it comes
    const plate = async (image: Promise<string | null>, side: 'front' | 'back') => {
        const url = await image
        if (!url) return
        if (product !== mine) return release(url) // another bag was read meanwhile
        root.style.setProperty(`--art-${side}`, `url(${JSON.stringify(url)})`)
        root.dataset.art = ['front', 'back'].filter(s => s === side || root.dataset.art?.split(' ').includes(s)).join(' ')
    }
    // the photograph waits for the description, which gives it its text and names who took it
    const photograph = async (photo: Promise<string | null>) => {
        const [url, described] = await Promise.all([photo, mine.description])
        if (product !== mine) return release(url)
        if (!url) return void ($('stage').hidden = true) // it did not come: its place is given back
        const img = $<HTMLImageElement>('fruit-photo')
        img.alt = described?.alt ?? $('fruit-name').textContent ?? ''
        // it fades in on its pixels once they are decoded, or ART_TURN after it is put in place when the browser has not
        // said so by then, as when the page is in the background and draws nothing; where the browser cannot say when
        // that is, as jsdom cannot, once it has loaded
        if (!img.decode) img.onload = () => img.classList.add('in')
        img.src = url
        img.hidden = false
        $('stage').classList.add('on')
        // who took it is said with the sources of the label, or under it when the label has none, once the photograph is
        // there to be credited
        if (described?.credit) {
            const origin = $('fruit-origin')
            const note = origin.querySelector('.origin-note') ?? origin.appendChild(Object.assign(document.createElement('p'), { className: 'origin-note' }))
            note.append(`${note.textContent ? ' ' : ''}Photograph: ${described.credit}.`)
        }
        if (!img.decode) return
        await waitTurn(img.decode())
        if (product === mine) img.classList.add('in')
    }
    // The photograph of the fruit first, then the cover, then the background. The cover is asked for once the photograph
    // is checked and tried as an image, and the background once the cover's bytes are checked, while the cover is still
    // being tried; each of them at the latest ART_TURN after the one before it was asked for.
    const photo = picture(mine, PHOTO)
    const shown = photograph(photo)
    await waitTurn(photo)
    if (product !== mine) return // another bag is being read: nothing more of this one is asked for
    const cover = checked(mine, COVER)
    const front = plate(cover.then(tried), 'front')
    await waitTurn(cover)
    if (product !== mine) return
    await Promise.all([shown, front, plate(picture(mine, BACKGROUND), 'back')])
}

function undress() {
    const root = document.documentElement
    delete root.dataset.way
    delete root.dataset.art
    root.style.removeProperty('--art-front')
    root.style.removeProperty('--art-back')
    for (const url of [...held]) release(url)
}

// ---------- stored until: the day the records' storage is paid up to, read from the stamp that pays for it ----------

// A postage batch id: 64 hex digits in lowercase, with no 0x, as a record names it.
const STAMP = /^[0-9a-f]{64}$/
// The stamp the bag's record names, `stamp`: the postage batch its records were stored with, which anyone can look up,
// and pay for, by its id. Only the head record's, and only in the form a stamp has; anything else names no stamp.
const stampOf = (head: Record | null | undefined) => (typeof head?.stamp === 'string' && STAMP.test(head.stamp) ? head.stamp : null)

// What the page asks the PostageStamp contract: what is left on the batch, per chunk, and the price of a chunk per block.
const stampAbi = parseAbi(['function remainingBalance(bytes32 batchId) view returns (uint256)', 'function lastPrice() view returns (uint64)'])

// The day the stamp is paid up to, read from the chain it lives on (storage.chain) through the RPCs the
// configuration lists for that chain, in order, and never through a wallet: a wallet is on the network of the bag, and
// the page does not ask it to change. What is left divided by the price is blocks, and a block is storage.block_s
// seconds, counted from now. Null when the batch has run out (the contract says 0, or reverts), when no RPC answers, or
// when the one that answers is on another network: the day written in the configuration then stands.
async function stampUntil(config: Page, stamp: string): Promise<Date | null> {
    const storage: Storage = config.storage ?? {}
    const rpcs = storage.chain != null ? (config.rpcs?.[storage.chain] ?? []) : []
    if (!storage.contract || !isAddress(storage.contract) || !storage.block_s) return null
    for (const url of rpcs) {
        try {
            const client = createClient({ transport: http(url, { retryCount: 1, timeout: 8_000 }), ...ownRpc })
            if ((await getChainId(client)) !== storage.chain) continue
            const contract = { address: storage.contract, abi: stampAbi } as const
            const [remaining, price] = await Promise.all([
                readContract(client, { ...contract, functionName: 'remainingBalance', args: [`0x${stamp}`] }),
                readContract(client, { ...contract, functionName: 'lastPrice' })
            ])
            if (!remaining || !price) return null
            const until = new Date(Date.now() + Number(remaining / price) * storage.block_s * 1000)
            return Number.isNaN(until.getTime()) ? null : until
        } catch (error) {
            console.error(error)
        }
    }
    return null
}

// The line under the seal: "Stored until" and a day. The day written in the configuration (storage.until) goes up at
// once and stands when nothing better comes; the stamp's takes its place when it comes, most often before the line is
// in sight. With a stamp, and a page to look one up on (storage.stamp_page, an https address with {stamp} where the id
// goes), the line is a link to that page for that stamp; without either it is a line and no link.
function showStoredUntil(config: Page, stamp: string | null, until: Promise<Date | null> | null) {
    const line = $<HTMLAnchorElement>('alive')
    const page = config.storage?.stamp_page
    line.removeAttribute('href')
    line.removeAttribute('title')
    if (stamp && page?.startsWith('https://') && page.includes('{stamp}')) {
        line.href = page.replace('{stamp}', stamp)
        line.title = `Swarm stamp ${stamp}`
    }
    const show = (when: string) => {
        if (line.hidden) $('alive-until').textContent = when
        else swap($('alive-until'), when)
        line.hidden = false
    }
    if (config.storage?.until) show(day(config.storage.until))
    const mine = product
    // the day is the seal's: on a plate that opened again, because its sources disagree, it does not come back
    void until?.then(when => {
        if (when && product === mine && $('hero').classList.contains('verified')) show(day(when.toISOString()))
    })
}

// ---------- the fingerprint ----------

// A page cannot carry its own hash: writing it in would change the bytes. So the device asks for the file once more, from
// where it came, with a bag in the link or without one, and hashes it. Opened from the web, the head of the file has kept
// the row's place (data-fingerprint) since the first paint; from disk, or with no way to hash, the row is not there.
async function fingerprint(config: Page) {
    const root = document.documentElement
    if (!config.source || !location.protocol.startsWith('http') || !globalThis.crypto?.subtle) return void delete root.dataset.fingerprint
    root.dataset.fingerprint = ''
    const source = $<HTMLAnchorElement>('fp-source')
    source.href = config.source
    source.textContent = config.source.replace(/^https?:\/\//, '').replace('/blob/main', '').replace(/\/SHA256SUMS$/, '')
    try {
        const bytes = await (await fetch(location.href.replace(/#.*$/, ''))).arrayBuffer()
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
        const hash = [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
        $('fp-hash').innerHTML = (hash.match(/.{16}/g) ?? [hash]).map(group => `<span>${group}</span>`).join('')
    } catch (error) {
        console.error(error)
        delete root.dataset.fingerprint
    }
}

// ---------- the rest of the small print: the code and the contract ----------

// The code: the repository that publishes the file, at its root, which config.source names with or without the folder of
// a release. Without a source, no row.
function showCode(source: string | undefined) {
    $('code').hidden = !source
    if (!source) return
    const root = source.replace(/\/blob\/.*$/, '')
    const link = $<HTMLAnchorElement>('code-link')
    link.href = root
    link.textContent = root.replace(/^https?:\/\//, '')
}

// The contract on the explorer of its network: the one the page trusts, from the config (`chain` and `contract`), in every
// state; once the link's contract has proved one of Fair Food Data's, the one the bag is in. Without an explorer for the
// network, or with something that is not an address, no row.
function showContract(chainId: number | undefined, contract: string | undefined) {
    const explorer = chainId === undefined ? undefined : explorers[chainId]
    const shown = !!explorer && !!contract && isAddress(contract, { strict: false })
    $('contract').hidden = !shown
    if (!shown) return
    $<HTMLAnchorElement>('contract-link').href = `${explorer}/address/${contract}`
    $('contract-addr').textContent = contract
}

// ---------- the states ----------

function notice(title: string, text: string, retry = false) {
    $('notice').innerHTML = `<strong>${title}</strong><br>${text}${retry ? '<br><button type="button" id="retry" class="btn">Try again</button>' : ''}`
    $('notice').hidden = false
    document.getElementById('retry')?.addEventListener('click', () => void main())
}

function hideLead() {
    $('hero').hidden = true
    $('fruit').hidden = true
}

export function reset() {
    for (const id of ['notice', 'co2', 'twin', 'alive']) $(id).hidden = true
    $('proof-fold').classList.remove('open')
    for (const id of ['notice', 'co2', 'twin']) $(id).innerHTML = ''
    $('co2').classList.remove('drawn')
    $<HTMLOListElement>('path').innerHTML = ''
    resetLater()
    resetFruit()
    places.plant = places.destination = null
    stalled.clear()
    row(1, 'reading…', 'busy')
    row(2, 'waiting', 'idle')
    row(3, 'waiting', 'idle')
    $('step-2').classList.remove('idle')
    $('step-3').classList.remove('idle')
    paintedAt = 0
    status('checking')
    $('hero').hidden = false
    $('fruit').hidden = false
    delete document.documentElement.dataset.empty
}

// ---------- the check ----------

// When the last block the check left for later is due on screen: the fruit, the cards opening, the arithmetic, the holder.
let paintedAt = 0
let runs = 0

export async function main() {
    const run = ++runs
    reset()
    const config = await loadConfig()
    try {
        await check(config)
    } finally {
        await fingerprint(config) // after the records, since it may read the page's own bytes again
    }
    // the art comes last: after the check, the fingerprint and every block of the page
    await new Promise(resolve => setTimeout(resolve, Math.max(0, paintedAt - performance.now())))
    if (run === runs) await dress()
}

async function check(config: Page) {
    if (config.links?.ethereum) $<HTMLAnchorElement>('eth-link').href = config.links.ethereum
    if (config.links?.swarm) $<HTMLAnchorElement>('swarm-link').href = config.links.swarm
    if (config.links?.ens) $<HTMLAnchorElement>('ens-link').href = config.links.ens
    showCode(config.source)
    showContract(config.chain, config.contract)
    const gateways = config.gateways
    const tried = new Set<string>()
    const raw = location.hash.slice(1)
    const parsed = parseSticker(location.hash)
    // with no bag in the link, or one cut short, the page opens on how it works: the head of the file has said so since
    // the first paint, by the same test, and the notice of no bag is already written in the markup
    if (!parsed) document.documentElement.dataset.empty = ''
    if (!raw) {
        hideLead()
        return notice('No bag to show yet. Go get one. They are yummy.', 'Scan the QR code on a bag to follow its fruit from the plant to your hands.')
    }
    if (!parsed) {
        hideLead()
        return notice('This link is incomplete.', 'Scan the QR code on the bag again. The link may have been cut short when it was copied.')
    }
    $('twin-id').textContent = String(parsed.id)
    $('twin-id').dataset.len = String(String(parsed.id).length)
    document.title = `Twin #${parsed.id}`

    try {
        // 1 · reading Ethereum: which contract, which record, who holds the twin. The first source that is on the network of
        // the link and answers for the bag is the one the page reads with; one that is on another network, or does not
        // answer, is passed over. The ones after it are kept for the second opinion.
        const chainId = parsed.chainId
        const address = parsed.contract
        const explorer = explorers[chainId]
        const asked = sources(config, chainId)
        let first: { source: Source; reader: Reader; run: Hex; owner: Address | null | void } | undefined
        let failed: unknown = Error(`no RPC for chain ${chainId}`)
        for (const source of asked) {
            try {
                const client = createClient({ transport: source.transport, ...ownRpc })
                if ((await getChainId(client)) !== chainId) throw Error(`${source.name} is on another network`)
                if (!(await isOfficial(config, chainId, address, source))) throw new NotOfficial(`contract ${address} is not listed in the page config`)
                const reader = liveReader(client, address)
                // who holds the twin is not part of the check: when the source does not say, that block is left out and the rest goes on
                const [run, owner] = await Promise.all([reader.recordOf(parsed.id), reader.ownerOf(parsed.id).catch(error => void console.error(error))])
                first = { source, reader, run, owner }
                break
            } catch (error) {
                if (error instanceof NotOfficial) throw error
                failed = error
            }
        }
        if (!first) throw failed
        const { source, reader, run, owner } = first
        showContract(chainId, address)
        const others = asked.slice(asked.indexOf(source) + 1)
        // ENS is asked for the holder's name only when the twin has moved: in custody it is Fair Food Data's, by the config
        const twin = () => {
            if (owner === undefined) return
            const state = renderTwin(parsed.id, owner, config, explorer, address)
            if (state === 'held' && owner) void nameHolder(owner, chainId, source)
        }
        if (run === zeroHash) {
            twin()
            row(1, 'read · no packing record yet')
            row(2, 'nothing to read yet', 'idle')
            row(3, 'nothing to verify', 'idle')
            status('idle')
            swap($('stage-cap'), 'No record yet for this bag')
            return notice('No packing record for this bag yet.', 'What exists is below.')
        }
        row(1, 'record and holder')
        row(2, 'reading…', 'busy')

        // 2 · reading Swarm: walk the chain back from the latest record. Each one is checked as it lands, before a byte of it is
        // read as a record: hashed the way Swarm does, the bytes must give the reference the page asked for, and that reference
        // must have its anchor. Only then are they parsed and their card painted, and only then are the records they name fetched.
        const path = $<HTMLOListElement>('path')
        const events: Event[] = []
        const cards = new Map<Hex, HTMLElement>()
        const queue: Hex[] = [run]
        const seen = new Set<Hex>()
        // What a gateway serves is hashed as it lands, and the first bytes that give the reference are the record. A gateway
        // that serves other bytes is passed over like one that does not answer. `bytes` is null when gateways answered and
        // none of them had the record; when none answered at all, that is the network, and it is thrown: what the gateway
        // the configuration names last said, whatever order they were asked in.
        const fetchBytes = async (ref: Hex) => {
            const failed = new Map<string, unknown>()
            let other: string | null = null
            for (const gateway of inTurn(gateways)) {
                tried.add(gateway)
                try {
                    const bytes = await download(gateway, ref)
                    if (swarmHash(bytes) === ref) return { bytes, gateway }
                    other ??= gateway
                } catch (error) {
                    if (unanswered(error)) stalled.add(gateway)
                    failed.set(gateway, error)
                }
            }
            if (other) return { bytes: null, gateway: other }
            const last = failed.get([...gateways].reverse().find(gateway => failed.has(gateway)) ?? '')
            throw last instanceof Error ? last : Error('no gateway answered')
        }
        while (queue.length) {
            const ref = queue.shift()!
            if (seen.has(ref)) continue
            seen.add(ref)
            // the anchor is asked while the bytes are on their way, and read once they are in: when no gateway answers, that
            // is said at once, without waiting for the source, and what the source says of the anchor is not read
            const anchor = reader.anchoredAt(ref)
            void anchor.catch(() => {})
            const { bytes, gateway } = await fetchBytes(ref)
            const [anchored, block] = await anchor
            const at = when(anchored)
            const text = at !== null && bytes ? new TextDecoder().decode(bytes) : null
            const verified = text !== null
            const { data, inputs } = text !== null ? read(text) : { data: null, inputs: [] }
            const event: Event = { ref, at, block, data, raw: data ? null : text, gateway, verified, tx: null }
            events.push(event)
            // a record that was not read, or not understood, has no date: it goes first, before the ones that could be placed
            events.sort((a, b) => (a.data ? a.data.at : '').localeCompare(b.data ? b.data.at : ''))
            cards.set(ref, placeCard(path, events, event, explorer))
            for (const input of inputs) queue.push(input)
            row(2, `${events.length} data ${events.length === 1 ? 'record' : 'records'}${queue.length ? '…' : ''}`, queue.length ? 'busy' : 'lit')
        }
        row(2, `${events.length} data ${events.length === 1 ? 'record' : 'records'}`)
        row(3, 'verifying…', 'busy')
        // the files of the product hang from the packing record: its description is asked for now, and the seal does not
        // wait for it
        product = readProduct(gateways, events)

        // 3 · the result of the check, on each card and on the plate
        for (const event of events) markCheck(cards.get(event.ref)!, event)
        const good = events.filter(e => e.verified).length
        const allGood = good === events.length
        row(3, `${good} of ${events.length} ${events.length === 1 ? 'match' : 'matches'}`, allGood ? 'lit' : 'bad')
        // the stamp that pays for the records' storage hangs from the head record: once every record has matched, the
        // chain it lives on is asked how long it is paid for, now, so that the day is there when the seal opens
        const stamp = allGood ? stampOf(events.find(event => event.ref === run)?.data) : null
        const until = stamp ? stampUntil(config, stamp) : null
        await edgesSettled()
        status(allGood ? 'verified' : 'mismatch')
        if (allGood) {
            $('proof-fold').classList.add('open')
            showStoredUntil(config, stamp, until)
        }
        const mine = product
        later(() => {
            revealFruit(events)
            // the description fills the label when it has come, now or later; the two places of the path, the plant and
            // where the bag went, each its card, and the route between them the Delivered card once both are in
            void mine.description.then(described => product === mine && revealFruit(events, described))
            void Promise.all([placePlant(mine, events, cards), placeDestination(mine, events, cards)]).then(() => drawMap(mine, events, cards))
            // the curves of a cycle hang from its record, as the files of the product from the packing: the light file each
            // cycle names is asked for now, and drawn in its card when it has come
            for (const event of events) if (event.data?.phase === 'cycle') void drawCurves(mine, event, cards.get(event.ref)!)
        }, 120)
        const lastCard = openPath(path, 1100)
        later(() => renderCo2(config, events), lastCard + UNFOLD_GAP + 120)
        later(twin, lastCard + UNFOLD_GAP + 360)
        paintedAt = performance.now() + lastCard + UNFOLD_GAP + 900

        void Promise.all(
            events.map(async event => {
                if (!explorer || !event.block) return
                const tx = await reader.anchorTx(event.ref, event.block)
                if (!tx) return
                const link = cards.get(event.ref)!.querySelector<HTMLAnchorElement>('.btn.anchor')
                if (link) link.href = `${explorer}/tx/${tx}`
            })
        )

        // The plate closes on what the first source says. A second one is then asked whether it says the same, and the answer
        // is kept on the plate (`data-sources`: agree, differ, or single when there was no second one). When it differs, one
        // of the two is not telling what is anchored, and the page cannot tell which: the plate opens again and says so.
        if (allGood) {
            const second = await secondOpinion(others, chainId, address, parsed.id, run, events)
            if (product !== mine) return // another bag is being read
            $('hero').dataset.sources = !second ? 'single' : second.same ? 'agree' : 'differ'
            if (second && !second.same) disagree()
        }
    } catch (error) {
        console.error(error)
        const details = `<details><summary>Technical details</summary><pre>${esc(error)}</pre></details>`
        if (error instanceof NotOfficial) {
            hideLead()
            return notice('This is not a Fair Food Data bag.', `The QR code points to a contract that Fair Food Data has not published, so this page does not show it.${details}`)
        }
        const where = tried.size ? `<br><span class="tried">Tried ${[...tried].map(g => esc(new URL(g).host)).join(', ')}.</span>` : ''
        notice('We couldn’t reach the records right now.', `The records don’t expire. Try again in a moment.${where}${details}`, true)
    }
}

// Another bag in the link is another page: it is loaded again and read from nothing, not left under the seal of the bag before.
window.addEventListener('hashchange', () => location.reload())

void main()
