// The page a bag opens: seven blocks, the states, a loading that tells the check as it happens, a list of gateways, the
// verification report. The looks live in devcon8.html; this file reads, checks and paints.
//
// Reads ./config.json. The keys of the blocks are optional: a block whose data or assumptions are missing is not painted.
// What the page says of the fruit, and where the plant is, is not in the config: the bag's records name the files, the
// packing record those of its product and the intake record the location of the plant, and the page reads them from Swarm
// against their references, as it reads the records.

import { NotOfficial, abi, download, hex, parseSticker, swarmHash, type Config } from '../src/lib.ts'
import './life-grid.ts'
import { BaseError, ContractFunctionRevertedError, createClient, custom, getChainId, getContractEvents, getEnsAvatar, getEnsName, getEnsText, http, isAddress, isAddressEqual, mainnet, readContract, sepolia, zeroHash, type Address, type Hex, type Transport } from '../src/rails.ts'

type Farm = { zone: string | null; country: string | null; variety: string | null; harvested: string | null; kg: number | null }

type Record = {
    phase: 'intake' | 'cycle' | 'packing' | 'transport'
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
// for it, and where it is. The intake record names the file of the plant.
type Point = { site: string | null; place: string | null; lat: number; lon: number }

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

// The records' storage on Swarm: the postage batch they live on and the day it is paid up to.
type Storage = { batch?: Hex; until?: string }

type Page = Config & {
    gateways?: string[]
    report?: string | null
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

const explorers: { [chainId: number]: string } = { 1: 'https://etherscan.io', 11155111: 'https://sepolia.etherscan.io' }

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
const country = (code: string) => {
    try {
        return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
    } catch {
        return code
    }
}
const farm = (f: Farm) =>
    [[f.zone, f.country && country(f.country)].filter(Boolean).join(', '), f.variety, f.harvested && `harvested ${day(f.harvested)}`, f.kg != null && `${f.kg} kg`]
        .filter(Boolean)
        .join(' · ') || null
// The rows of a card: a key and a value, written as text. A third element is an address of the page's own making, and the
// value is then a link to it, opened beside the page; nothing a record or a file says is ever one.
const rows = (list: (string | null | undefined)[][]) =>
    list
        .filter(([, value]) => value != null && value !== '')
        .map(([key, value, href]) => `<div class="row"><span class="k">${esc(key)}</span><span class="v">${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(value)} ↗</a>` : esc(value)}</span></div>`)
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

// ---------- the record cards (block 4) ----------

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
            ['Coldest', r.min_temperature_c != null ? `${r.min_temperature_c} °C` : null],
            ['Lowest pressure', r.min_pressure_pa != null ? `${r.min_pressure_pa} Pa` : null],
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

function card(event: Event, explorer: string | undefined) {
    const data = event.data
    // A record that did not pass the check was not read: its card carries the reference the page asked for and nothing of what arrived.
    if (!event.verified)
        return `
        <h2>Record not shown</h2>
        <p class="check pending">Checking against its Ethereum anchor…</p>
        <details><summary>Reference</summary><p>Swarm <code>${esc(event.ref)}</code></p></details>`
    const links = `
        <p class="check pending">Checking against its Ethereum anchor…</p>
        <div class="links">
            ${explorer && event.block ? `<a class="btn anchor" href="${esc(`${explorer}/block/${event.block}`)}" target="_blank" rel="noopener">Ethereum anchor ↗</a>` : ''}
            <a class="btn" href="${esc(`${event.gateway}/bytes/${event.ref.slice(2)}`)}" target="_blank" rel="noopener">Swarm file ↗</a>
        </div>`
    // A record that passed the check and is not one the page knows how to show: what it says, as it was written, and no rows.
    if (!data) {
        const raw = event.raw ?? ''
        return `
        <h2>Record not understood</h2>
        <div class="chips"><span class="chip wait">A kind this page does not know</span></div>${links}
        <details><summary>Raw record</summary><pre>${esc(raw.length > RAW_SHOWN ? `${raw.slice(0, RAW_SHOWN)}…` : raw)}</pre><p>Swarm <code>${esc(event.ref)}</code></p></details>`
    }
    const { title, twin, rows: list } = steps[data.phase](data)
    const correction = typeof data.version === 'number' && data.version > 1 ? `<span class="chip wait">Correction v${esc(data.version)}</span>` : ''
    return `
        <h2>${esc(title)}</h2>
        ${twin ? '<p class="twin-born">This bag’s twin starts here.</p>' : ''}
        ${correction ? `<div class="chips">${correction}</div>` : ''}
        ${rows(list)}${links}
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
// the files of the product, the intake record the location of the plant. A document under another name, of another type,
// or whose reference is not one, is not that file, and the page does not ask for it; a record that was not read, or not
// understood, names nothing.
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
    for (const gateway of gateways) {
        try {
            const bytes = await download(gateway, ref)
            if (swarmHash(bytes) === ref) return bytes
        } catch {
            // the next gateway is asked
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
// coordinates, the longitude and then the latitude, as GeoJSON writes them, that are on Earth; and the words for the place
// and the key of the site, each when it is a line of text. Like a description it is found out here, once, before anything
// is painted from it. A file of another shape, or that is not JSON, says nothing.
export function readPoint(bytes: Uint8Array): Point | null {
    try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { [key: string]: unknown } | null
        if (typeof value !== 'object' || value === null || value.type !== 'Feature') return null
        const geometry = (typeof value.geometry === 'object' && value.geometry !== null ? value.geometry : {}) as { [key: string]: unknown }
        const coordinates = Array.isArray(geometry.coordinates) ? (geometry.coordinates as unknown[]) : []
        const [lon, lat] = coordinates
        if (geometry.type !== 'Point' || coordinates.length !== 2 || !coordinate(lon, 180) || !coordinate(lat, 90)) return null
        const properties = (typeof value.properties === 'object' && value.properties !== null ? value.properties : {}) as { [key: string]: unknown }
        return { site: line(properties.site), place: line(properties.place), lat, lon }
    } catch {
        return null
    }
}

// The places of the path, kept as each file comes, with their coordinates: the plant, from the file the intake record
// names, and in time the destination of the transport, for a map to join them. Another bag starts from none.
export const places: { plant: Point | null } = { plant: null }

// The coordinates as a visitor reads them, 20.2353° N, 85.1091° E, and as OpenStreetMap takes them: in the address only
// numbers of the page's own making, to six decimals, and nothing the file said.
const geo = ({ lat, lon }: Point) => `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`
const osm = ({ lat, lon }: Point) => `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=15/${lat.toFixed(6)}/${lon.toFixed(6)}`

// Where the plant is. The intake record names the file among its documents; it is asked for once the records are checked,
// with the description, and read like it: hashed against its reference, then found out once. When it has come, the
// Received card, already on screen, gains two rows before its check: the place, and the coordinates, linked to
// OpenStreetMap, which is asked for nothing unless the link is tapped.
async function placePlant(mine: Product, events: Event[], cards: Map<Hex, HTMLElement>) {
    const intake = events.find(e => e.data?.phase === 'intake')
    const ref = documentOf(intake?.data, SITE_LOCATION, GEOJSON)
    if (!intake || !ref) return
    const bytes = await fileOf(mine.gateways, ref)
    const point = bytes ? readPoint(bytes) : null
    if (!point || product !== mine) return // it did not come, or another bag is being read
    places.plant = point
    const check = cards.get(intake.ref)?.querySelector('.check')
    if (!check) return
    // the rows land as the blocks do
    const late = document.createElement('template')
    late.innerHTML = rows([['Site', point.place], ['GPS', geo(point), osm(point)]])
    late.content.querySelectorAll('.row').forEach(row => row.classList.add('late'))
    check.before(late.content)
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
            ${explorer && state !== 'none' ? `<a class="go" href="${explorer}/nft/${contract}/${id}" target="_blank" rel="noopener">Etherscan ↗</a>` : ''}
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
        if (!avatar) return
        const img = new Image()
        img.className = 'pic arrives'
        img.alt = ''
        img.onload = () => {
            $('holder').querySelector('.pic')?.replaceWith(img)
            requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('in')))
        }
        img.src = avatar
    } catch (error) {
        console.error(error)
    }
}

// ---------- the art: last of all ----------

// The page is complete without an image: the crystal is drawn, the colours are its own, and the photograph has its place
// kept. When everything else is on screen, and only then, it asks Swarm for the illustrations of the bag's pouch and the
// photograph of its fruit, by the references the packing record names, and checks each against its reference before
// it is shown. One that does not come, does not match, or is not an image a browser can draw, leaves the page as it was.
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
        image.src = src
    })

// The images on screen are the bytes that were checked, held by the page under an address of its own making.
const held = new Set<string>()
const release = (url: string | null | undefined) => {
    if (!url || !held.delete(url)) return
    URL.revokeObjectURL(url)
}

// An image of the product: its bytes from Swarm, checked against their reference, and then tried as an image.
async function picture(mine: Product, name: string) {
    const ref = mine.files.get(name)
    const bytes = ref ? await fileOf(mine.gateways, ref) : null
    if (!bytes || product !== mine) return null // it did not come, or another bag is being read
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: PRODUCT_FILES[name]! }))
    held.add(url)
    if (await arrive(url)) return url
    release(url)
    return null
}

async function dress() {
    const mine = product
    if (!mine) return
    const root = document.documentElement
    // each illustration is shown as it comes, and none waits for another file
    const plate = async (name: string, side: 'front' | 'back') => {
        const url = await picture(mine, name)
        if (!url) return
        if (product !== mine) return release(url) // another bag was read meanwhile
        root.style.setProperty(`--art-${side}`, `url(${JSON.stringify(url)})`)
        root.dataset.art = ['front', 'back'].filter(s => s === side || root.dataset.art?.split(' ').includes(s)).join(' ')
    }
    // the photograph waits for the description, which gives it its text and names who took it
    const photograph = async () => {
        const [url, described] = await Promise.all([picture(mine, PHOTO), mine.description])
        if (product !== mine) return release(url)
        if (!url) return void ($('stage').hidden = true) // it did not come: its place is given back
        const img = $<HTMLImageElement>('fruit-photo')
        img.alt = described?.alt ?? $('fruit-name').textContent ?? ''
        img.onload = () => img.classList.add('in')
        img.src = url
        img.hidden = false
        $('stage').classList.add('on')
        // who took it is said with the sources of the label, or under it when the label has none, once the photograph is
        // there to be credited
        if (!described?.credit) return
        const origin = $('fruit-origin')
        const note = origin.querySelector('.origin-note') ?? origin.appendChild(Object.assign(document.createElement('p'), { className: 'origin-note' }))
        note.append(`${note.textContent ? ' ' : ''}Photograph: ${described.credit}.`)
    }
    await Promise.all([plate(COVER, 'front'), plate(BACKGROUND, 'back'), photograph()])
}

function undress() {
    const root = document.documentElement
    delete root.dataset.way
    delete root.dataset.art
    root.style.removeProperty('--art-front')
    root.style.removeProperty('--art-back')
    for (const url of [...held]) release(url)
}

// ---------- stored until: the date the records' storage is paid up to ----------

// The date comes with the configuration (storage.until), kept by whoever keeps the postage batch paid; the page reads it from nowhere else.
function showStoredUntil(config: Page) {
    if (!config.storage?.until) return
    $('alive-until').textContent = day(config.storage.until)
    $('alive').hidden = false
}

// ---------- the report ----------

async function report(config: Page, id: bigint, outcome: 'verified' | 'failed', gateway: string | null, reason?: string) {
    if (!config.report) return
    const body = JSON.stringify({ bag: Number(id), at: new Date().toISOString(), gateway, outcome, ...(reason ? { reason } : {}) })
    try {
        await fetch(config.report, { method: 'POST', mode: 'cors', credentials: 'omit', keepalive: true, headers: { 'content-type': 'application/json' }, body })
        $('reported').hidden = false
    } catch {
    }
}

// ---------- the fingerprint ----------

// A page cannot carry its own hash: writing it in would change the bytes.
async function fingerprint(config: Page) {
    if (!config.source || !location.protocol.startsWith('http') || !globalThis.crypto?.subtle) return
    try {
        const bytes = await (await fetch(location.href.replace(/#.*$/, ''))).arrayBuffer()
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
        const hash = [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
        $('fp-hash').innerHTML = (hash.match(/.{16}/g) ?? [hash]).map(group => `<span>${group}</span>`).join('')
        const source = $<HTMLAnchorElement>('fp-source')
        source.href = config.source
        source.textContent = config.source.replace(/^https?:\/\//, '').replace('/blob/main', '').replace(/\/SHA256SUMS$/, '')
        $('fingerprint').hidden = false
    } catch (error) {
        console.error(error)
    }
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
    for (const id of ['notice', 'co2', 'twin', 'reported', 'alive']) $(id).hidden = true
    $('proof-fold').classList.remove('open')
    for (const id of ['notice', 'co2', 'twin']) $(id).innerHTML = ''
    $('co2').classList.remove('drawn')
    $<HTMLOListElement>('path').innerHTML = ''
    resetLater()
    resetFruit()
    places.plant = null
    row(1, 'reading…', 'busy')
    row(2, 'waiting', 'idle')
    row(3, 'waiting', 'idle')
    $('step-2').classList.remove('idle')
    $('step-3').classList.remove('idle')
    paintedAt = 0
    status('checking')
    $('hero').hidden = false
    $('fruit').hidden = false
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
    const gateways = config.gateways
    const tried = new Set<string>()
    let served: string | null = null
    const raw = location.hash.slice(1)
    const parsed = parseSticker(location.hash)
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
        const others = asked.slice(asked.indexOf(source) + 1)
        const twin = () => {
            if (owner === undefined) return
            const state = renderTwin(parsed.id, owner, config, explorer, address)
            if (state !== 'none' && owner) void nameHolder(owner, chainId, source)
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
        // none of them had the record; when none answered at all, that is the network, and it is thrown.
        const fetchBytes = async (ref: Hex) => {
            let last: unknown
            let other: string | null = null
            for (const gateway of gateways) {
                tried.add(gateway)
                try {
                    const bytes = await download(gateway, ref)
                    if (swarmHash(bytes) === ref) {
                        served = gateway
                        return { bytes, gateway }
                    }
                    other ??= gateway
                } catch (error) {
                    last = error
                }
            }
            if (other) return { bytes: null, gateway: other }
            throw last instanceof Error ? last : Error('no gateway answered')
        }
        while (queue.length) {
            const ref = queue.shift()!
            if (seen.has(ref)) continue
            seen.add(ref)
            const { bytes, gateway } = await fetchBytes(ref)
            const [anchored, block] = await reader.anchoredAt(ref)
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
        await edgesSettled()
        status(allGood ? 'verified' : 'mismatch')
        if (allGood) {
            $('proof-fold').classList.add('open')
            showStoredUntil(config)
        }
        const mine = product
        later(() => {
            revealFruit(events)
            // the description fills the label when it has come, now or later; the location of the plant, the Received card
            void mine.description.then(described => product === mine && revealFruit(events, described))
            void placePlant(mine, events, cards)
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
        // is kept on the plate (`data-sources`: agree, differ, or single when there was no second one) and nowhere in sight:
        // the page has no words for it yet, and until it has, nothing the visitor sees depends on it.
        if (allGood) {
            const second = await secondOpinion(others, chainId, address, parsed.id, run, events)
            $('hero').dataset.sources = !second ? 'single' : second.same ? 'agree' : 'differ'
        }

        const outcome = events.length && allGood ? 'verified' : 'failed'
        await report(config, parsed.id, outcome, served, outcome === 'failed' ? 'mismatch' : undefined)
    } catch (error) {
        console.error(error)
        const details = `<details><summary>Technical details</summary><pre>${esc(error)}</pre></details>`
        if (error instanceof NotOfficial) {
            hideLead()
            return notice('This is not a Fair Food Data bag.', `The QR code points to a contract that Fair Food Data has not published, so this page does not show it.${details}`)
        }
        const where = tried.size ? `<br><span class="tried">Tried ${[...tried].map(g => esc(new URL(g).host)).join(', ')}.</span>` : ''
        notice('We couldn’t reach the records right now.', `The records don’t expire. Try again in a moment.${where}${details}`, true)
        await report(config, parsed.id, 'failed', served, 'unreachable')
    }
}

// Another bag in the link is another page: it is loaded again and read from nothing, not left under the seal of the bag before.
window.addEventListener('hashchange', () => location.reload())

void main()
