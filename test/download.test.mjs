// How long the page waits for a gateway. Measured on the published page, one limit over the answer and the bytes together
// cut images while they were arriving, once with 129,776 of 148,750 B in and the last byte 50 ms before the cut. So silence
// ends a download, slowness does not, and a gateway that keeps sending has a limit of its own for the whole file. The waits
// are cut short for the tests, in their proportion; a stream here sends what the test says, when the test says.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { download } from '../src/lib.ts'

const ref = `0x${'ab'.repeat(32)}`
const SILENCE = 150
const WHOLE = 600
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const real = globalThis.fetch
afterEach(() => {
    globalThis.fetch = real
})

// the page's waits, cut short, and the ones it asked for
function shortWaits(t) {
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    const asked = []
    t.mock.method(AbortSignal, 'timeout', (ms) => {
        asked.push(ms)
        return timeout(ms > 12_000 ? WHOLE : SILENCE)
    })
    return asked
}
// a gateway whose answer `answer` gives; the signal the page gave it is kept
function gateway(answer) {
    const seen = {}
    globalThis.fetch = async (url, init) => {
        seen.url = url
        seen.signal = init.signal
        return answer(init.signal)
    }
    return seen
}
// a body that sends a byte, `count` times, one every `gap` ms, and then ends; or, with no count, stays open
const body = (gap, count = Infinity) => {
    let sent = 0
    return new Response(
        new ReadableStream({
            async pull(controller) {
                await sleep(gap)
                controller.enqueue(new Uint8Array([++sent % 256]))
                if (sent >= count) controller.close()
            }
        })
    )
}
const silentBody = (bytes) => new Response(new ReadableStream({ start: (controller) => controller.enqueue(new Uint8Array(bytes)) }))
const timedOut = (error) => error.name === 'TimeoutError'

test('a file that takes longer than the wait for silence, with its bytes still coming: it is not cut, and every byte is there', async (t) => {
    shortWaits(t)
    const seen = gateway(() => body(40, 6)) // 240 ms in all, more than the 150 of silence, and never 150 without a byte
    const bytes = await download('https://gateway.example', ref)
    assert.deepEqual([...bytes], [1, 2, 3, 4, 5, 6])
    assert.equal(seen.url, `https://gateway.example/bytes/${'ab'.repeat(32)}`)
    assert.equal(seen.signal.aborted, false)
})

test('a gateway that takes the request and never answers: the page gives up on it after the wait for silence, as a timeout, and tells the request', async (t) => {
    shortWaits(t)
    const seen = gateway((signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))))
    const from = performance.now()
    await assert.rejects(download('https://gateway.example', ref), timedOut)
    assert.ok(performance.now() - from < WHOLE, 'it did not wait for the limit of the whole file')
    assert.equal(seen.signal.aborted, true)
})

test('a gateway that falls silent halfway through a file: the page gives up on it, as a timeout, and tells the request', async (t) => {
    shortWaits(t)
    const seen = gateway(() => silentBody([1, 2, 3]))
    await assert.rejects(download('https://gateway.example', ref), timedOut)
    assert.equal(seen.signal.aborted, true)
})

test('a gateway that keeps sending and never ends: the limit of the whole file stops it, as a timeout', async (t) => {
    shortWaits(t)
    const seen = gateway(() => body(40))
    const from = performance.now()
    await assert.rejects(download('https://gateway.example', ref), timedOut)
    const took = performance.now() - from
    assert.ok(took >= WHOLE - 20, `it stopped at ${Math.round(took)} ms, before the limit of the whole file`)
    assert.equal(seen.signal.aborted, true)
})

test('the waits of the page: 12 s for each thing a gateway is waited for, and 30 s for the whole file, once', async (t) => {
    const asked = shortWaits(t)
    gateway(() => body(1, 2))
    await download('https://gateway.example', ref)
    assert.equal(asked.filter((ms) => ms === 30_000).length, 1)
    assert.ok(asked.filter((ms) => ms === 12_000).length >= 2) // the answer, and at least one read of its bytes
    assert.deepEqual([...new Set(asked)].sort(), [12_000, 30_000])
})

test('an error, or a body too large while its bytes come: they fail as they did, and are not timeouts', async (t) => {
    shortWaits(t)
    gateway(() => new Response('bad gateway', { status: 502 }))
    await assert.rejects(download('https://gateway.example', ref), /download failed: 502/)
    gateway(() => new Response(new Uint8Array(1024 * 1024 + 1)))
    await assert.rejects(download('https://gateway.example', ref), /more than 1048576 bytes/)
})
