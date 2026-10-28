// Folds the page into one file that opens anywhere and reads like the source. The file is web/devcon8.html as written,
// with five things added in their marked places: the fonts and marks as data URIs, the merged config as JSON, the libraries
// as one compact script, the page's own modules one after another with only their types removed (Node's stripper keeps
// every comment and line), and in the head the policy that lets those two scripts run, with the two lines the page writes
// in its head to set the first paint, and no other. `node
// scripts/standalone.mjs` writes dist/devcon8.html. With `--release <folder>` (what scripts/release.mjs passes: the
// number of the release) the fingerprint line links to the SHA256SUMS of that folder of releases/ on GitHub.
//
// The file carries no image, and of the fruit only the colours of each pouch: the art of the pouches, the photographs and
// the description of each product are files the packing record of a bag names, and the page reads them from Swarm. What is
// published is the file alone.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'vite'
import { inspect } from './inspect.mjs'

const root = resolve(import.meta.dirname, '..')
const release = process.argv.includes('--release') ? process.argv[process.argv.indexOf('--release') + 1] : null
const out = resolve(root, 'dist-standalone')
const read = (file) => readFileSync(resolve(root, file))
const text = (file) => read(file).toString()

// ---------- 4 · the library: src/rails.ts and everything it reaches, as one script that defines `rails` ----------
await build({
    configFile: false,
    logLevel: 'warn',
    root,
    build: { lib: { entry: resolve(root, 'src/rails.ts'), name: 'rails', formats: ['iife'], fileName: () => 'rails.js' }, outDir: out, emptyOutDir: true, minify: true }
})
const libraries = text('dist-standalone/rails.js').replace(/<\/script/g, '<\\/script')
const lock = JSON.parse(text('package-lock.json')).packages
const versions = ['viem'].map(name => `${name} ${lock[`node_modules/${name}`].version}`).join(', ')

// ---------- 5 · the page's own code: three files, types removed, their imports from rails resolved ----------
// The stripper leaves a blank where each type was. This closes those blanks and nothing else: a blank is dropped only
// where the source had something other than a space, and one of two spaces goes when a blank left them side by side.
function stripTypes(source) {
    const stripped = stripTypeScriptTypes(source, { mode: 'strip' })
    let result = ''
    for (let i = 0; i < stripped.length; i++) {
        if (stripped[i] === ' ' && source[i] !== ' ') {
            while (i < stripped.length && stripped[i] === ' ' && source[i] !== ' ') i++
            if (result.endsWith(' ') && (i >= stripped.length || ' ,);\n'.includes(stripped[i]))) result = result.slice(0, -1)
            i--
            continue
        }
        result += stripped[i]
    }
    return result.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n')
}
const taken = new Set()
const ownModules = ['src/lib.ts', 'web/life-grid.ts', 'web/devcon8.ts'].map(file => {
    const code = stripTypes(text(file))
        .replace(/^import \{([^}]*)\} from '(?:\.\.\/src|\.)\/rails\.ts'\n/gm, (_, names) => {
            for (const name of names.split(',').map(n => n.trim()).filter(n => n && !n.startsWith('type '))) taken.add(name)
            return ''
        })
        .replace(/^import .* from '(?:\.\.\/src\/lib|\.\/life-grid)\.ts'\n|^import '\.\/life-grid\.ts'\n/gm, '')
        .replace(/^export (?=(?:async )?function |const |let |class )/gm, '')
    if (/^import |^export /m.test(code)) throw Error(`${file}: an import or export the assembly does not know`)
    return `// ${'='.repeat(110)}\n// ${file}\n// ${'='.repeat(110)}\n\n${code.trim()}\n`
})
const ours = `// What the page takes from the libraries above, by name; the full list is src/rails.ts.\nconst { ${[...taken].sort().join(', ')} } = rails\n\n${ownModules.join('\n')}`.replace(/<\/script/g, '<\\/script')
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'page.mjs'), ours)
execFileSync(process.execPath, ['--check', resolve(out, 'page.mjs')], { stdio: 'inherit' }) // a syntax error, a duplicate name, stops the build

// ---------- the page as written, with the pieces in their places ----------
let html = text('web/devcon8.html')
const data = (file, type) => `data:${type};base64,${read(`web/public/${file}`).toString('base64')}`
html = html.replace(/url\((['"]?)\.\/(fonts\/[^'")]+\.woff2)\1\)/g, (_, __, file) => `url('${data(file, 'font/woff2')}')`)
html = html.replace(/src="\.\/(brand\/[^"]+\.svg)"/g, (_, file) => `src="${data(file, 'image/svg+xml')}"`)
html = html.replace(/href="\.\/favicon\.svg"/, `href="${data('favicon.svg', 'image/svg+xml')}"`)
if (/\.\/(fonts|brand)\/|\.\/favicon/.test(html)) throw Error('a font or a mark is still external')

// 3 · the merged config, read by loadConfig() before it would fetch
const config = JSON.parse(text('web/public/config.json'))
delete config._about
if (release && config.source) config.source = `${config.source}/blob/main/releases/${release}/SHA256SUMS`
// Its RPCs are listed by the number of their network. The comment over it says which is which, from the config itself:
// the network of the contract first, and last the chain Swarm's stamps are paid on, read for the stamp alone and named by
// its number only.
const networks = { 1: 'Ethereum mainnet', 11155111: 'Sepolia' }
const place = (id) => (id === config.chain ? 0 : id === config.storage?.chain ? 2 : 1)
const legend = Object.keys(config.rpcs ?? {})
    .map(Number)
    .sort((a, b) => place(a) - place(b))
    .map(id => (place(id) === 2 ? `${id}, the chain Swarm's stamps are paid on, read for the stamp alone` : [networks[id] ? `${id} ${networks[id]}` : `${id}`, place(id) === 0 && 'the network of the bag'].filter(Boolean).join(', ')))
    .join('; ')
// The config says nothing of the fruit: what the page shows of it comes from Swarm, by the references of the bag's packing
// record. A key that did would be a leftover the page no longer reads, and the build stops rather than publish it.
for (const key of ['art', 'fruits', 'nutrition']) if (key in config) throw Error(`the config says something about the fruit: ${key}`)

// The scripts as they sit between their tags, to the byte: the policy names each by the hash of exactly this text. The
// two lines of the head are the page's, as it writes them before its styles; the library and the page's own code are added.
const head = /<script>([^<]*)<\/script>/.exec(html.slice(0, html.indexOf('</head>')))
if (!head) throw Error('the script of the head is not where the page writes it')
const scripts = { head: head[1], library: `\n${libraries}\n        `, page: `\n${ours}\n        ` }

// a function, so that a `$&` or a `$'` inside the minified libraries is not read as a replacement pattern
html = html.replace(
    /[ \t]*<script type="module" src="\.\/devcon8\.ts"><\/script>\n/,
    () =>
    `        <!-- 3 · Config: what the page reads from, read by loadConfig() before anything else. Its RPCs by network: ${legend}. -->\n` +
        `        <script type="application/json" id="config">\n${JSON.stringify(config, null, 2).replace(/</g, '\\u003c')}\n        </script>\n` +
        `        <!-- 4 · Library: ${versions}, bundled and minified from npm, unchanged. What the page takes from it is listed in src/rails.ts -->\n` +
        `        <script>${scripts.library}</script>\n` +
        `        <!-- 5 · Script: the page's own code as written, src/lib.ts, web/life-grid.ts and web/devcon8.ts, with only the types removed -->\n` +
        `        <script type="module">${scripts.page}</script>\n`
)
if (/<script type="module" src=/.test(html)) throw Error('the script tag was not replaced')

// ---------- the policy: the file runs its own three scripts and no other ----------
// A Content-Security-Policy, as a meta since the file travels without a server of its own. It names the three scripts by their
// SHA-256 and allows no other: not a handler written into the markup, not a script added later, not a javascript: link. The
// page writes what a record says as text; if a value ever reached the markup as it came, it would still not run. The policy
// is about script and nothing else: what the page may load and where it may connect stay as they were.
const sha256 = (script) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`
const policy = `script-src ${Object.values(scripts).map(sha256).join(' ')}; object-src 'none'; base-uri 'none'`
html = html.replace(/([ \t]*)<meta charset="utf-8" \/>\n/, (charset, indent) => `${charset}${indent}<meta http-equiv="Content-Security-Policy" content="${policy}" />\n`)
// What was hashed must be what a browser will hash. It reads the text between the tags after turning every carriage return
// into a line feed and every NUL into a replacement character, and it would stop a script that does not match its hash.
for (const script of Object.values(scripts)) if (/[\r\0]/.test(script)) throw Error('a script has a carriage return or a NUL: its hash would not be the one a browser computes')
// And the policy must be where a browser finds it. That its words are in the file says nothing: inside a comment they are
// text, and the file would run whatever was written into it. The file is parsed as a browser parses it, and it must have
// this policy in its head, before any script, with the three scripts it names and nothing else that runs (scripts/inspect.mjs).
if (inspect(html, Object.keys(scripts).length).policy !== policy) throw Error('the policy in the head is not the one that was written')
// A browser looks for the encoding in the first 1024 bytes. Past them it takes the server's word, or guesses, and a file
// read in another encoding is another text: the page's script would not match its hash, and would not run.
if (Buffer.from(html).indexOf('<meta charset="utf-8" />') + '<meta charset="utf-8" />'.length > 1024 || !html.includes('<meta charset="utf-8" />')) throw Error('the encoding is not declared in the first 1024 bytes')

mkdirSync(resolve(root, 'dist'), { recursive: true })
const name = 'devcon8.html'
writeFileSync(resolve(root, 'dist', name), html)
console.log(`dist/${name} · ${(html.length / 1024).toFixed(0)} kB`)
