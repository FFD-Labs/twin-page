// Everything the page takes from the library, in one place: the read side of Ethereum and ENS from viem, as a bare
// client and the few actions the page calls, keccak256, which the Swarm reference is built on, and the recovery of the
// address that signed a message, which tells who wrote the bag's chapter. The single file is built from here: these names become one compact script, and the page's own code takes
// them from it. Nothing here signs or sends.
export { createClient, custom, http, isAddress, isAddressEqual, parseAbi, zeroHash, bytesToHex, hexToBytes, keccak256, recoverMessageAddress, BaseError, ContractFunctionRevertedError } from 'viem'
export { readContract, getContractEvents, getChainId, getEnsName, getEnsAvatar, getEnsText } from 'viem/actions'
export type { Address, Hex, Transport } from 'viem'
export { mainnet, sepolia } from 'viem/chains'
