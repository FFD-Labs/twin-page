# Product

<!-- impeccable:product-schema 1 -->

Facts marked (README) are taken from this repository as written on 11 October 2026. Facts marked (tonytony32) were confirmed in conversation on that date.

## Platform

web

## Users

A person holding a bag of freeze-dried fruit given out at Devcon 8 (Mumbai, 2 to 6 November 2026) who scans the QR on its back with a phone. Most are Ethereum people: they know what an anchor and a hash are, and they believe what their own device computes more than what a page tells them. The page also opens on a laptop, and some visitors read it with view source. (README; the description of the audience is inferred from the event and not yet confirmed.)

## Product Purpose

The page a bag opens. It reads the bag's records, anchored on Ethereum and stored on Swarm, and checks them on the visitor's own device: every record is hashed again and compared with the reference its anchor names. Success is a visitor who sees the check happen on their device and then reads what the bag is and where it has been. (README)

## Positioning

No server of Fair Food Data sits between the visitor and the records. The page is one HTML file that anyone can read top to bottom, published with its hash, and what it shows is what the device verified, not what it was told. (README)

## Operating Context

- Reached from a QR sticker on the back of the pouch: `…/devcon8.html#<chainId>:<contract>/<id>`.
- The pouch is the object in the visitor's hand when the page opens. Three fruits, each with its own colourway: pineapple (blush and lilac), banana (deep aubergine), jackfruit (ivory and teal). Print files and source art are kept with the packaging, outside this repository.
- Read on a phone at the venue first, on a laptop second.

## Capabilities and Constraints

- Six blocks, top to bottom, each filling in as its records arrive: the fruit, the plate (the check), the path (one card per record), the arithmetic of the CO₂, who holds the twin, the footer with the file's fingerprint. The structure is final; the content is not. (README)
- One file with everything inside: styles, markup, configuration, viem, the page's own code with its types removed, the fonts. A Content-Security-Policy names its two scripts by hash. The build is deterministic and every release is filed with its SHA-256. (README)
- The file carries no image, so that it weighs as little as it can. The page first shows itself complete in CSS, with the crystal drawn and the colours of the pouch, and loads the art and the photograph last of all, from beside the file (tonytony32).
- The twins are numbered up to 15000 (tonytony32).
- A bag holds 10 g (tonytony32).
- The check is shown as a process, in order: your device asks Ethereum, then Swarm, and then everything fills in (tonytony32).
- It sets no cookies, keeps nothing on the device, signs and uploads nothing. (README)
- A record that fails the check is never read or painted; a record's values are written as text. (README)
- The fruit of a bag is known only once its packing record has been read and checked, so the page cannot know its colourway when it opens.
- The final fruits are pineapple, banana and jackfruit (tonytony32). The configuration still lists mango, the fruit of the test records.

## Brand Commitments

- The page looks like the pouch that opened it and takes the colourway of the scanned bag (tonytony32). The reference is the jackfruit pouch, front and back.
- The pouch's typefaces: Montserrat for the capitals, Fira Sans Condensed for sentences (packaging README).
- The page shows a photograph of the fresh fruit, one per fruit (tonytony32): the pineapples at their plantation in Assam, given by the grower; the bananas and the jackfruit from Unsplash. The fruit rendered inside the hexagon of the crystal on the pouch is not used: the hexagon is free on the page (tonytony32).
- The Fair Food Data mark and lockup identify the company, not the code (README).
- Plain, declarative English, as in the README and the page today.

## Evidence on Hand

- Real: the reads and the check, working today against test records on a Sepolia contract (bags 1 to 20).
- Real: the pouch artwork for three fruits, flat, 3392 × 5056 px, front and back, with its print specification.
- Placeholder: the nutrition figures, the CO₂ factor and reference scenario, the fruit photos. Nothing may be presented as final until it is. (README)

## Product Principles

1. The device checks, the page reports. Nothing is shown as verified before it is.
2. One file anyone can read, as light as it can be. Whatever the page needs to be itself lives inside it; what only makes it prettier comes afterwards.
3. The twin belongs to the bag. What the visitor holds and what the visitor sees are one object.
4. Every assumption in view: the arithmetic shows its factors, a record shows its raw text.

## Accessibility & Inclusion

Reduced motion and forced colours are handled today and stay handled. Text over the pouch's grounds must keep readable contrast in the three colourways, the dark one included.
