// The releases: what the table of the README says against what releases/ holds. A published file is never written again,
// so every folder must still hold the file its SHA256SUMS names, and the table must name every folder with that hash.
// The release script reads the same table; it must refuse any number but the two that may come next, before it builds or
// writes anything. And a published file that is still to be used must run its own two scripts and no other, read the way a
// browser reads it (scripts/inspect.mjs, which the build asks of every file it writes).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { inspect } from '../scripts/inspect.mjs'

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

// ---------- what a published file runs ----------
// Release 0.1 has no policy, which is one of the reasons it was withdrawn: it is kept to be recognised, not to be used.
const inUse = rows.filter((row) => row.status !== 'withdrawn')

test('every published file that is still to be used runs its own two scripts and no other', () => {
    assert.ok(inUse.length)
    for (const { folder } of inUse) assert.equal(inspect(file('releases', folder, 'devcon8.html').toString()).scripts, 2, `releases/${folder}/devcon8.html`)
    assert.throws(() => inspect(file('releases', rows[0].folder, 'devcon8.html').toString()), /it has 0 policies, not one/)
})

// The same file, with one thing changed that a search for the policy's words would not notice.
const published = file('releases', inUse.at(-1).folder, 'devcon8.html').toString()
const policy = /[ \t]*<meta http-equiv="Content-Security-Policy"[^>]*>\n/.exec(published)[0]
const changed = {
    'its policy inside a comment': [(html) => html.replace(policy, `<!--\n${policy}-->\n`), /0 policies/],
    'its policy written twice': [(html) => html.replace(policy, policy + policy), /2 policies/],
    'its policy at the end of the body': [(html) => html.replace(policy, '').replace('</body>', `${policy}</body>`), /not in the head/],
    'a script before its policy': [(html) => html.replace(policy, `<script type="module">void 0</script>\n${policy}`), /before the policy/],
    'a policy that lets any script run': [(html) => html.replace("script-src '", "script-src 'unsafe-inline' '"), /other than by its hash/],
    'a policy that leaves base-uri open': [(html) => html.replace("; base-uri 'none'", ''), /leaves base-uri open/],
    'a third script': [(html) => html.replace('</body>', '<script>void 0</script></body>'), /3 scripts can run/],
    'a script loaded from elsewhere': [(html) => html.replace('</body>', '<script src="https://elsewhere.example/a.js"></script></body>'), /a script is loaded from elsewhere/],
    'one character more in its own script': [(html) => html.replace('void main()', 'void main() '), /not the two its policy names/],
    'a handler written into the markup': [(html) => html.replace('<main>', '<main onclick="void 0">'), /a handler written into it, onclick/],
    'a frame': [(html) => html.replace('</main>', '<iframe src="data:text/html,x"></iframe></main>'), /it has a <iframe>/],
    'a form': [(html) => html.replace('</main>', '<form action="https://elsewhere.example"></form></main>'), /it has a <form>/],
    'a refresh to another address': [(html) => html.replace(policy, `${policy}<meta http-equiv="refresh" content="0;url=https://elsewhere.example">\n`), /sends the visitor elsewhere/],
    'a stylesheet from elsewhere': [(html) => html.replace(policy, `${policy}<link rel="stylesheet" href="https://elsewhere.example/a.css">\n`), /links to a resource/],
    'a style that imports': [(html) => html.replace('<style>', '<style>@import "https://elsewhere.example/a.css";'), /its styles load from elsewhere/],
    'an image from elsewhere': [(html) => html.replace('</main>', '<img src="https://elsewhere.example/a.png"></main>'), /<img> is loaded from elsewhere/],
    'a link that is a script': [(html) => html.replace('</main>', '<a href=" JavaScript:void 0">x</a></main>'), /a script for an address/]
}
for (const [what, [change, why]] of Object.entries(changed))
    test(`a file with ${what} is not the file it says it is`, () => {
        const html = change(published)
        assert.notEqual(html, published, 'the test changed nothing')
        assert.throws(() => inspect(html), why)
    })
