// What the page needs to read a bag, and nothing that signs or uploads: the shape of the config, the read side of the
// contract, the sticker format, downloading a record from a gateway and hashing it the way Swarm does.
import { bytesToHex, hexToBytes, keccak256, parseAbi, recoverMessageAddress, type Address, type Hex } from './rails.ts'

// `rpcs`: the RPCs the page asks, by network and in order. The first that answers is read; the next is asked whether it says the same.
// `chain`: the network of `contract`, on whose explorer the footer links it.
export type Config = { rpcs: Record<string, string[]>; contract: Address; chain?: number; custody?: Address; contracts?: Address[]; gateways: string[] }

export const abi = parseAbi([
    'function anchoredAt(bytes32 ref) view returns (uint64 at, uint64 block)',
    'function recordOf(uint256 id) view returns (bytes32)',
    'function ownerOf(uint256 id) view returns (address)',
    'error ERC721NonexistentToken(uint256 tokenId)',
    'event Anchored(bytes32 indexed ref, uint64 at)'
])

// A Swarm reference is 32 bytes: 64 hex digits, with or without 0x in front. Anything else is not a reference, and the page
// stops there rather than ask a gateway or the contract for it.
export function hex(ref: unknown) {
    if (typeof ref !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(ref)) throw Error(`not a Swarm reference: ${ref}`)
    return (ref.startsWith('0x') ? ref : `0x${ref}`).toLowerCase() as Hex
}

// A record is small and a photograph not much more, but a gateway's bytes can come slowly. The page waits this long for a
// gateway to say something, its answer or more of its bytes; this long for the whole of a file from one that keeps saying
// something; and takes this much from it, and no more. One that falls silent, drags on or serves something else is left
// for the next.
const WAIT = 12_000
const LONGEST = 30_000
const MOST = 1024 * 1024

// A wait that ends by failing as a timeout fails, which is how the page knows a gateway that did not answer.
const outOfTime = (ms: number) =>
    new Promise<never>((_, reject) => {
        const signal = AbortSignal.timeout(ms)
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })

export async function download(gateway: string, ref: Hex) {
    // the whole file has one clock, and each thing the gateway is waited for starts another: bytes still coming are not cut
    const stop = new AbortController()
    const whole = outOfTime(LONGEST)
    const heard = async <T>(step: Promise<T>) => {
        try {
            return await Promise.race([step, whole, outOfTime(WAIT)])
        } catch (error) {
            stop.abort(error)
            throw error
        }
    }
    const response = await heard(fetch(`${gateway}/bytes/${ref.slice(2)}`, { signal: stop.signal }))
    if (!response.ok) throw Error(`download failed: ${response.status}`)
    const large = () => Error(`download failed: more than ${MOST} bytes`)
    if (Number(response.headers.get('content-length')) > MOST) throw large()
    // the length a gateway declares is its word: the bytes are counted as they come
    const reader = response.body?.getReader()
    const parts: Uint8Array[] = []
    let size = 0
    while (reader) {
        const { done, value } = await heard(reader.read())
        if (done) break
        size += value.length
        if (size > MOST) {
            void reader.cancel()
            throw large()
        }
        parts.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const part of parts) {
        bytes.set(part, offset)
        offset += part.length
    }
    return bytes
}

// The Swarm reference of a file, computed the way Swarm computes it, so the page can check the bytes it downloaded against the reference the anchor names.
const CHUNK = 4096
const SEGMENT = 32
const BRANCHES = CHUNK / SEGMENT

function chunkAddress(data: Uint8Array, span: number): Uint8Array {
    let level = new Uint8Array(CHUNK)
    level.set(data)
    for (let count = BRANCHES; count > 1; count /= 2) {
        const next = new Uint8Array((count / 2) * SEGMENT)
        for (let i = 0; i < count / 2; i++) next.set(keccak256(level.subarray(i * 2 * SEGMENT, (i + 1) * 2 * SEGMENT), 'bytes'), i * SEGMENT)
        level = next
    }
    const spanned = new Uint8Array(8 + SEGMENT)
    new DataView(spanned.buffer).setBigUint64(0, BigInt(span), true)
    spanned.set(level, 8)
    return keccak256(spanned, 'bytes')
}

export function swarmHash(data: Uint8Array): Hex {
    // the leaves: one address per chunk of data, each with the bytes it covers
    let nodes: { address: Uint8Array; span: number }[] = []
    for (let offset = 0; offset === 0 || offset < data.length; offset += CHUNK) {
        const slice = data.subarray(offset, Math.min(offset + CHUNK, data.length))
        nodes.push({ address: chunkAddress(slice, slice.length), span: slice.length })
    }
    while (nodes.length > 1) {
        const next: typeof nodes = []
        for (let i = 0; i < nodes.length; i += BRANCHES) {
            const group = nodes.slice(i, i + BRANCHES)
            if (group.length === 1) {
                next.push(group[0]!)
                continue
            }
            const packed = new Uint8Array(group.length * SEGMENT)
            group.forEach((node, k) => packed.set(node.address, k * SEGMENT))
            const span = group.reduce((total, node) => total + node.span, 0)
            next.push({ address: chunkAddress(packed, span), span })
        }
        nodes = next
    }
    return bytesToHex(nodes[0]!.address)
}

// What follows `#` in the link printed on the bag: <chainId>:<contract>/<id>, the network, the contract and the bag number.
// The page reads those three and nothing else.
export function parseSticker(hash: string) {
    const match = /^#?(\d+):(0x[0-9a-fA-F]{40})\/(\d+)(?:\D|$)/.exec(hash)
    if (!match) return null
    const [, chainId = '', contract = '', id = ''] = match
    return { chainId: Number(chainId), contract: contract as Address, id: BigInt(id) }
}

export class NotOfficial extends Error {}

// ---------- the bag's chapter: what its holder added to its record ----------
// The holder of a bag writes a feed on Swarm, topic "taste", whose latest update names a small JSON document, the chapter:
// one entry per kind, a photo, a message, each with its time and a picture or a text. FFD-Labs/kitchen writes it and its
// docs/FORMAT.md is the contract. It is not anchored: what the page checks is that the update is signed by the address
// that holds the record, and that the chapter is the bytes its reference names.
export const TOPIC = keccak256(new TextEncoder().encode('taste'))
export const CHAPTER_BYTES = 4096
export const CHAPTER_ENTRIES = 8
export const ENTRY_TITLE = 60
export const ENTRY_TEXT = 500
export const IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png', 'image/avif']
export type Entry = { kind: string; at: string; title?: string; text?: string; image?: { ref: Hex; type: string; width?: number; height?: number } }
export type Chapter = { chain?: number; contract?: string; bag?: number; entries: Entry[] }

const KIND = /^[a-z][a-z0-9-]{0,31}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

// A chapter read from its bytes, trimmed to what the page may draw, or null when the bytes are not one. An entry that
// breaks a rule, or repeats a kind, is dropped and the rest still show.
export function readChapter(bytes: Uint8Array): Chapter | null {
    if (bytes.length === 0 || bytes.length > CHAPTER_BYTES) return null
    let doc: unknown
    try {
        doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
        return null
    }
    if (!doc || typeof doc !== 'object') return null
    const { format, chain, contract, bag, entries } = doc as { [key: string]: unknown }
    if (typeof format !== 'string' || !format.startsWith('ffd-bag-chapter/1') || !Array.isArray(entries)) return null
    const seen = new Set<string>()
    const kept: Entry[] = []
    for (const raw of entries.slice(0, CHAPTER_ENTRIES) as unknown[]) {
        if (!raw || typeof raw !== 'object') continue
        const { kind, at, title, text, image } = raw as { [key: string]: unknown }
        if (typeof kind !== 'string' || !KIND.test(kind) || seen.has(kind)) continue
        if (typeof at !== 'string' || !INSTANT.test(at)) continue
        const entry: Entry = { kind, at }
        if (typeof title === 'string' && title.trim()) entry.title = title.trim().slice(0, ENTRY_TITLE)
        if (typeof text === 'string' && text.trim()) entry.text = text.trim().slice(0, ENTRY_TEXT)
        if (image && typeof image === 'object') {
            const { ref, type, width, height } = image as { [key: string]: unknown }
            if (typeof type === 'string' && IMAGE_TYPES.includes(type)) {
                try {
                    entry.image = { ref: hex(ref), type }
                    if (Number.isInteger(width) && (width as number) > 0) entry.image.width = width as number
                    if (Number.isInteger(height) && (height as number) > 0) entry.image.height = height as number
                } catch {
                    // not a reference: no picture
                }
            }
        }
        if (!entry.image && !entry.text) continue
        seen.add(kind)
        kept.push(entry)
    }
    return {
        chain: Number.isInteger(chain) ? (chain as number) : undefined,
        contract: typeof contract === 'string' ? contract : undefined,
        bag: Number.isInteger(bag) ? (bag as number) : undefined,
        entries: kept
    }
}

// The latest update of the holder's feed, as a gateway serves it: the reference it names, its index and its signature, or
// null when the feed has none. Bee answers the update's payload raw, the index and the signature in its headers.
export async function feedOf(gateway: string, owner: Address) {
    const response = await fetch(`${gateway}/feeds/${owner.slice(2).toLowerCase()}/${TOPIC.slice(2)}?type=sequence`, { signal: AbortSignal.timeout(WAIT) })
    if (response.status === 404) return null
    if (!response.ok) throw Error(`feed failed: ${response.status}`)
    const index = response.headers.get('swarm-feed-index') ?? ''
    const signature = response.headers.get('swarm-soc-signature') ?? ''
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.length !== SEGMENT || !/^[0-9a-f]{16}$/i.test(index) || !/^[0-9a-f]{130}$/i.test(signature)) throw Error('feed failed: not a feed update')
    return { ref: bytesToHex(body), index: BigInt(`0x${index}`), signature: `0x${signature}` as Hex }
}

// Who signed a feed update: the address the signature of its single owner chunk recovers to. The chunk wraps the
// reference (a span of 32 and the 32 bytes) under the identifier keccak256(topic || index), and its owner signs
// keccak256(identifier || the wrapped chunk's address) as an Ethereum message.
export async function signerOf(update: { ref: Hex; index: bigint; signature: Hex }) {
    const index = new Uint8Array(8)
    new DataView(index.buffer).setBigUint64(0, update.index, false)
    const topic = hexToBytes(TOPIC)
    const identifier = keccak256(new Uint8Array([...topic, ...index]), 'bytes')
    const wrapped = chunkAddress(hexToBytes(update.ref), SEGMENT)
    const digest = keccak256(new Uint8Array([...identifier, ...wrapped]))
    return recoverMessageAddress({ message: { raw: digest }, signature: update.signature })
}
