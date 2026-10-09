// The releases: what the table of the README says against what releases/ holds. A published file is never written again,
// so every folder must still hold the file its SHA256SUMS names, and the table must name every folder with that hash.
// The release script reads the same table; it must refuse any number but the two that may come next, before it builds or
// writes anything.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const file = (...path) => readFileSync(resolve(root, ...path))
const folders = () => readdirSync(resolve(root, 'releases'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
const rows = [...file('README.md').toString().matchAll(/^\| (\d+\.\d+) \| [^|]+ \| `releases\/([^`]+)\/` \| `([^`]+)` \| `([0-9a-f]{64})` \| ([^|]+) \|$/gm)].map(([, number, folder, tag, hash, status]) => ({ number, folder, tag, hash, status }))
// what may follow a release: the next of its line, or the first of the next line
const after = (number) => {
    const [line, count] = number.split('.').map(Number)
    return [`${line}.${count + 1}`, `${line + 1}.0`]
}

test('the table names every folder of releases/, once', () => {
    assert.deepEqual(rows.map((row) => row.folder).sort(), folders())
})

test('every published file is the one its SHA256SUMS and its row name', () => {
    for (const { folder, hash } of rows) {
        assert.equal(createHash('sha256').update(file('releases', folder, 'devcon8.html')).digest('hex'), hash, `releases/${folder}/devcon8.html is not the file the table names`)
        assert.equal(file('releases', folder, 'SHA256SUMS').toString(), `${hash}  devcon8.html\n`)
    }
})

test('every published file links to the SHA256SUMS of its own folder', () => {
    for (const { folder } of rows) assert.ok(file('releases', folder, 'devcon8.html').includes(`/blob/main/releases/${folder}/SHA256SUMS"`))
})

test('the releases are numbered in order, and at most one is the current one', () => {
    assert.equal(rows[0].number, '0.1')
    rows.slice(1).forEach((row, i) => assert.ok(after(rows[i].number).includes(row.number), `${row.number} does not follow ${rows[i].number}`))
    for (const { status } of rows) assert.match(status, /^(current|superseded|withdrawn)$/)
    assert.ok(rows.filter((row) => row.status === 'current').length <= 1)
    // the first two were named by their date; from the third on, release n is releases/n/ and the tag vn
    for (const { number, folder, tag } of rows.slice(2)) assert.deepEqual([folder, tag], [number, `v${number}`])
})

test('the release script takes one of the two numbers that may come next, and writes nothing otherwise', () => {
    const last = rows.at(-1).number
    const [next, opening] = after(last)
    const [line, count] = last.split('.').map(Number)
    const release = (...args) => spawnSync(process.execPath, [resolve(root, 'scripts/release.mjs'), ...args], { encoding: 'utf8' })
    const before = folders()
    const unnamed = release()
    assert.equal(unnamed.status, 1)
    assert.match(unnamed.stderr, new RegExp(`npm run release -- ${next.replace('.', '\\.')}\\nOr ${opening.replace('.', '\\.')}, `))
    for (const not of [last, `${line}.${count + 2}`, `${line + 1}.1`, `${line + 2}.0`, `v${next}`, `${next}.0`, `0${next}`, String(count + 1), '2026-10-11', '']) {
        const refused = release(not)
        assert.equal(refused.status, 1, `it took ${not}`)
        assert.match(refused.stderr, /^The next release is /)
    }
    assert.deepEqual(folders(), before)
})
