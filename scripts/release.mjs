// Builds the page and files it with its fingerprint: releases/<today>/devcon8.html, and its SHA-256 in SHA256SUMS next
// to it, in the form `shasum -a 256 -c SHA256SUMS` checks. Run with `node scripts/release.mjs`.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const day = new Date().toISOString().slice(0, 10)
// the file names its own release: its fingerprint line links to the SHA256SUMS of this folder
execFileSync(process.execPath, [resolve(root, 'scripts/standalone.mjs'), '--release', day], { stdio: 'inherit' })

const name = 'devcon8.html'
const bytes = readFileSync(resolve(root, 'dist', name))
const hash = createHash('sha256').update(bytes).digest('hex')
const dir = resolve(root, 'releases', day)
mkdirSync(dir, { recursive: true })
copyFileSync(resolve(root, 'dist', name), resolve(dir, name))
writeFileSync(resolve(dir, 'SHA256SUMS'), `${hash}  ${name}\n`)
console.log(`releases/${day}/${name}\nsha256 ${hash}`)
