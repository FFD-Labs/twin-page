// What a browser would run in the single file, found the way a browser finds it: the file is parsed, not searched. The
// build asks this of what it has just written and stops if the answer is not the one it means; the tests ask it of every
// published file that is still to be used.
//
// The file runs its own two scripts and no other because its head says so: a Content-Security-Policy that names each by
// its SHA-256. A policy holds only where a browser finds it, as an element of the head that comes before any script. One
// that landed inside a comment, or after a script, is text, and a search for its words would still find it. So: there is
// one policy and it is where it holds; the scripts that can run are two, and each is one the policy names; and nothing
// else in the markup runs or loads anything from elsewhere.
import { createHash } from 'node:crypto'
import { JSDOM, VirtualConsole } from 'jsdom'

const sha256 = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

export function inspect(html) {
    const { document } = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window
    const stop = (what) => {
        throw Error(`the file is not what it says: ${what}`)
    }
    const all = [...document.querySelectorAll('*')]
    const after = (a, b) => Boolean(a.compareDocumentPosition(b) & 4) // b comes after a

    // ---------- the policy: one, in the head, about script ----------
    const policies = all.filter((el) => el.localName === 'meta' && el.getAttribute('http-equiv')?.toLowerCase() === 'content-security-policy')
    if (policies.length !== 1) stop(`it has ${policies.length} policies, not one`)
    const [policy] = policies
    if (policy.parentElement !== document.head) stop('its policy is not in the head')
    const content = policy.getAttribute('content') ?? ''
    const directives = new Map(content.split(';').map((directive) => directive.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))
    const named = directives.get('script-src') ?? []
    if (!named.length || named.some((value) => !/^'sha256-[A-Za-z0-9+/]{43}='$/.test(value))) stop('its policy lets a script run other than by its hash')
    for (const closed of ['object-src', 'base-uri']) if (directives.get(closed)?.join(' ') !== "'none'") stop(`its policy leaves ${closed} open`)

    // ---------- the scripts: two that run, each named by the policy, and data ----------
    const scripts = all.filter((el) => el.localName === 'script')
    if (scripts.some((script) => script.hasAttribute('src'))) stop('a script is loaded from elsewhere')
    const running = scripts.filter((script) => script.getAttribute('type') !== 'application/json')
    if (running.some((script) => !after(policy, script))) stop('a script comes before the policy')
    const hashes = running.map((script) => sha256(script.textContent))
    if (running.length !== 2) stop(`${running.length} scripts can run, not two`)
    if (hashes.some((hash) => !named.includes(hash)) || named.some((hash) => !hashes.includes(hash))) stop('the scripts are not the two its policy names')

    // ---------- nothing else runs, and nothing is loaded from elsewhere ----------
    for (const el of all) {
        const tag = `<${el.localName}>`
        if (['iframe', 'frame', 'object', 'embed', 'applet', 'base', 'form', 'portal'].includes(el.localName)) stop(`it has a ${tag}`)
        if (el.localName === 'meta' && el.getAttribute('http-equiv')?.toLowerCase() === 'refresh') stop('it sends the visitor elsewhere')
        if (el.localName === 'link' && !(el.getAttribute('rel') === 'icon' && el.getAttribute('href')?.startsWith('data:'))) stop('it links to a resource')
        if (el.localName === 'style' && /@import|url\(\s*(?!['"]?(?:data:|#))/i.test(el.textContent)) stop('its styles load from elsewhere')
        for (const { name, value } of el.attributes) {
            if (name.startsWith('on')) stop(`${tag} has a handler written into it, ${name}`)
            if (name === 'srcdoc') stop(`${tag} carries a document of its own`)
            if (/^\s*(javascript|vbscript):/i.test(value)) stop(`${tag} has a script for an address`)
            if (name === 'src' && !value.startsWith('data:')) stop(`${tag} is loaded from elsewhere`)
        }
    }
    return { policy: content, scripts: running.length }
}
