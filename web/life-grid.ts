// Conway's Game of Life as the field of cells behind the footer, the same one the Fair Food Data site draws, so the page
// ends the way the site does. Four choices of its own:
// - The cells are squares, like the five of the glider in the mark, painted on whole device pixels so they stay crisp at
//   any screen density.
// - The colour follows the gradient: 135 degrees, from measured (top left) to sealed (bottom right). The glider is born in
//   the phase of the mark and the lightweight spaceship travels right: everything that moves across the field goes from
//   measured to sealed, as the glider of the mark does.
// - The field never passes under the text, the images or the plates of the footer: those cells are not painted and the
//   ones at their edge go to half opacity, so the text keeps its contrast.
// - It only works near the screen: it prepares the field when the footer comes close, advances a generation every 160 ms
//   while it is in view and stops when it leaves. With reduced motion it leaves one still frame.
// The canvas sits in the flow of the footer, before its content: here it receives the footer's height and the same
// negative margin. The fade at the top is drawn row by row. A module: it runs after parsing. Without JavaScript the
// canvas is 0 high and the footer stands on its own.

const CELL = 8; // px between cell centres
const TICK = 120; // ms per generation
const RESEED = 24; // generations between seedings
const LIFETIME = 40; // generations a cell may live: what settles into a still life clears itself
const QUIET = 3; // generations with almost nothing changing before a seeding comes early
const FADE = 6; // generations a dying cell takes to go out
const NOISE = 0.03; // loose noise of the first seeding
const WARMUP = 24; // generations before the first frame: the loose noise has died by then
const CLEAR = 4; // px of air around every line of text, image or plate
const RISE = 128; // px of the fade from the top edge
// Side of the square in px: lattice (and a cell going out), a living cell, a newborn cell.
const SIZE = { base: 2, alive: 2.5, young: 3 };
// Opacities: lattice, living, newborn (the sparks) and going out.
const ALPHA = { base: 0.045, alive: 0.28, young: 0.4, fade: 0.11 };
// Visibility of a cell: under the content, at its edge, in the open.
const VIS = [0, 0.5, 1];

// Seed patterns, as [row, column].
type Pattern = readonly (readonly [number, number])[];
const turn = (p: Pattern): Pattern => { const h = Math.max(...p.map(([r]) => r)); return p.map(([r, c]) => [c, h - r] as const); };
const spins = (p: Pattern): Pattern[] => { const out = [p]; for (let k = 0; k < 3; k++) out.push(turn(out[k]!)); return out; };
const GLIDER: Pattern = [[0, 0], [1, 1], [1, 2], [2, 0], [2, 1]]; // in the phase of the mark, X.. / .XX / XX.: it goes down and right
const SHIP: Pattern = [[0, 0], [0, 3], [1, 4], [2, 0], [2, 4], [3, 1], [3, 2], [3, 3], [3, 4]]; // the lightweight spaceship, going right
const MOVERS: readonly Pattern[] = [...spins(GLIDER), ...spins(SHIP)];
const BURSTS: readonly Pattern[] = [
  [[0, 1], [0, 2], [1, 0], [1, 1], [2, 1]], // the R-pentomino
  [[0, 1], [1, 3], [2, 0], [2, 1], [2, 4], [2, 5], [2, 6]], // acorn
  [[0, 6], [1, 0], [1, 1], [2, 1], [2, 5], [2, 6], [2, 7]], // diehard
];

type RGB = readonly [number, number, number];

// A colour token as [r, g, b].
function rgbOf(ctx: CanvasRenderingContext2D, value: string): RGB | null {
  ctx.fillStyle = 'transparent';
  ctx.fillStyle = value.trim();
  const v = String(ctx.fillStyle);
  if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  const [r = 0, g = 0, b = 0, a = 0] = (v.match(/[\d.]+/g) ?? []).map(Number);
  return a > 0 ? [r, g, b] : null;
}

// The opacity of a computed colour
function alphaOf(color: string): number {
  if (color === 'transparent') return 0;
  const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(color);
  if (slash) return parseFloat(slash[1]!) / (slash[2] ? 100 : 1);
  const rgba = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\)$/.exec(color);
  return rgba ? parseFloat(rgba[1]!) : 1;
}

export function mountLifeGrid(canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext('2d'), parent = canvas.parentElement;
  if (!context || !parent) return () => {};
  const ctx: CanvasRenderingContext2D = context, host: HTMLElement = parent;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let cols = 0, rows = 0, ox = 0, oy = 0, dpr = 1, gen = 0;
  let alive = new Uint8Array(0), age = new Uint8Array(0), dying = new Uint8Array(0);
  let alive2 = alive, age2 = age, dying2 = dying;
  let vis = new Uint8Array(0);
  let palette: string[] = [], ink = '';
  let ready = false, running = false, timer = 0, frame = 0;

  function stamp(p: readonly (readonly [number, number])[], r0: number, c0: number): void {
    for (const [r, c] of p) {
      const i = ((r0 + r) % rows) * cols + ((c0 + c) % cols);
      alive[i] = 1; age[i] = 0; dying[i] = 0;
    }
  }
  // Mostly ships, now and then a burst, each somewhere at random: on a torus every direction crosses the whole field.
  function seed(k: number): void {
    for (let j = 0; j < k; j++) {
      const pool = Math.random() < 0.7 ? MOVERS : BURSTS;
      const p = pool[Math.floor(Math.random() * pool.length)];
      if (p) stamp(p, Math.floor(Math.random() * rows), Math.floor(Math.random() * cols));
    }
  }

  // One generation, on a torus: what leaves by one edge comes in by the opposite one.
  let quiet = 0;
  function step(): void {
    let changes = 0;
    for (let r = 0; r < rows; r++) {
      const up = ((r + rows - 1) % rows) * cols, mid = r * cols, down = ((r + 1) % rows) * cols;
      for (let c = 0; c < cols; c++) {
        const w = (c + cols - 1) % cols, e = (c + 1) % cols, i = mid + c;
        const n = alive[up + w]! + alive[up + c]! + alive[up + e]! + alive[mid + w]! + alive[mid + e]!
          + alive[down + w]! + alive[down + c]! + alive[down + e]!;
        if (alive[i]) {
          const lives = (n === 2 || n === 3) && age[i]! < LIFETIME;
          alive2[i] = lives ? 1 : 0; age2[i] = lives ? Math.min(age[i]! + 1, 255) : 0; dying2[i] = lives ? 0 : FADE;
          if (!lives) changes++;
        } else {
          alive2[i] = n === 3 ? 1 : 0; age2[i] = 0; dying2[i] = n === 3 ? 0 : Math.max(0, dying[i]! - 1);
          if (n === 3) changes++;
        }
      }
    }
    [alive, alive2, age, age2, dying, dying2] = [alive2, alive, age2, age, dying2, dying];
    quiet = changes < Math.max(4, (cols * rows) / 400) ? quiet + 1 : 0;
    if (++gen % RESEED === 0 || quiet >= QUIET) {
      seed(Math.max(2, Math.round((cols * rows) / 1200)));
      quiet = 0;
    }
  }

  // The lattice covers the canvas with one column and one row to spare, centred.
  function lattice(nc: number, nr: number): void {
    const fresh = !cols, n = nc * nr;
    const a = new Uint8Array(n), g = new Uint8Array(n), d = new Uint8Array(n);
    for (let r = 0; r < Math.min(rows, nr); r++) {
      for (let c = 0; c < Math.min(cols, nc); c++) {
        a[r * nc + c] = alive[r * cols + c]!; g[r * nc + c] = age[r * cols + c]!; d[r * nc + c] = dying[r * cols + c]!;
      }
    }
    cols = nc; rows = nr;
    alive = a; age = g; dying = d;
    alive2 = new Uint8Array(n); age2 = new Uint8Array(n); dying2 = new Uint8Array(n);
    if (!fresh) return;
    seed(Math.max(3, Math.round(n / 400)));
    for (let i = 0; i < n; i++) if (!alive[i] && Math.random() < NOISE) alive[i] = 1;
    for (let k = 0; k < WARMUP; k++) step();
  }

  // The canvas covers the footer's content box: its height, and the same margin in negative so nothing moves.
  function fit(): boolean {
    if (!canvas.getClientRects().length) return false;
    const cs = getComputedStyle(host);
    const bottom = host.getBoundingClientRect().bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom);
    const h = Math.max(0, Math.floor(bottom - canvas.getBoundingClientRect().top));
    canvas.style.height = `${h}px`;
    canvas.style.marginBottom = `${-h}px`;
    return h > 0 && canvas.clientWidth > 0;
  }

  // Measures the canvas, rebuilds the lattice if needed and reads the tokens and the content it covers again.
  function layout(): void {
    if (!fit()) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ox = (w % CELL) / 2;
    oy = (h % CELL) / 2;
    const nc = Math.ceil(w / CELL) + 1, nr = Math.ceil(h / CELL) + 1;
    if (nc !== cols || nr !== rows) lattice(nc, nr);
    // The colour of each cell is that of the gradient at its centre: it climbs the diagonal, row plus column.
    const css = getComputedStyle(canvas);
    const a = rgbOf(ctx, css.getPropertyValue('--grad-a')), b = rgbOf(ctx, css.getPropertyValue('--grad-b'));
    ink = css.getPropertyValue('--ink').trim();
    palette = a && b ? Array.from({ length: cols + rows - 1 }, (_, k) => {
      const t = Math.min(1, Math.max(0, (ox + oy + CELL + k * CELL) / (w + h)));
      return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
    }) : [];
    clearings();
  }

  // What the field does not tread on: the lines of every text node (their line boxes, not the element's), the images and the boxes with a background of their own.
  function clearings(): void {
    vis = new Uint8Array(cols * rows).fill(2);
    const box = canvas.getBoundingClientRect(), rects: DOMRect[] = [], range = document.createRange();
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.nodeValue?.trim()) continue;
      range.selectNodeContents(t);
      rects.push(...range.getClientRects());
    }
    for (const el of host.querySelectorAll('*')) {
      if (el === canvas) continue;
      const cs = getComputedStyle(el);
      if (/^(img|svg)$/.test(el.localName) || cs.backgroundImage !== 'none' || alphaOf(cs.backgroundColor) > 0) rects.push(el.getBoundingClientRect());
    }
    const reach = CLEAR + SIZE.young / 2, index = (v: number): number => (v - CELL / 2) / CELL;
    for (const q of rects) {
      if (!q.width || !q.height) continue;
      const c0 = Math.ceil(index(q.left - box.left - reach - ox)), c1 = Math.floor(index(q.right - box.left + reach - ox));
      const r0 = Math.ceil(index(q.top - box.top - reach - oy)), r1 = Math.floor(index(q.bottom - box.top + reach - oy));
      for (let r = Math.max(0, r0 - 1); r <= Math.min(rows - 1, r1 + 1); r++) {
        for (let c = Math.max(0, c0 - 1); c <= Math.min(cols - 1, c1 + 1); c++) {
          const i = r * cols + c, under = r >= r0 && r <= r1 && c >= c0 && c <= c1;
          vis[i] = Math.min(vis[i]!, under ? 0 : 1);
        }
      }
    }
  }

  // Row by row
  function draw(): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!palette.length || !ink) return;
    const pitch = CELL * dpr, x0 = (ox + CELL / 2) * dpr, y0 = (oy + CELL / 2) * dpr;
    const side = (v: number): number => Math.max(1, Math.round(v * dpr));
    const base = side(SIZE.base), live = side(SIZE.alive), young = side(SIZE.young);
    for (let r = 0; r < rows; r++) {
      const rise = Math.min(1, (oy + r * CELL + CELL / 2) / RISE);
      if (rise <= 0) continue;
      const cy = y0 + r * pitch, y = Math.round(cy - base / 2);
      ctx.fillStyle = ink;
      for (const level of [1, 2]) {
        ctx.globalAlpha = ALPHA.base * VIS[level]! * rise;
        ctx.beginPath();
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (vis[i] === level && !alive[i] && !dying[i]) ctx.rect(Math.round(x0 + c * pitch - base / 2), y, base, base);
        }
        ctx.fill();
      }
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c, v = VIS[vis[i]!]!;
        if (!v || !(alive[i] || dying[i])) continue;
        const fresh = alive[i] && age[i]! < 3;
        const s = alive[i] ? (fresh ? young : live) : base;
        ctx.globalAlpha = v * rise * (alive[i] ? (fresh ? ALPHA.young : ALPHA.alive) : (ALPHA.fade * dying[i]!) / FADE);
        ctx.fillStyle = palette[r + c]!;
        ctx.fillRect(Math.round(x0 + c * pitch - s / 2), Math.round(cy - s / 2), s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  function prepare(): void {
    ready = true;
    layout();
    draw();
  }
  // One generation per frame, requested every TICK ms: the main thread only wakes when there is something to paint.
  function tick(): void {
    step();
    draw();
    if (running) timer = window.setTimeout(() => { frame = requestAnimationFrame(tick); }, TICK);
  }
  function start(): void {
    if (running || still) return;
    if (!ready) prepare();
    running = true;
    timer = window.setTimeout(() => { frame = requestAnimationFrame(tick); }, TICK);
  }
  function stop(): void {
    running = false;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
  }

  // The footer is observed, not the canvas, which is 0 high until it is prepared.
  const near = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    near.disconnect();
    if (!ready) prepare();
  }, { rootMargin: '50% 0px' });
  const seen = new IntersectionObserver((entries) => {
    if (entries[entries.length - 1]?.isIntersecting) start();
    else stop();
  });
  // The canvas height does not change the footer's (its margin cancels it), so setting it here does not fire this again.
  const resized = new ResizeObserver(() => {
    if (!ready) return;
    layout();
    draw();
  });
  near.observe(host);
  seen.observe(host);
  resized.observe(host);
  void document.fonts.ready.then(() => {
    if (!ready) return;
    clearings();
    draw();
  });

  return () => {
    stop();
    near.disconnect();
    seen.disconnect();
    resized.disconnect();
  };
}

if (typeof window.matchMedia === 'function' && 'IntersectionObserver' in window && 'ResizeObserver' in window) {
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas.life-grid')) mountLifeGrid(canvas);
}
