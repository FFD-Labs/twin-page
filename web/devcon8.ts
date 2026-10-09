// The page a bag opens: seven blocks, the states, a loading that tells the check as it happens, a list of gateways, the
// verification report. The looks live in devcon8.html; this file reads, checks and paints.
//
// Reads ./config.json. The keys of the blocks are optional: a block whose data or assumptions are missing is not painted.

import { NotOfficial, abi, download, hex, parseSticker, swarmHash, type Config } from '../src/lib.ts'
import './life-grid.ts'
import { createClient, getChainId, getContractEvents, getEnsAvatar, getEnsName, getEnsText, http, isAddress, isAddressEqual, mainnet, readContract, sepolia, zeroHash, type Address, type Hex } from '../src/rails.ts'

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
    inputs?: Hex[]
}

// Editorial card of the fruit (block 3).
type Nutrition = {
    energy_kcal: number
    carbohydrate_g: number
    sugars_g?: number
    protein_g: number
    fat_g: number
    fibre_g: number
    micro?: [string, number, string][]
    source?: string | null
    reviewed?: string
}
type NutritionTable = { basis?: string; fruits: { [fruit: string]: Nutrition } }
type Fruit = { name: string; photo?: string | null; alt?: string; lines?: string[]; nutrition?: Nutrition }

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
    fruits?: { [fruit: string]: Fruit }
    nutrition?: NutritionTable
    co2?: Co2
    storage?: Storage
    source?: string
}

type Event = {
    ref: Hex
    at: string | null
    block: bigint
    bytes: Uint8Array
    data: Record
    gateway: string
    verified: boolean | null
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
const rows = (list: (string | null | undefined)[][]) =>
    list
        .filter(([, value]) => value != null && value !== '')
        .map(([key, value]) => `<div class="row"><span class="k">${esc(key)}</span><span class="v">${esc(value)}</span></div>`)
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

// The three reads of the plate, one at each vertex of the triangle: what each read gave.
const row = (step: number, value: string, state: 'busy' | 'lit' | 'idle' | 'bad' = 'lit') => {
    const li = $(`step-${step}`)
    li.classList.remove('busy', 'lit', 'idle', 'bad')
    li.classList.add(state)
    if (state === 'bad') li.classList.add('lit')
    swap(li.querySelector<HTMLElement>('.v')!, value)
    if ((state === 'lit' || state === 'bad') && step <= 3) edge(`e${step}`, step === 3 && state === 'bad')
}
const status = (state: 'checking' | 'verified' | 'mismatch' | 'idle') => $('hero').classList.toggle('verified', state === 'verified')

// ---------- config ----------

// The nutrition table lives in the page itself (<script id="nutrition">), so the page depends on nothing else for it.
function withNutrition(page: Page): Page {
    const table = document.getElementById('nutrition')?.textContent
    if (table) page.nutrition = JSON.parse(table) as NutritionTable
    if (!page.nutrition || !page.fruits) return page
    for (const [fruit, entry] of Object.entries(page.nutrition.fruits)) if (page.fruits[fruit]) page.fruits[fruit].nutrition = entry
    return page
}

async function loadConfig(): Promise<Page> {
    // The single file carries the config inline; the served page fetches config.json.
    const inline = document.getElementById('config')?.textContent
    const page = inline ? (JSON.parse(inline) as Page) : ((await (await fetch('./config.json')).json()) as Page)
    return withNutrition(page)
}

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
        ownerOf: id => readContract(client, { ...contract, functionName: 'ownerOf', args: [id] }).catch(() => null),
        anchoredAt: ref => readContract(client, { ...contract, functionName: 'anchoredAt', args: [ref] }),
        anchorTx: async (ref, block) => {
            const logs = await getContractEvents(client, { ...contract, eventName: 'Anchored', args: { ref }, fromBlock: block, toBlock: block }).catch(() => [])
            return logs[0]?.transactionHash ?? null
        }
    }
}

// Is this contract one of ours: listed in the config or, on mainnet, named by fairfooddata.eth.
async function isOfficial(config: Page, chainId: number, contract: Address) {
    if ([config.contract, ...(config.contracts ?? [])].some(listed => isAddressEqual(listed, contract))) return true
    if (chainId !== 1) return false
    const client = createClient({ chain: mainnet, transport: http(config.rpcs?.[1] ?? config.rpc) })
    const listed = await getEnsText(client, { name: 'fairfooddata.eth', key: 'ffd.contract' }).catch(() => null)
    return !!listed && isAddress(listed) && isAddressEqual(listed, contract)
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

function card(event: Event, explorer: string | undefined) {
    const { title, twin, rows: list } = steps[event.data.phase](event.data)
    const correction = (event.data.version ?? 1) > 1 ? `<span class="chip wait">Correction v${esc(event.data.version)}</span>` : ''
    return `
        <p class="stage"><span class="num"></span> · ${esc(event.data.phase)}</p>
        <h2>${esc(title)}</h2>
        ${twin ? '<p class="twin-born">This bag’s twin starts here.</p>' : ''}
        ${correction ? `<div class="chips">${correction}</div>` : ''}
        ${rows(list)}
        <p class="check pending">Checking against its Ethereum anchor…</p>
        <div class="links">
            ${explorer && event.block ? `<a class="btn anchor" href="${esc(`${explorer}/block/${event.block}`)}" target="_blank" rel="noopener">Ethereum anchor ↗</a>` : ''}
            <a class="btn" href="${esc(`${event.gateway}/bytes/${event.ref.slice(2)}`)}" target="_blank" rel="noopener">Swarm file ↗</a>
        </div>
        <details><summary>Raw record</summary><pre>${esc(JSON.stringify(event.data, null, 2))}</pre><p>Swarm <code>${esc(event.ref)}</code></p></details>`
}

// Cards are painted as their record arrives and kept in the order of the events; the numbers follow.
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

export function placeCard(path: HTMLOListElement, events: Event[], event: Event, explorer: string | undefined) {
    const li = document.createElement('li')
    li.className = 'step'
    li.dataset.ref = event.ref
    const when = new Date(event.data.at)
    const d = when.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })
    const m = when.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    li.innerHTML = `<div class="unfold"><div class="unfold-in"><time class="tile" datetime="${esc(event.data.at)}"><b>${d}</b><span>${m}</span></time><div class="card">${card(event, explorer)}</div></div></div>`
    const index = events.indexOf(event)
    const next = events[index + 1]
    const before = next ? path.querySelector<HTMLLIElement>(`li[data-ref="${next.ref}"]`) : null
    path.insertBefore(li, before)
    path.querySelectorAll<HTMLElement>('.num').forEach((n, i) => swap(n, String(i + 1).padStart(2, '0')))
    return li
}

function markCheck(li: HTMLElement, event: Event) {
    li.classList.add(event.verified ? 'ok' : 'bad')
    const check = li.querySelector('.check')!
    check.classList.remove('pending')
    check.classList.add(event.verified ? 'ok' : 'bad')
    swap(check as HTMLElement, event.verified ? `✓ Matches its Ethereum anchor of ${date(event.at!)}` : '✗ Does not match any Ethereum anchor')
}

// ---------- the fruit card (block 3) ----------

const g = (value: number) => `${Number(value.toFixed(1))} g`
// The grams of a bag as its packing record gives them: a positive number, or none. Anything else in that field is not grams,
// and the two blocks that compute with them, the fruit card and the arithmetic, are not painted from it.
const bagGrams = (packing?: Record) => (typeof packing?.bag_g === 'number' && Number.isFinite(packing.bag_g) && packing.bag_g > 0 ? packing.bag_g : null)

// The donut of what the bag holds: sugars on their own, the rest of the carbohydrate, protein, fat, fibre, and what is left of the weight as minerals.
function donut(n: Nutrition, grams: number) {
    const scale = grams / 100
    const sugars = (n.sugars_g ?? 0) * scale
    const shown: (readonly [string, number])[] = [
        ['Sugars', sugars],
        ['Protein', n.protein_g * scale],
        ['Fat', n.fat_g * scale],
        ['Fibre', n.fibre_g * scale]
    ]
    const otherCarb = Math.max(0, n.carbohydrate_g * scale - sugars)
    const minerals = Math.max(0, grams - shown.reduce((total, [, value]) => total + value, 0) - otherCarb)
    const arcsData: (readonly [string, number, string])[] = [
        ...shown.filter(([, value]) => value > 0).map(([label, value], i) => [label, value, `seg-${i + 1}`] as const),
        ['Rest', otherCarb + minerals, 'seg-6']
    ]
    const r = 44, c = 2 * Math.PI * r
    let offset = 0
    const arcs = arcsData
        .map(([, value, cls], i) => {
            const len = (value / grams) * c
            const arc = `<circle class="seg ${cls}" style="--i:${i}" cx="56" cy="56" r="${r}" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`
            offset += len
            return arc
        })
        .join('')
    const legend = shown
        .filter(([, value]) => value > 0)
        .map(([label, value], i) => `<li style="--i:${i}"><i class="sw seg-${i + 1}"></i><span class="lb">${label}</span><span class="val">${g(value)}</span></li>`)
        .join('')
    const fmt = (value: number, unit: string) => `${Number(value.toPrecision(3))} ${unit}`
    const table = ([
        ['Energy', n.energy_kcal, 'kcal'],
        ['Carbohydrate', n.carbohydrate_g, 'g'],
        ...(n.sugars_g != null ? [['of which sugars', n.sugars_g, 'g'] as const] : []),
        ['Protein', n.protein_g, 'g'],
        ['Fat', n.fat_g, 'g'],
        ['Fibre', n.fibre_g, 'g'],
        ...(n.micro ?? []).map(([label, per100, unit]) => [label, per100, unit] as const)
    ] as (readonly [string, number, string])[])
        .map(([label, per100, unit]) => `<tr><th scope="row">${esc(label)}</th><td>${fmt(per100 * scale, unit)}</td><td>${fmt(per100, unit)}</td></tr>`)
        .join('')
    return [
        `<svg class="donut" viewBox="0 0 112 112" role="img" aria-label="What this bag holds, by weight">
                <circle class="track" cx="56" cy="56" r="${r}"/>${arcs}
                <text class="kcal" x="56" y="54" text-anchor="middle">${Math.round(n.energy_kcal * scale)}</text>
                <text class="unit" x="56" y="68" text-anchor="middle">kcal</text>
            </svg>
            <ul class="legend">${legend}</ul>`,
        `<details class="origin"><summary>Full table and sources</summary>
            <table class="nutri"><thead><tr><th></th><th scope="col">this bag · ${grams} g</th><th scope="col">per 100 g</th></tr></thead><tbody>${table}</tbody></table>
            <p class="origin-note">Figures for 100 g of the dried fruit, as published, scaled to the ${grams} g of this bag.${n.source ? ` Source: ${esc(n.source)}.` : ''}</p>
        </details>`
    ] as const
}

const fruitState = { key: null as string | null, grams: null as number | null, named: false }

function fruitKey(config: Page, events: Event[]): string | null {
    const keys = Object.keys(config.fruits ?? {})
    const intake = events.find(e => e.data.phase === 'intake')?.data
    if (intake?.fruit && keys.includes(intake.fruit)) return intake.fruit
    for (const event of events) {
        const product = event.data.product?.toLowerCase()
        if (!product) continue
        const hit = keys.find(key => product.includes(key.toLowerCase()) || product.includes((config.fruits?.[key]?.name ?? '').toLowerCase()))
        if (hit) return hit
    }
    return null
}

export function revealFruit(config: Page, events: Event[], final = false) {
    const key = fruitState.key ?? fruitKey(config, events)
    const fruit = key ? config.fruits?.[key] : undefined
    const packing = events.find(e => e.data.phase === 'packing')?.data
    const product = events.find(e => e.data.product)?.data.product
    if (fruit && !fruitState.named) {
        fruitState.key = key
        fruitState.named = true
        $('fruit-name').textContent = fruit.name
        $('fruit-name').classList.add('in')
        $('fruit-lines').innerHTML = (fruit.lines ?? []).filter(Boolean).map(line => `<p class="fruit-line">${esc(line)}</p>`).join('')
        const photo = $<HTMLImageElement>('fruit-photo')
        if (fruit.photo) {
            photo.alt = fruit.alt ?? fruit.name
            photo.onload = () => photo.classList.add('in')
            photo.src = fruit.photo
            photo.hidden = false
        }
        $('stage-cap').hidden = true
    } else if (!fruit && final && !fruitState.named) {
        fruitState.named = true
        $('fruit-name').textContent = cap(product) ?? 'This bag'
        $('fruit-name').classList.add('in')
        $('fruit-grams').innerHTML = ''
        $('fruit-contains').hidden = true
        $('stage-cap').hidden = true
    }
    const grams = bagGrams(packing)
    if (fruit && grams && fruitState.grams !== grams) {
        fruitState.grams = grams
        $('fruit-grams').textContent = `${grams} g per bag`
        $('fruit-grams').classList.add('in')
        if (fruit.nutrition) {
            const [contains, origin] = donut(fruit.nutrition, grams)
            $('fruit-contains').classList.remove('skel-host')
            $('fruit-contains').innerHTML = contains
            $('fruit-origin').innerHTML = origin
            requestAnimationFrame(() => requestAnimationFrame(() => $('fruit-contains').classList.add('drawn')))
        } else {
            $('fruit-contains').hidden = true
        }
    }
}

function resetFruit() {
    fruitState.key = null
    fruitState.grams = null
    fruitState.named = false
    resetEdges()
    $('tri').setAttribute('class', 'tri')
    const photo = $<HTMLImageElement>('fruit-photo')
    photo.hidden = true
    photo.classList.remove('in')
    photo.removeAttribute('src')
    $('stage-cap').textContent = 'Reading the bag…'
    $('stage-cap').hidden = false
    $('fruit-name').classList.remove('in')
    $('fruit-grams').classList.remove('in')
    $('fruit-name').innerHTML = '<span class="skel name"></span>'
    $('fruit-lines').innerHTML = ''
    $('fruit-grams').innerHTML = '<span class="skel grams"></span>'
    $('fruit-contains').hidden = false
    $('fruit-contains').classList.remove('drawn')
    $('fruit-contains').classList.add('skel-host')
    $('fruit-contains').innerHTML =
        '<svg class="donut" viewBox="0 0 112 112" aria-hidden="true"><circle class="track" cx="56" cy="56" r="44"/></svg><ul class="legend skel-legend" aria-hidden="true"><li><span class="skel"></span></li><li><span class="skel"></span></li><li><span class="skel"></span></li><li><span class="skel"></span></li></ul>'
    $('fruit-origin').innerHTML = ''
}

// ---------- the arithmetic (block 5) ----------

export function renderCo2(config: Page, events: Event[]) {
    const co2 = config.co2
    const intake = events.find(e => e.data.phase === 'intake')?.data
    const cycle = events.find(e => e.data.phase === 'cycle')?.data
    const packing = events.find(e => e.data.phase === 'packing')?.data
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
            <p class="stage">${String(events.length + 1).padStart(2, '0')} · if this fruit was rescued</p>
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
async function nameHolder(owner: Address, chainId: number, rpc: string) {
    const chain = chainId === 1 ? mainnet : chainId === 11155111 ? sepolia : null
    if (!chain) return
    try {
        const client = createClient({ chain, transport: http(rpc) })
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
    row(1, 'reading…', 'busy')
    row(2, 'waiting', 'idle')
    row(3, 'waiting', 'idle')
    $('step-2').classList.remove('idle')
    $('step-3').classList.remove('idle')
    status('checking')
    $('hero').hidden = false
    $('fruit').hidden = false
}

// ---------- the check ----------

async function main() {
    reset()
    const config = await loadConfig()
    try {
        await check(config)
    } finally {
        void fingerprint(config) // after the records, since it may read the page's own bytes again
    }
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
    $('twin-id').textContent = `#${parsed.id}`
    document.title = `Twin #${parsed.id}`

    try {
        // 1 · reading Ethereum: which contract, which record, who holds the twin.
        const rpc = config.rpcs?.[parsed.chainId] ?? config.rpc
        const client = createClient({ transport: http(rpc) })
        const chainId = await getChainId(client)
        if (parsed.chainId !== chainId) throw Error(`no RPC for chain ${parsed.chainId}`)
        const address = parsed.contract
        if (!(await isOfficial(config, chainId, address))) throw new NotOfficial(`contract ${address} is not listed in the page config`)
        const reader = liveReader(client, address)
        const explorer = explorers[chainId]
        const [run, owner] = await Promise.all([reader.recordOf(parsed.id), reader.ownerOf(parsed.id)])
        const twin = () => {
            const state = renderTwin(parsed.id, owner, config, explorer, address)
            if (state !== 'none' && owner) void nameHolder(owner, chainId, rpc)
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

        // 2 · reading Swarm: walk the chain back from the latest record, painting each card as it lands.
        const path = $<HTMLOListElement>('path')
        const events: Event[] = []
        const cards = new Map<Hex, HTMLElement>()
        const queue: Hex[] = [run]
        const seen = new Set<Hex>()
        const fetchBytes = async (ref: Hex) => {
            let last: unknown
            for (const gateway of gateways) {
                tried.add(gateway)
                try {
                    const bytes = await download(gateway, ref)
                    served = gateway
                    return { bytes, gateway }
                } catch (error) {
                    last = error
                }
            }
            throw last instanceof Error ? last : Error('no gateway answered')
        }
        while (queue.length) {
            const ref = queue.shift()!
            if (seen.has(ref)) continue
            seen.add(ref)
            const { bytes, gateway } = await fetchBytes(ref)
            const data = JSON.parse(new TextDecoder().decode(bytes)) as Record
            const [anchored, block] = await reader.anchoredAt(ref)
            const event: Event = { ref, at: anchored ? new Date(Number(anchored) * 1000).toISOString() : null, block, bytes, data, gateway, verified: null, tx: null }
            events.push(event)
            events.sort((a, b) => a.data.at.localeCompare(b.data.at))
            cards.set(ref, placeCard(path, events, event, explorer))
            queue.push(...(data.inputs ?? []).map(hex))
            row(2, `${events.length} data ${events.length === 1 ? 'record' : 'records'}${queue.length ? '…' : ''}`, queue.length ? 'busy' : 'lit')
        }
        row(2, `${events.length} data ${events.length === 1 ? 'record' : 'records'}`)
        row(3, 'verifying…', 'busy')

        for (const event of events) {
            event.verified = event.at !== null && swarmHash(event.bytes) === event.ref
            markCheck(cards.get(event.ref)!, event)
        }
        const good = events.filter(e => e.verified).length
        const allGood = good === events.length
        row(3, `${good} of ${events.length} ${events.length === 1 ? 'match' : 'matches'}`, allGood ? 'lit' : 'bad')
        await edgesSettled()
        status(allGood ? 'verified' : 'mismatch')
        if (allGood) {
            $('proof-fold').classList.add('open')
            showStoredUntil(config)
        }
        later(() => revealFruit(config, events, true), 120)
        const lastCard = openPath(path, 1100)
        later(() => renderCo2(config, events), lastCard + UNFOLD_GAP + 120)
        later(twin, lastCard + UNFOLD_GAP + 360)

        void Promise.all(
            events.map(async event => {
                if (!explorer || !event.block) return
                const tx = await reader.anchorTx(event.ref, event.block)
                if (!tx) return
                const link = cards.get(event.ref)!.querySelector<HTMLAnchorElement>('.btn.anchor')
                if (link) link.href = `${explorer}/tx/${tx}`
            })
        )

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

void main()
