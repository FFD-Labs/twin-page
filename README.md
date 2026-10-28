# twin-page

The page a bag opens. A visitor scans the QR code on a bag of freeze-dried fruit and this page reads the bag's records, anchored on Ethereum and stored on Swarm, and checks them on the visitor's own device: every record is hashed again and compared with the reference its anchor names. No server of ours sits in between.

The page is one HTML file with everything it needs inside: the script, the fonts and the configuration. It carries no image, and of the fruit only the colours of each pouch: what it shows of the pouch it draws, and the name of the fruit, what the bag holds, its photograph and the illustrations of its pouch are files the bag's packing record names, which the page reads from Swarm and checks against their references, the images last of all. It is complete without them. It is being built for Devcon 8 (Mumbai, 2 to 6 November 2026). The structure is final; the content is not (see Status).

The published file reads like the source. It opens with a map of what it contains and what it talks to, and then comes in six marked parts: the styles, the markup, the configuration as JSON, the library (viem, bundled and minified from npm, unchanged), the page's own code exactly as written here with only the types removed, and the fonts. Anyone can read it top to bottom with view source.

## Try it

1. Download `devcon8.html` from the folder of the current release, the one marked current in [Releases](#releases) (open it on GitHub and use "Download raw file"), and open it in a browser, on a phone or a laptop. It needs no server and nothing else to install.
2. Add the network, the contract and a bag number after a `#` at the end of the address, exactly like this, and load the page again. On a phone, tap the address bar and paste the part from `#`:

```
devcon8.html#11155111:0x240dfbca7064d091149169eff95f764d1e21cea7/1
```

   Bags 1 to 20 exist on that Sepolia test contract. The page reads Ethereum and Swarm, so it needs an internet connection.
3. What you should see, in order: the front of the pouch, its crystal drawn as an outline while the page reads; under it a line that goes from your device to Ethereum and on to Swarm, each stretch drawn as its read comes back, while the frame of the hexagon at the heart of the crystal is drawn with them; the hexagon closing, the crystal taking the colours of the bag's pouch, and the line "Your device just checked this bag with Ethereum and Swarm."; the fruit and what the bag holds; the four records of the path, one after another down one line; the arithmetic of the CO₂; who holds the twin; and, last of all, the art of the pouch and the photograph of the fruit, when the bag's packing record names them. The test records of bags 1 to 20 name none: they show the fruit, its grams and the drawn crystal.

## The link

The QR on a bag is a link to this page with the bag after a `#`:

```
https://fairfooddata.eth.limo/devcon8.html#<chainId>:<contract>/<id>
```

`chainId` is the network (1 for Ethereum mainnet, 11155111 for Sepolia), `contract` the address of the Fair Food Data contract and `id` the bag number. The page reads the three, checks the contract against the ones it lists (and, on mainnet, against the `ffd.contract` record of `fairfooddata.eth`) and shows the bag. A link whose contract is not Fair Food Data's shows a warning and nothing else.

## What the page shows

Top to bottom, each block filling in as its records arrive. The page looks like the pouch that opened it: it opens in ivory and teal, and takes the colourway of the bag's pouch once a record that passed the check has named its fruit.

| Block | What it shows | Where it comes from |
|---|---|---|
| The front | The front of the pouch: its lockup and its crystal, with the twin's number inside the hexagon at its heart, the name of the fruit, and the three reads on one line, in the order they happen: your device asks Ethereum (the bag's latest record and who holds it), then Swarm (the records), and hashes every record to compare it with its anchor. Each read draws its stretch of the line and two edges of the hexagon; the hexagon closes when every record matches and the sealing line appears, with the day the records are paid up to on Swarm under it: the day of the stamp the bag's record names, read from Gnosis, with the day written in the configuration in its place until it comes and when it does not. Tap it to see the stamp on Stamptime. The crystal is drawn by the page: an outline, then the colours of the pouch, and the pouch's own illustration when it arrives | Ethereum, Swarm and, for the stamp, Gnosis, read by the device |
| The fruit | The back of the pouch: the photograph of the fruit where the QR sticker sits, and in the label panel the grams per bag, what the bag holds (energy, sugars, protein, fat, fibre) and the full table per 100 g | The packing record names the product and the files of its description and its photograph, read from Swarm (see The product) |
| The path | One card per record: received, freeze-dried, packed, delivered, each headed by its glyph, drawn in the tints of the pouch's crystal. The data rows, the check against the record's Ethereum anchor with the anchor's date, a link to the Ethereum anchor (its block, or the transaction once found) and to the file on Swarm, and the raw record. Received says where the fruit came from, the country the record names by its code followed by its flag, and where the plant is, from the file the record names: the place, followed by the flag of its country, from the code the file gives or the name the place ends with, and its coordinates, which are a link to OpenStreetMap, named in small print under them. Freeze-dried draws the cycle: the chamber temperature and the pressure hour by hour, the shelves faint behind, and the coldest point and the lowest pressure the record declares as two figures above the chart, with the hour they came, and marked on their curves, from the light file the record names for the page (`telemetry_preview`), read like a file of the product; the full curves, the SenML the record names as `telemetry`, are a line of small print beside the raw record. Delivered draws the route: the plant and where the bag went, from the file the intake record names and the one the transport record names, joined by a line that is drawn as the map lands, with the distance as the crow flies and the days from departure to arrival under it; the coordinates of the destination, on the To row, are a link to OpenStreetMap, and the line under the map ends with one that opens it over the two places | The records on Swarm; the location of the plant, a file the intake record names, and where the bag went, a file the transport record names (see The product); and for a cycle the preview of its curves, named by its record |
| The arithmetic | If this fruit was rescued: the grams in the bag, the fresh fruit they came from and the CO₂e that stays out of the air, every assumption in view | The cycle and packing records, and the factors in the configuration |
| The twin | Who holds the bag's twin: the jazzicon of its address, as its wallet draws it, or its ENS name and avatar when it has them | Ethereum and ENS |
| The footer | Anchored on Ethereum, stored on Swarm, living on public rails; the Fair Food Data mark and the site; the fingerprint of the page | |

The states the page handles: no record yet for the bag, no bag in the link, a link cut short, a contract the page does not list, a network the page has no RPC for, a source of Ethereum or a gateway that does not answer or serves something else (the next is asked; when none answers, the page says so and offers to try again), a record that fails the check, and a record that passes it and is not one the page knows how to show.

A record that fails the check is never read: what a gateway serves is hashed and compared with its anchor before a byte of it is parsed, and a record that does not match gets a card with its reference and nothing of what arrived. "Does not match" is said only when a gateway answered and none had the record. A record that passes and that the page does not understand, a phase it does not know yet or a field of another kind, has a card that says so, with its text as it was written, and the rest of the page goes on.

## Who the page asks

The records are checked by arithmetic: whatever gateway serves them, their bytes give their reference or they do not. What Ethereum says is different. Which record a bag has, and whether a record is anchored, is something the page is told by a source, and it reads with the first of these that is on the network of the link and answers:

1. A wallet in the browser, when there is one. It is the visitor's own way to the chain. It is asked to read, never for an account, a signature or a change of network, and only on a network the page has RPCs for.
2. The RPCs of the configuration, in order: for Sepolia, an Alchemy endpoint and then a public one. The key in the Alchemy address is public, like the rest of the file; it is limited to the page's contracts and to ENS.

When every record matches, the next source is asked the two things the check rests on: which record the bag has, and whether each record has its anchor, and since when. Its answer is kept on the plate (`data-sources`: `agree`, `differ` or `single`) and is not shown yet. Until it is, the plate closes on what the first source says, and the check is as good as that source: one that lied could have a record that was never anchored shown as checked.

One more thing is asked, of another chain, for the line under the seal. The records are stored on Swarm under a stamp, a postage batch that is paid for by the block, and the bag's record names it (`stamp`). Once every record has matched, the page asks the PostageStamp contract on Gnosis what is left on that batch and the price of a block, through the RPCs the configuration lists for Gnosis, in order, and never through a wallet: a wallet is on the network of the bag, and the page does not ask it to change. The day that gives is the one shown. The day written in the configuration goes up first and stands when the stamp has run out, when no RPC answers, or when the record names no stamp. Tap the line and the stamp opens on Stamptime, where anyone can see how long it lasts and add to it.

## The fingerprint

The file behind the QR is published here with its SHA-256 hash, each release in a folder of its own under `releases/`. A page cannot carry its own hash, since writing it in would change the bytes. So when the page opens from the web, the device asks for the file once more, hashes what it gets and shows the result in the footer. Compare that number with `SHA256SUMS`.

That number tells a copy from the published file when nobody is hiding the difference: an old file, a wrong upload. It is no defence against whoever serves the page, since the number is computed and shown by the file that was served, and a file changed on purpose shows the number it likes. To be sure of a copy, download it and hash it yourself.

To check a copy of the file, in the folder of its release:

```
cd releases/<folder> && shasum -a 256 -c SHA256SUMS
```

A release is the file, and the file is all that is published: what the page shows of a fruit is on Swarm, named by the records of each bag.

To check that a published file is what its source builds: with Node 24 and the lockfile, the build gives the same bytes every time. Build from the tag of the release and name its folder, since the file links to its own; the page's own code is not compiled, only stripped of its types, so the file's last script is the three source files one after another.

```
git checkout <tag>
npm ci
node scripts/standalone.mjs --release <folder>
shasum -a 256 dist/devcon8.html
```

## Releases

Every file that has been published, in the order it was. A release has a number, a folder that is never written again and a tag on the commit it was built from.

The number has two parts. The first is 0 while the page is in the workshop (see Status) and 1 from the first official release. The second counts the releases of that line, one by one: after 0.2 comes 0.3, and the first official one is 1.0.

The first two were named by their date and keep their folder and their tag, since each file links to its own folder. From the third on, release 0.3 is `releases/0.3/` and the tag `v0.3`.

| Release | Date | Folder | Tag | SHA-256 of `devcon8.html` | Status |
|---|---|---|---|---|---|
| 0.1 | 9 Oct 2026 | `releases/2026-10-09/` | `2026-10-09` | `c9840efe1f223e1d199b2f6039be5573bdefd9685378a51631ac4f4f32e2ed87` | withdrawn |
| 0.2 | 10 Oct 2026 | `releases/2026-10-10/` | `2026-10-10` | `0e6f48570feedab7d29b1b6a741eabf1366ea2a4aacd201b3052f54eee69d95e` | superseded |
| 0.3 | 11 Oct 2026 | `releases/0.3/` | `v0.3` | `804395a26c31d6739ecacdd80b0fc210a9f1b5e0e566341f4aee44630428b1fd` | superseded |
| 0.4 | 11 Oct 2026 | `releases/0.4/` | `v0.4` | `df51fe61184360017716f81cee96f6eba8cf3f0bb9e1c1664a563c28fd9ba613` | current |

The file to use is the one marked current. A superseded one has a newer file after it and nothing known against it. Release 0.1 is withdrawn: it painted a record before checking it and wrote one of its values into the page as it came, so a gateway or an RPC that lied could run script in it. Its file stays here with its hash so that a copy of it can be recognised; do not use it.

To publish the next one:

```
npm run release -- <n>
```

`<n>` is the next number; run it without one and it says which. It is the next of the same line or, to begin the line that follows, its first: after 0.2 the script takes 0.3 or 1.0 and nothing else. It builds the file, files it in `releases/<n>/` with its `SHA256SUMS` and adds its row to the table, and it never writes into a folder that is there. Commit the folder and the README; once that commit is on `main`, tag it `v<n>` and attach the two files to a GitHub release of that name. While the first number is 0 that GitHub release is marked as a pre-release, so that "Latest" waits for 1.0.

## The product

What the page says of the fruit is not in the page, nor is where the plant is. A record names files among its `documents`, each by its name, its type and its reference, and the page reads the ones it knows, by name and type, from the record that names them. The packing record of a bag names the files of what the bag holds; the intake record names where the plant is, and the transport record where the bag went:

| Document | Named by | Type | What the page does with it |
|---|---|---|---|
| `product-description.json` | the packing record | `application/json` | The name of the fruit, the key that picks the colours of its pouch, the table per 100 g that the label scales to the grams of the bag, and the text and the credit of the photograph |
| `photo.webp` | the packing record | `image/webp` | The photograph of the fruit |
| `cover.webp` | the packing record | `image/webp` | The illustration that opens the page, around the twin's number |
| `background.webp` | the packing record | `image/webp` | The illustration behind the label |
| `site-location.geojson` | the intake record | `application/geo+json` | Where the plant is: the place, with its flag, and its coordinates, on the Received card |
| `destination-location.geojson` | the transport record | `application/geo+json` | Where the bag went: its coordinates on the Delivered card, and the end of the route the card draws from the plant |

Each is read like a record: asked of the gateways in order by its reference, hashed the way Swarm does, and used only when the bytes give that reference. The reference is inside a record that has its anchor on Ethereum, so the file is the one that record was sealed with. A document under another name, of another type, heavier than 1 MiB, or whose bytes are not what they should be, is not shown, and the page is the same without it. The description is asked for as soon as the records are read and the seal does not wait for it; the two locations once the records are checked, and the Received card gains its rows, and the Delivered card its coordinates and its map, when they have come; the images come last of all.

The description is an `ffd/product-description/1.0` file. The page reads `name`, `fruit`, the six figures of `nutrition` (`energy_kcal`, `carbohydrate_g`, `sugars_g`, `protein_g`, `fat_g`, `fibre_g`), with `energy_kj`, `saturated_fat_g`, `salt_g`, `micro` and `source` when they are there, and `photo.alt` and `photo.credit`. It does not read `nutrition.as_given`, the figures as their producer gave them. It reads the two dates of the pouch's label, `manufactured` and `expires`, a month (`2026-09`) or a day, and prints them under the full table as the pouch prints them, `SEP/2026`. The full table is in the order of a label: energy in kJ and kcal, fat and its saturates, carbohydrate and its sugars, fibre, protein and salt. A description also carries a light tag, `standards.gs1_voc`: the version of the GS1 Web Vocabulary its table follows, so that the GS1 document of the product can be generated from it. The page does not read the tag. Whatever it says is written as text. Without it the page names the fruit the records name and, when it is one the page has a pouch for, gives the grams of the bag.

A location, the plant's or the destination's, is a GeoJSON `Feature` whose geometry is a `Point`, its `coordinates` the longitude and then the latitude, as GeoJSON writes them, with `properties.place`, the words for it, `properties.country`, the code of its country (`IN`) when the file gives one, and, for the plant, `properties.site`, the key the records name the plant by (`urn:bdf:site:india-1`). The page reads the two coordinates when they are numbers on Earth, prints them to four decimals with N or S and E or W, `20.2353° N, 85.1091° E`, and makes them a link to OpenStreetMap at that point, named in small print under them. A code of two capital letters that names a country sets its flag after the place, 🇮🇳, which the emoji font of the device draws; the Origin row of the same card sets it after the name of the country the record gives by code for a farm. A file without the code gets the flag of the country whose name, in English, the place ends with after its last comma, India in `Dhodapalli, Odisha 752077, India`, read against the same list of countries the page prints a code with and never a list of its own; words that are not exactly such a name give no flag. The address holds the two numbers, written by the page, and never a word of the file; the place is written as text. A file of another shape says nothing, and the card is as it was.

With both files in, and the transport record naming the plant's site as its origin, the Delivered card draws the route between the two points: a map of the page's own making, no tile and nothing loaded from anyone, with the two places named by the words before the first comma of each file, a line between them that bows to the north, and under it the distance as the crow flies and the days from departure to arrival. The line under the map ends with a link that opens OpenStreetMap over the two places, the destination marked and the view centred between them at the widest zoom at which both fit, with numbers of the page's making in the address and nothing else. Two places within a kilometre of each other are one, and there is no map.

## What the page never does

- It reads Ethereum, through the visitor's wallet or the RPCs it lists, Swarm, through public gateways, and Gnosis, through the RPCs it lists and for the stamp alone (see Who the page asks). No server of ours.
- It loads no image until everything else is on screen. Then it asks the Swarm gateways for the art of the bag's pouch and the photograph of its fruit, by the references the packing record names, and shows each only when its bytes give that reference. The gateways see which files are fetched, as they see the records. Whoever served the page is asked for nothing more. A bag whose record names no image shows the drawn crystal, and nothing is missing.
- The coordinates of the plant, on the Received card, and of where the bag went, on the Delivered card, are links to OpenStreetMap, and the line under the map the Delivered card draws ends with one that opens it over the two places. The page loads nothing from it, no map and no tile, and asks it for nothing: the map is drawn by the page from the two points, and a link is followed only when it is tapped, like the links to Etherscan and to a file on Swarm.
- It never downloads the full curves of a cycle. A cycle record names them twice: the readings of the machine as SenML, about 2 MB, and a light file in columns the Notary publishes for the page, about 45 KB. The page reads the second, checked against its reference like any file, and draws it in the card of the cycle; the first opens on Swarm only when the small "Full curve data" line beside the raw record is tapped. A cycle that names no curves, as the test records of bags 1 to 20, has its rows and no chart.
- When a twin has moved to an address with an ENS name, the page asks ENS for the name and the avatar through the same source, and loads the avatar from wherever its holder keeps it: an address of their choosing, ipfs.io or arweave.net, and for an NFT its contract and the metadata that contract names. Whoever serves it sees that the page was opened.
- It follows no off-chain lookup (CCIP-Read). A name kept off-chain is not resolved, and its holder is shown by address.
- Stamptime, where the stamp is looked up, opens only when the visitor taps the line under the seal, in a new tab. The page loads nothing from it.
- It sets no cookies and keeps nothing on the device.
- What follows `#` in the link is not sent to whoever serves the page. The network, the contract and the bag number in it are what the page asks Ethereum about, so the source it asks sees them, and the gateways see which records are fetched.
- Nothing here signs, uploads or moves anything.
- It runs no script but its own two. What a record says is written as text, and the head of the file carries a Content-Security-Policy that names the two scripts by their SHA-256, so nothing written into the page afterwards can run.

## Build

```
npm ci
npm run check          # type check
npm test               # the check and the paint functions against a gateway, an RPC and records that lie
npm run dev            # http://localhost:5173/devcon8.html
npm run standalone     # dist/devcon8.html, the one file
npm run release -- <n> # builds the file and files it as release <n>, see Releases
```

Open the built file with the network, the contract and the bag number after a hash, as in The link.

## Files

| File | What it is |
|---|---|
| `web/devcon8.html` | The page: markup and styles |
| `web/devcon8.ts` | The script: the reads, the check, the arrival of every block, the day the stamp is paid up to, the curves of a cycle, the route of the bag, the holder's jazzicon and ENS name, the fingerprint |
| `web/life-grid.ts` | The field behind the footer |
| `src/lib.ts` | The contract's read side, the link format, downloading a record, and the Swarm reference of a file computed the way Swarm computes it, written here so anyone can read how a record is checked |
| `src/rails.ts` | Everything the page takes from viem, by name: the read side of Ethereum and ENS, keccak256 |
| `web/public/config.json` | What the page reads: the RPCs it asks, by network and in order, the contract it trusts, the custody address, the gateways in order, the chain and the contract the stamp of a bag is read from and the page it is looked up on, the day the storage is paid up to when the stamp cannot be read, the links, this repository and the CO₂ assumptions. Nothing about the fruit |
| `test/paint.test.mjs` | The paint functions, given a record or a product description whose values are HTML: nothing of it may become an element of the page. What a description, the location of the plant or the preview of a cycle's curves says when it is not what it should be, which documents of a record are the files it names, and that the cycle and the route are drawn from numbers alone, the names of the places as text |
| `test/check.test.mjs` | The whole check against gateways, RPCs and a wallet that lie, fail or do not answer: bytes that fail it are never read, a record of any shape leaves the page standing, and a source that fails is not taken for an answer. The same for the files of the product: one that does not match its reference, is too heavy or is not an image is not shown, and the page is the same without it. And for the location of the plant: the Received card says it when the file is what it should be, and is as it was when it is not. And for the curves of a cycle: a preview that is not what its reference names, or not one the page can draw, is not drawn, and the full curves are never asked for. And for the route: the Delivered card draws it when both files are what they should be and the plant is the transport's origin, and is as it was when they are not |
| `test/products.test.mjs` | The files in `products/`: each description is one the page reads, and each image a WebP of a weight the page takes |
| `test/page.mjs` | The page for the tests: the markup and the script as written, in jsdom |
| `scripts/standalone.mjs` | Folds the page into one file: the source HTML, the fonts inlined and the marks as text, the config, the library as one compact script, the page's code with its types removed, and the policy that names those two scripts by their hash. The file carries no image, and the build stops if the config says something about the fruit |
| `products/<fruit>/` | The files of each product, as its packing records name them: `product-description.json`, `photo.webp`, `cover.webp` and `background.webp`. They are not part of the page: whoever declares a packing puts them among its documents, and they reach Swarm with its record. Each image has a note of where it comes from beside it |
| `scripts/plates.py` | Makes the plates from the flat art of the pouch, which is kept with the packaging and not here: `uv run scripts/plates.py <folder of the flat art> pineapple jackfruit`. The front of a pouch becomes the `cover.webp` of its product and the back its `background.webp`. Every front is placed in one frame, so that the page draws one window for all of them |
| `scripts/inspect.mjs` | What a browser would run in the single file, parsed as a browser parses it: one policy in the head, the two scripts it names, nothing else that runs or loads from elsewhere. The build asks it of every file it writes |
| `test/releases.test.mjs` | The releases: every folder still holds the file its `SHA256SUMS` and its row in the table name, and a file still in use passes `scripts/inspect.mjs` |
| `scripts/release.mjs` | Builds the file and files it as the next release, with its hash and its row in the table. It never writes over a release |
| `releases/<folder>/` | The published files and their `SHA256SUMS`, one folder per release |

## Status

11 October 2026. Work in progress.

- The records the page reads today are test records on a Sepolia contract. The event runs on Ethereum mainnet with real records; the network and the contract in the QR come with that contract.
- The nutrition figures in `products/` are the producer's, received on 15 October 2026. The producer gives each figure for a 5 g serving as a range; each description keeps them as given, under `nutrition.as_given`, and declares the middle of each range for 100 g, which the page scales to the grams of the bag its packing record names.
- Placeholder: the CO₂ factor and reference scenario (being closed with our partners).
- The fruits of the bags are pineapple, banana and jackfruit, each with the colours of its pouch. The illustrations are in for pineapple and jackfruit; banana shows the drawn crystal until its own are. The test records are of mango, shown in the jackfruit colourway, and name no file of a product.
- The bags and their packaging are separate work, not in this repository.
- The file to use is the one marked current in [Releases](#releases).

## License

Apache 2.0, see `LICENSE`. The code is yours to use, copy and change, with the notices kept.

The name Fair Food Data, its mark and the lockups in `web/public/brand/` are not covered by the license: they identify us, not the code. A copy of the page for another twin takes the code and leaves the mark.

What comes from others keeps its own license: viem (MIT), and the three typefaces, Montserrat, Fira Sans Condensed and Spline Sans Mono (SIL Open Font License 1.1). The photographs of the bananas and the jackfruit are from Unsplash, under its license: the bananas by Giorgio Trovato, the jackfruit by Antonio Castellano. That of the pineapples was taken at their plantation in Assam and given by the grower.
