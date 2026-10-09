// The page, for a test: web/devcon8.html as jsdom parses it, the config inline as the single file carries it, and the
// page's own script, web/devcon8.ts, imported as written. jsdom parses HTML the way the standard says, so what a test
// finds in the document is what a browser would have built from the same string.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const root = resolve(import.meta.dirname, '..')
const text = (file) => readFileSync(resolve(root, file), 'utf8')

// Importing the script starts the page, as loading it does: with no bag in the link it settles on its notice. After that
// its functions are the test's to call. One page per test file: node runs each file in a process of its own.
export async function openPage(config = JSON.parse(text('web/public/config.json'))) {
    const { window } = new JSDOM(text('web/devcon8.html'), { url: 'file:///devcon8.html' })
    const { document } = window
    const inline = document.createElement('script')
    inline.type = 'application/json'
    inline.id = 'config'
    inline.textContent = JSON.stringify(config)
    document.body.append(inline)
    Object.assign(globalThis, { window, document, location: window.location, requestAnimationFrame: (fn) => setTimeout(fn, 0) })
    const page = await import('../web/devcon8.ts')
    await new Promise((done) => setTimeout(done, 0))
    assert.match(document.getElementById('notice').textContent, /No bag to show yet/)
    return { document, page }
}

// One string for every place a value can land. Written as text it would open two elements; inside a quoted attribute it
// would close the quote and add a handler. `via` names the field it came through.
export const hostile = (via) => `x" onfocus="globalThis.ran='${via}'" autofocus="<img src=x onerror="globalThis.ran='${via}'"><ffd-probe via="${via}"></ffd-probe>`

// Nothing of a record may become an element or an attribute of the page. The page's own markup has no handler attributes:
// it listens with addEventListener.
export function clean(document) {
    const made = [...document.querySelectorAll('ffd-probe, img[src="x"]')].map((el) => el.outerHTML)
    const set = [...document.querySelectorAll('*')].flatMap((el) => [...el.attributes].filter((a) => a.name.startsWith('on') || a.name === 'autofocus').map((a) => `<${el.localName} ${a.name}>`))
    assert.deepEqual(made, [], 'an element was created from a value of a record')
    assert.deepEqual(set, [], 'an attribute was created from a value of a record')
}
