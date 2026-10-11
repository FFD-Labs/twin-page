// The files of each product, in products/<fruit>/, are the ones a packing record names among its documents. They are not
// part of the page, and nothing but this test ties them to it: each must be a file the page would show. A description the
// page cannot read, or an image heavier than the page takes, would be sealed with a record and never seen.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { openPage } from './page.mjs'

const { page } = await openPage()
const root = resolve(import.meta.dirname, '../products')
const images = ['photo.webp', 'cover.webp', 'background.webp']
const MOST = 1024 * 1024
const ascii = (file, from, to) => String.fromCharCode(...file.subarray(from, to))

for (const fruit of readdirSync(root)) {
    const files = readdirSync(resolve(root, fruit))
    const read = (name) => new Uint8Array(readFileSync(resolve(root, fruit, name)))

    test(`${fruit}: the folder holds the files of a product, under their names, and a note beside each image`, () => {
        const known = ['product-description.json', ...images]
        assert.deepEqual(files.filter((name) => !known.includes(name) && !known.includes(name.replace(/\.json$/, ''))), [])
        assert.ok(files.includes('product-description.json'))
        for (const name of images.filter((image) => files.includes(image))) assert.ok(files.includes(`${name}.json`), `${name} has no note of where it comes from`)
    })

    test(`${fruit}: the page reads its description, with its name, its key and its table`, () => {
        const described = page.readDescription(read('product-description.json'))
        assert.equal(described.fruit, fruit)
        assert.ok(described.name)
        assert.ok(described.nutrition)
        // the text of the photograph and who took it are there when the photograph is
        if (files.includes('photo.webp')) assert.ok(described.alt && described.credit)
    })

    test(`${fruit}: its description is plain JSON that names the version of the GS1 vocabulary its table follows`, () => {
        const file = read('product-description.json')
        assert.notEqual(file[0], 0xef, 'a byte order mark')
        const said = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file))
        assert.equal(said.schema, 'ffd/product-description/1.0')
        assert.match(said.standards.gs1_voc, /^\d+\.\d+$/)
    })

    for (const name of images.filter((image) => files.includes(image)))
        test(`${fruit}: ${name} is a WebP the page takes`, () => {
            const file = read(name)
            assert.ok(file.length <= MOST, `${file.length} bytes`)
            assert.equal(ascii(file, 0, 4), 'RIFF')
            assert.equal(ascii(file, 8, 12), 'WEBP')
        })
}
