// Builds the page and files it as the next release: releases/<n>/devcon8.html, its SHA-256 in SHA256SUMS next to it, in the
// form `shasum -a 256 -c SHA256SUMS` checks, and its row in the table of releases of the README. Run with
// `npm run release -- <n>`; without a number it says which one is next.
//
// A release has a number and is never written again. The number has two parts: the first is 0 while the page is in the
// workshop and 1 from the first official release, and the second counts the releases of that line one by one. So after
// 0.2 comes 0.3, or 1.0 when the line of 1 begins. The number is given by hand, so that a release is something one means
// to do, and it must be one of those two; the folder must not exist. The table in the README is the list of releases: the
// first two were named by their date and keep their folders, since each file links to its own.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const name = 'devcon8.html'
const stop = (...lines) => {
    console.error(lines.join('\n'))
    process.exit(1)
}

// ---------- the releases so far: the rows of the table, one after another ----------
const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
const rows = [...readme.matchAll(/^\| (\d+)\.(\d+) \| [^|]+ \| `releases\/([^`]+)\/` \| `[^`]+` \| `[0-9a-f]{64}` \| ([^|]+) \|$/gm)].map(([text, line, count, folder, status]) => ({ text, number: [Number(line), Number(count)], folder, status }))
const table = rows.map(row => row.text).join('\n')
// what may follow a release: the next of its line, or the first of the next line
const after = ([line, count]) => [`${line}.${count + 1}`, `${line + 1}.0`]
if (!rows.length || !readme.includes(table) || rows.some((row, i) => i > 0 && !after(rows[i - 1].number).includes(row.number.join('.'))))
    stop('The table of releases in the README is not one this script can read: one row per release, in order, one after another.')

// ---------- which release this is ----------
const last = rows.at(-1)
const [next, opening] = after(last.number)
const asked = process.argv[2]
if (asked !== next && asked !== opening)
    stop(
        asked === undefined ? `Say which release this is: npm run release -- ${next}` : `The next release is ${next}, not ${asked}.`,
        `Or ${opening}, if this one begins the line of ${opening.split('.')[0]}.`,
        `The last one is ${last.number.join('.')}, in releases/${last.folder}/.`
    )
const dir = resolve(root, 'releases', asked)
if (existsSync(dir)) stop(`releases/${asked}/ is already there. A release is never written again.`)

// ---------- the file ----------
// it names its own release: its fingerprint line links to the SHA256SUMS of this folder
execFileSync(process.execPath, [resolve(root, 'scripts/standalone.mjs'), '--release', asked], { stdio: 'inherit' })
const bytes = readFileSync(resolve(root, 'dist', name))
const hash = createHash('sha256').update(bytes).digest('hex')
mkdirSync(dir) // not recursive: it fails rather than write into a folder that is there
copyFileSync(resolve(root, 'dist', name), resolve(dir, name))
writeFileSync(resolve(dir, 'SHA256SUMS'), `${hash}  ${name}\n`)

// ---------- its row: the one that was current is superseded, and this one is current ----------
// the date is the day on the calendar of whoever publishes: it says when, and names nothing
const day = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const earlier = rows.map(row => (row.status === 'current' ? row.text.replace(/current \|$/, 'superseded |') : row.text))
const row = `| ${asked} | ${day} | \`releases/${asked}/\` | \`v${asked}\` | \`${hash}\` | current |`
writeFileSync(resolve(root, 'README.md'), readme.replace(table, () => [...earlier, row].join('\n')))

console.log(`releases/${asked}/${name}\nsha256 ${hash}`)
// on GitHub a release of the workshop is a pre-release, so that "Latest" waits for the first official one
const mark = asked.startsWith('0.') ? ', marked as a pre-release' : ''
console.log(`Its row is in the README. Commit the folder and the README; once that commit is on main, tag it v${asked} and attach the two files to a GitHub release of that name${mark}.`)
