# twin-page

The page a bag opens. A visitor scans the QR code on a bag of freeze-dried fruit and this page reads the bag's records, anchored on Ethereum and stored on Swarm, and checks them on the visitor's own device: every record is hashed again and compared with the reference its anchor names. No server of ours sits in between.

The page is one HTML file with everything inside: the script, the fonts and the configuration. It is being built for Devcon 8 (Mumbai, 2 to 6 November 2026). The structure is final; the content is not (see Status).

The published file reads like the source. It opens with a map of what it contains and what it talks to, and then comes in six marked parts: the styles, the markup, the configuration as JSON, the library (viem, bundled and minified from npm, unchanged), the page's own code exactly as written here with only the types removed, and the fonts. Anyone can read it top to bottom with view source.

## Try it

1. Download `releases/2026-10-09/devcon8.html` (open it on GitHub and use "Download raw file") and open it in a browser, on a phone or a laptop. It needs no server and nothing else to install.
2. Add the network, the contract and a bag number after a `#` at the end of the address, exactly like this, and load the page again. On a phone, tap the address bar and paste the part from `#`:

```
devcon8.html#11155111:0x240dfbca7064d091149169eff95f764d1e21cea7/1
```

   Bags 1 to 20 exist on that Sepolia test contract. The page reads Ethereum and Swarm, so it needs an internet connection.
3. What you should see, in order: the fruit card, empty while it reads; the plate reading Ethereum, then Swarm, then matching the two, with the triangle lighting up edge by edge; the border closing and the line "Your device just checked this bag with Ethereum and Swarm. No one else in between."; the fruit card filling in; the four records of the path, one after another; the arithmetic of the CO₂; who holds the twin; and, in the footer, the fingerprint of the file you are looking at, which you can compare with `releases/2026-10-09/SHA256SUMS`.

## The link

The QR on a bag is a link to this page with the bag after a `#`:

```
https://fairfooddata.eth.limo/devcon.html#<chainId>:<contract>/<id>
```

`chainId` is the network (1 for Ethereum mainnet, 11155111 for Sepolia), `contract` the address of the Fair Food Data contract and `id` the bag number. The page reads the three, checks the contract against the ones it lists (and, on mainnet, against the `ffd.contract` record of `fairfooddata.eth`) and shows the bag. A link whose contract is not Fair Food Data's shows a warning and nothing else.

## What the page shows

Top to bottom, each block filling in as its records arrive.

| Block | What it shows | Where it comes from |
|---|---|---|
| The fruit | The name, the grams per bag, what the bag holds (energy, sugars, protein, fat, fibre) and the full table per 100 g | The packing record names the product; the nutrition table is in the page |
| The plate | The twin's number, with the date its records are paid up to on Swarm under it, and the three reads at the vertices of a triangle: the scan on top, Ethereum (the bag's latest record and who holds it) and Swarm (the records) at the base. Local is the device hashing every record and comparing it with its anchor. Each edge draws as its read completes; the border closes when every record matches and the sealing line appears | Ethereum and Swarm, read by the device |
| The path | One card per record: received, freeze-dried, packed, delivered. The data rows, the check against the record's Ethereum anchor with the anchor's date, a link to the Ethereum anchor (its block, or the transaction once found) and to the file on Swarm, and the raw record | The records on Swarm |
| The arithmetic | If this fruit was rescued: the grams in the bag, the fresh fruit they came from and the CO₂e that stays out of the air, every assumption in view | The cycle and packing records, and the factors in the configuration |
| The twin | Who holds the bag's twin: the jazzicon of its address, as its wallet draws it, or its ENS name and avatar when it has them | Ethereum and ENS |
| The footer | Anchored on Ethereum, stored on Swarm, living on public rails; the Fair Food Data mark and the site; the fingerprint of the page | |

The states the page handles: no record yet for the bag, no bag in the link, a link cut short, a contract the page does not list, a network the page has no RPC for, and a network that does not answer (the gateways are tried in order, with a retry).

## The fingerprint

The file behind the QR is published here with its SHA-256 hash, in `releases/<date>/`. A page cannot carry its own hash, since writing it in would change the bytes. So when the page opens from the web, the device reads the file it received, hashes it and shows the result in the footer, the same way it hashes every record. Compare that number with `SHA256SUMS`.

To check a copy of the file:

```
cd releases/2026-10-09 && shasum -a 256 -c SHA256SUMS
```

To check that the published file is what this source builds: with Node 24 and the lockfile, the build gives the same bytes every time. Name the release when you build, since the file links to its own folder; the page's own code is not compiled, only stripped of its types, so the file's last script is the three source files one after another.

```
npm ci
node scripts/standalone.mjs --release 2026-10-09
shasum -a 256 dist/devcon8.html
```

## What the page never does

- It talks only to Ethereum through a public RPC and to Swarm through public gateways. No server of ours. The one exception is a holder's ENS avatar, which the page loads from wherever that holder keeps the image.
- It sets no cookies and keeps nothing on the device.
- What follows `#` in the link stays on the device: the page reads it and never sends it.
- Nothing here signs, uploads or moves anything.

## Build

```
npm ci
npm run check          # type check
npm run dev            # http://localhost:5173/devcon8.html
npm run standalone     # dist/devcon8.html, the one file
npm run release        # builds the file and files it in releases/<today>/ with SHA256SUMS
```

Open the built file with the network, the contract and the bag number after a hash, as in The link.

## Files

| File | What it is |
|---|---|
| `web/devcon8.html` | The page: markup and styles |
| `web/devcon8.ts` | The script: the reads, the check, the arrival of every block, the holder's jazzicon and ENS name, the fingerprint |
| `web/life-grid.ts` | The field behind the footer |
| `src/lib.ts` | The contract's read side, the link format, downloading a record, and the Swarm reference of a file computed the way Swarm computes it, written here so anyone can read how a record is checked |
| `src/rails.ts` | Everything the page takes from viem, by name: the read side of Ethereum and ENS, keccak256 |
| `web/public/config.json` | What the page reads: the RPC and the contract it trusts, the custody address, the gateways in order, the day the storage is paid up to, the links, this repository, the fruits and the CO₂ assumptions |
| `scripts/standalone.mjs` | Folds the page into one file: the source HTML, the fonts and marks inlined, the config, the library as one compact script, the page's code with its types removed |
| `scripts/release.mjs` | Builds the file and files it with its hash |
| `releases/<date>/` | The published files and their `SHA256SUMS` |

## Status

9 October 2026. Work in progress.

- The records the page reads today are test records on a Sepolia contract. The event runs on Ethereum mainnet with real records; the network and the contract in the QR come with that contract.
- Placeholder: the fruit photos, the nutrition figures (working values until a public table is cited), the CO₂ factor and reference scenario (being closed with our partners), the colours of the frame around the fruit card.
- The bags and their packaging are separate work, not in this repository.
- The latest file is `releases/2026-10-09/devcon8.html`; its hash is in `SHA256SUMS` next to it.

## License

Apache 2.0, see `LICENSE`. The code is yours to use, copy and change, with the notices kept.

The name Fair Food Data, its mark and the lockups in `web/public/brand/` are not covered by the license: they identify us, not the code. A copy of the page for another twin takes the code and leaves the mark.

What comes from others keeps its own license: viem (MIT), and the three typefaces, Host Grotesk, Spline Sans Mono and Spectral (SIL Open Font License 1.1).
