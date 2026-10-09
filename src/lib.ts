// What the page needs to read a bag, and nothing that signs or uploads: the shape of the config, the read side of the
// contract, the sticker format, downloading a record from a gateway and hashing it the way Swarm does.
import { bytesToHex, keccak256, parseAbi, type Address, type Hex } from './rails.ts'

export type Config = { rpc: string; contract: Address; custody?: Address; rpcs?: Record<string, string>; contracts?: Address[]; gateways: string[] }

export const abi = parseAbi([
    'function anchoredAt(bytes32 ref) view returns (uint64 at, uint64 block)',
    'function recordOf(uint256 id) view returns (bytes32)',
    'function ownerOf(uint256 id) view returns (address)',
    'event Anchored(bytes32 indexed ref, uint64 at)'
])

export const hex = (ref: string) => (ref.startsWith('0x') ? ref : `0x${ref}`) as Hex

export async function download(gateway: string, ref: Hex) {
    const response = await fetch(`${gateway}/bytes/${ref.slice(2)}`)
    if (!response.ok) throw Error(`download failed: ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
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
