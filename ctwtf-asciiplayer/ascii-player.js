/* ════════════════════════════════════════════════════════════
   ascii-player — the runtime half of ascii-anima.
   built by kesh with our good friend claude
   bake your own maps at https://asciianima.creativetech.wtf

   Loads a baked .asciimap file and renders it as an interactive
   character grid on a canvas: playback (with ping-pong), a cursor
   lens (magnify / bold / ramp climb / colour reveal / repel), and
   click bursts driven by a hand-drawn motion curve. Dependency-free
   canvas 2D, one file, works from a plain <script> tag.

   This is the file that travels to other sites — like the
   portra-anima player, everything expensive happened in the mapper
   at bake time; the player only reads numbers. (Coming soon)

     <script src="ascii-player.js"></script>
     <div id="host"></div>
     <script>
       AsciiPlayer.load('portrait.asciimap').then((map) => {
         AsciiPlayer.mount(document.getElementById('host'), map);
       });
     </script>

   mount(host, map, options) — options, all optional:
     config   partial config; wins over the map's baked config
              (precedence DEFAULT_CONFIG ← map.config ← options.config)
     theme    { bg, ink, accent, font } — the site's look. bg is any
              css colour, ink/accent are '#rrggbb' or [r,g,b], font a
              css font-family list. Defaults to the ascii-anima palette.
     pointer  'auto' (default) the player listens to its own canvas;
              'manual' no listeners — drive it with lookAt()/burst()
     autoplay animated maps start playing (default true; reduced
              motion always wins and starts paused)
     label    aria-label for the canvas

   The instance: reload(map?, { keep }), setConfig(patch), getConfig(),
   setTheme(patch), lookAt(x, y), lookAway(), burst(x, y) (alias
   explode), getExplosions(), isAnimated(), isPlaying(),
   setPlaying(bool), getFrame(), getFrameCount() (frames drawn so
   far: sample it twice for a fps readout; it stands still while
   the player sleeps), canvas, destroy().
   Coordinates are CSS pixels relative to the canvas.

   reveal(target, map, options) — MAP FIRST, THEN THE PHOTO. The map
   is a few hundred bytes, the photo is the big download, so the map
   stands in while the photo is on its way: the glyphs scramble in
   top to bottom, hold for as long as the photo takes, then resolve
   through chunky pixel steps into it. target is a <canvas> or any
   element (a canvas is made inside it). options, all optional:
     src      photo URL; the reveal loads and decodes it itself
              (or pass the photo later with .resolve(source))
     theme    { bg, accent, ink, font } as for mount
     color    'accent' (default) | 'ink' — the glyph colour
     clock    'auto' (default) runs its own rAF; 'manual' draws only
              when you call .frame(now), for a page that schedules
              many reveals itself
     width, height  CSS px (default: the target's box)
     dpr      backing scale (default devicePixelRatio, max 2)
     onDone   called once the photo is fully drawn
   timings come from config: revealMs, revealHold, revealStepMs.
   resolve() takes anything drawImage takes; a <video> on its first
   frame is played on (muted, looping) once revealed (autoplay: false
   to keep it still; reduced motion always does).
   The instance: frame(now) → true once done, resolve(source),
   replay(), isWaiting(), isDone(), canvas, destroy().

   bake(pixels, cols, rows, options) — the bake core the mapper uses,
   exposed so a build step (sharp in node, say) bakes the same maps.
   pixels is RGBA (or options.channels) already resized to cols ×
   rows. options: ramp (string), gamma, invert, stretch (contrast
   stretch to the frame's own range), colorStore ('arrays' keeps
   lum + colour), stops (where each glyph starts, see tones). Returns one
   frame { chars, lum?, color? }. No DOM. bakeValues() gives the tones
   before they become glyphs.

   tones (optional map block, v3-compatible): { stops, colors } — where
   each ramp glyph starts on the dark→light scale, and a colour gradient
   [[pos, '#rrggbb'], ...]; each glyph takes the gradient's colour at the
   middle of its band, in the player and the reveal alike.

   ── how it stays fast (0.10.0) ──────────────────────────────

   · The current frame lives on an offscreen STATIC LAYER. A clip
     frame change redraws only the cells whose glyph or colour
     differ from the frame before (a diff, not a wipe).
   · Per animation frame only the DIRTY RECTANGLE the last lens or
     burst pass painted is restored from the static layer, then only
     the cells the lens or a live burst touch are drawn again.
   · A PARKED LENS costs nothing: when the pointer, the playhead and
     the bursts have all settled, the frame is skipped and the rAF
     loop sleeps until something moves again.
   · Touched glyphs are queued by font and drawn one size at a time,
     so ctx.font changes once per size in use, not once per glyph;
     the lens fringe where nothing would visibly change is skipped.
   · Burst math is analytic: per-cell jitter is precomputed per grid,
     the swirl uses the sin-addition identity, distances early-reject
     on squared radii, alpha strings come from a lookup table.
   · The rAF loop stops when nothing moves, when the tab hides, and
     when the canvas leaves the viewport.

   ── the .asciimap contract (v3) ─────────────────────────────

   {
     version: 3,                                 v1 (single `cells`) and v2 still load
     source:  { width, height, mime, kind },     kind 'image' | 'video', video adds duration
     grid:    { cols, rows, cellAspect },        cellAspect = cell w / cell h
     ramp:    " .:-=+*#%@",                      light → dense
     anim:    { fps, frames },                   present only when frames.length > 1
     frames: [{
       chars: ["row string", …],                 rows × cols glyphs, always present
       lum:   [0..255, …],                       optional; player derives from ramp index if absent
       color: [r,g,b, r,g,b, …]                  optional per-cell colour ('arrays' storage)
     }, …],                                      one entry per baked frame
     media:   { mime, data, atlas },             optional colour atlas: the per-frame colour
                                                 grids re-encoded as ONE jpeg at grid size,
                                                 tiled atlas.tilesX per row, one tile per
                                                 frame. carries full colour at a fraction of
                                                 the source, since a 110-column export only
                                                 ever needs 110 × rows pixels of colour.
                                                 (a media block without atlas is treated as
                                                 raw source and re-sampled, for older files)
     tones:   { stops, colors, lensColors },     optional: the author's characters and gradients
     config:  { …player defaults, baked },
     meta:    { createdWith, createdAt }
   }
   ════════════════════════════════════════════════════════════ */

(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else if (typeof define === 'function' && define.amd) define(factory);
	else root.AsciiPlayer = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const VERSION = '0.10.1';
/** ms a host's width must hold before a resize redraws the grid (it stretches until then) */
const RESIZE_SETTLE_MS = 150;
const MAP_VERSION = 3;
const CURVE_SAMPLES = 48;
const FALLBACK_RAMP = ' .:-=+*#%@';
/** '0.00' … '1.00': alpha as a string without a toFixed per glyph per frame */
const ALPHA_STR = Array.from({ length: 101 }, (_, i) => (i / 100).toFixed(2));
/** below this a burst influence counts as nothing */
const EPS = 0.004;
/** below this lens strength a glyph draws the same as at rest (scale rounds to 1,
    the colour blend is under 3%, the push is under a px), so it is left alone */
const LENS_EPS = 0.025;
/** the pointer has settled once it is this close (css px) to its target */
const SETTLE_PX = 0.05;
/** a lens core (bold / italic) starts at this lens strength */
const CORE_AT = 0.45;

const DEFAULT_THEME = {
	bg: '#131316',
	ink: [236, 236, 233],
	accent: [253, 178, 87],
	font: '"Space Mono", ui-monospace, "Cascadia Mono", Consolas, monospace'
};

/* ── small shared helpers ───────────────────────────────────── */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** the backing-store scale: the device's, capped at 2 (4x the pixels is plenty) */
const dprOf = (override) => override || Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
/** the OS "reduce motion" switch; false where there is no matchMedia (node) */
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** a <video> set up to decode quietly: muted, inline, preloaded */
function quietVideo() {
	const v = document.createElement('video');
	v.muted = true; v.playsInline = true; v.preload = 'auto';
	return v;
}
/** anything with play() and a videoWidth is treated as a <video> */
const isVideo = (v) => !!v && typeof v.play === 'function' && 'videoWidth' in v;
/** seek a video and wait for the frame to present (500ms fallback: some decoders never fire seeked) */
function seekTo(video, t) {
	return new Promise((resolve) => {
		let done = false;
		const finish = () => { if (!done) { done = true; video.removeEventListener('seeked', finish); resolve(); } };
		video.addEventListener('seeked', finish);
		setTimeout(finish, 500);
		video.currentTime = t;
	});
}
/** linear interpolation across an array of samples at position t in 0..1 */
function sampleAt(arr, t) {
	const x = t * (arr.length - 1);
	const i = Math.floor(x);
	const a = arr[i], b = arr[Math.min(arr.length - 1, i + 1)];
	return a + (b - a) * (x - i);
}

/* ── the burst motion curve ─────────────────────────────────
   displacement over normalized time, shaped by a few control points and
   auto-smoothed with a hermite spline (secant tangents, clamped 0..1,
   endpoints pinned to 0). the player consumes the baked samples. */

/** secant tangents at each sorted control point (zero where two share a time) */
function secantTangents(p) {
	const m = p.length;
	const tan = new Array(m);
	for (let i = 0; i < m; i++) {
		const p0 = p[Math.max(0, i - 1)], p1 = p[Math.min(m - 1, i + 1)];
		const dt = p1.t - p0.t;
		tan[i] = dt > 0 ? (p1.v - p0.v) / dt : 0;
	}
	return tan;
}

/** one hermite segment a→b evaluated at u in 0..1 */
function hermite(a, b, ta, tb, span, u) {
	const u2 = u * u, u3 = u2 * u;
	return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * span * ta
		+ (-2 * u3 + 3 * u2) * b + (u3 - u2) * span * tb;
}

function sampleCurvePts(pts, n) {
	const p = pts.slice().sort((a, b) => a.t - b.t);
	const m = p.length;
	const tan = secantTangents(p);
	const out = [];
	let seg = 0;
	for (let i = 0; i < n; i++) {
		const t = i / (n - 1);
		while (seg < m - 2 && t > p[seg + 1].t) seg++;
		const a = p[seg], b = p[seg + 1];
		const span = b.t - a.t;
		const v = span <= 0 ? b.v : hermite(a.v, b.v, tan[seg], tan[seg + 1], span, clamp01((t - a.t) / span));
		out.push(clamp01(v));
	}
	out[0] = 0; out[n - 1] = 0;
	return out;
}

/** public wrapper: accepts [{t,v}, …] or [[t,v], …] and returns n samples (default CURVE_SAMPLES) */
function sampleCurve(points, n) {
	const pts = points.map((p) => Array.isArray(p)
		? { t: Number(p[0]) || 0, v: Number(p[1]) || 0 }
		: { t: Number(p.t) || 0, v: Number(p.v) || 0 });
	return sampleCurvePts(pts, n || CURVE_SAMPLES);
}

/* kesh's drawn default: a hard burst to the peak just past t = 0.1, a long
   eased fall, then a low smokey tail that finally settles home */
const DEFAULT_POINTS = [[0, 0], [0.06, 0.28], [0.11, 0.95], [0.24, 0.72], [0.39, 0.3], [0.52, 0.13], [0.75, 0.06], [1, 0]];
const DEFAULT_CURVE = sampleCurve(DEFAULT_POINTS, CURVE_SAMPLES);

/* defaults; precedence is DEFAULT ← map.config ← runtime overrides,
   spatial values are fractions so any grid size behaves the same. */
const DEFAULT_CONFIG = Object.freeze({
	radius: 0.16,      // lens radius · fraction of grid width
	magnify: 1.8,      // glyph scale at the centre
	weight: 1,         // 1 = bold inside the lens core (older maps; `core` says it now)
	core: null,        // the lens core's style: 'none' | 'bold' | 'italic'; null = from weight
	charBoost: 0.3,    // how far up the ramp a glyph climbs at the centre
	repel: 0.5,        // outward push · in cell heights
	colorMode: 'image',// lens colour: 'same' (the colour at rest) | 'gradient' (tones.lensColors)
	                   // | 'image' (the map's colour data) | 'amber' | 'mono' (older looks)
	pingpong: 0,       // 1 = clips play forward then reverse instead of wrapping
	power: 0.22,       // burst throw distance · fraction of grid width
	blast: 0.5,        // burst radius · fraction of grid width
	burstMs: 1760,     // burst duration · the drawn curve plays over this span
	curve: Object.freeze(DEFAULT_CURVE.slice()),       // burst motion · displacement over normalized time
	curvePoints: Object.freeze(DEFAULT_POINTS.map((p) => Object.freeze(p.slice()))), // editor handles the curve was drawn with
	swirl: 0.35,       // burst tangential wobble while airborne
	bursts: 3,         // how many explosions stack before the cooldown
	ease: 0.16,        // pointer smoothing per frame
	revealMs: 520,     // reveal · how long the glyphs take to scramble in
	revealHold: 260,   // reveal · the least time the map holds before resolving
	revealStepMs: 70,  // reveal · each chunky pixel step on the way to the photo
	restColor: 'ink'   // glyph colour at rest: 'ink' (tones.colors when the map has them, else the
	                   // theme's ink) | 'image' (the map's own image colours, once decoded)
});

/* ── format ─────────────────────────────────────────────────── */

/* user stops (the mapper's tone bar): stops[i] is where glyph i starts,
   0..1 ascending, one per ramp glyph, stops[0] = 0. Without them the
   ramp is spread evenly, exactly as before stops existed. */
const validStops = (stops, ramp) =>
	Array.isArray(stops) && stops.length === ramp.length &&
	stops.every((x, i) => typeof x === 'number' && x >= 0 && x <= 1 && (i === 0 || x >= stops[i - 1]));

/** a gradient as the map carries it: [[pos, '#rrggbb'], ...] */
const validGradient = (g) =>
	Array.isArray(g) && g.every((c) => Array.isArray(c) && typeof c[0] === 'number' && !!rgbTriplet(c[1], null));

/** the frames array whichever version the map is (v1 kept one `cells` block) */
const framesOf = (m) => (m.version === 1 ? [m.cells] : m.frames);

/** one frame's shape against the grid; throws on mismatch */
function validateFrame(f, g) {
	if (!f || !Array.isArray(f.chars) || f.chars.length !== g.rows) throw new Error('chars rows mismatch');
	for (const line of f.chars) if (line.length !== g.cols) throw new Error('chars cols mismatch');
	if (f.lum && (!Array.isArray(f.lum) || f.lum.length !== g.cols * g.rows)) throw new Error('lum length mismatch');
	if (f.color && (!Array.isArray(f.color) || f.color.length !== g.cols * g.rows * 3)) throw new Error('color length mismatch');
}

/** the optional tones block; throws on mismatch */
function validateTones(t, ramp) {
	if (t.stops !== undefined && !validStops(t.stops, ramp)) throw new Error('tones.stops: one per ramp glyph, 0..1 ascending');
	for (const key of ['colors', 'lensColors']) {
		if (t[key] !== undefined && !validGradient(t[key])) throw new Error('tones.' + key + ': [[pos, "#rrggbb"], ...]');
	}
}

/** Validate a parsed map. Throws a readable Error on any shape mismatch;
    returns the map untouched when it is sound. Accepts v1, v2 and v3. */
function validate(m) {
	if (!m || (m.version !== 1 && m.version !== 2 && m.version !== 3)) throw new Error('not an asciimap v1, v2 or v3');
	const g = m.grid;
	if (!g || !(g.cols > 0) || !(g.rows > 0) || !(g.cellAspect > 0)) throw new Error('bad grid block');
	if (typeof m.ramp !== 'string' || m.ramp.length < 2) throw new Error('bad ramp');
	const frames = framesOf(m);
	if (!Array.isArray(frames) || !frames.length) throw new Error('no frames');
	for (const f of frames) validateFrame(f, g);
	if (frames.length > 1 && !(m.anim && m.anim.fps > 0)) throw new Error('animated map needs anim.fps');
	if (m.media && (typeof m.media.mime !== 'string' || typeof m.media.data !== 'string')) throw new Error('bad media block');
	if (m.media && m.media.atlas && !(m.media.atlas.tilesX > 0 && m.media.atlas.frames > 0)) throw new Error('bad atlas block');
	if (m.tones) validateTones(m.tones, m.ramp);
	return m;
}

/** JSON string → validated map. */
function parse(json) {
	return validate(JSON.parse(json));
}

/** Fetch a .asciimap from a URL → Promise of a validated map. */
function load(url, fetchOpts) {
	return fetch(url, fetchOpts).then((r) => {
		if (!r.ok) throw new Error('asciimap fetch failed: ' + r.status + ' · ' + url);
		return r.text();
	}).then(parse);
}

/** DEFAULT_CONFIG ← baked ← overrides, as a fresh mutable object. */
function resolveConfig(baked, overrides) {
	return Object.assign({}, DEFAULT_CONFIG, baked || {}, overrides || {});
}

/* ── colours and theme ──────────────────────────────────────── */

/** [r,g,b] from an array or '#rrggbb'; `fallback` for anything else */
function rgbTriplet(v, fallback) {
	if (Array.isArray(v) && v.length === 3) return v.map((c) => clamp(Number(c) || 0, 0, 255));
	if (typeof v === 'string') {
		const m = v.trim().match(/^#([0-9a-f]{6})$/i);
		if (m) {
			const n = parseInt(m[1], 16);
			return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
		}
	}
	return fallback;
}

/** 'rgb(r,g,b)' from a triplet */
const rgbCss = (c) => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';

/** base ← patch, every field made usable: ink/accent as triplets, inkStr pre-joined */
function resolveTheme(base, patch) {
	const t = Object.assign({}, base || {}, patch || {});
	const ink = rgbTriplet(t.ink, DEFAULT_THEME.ink);
	return {
		bg: typeof t.bg === 'string' ? t.bg : DEFAULT_THEME.bg,
		ink,
		inkStr: ink.join(','),
		accent: rgbTriplet(t.accent, DEFAULT_THEME.accent),
		font: typeof t.font === 'string' ? t.font : DEFAULT_THEME.font
	};
}

/** the advance of 'M' per px of font size, measured once per face */
const advanceCache = new Map();
function fontAdvance(font) {
	let adv = advanceCache.get(font);
	if (adv === undefined) {
		const m = document.createElement('canvas').getContext('2d');
		m.font = '100px ' + font;
		adv = m.measureText('M').width / 100 || 0.6;
		advanceCache.set(font, adv);
	}
	return adv;
}

/* a one-time hello for whoever opens devtools — the whole trick in
   three steps, because the kind of person who inspects the canvas
   deserves a straight answer. fires once per page, on first mount. */
let greeted = false;
function greet() {
	if (greeted) return;
	greeted = true;
	try {
		console.log(
			'%c ✳ ascii-anima %c .:-=+*#%@ ',
			'background:#131316;color:#fdb257;font-family:ui-monospace,monospace;padding:3px 7px;',
			'background:#131316;color:#ECECE9;font-family:ui-monospace,monospace;padding:3px 7px;'
		);
		console.log(
			'hah — caught you poking around in here. respect.\n' +
			'since you\'re in already, the whole trick in three steps:\n' +
			'\n' +
			'  1 · an image (or clip) was baked ONCE into a tiny .asciimap — characters,\n' +
			'      grid, colours at grid size. the original media never ships.\n' +
			'  2 · at rest this player just blits a prebaked layer. only the cells near\n' +
			'      your cursor redraw. the rAF loop stops when nothing moves.\n' +
			'  3 · the bursts are pure math, no physics state: every glyph sits at\n' +
			'      home + f(time, click point, a hand-drawn motion curve). when the\n' +
			'      curve returns to zero, everything is exactly home again.\n' +
			'\n' +
			'poke it yourself: window.AsciiPlayer · mount / lookAt / burst / setTheme\n' +
			'bake your own:    https://asciianima.creativetech.wtf\n' +
			'built by kesh ·   https://creativetech.wtf'
		);
	} catch (e) { /* consoles are optional, the greeting is too */ }
}

/* ── bake core ──────────────────────────────────────────────
   the one place pixels become glyphs. the mapper calls it per frame
   off its bake canvas; a build step can call it in node off sharp's
   raw output. pure numbers in, one frame out, no DOM. */

/** each cell's tone, 0 (dark) to 1 (light), after stretch, gamma and
    invert: what bake() turns into glyphs, and what a tone bar's histogram
    is drawn from */
function bakeValues(pixels, cols, rows, options) {
	const o = options || {};
	const ch = o.channels || 4;
	const count = cols * rows;
	const gamma = o.gamma || 1;
	const L = new Float64Array(count); // full precision: band edges must not move
	let lo = 1, hi = 0;
	for (let k = 0; k < count; k++) {
		const i = k * ch;
		const l = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
		L[k] = l;
		if (l < lo) lo = l;
		if (l > hi) hi = l;
	}
	const span = Math.max(0.05, hi - lo);
	for (let k = 0; k < count; k++) {
		let v = o.stretch ? clamp01((L[k] - lo) / span) : L[k];
		v = Math.pow(v, gamma);
		L[k] = o.invert ? 1 - v : v;
	}
	return L;
}

/** the ramp index a tone lands on: even bands, or the author's stops */
function glyphIndexer(n, stops) {
	if (!stops) return (v) => Math.round(v * n);
	return (v) => {
		let i = n;
		while (i > 0 && stops[i] > v) i--;
		return i;
	};
}

/** pixels → one baked frame { chars, lum?, color? }; see the header for options */
function bake(pixels, cols, rows, options) {
	const o = options || {};
	const ch = o.channels || 4;
	const ramp = typeof o.ramp === 'string' && o.ramp.length > 1 ? o.ramp : FALLBACK_RAMP;
	const n = ramp.length - 1;
	const count = cols * rows;
	const glyphOf = glyphIndexer(n, validStops(o.stops, ramp) ? o.stops : null);
	const V = bakeValues(pixels, cols, rows, o);
	const keep = o.colorStore === 'arrays';
	const lum = keep ? new Array(count) : null;
	const color = keep ? new Array(count * 3) : null;
	const chars = [];
	for (let r = 0; r < rows; r++) {
		let line = '';
		for (let c = 0; c < cols; c++) {
			const k = r * cols + c;
			const v = V[k];
			if (keep) {
				const i = k * ch;
				lum[k] = Math.round(v * 255);
				color[k * 3] = pixels[i]; color[k * 3 + 1] = pixels[i + 1]; color[k * 3 + 2] = pixels[i + 2];
			}
			line += ramp[glyphOf(v)];
		}
		chars.push(line);
	}
	return keep ? { chars, lum, color } : { chars };
}

/* ── tones: the map's own palette ───────────────────────────
   map.tones (optional) = { stops: [one per ramp glyph], colors: [[pos,
   '#rrggbb'], ...] }. Each glyph takes the gradient's colour at the middle
   of its band, so a colour costs a few bytes in the map, not per-cell
   colour data, and it reads the same in the player and the reveal. Theme
   (background, font) stays the page's; this is the map's authored look,
   like an image's own colours. */
/* GRADIENTS BLEND IN OKLCH (2026-10-13, Kesh: "try this method: in CSS,
   linear-gradient(in oklch, red, blue). Browsers now blend in OKLCH
   natively"). The glyph colours are computed here, not by CSS, and canvas
   gradients cannot take an interpolation space, so this does the same maths
   CSS Color 4 does for `in oklch`: sRGB to OKLab (Björn Ottosson's matrices)
   to LCH, lightness and chroma blended straight, hue the shorter way round,
   and an achromatic end (black, white, greys: no meaningful hue) takes the
   other end's hue, as CSS treats a powerless hue. Red to blue now passes
   through a vivid purple instead of a muddy one, and stays even in
   lightness. Checked against Chrome's own color-mix(in oklch, ...). */
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
function rgbToOklch(rgb) {
	const r = toLin(rgb[0] / 255), g = toLin(rgb[1] / 255), b = toLin(rgb[2] / 255);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
	return [L, Math.sqrt(A * A + B * B), Math.atan2(B, A)];
}
function oklchToRgb(L, C, h) {
	const A = C * Math.cos(h), B = C * Math.sin(h);
	const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
	const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
	const s = Math.pow(L - 0.0894841775 * A - 1.2914855480 * B, 3);
	const out = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
	];
	return out.map((c) => Math.round(clamp01(toGam(Math.max(0, c))) * 255));
}
const POWERLESS = 2e-4; // chroma this low has no meaningful hue
function mixOklch(a, b, u) {
	let [L1, C1, h1] = a, [L2, C2, h2] = b;
	if (C1 < POWERLESS) h1 = h2;
	if (C2 < POWERLESS) h2 = h1;
	let dh = h2 - h1;
	if (dh > Math.PI) dh -= 2 * Math.PI; // the shorter way round
	else if (dh < -Math.PI) dh += 2 * Math.PI;
	return oklchToRgb(L1 + (L2 - L1) * u, C1 + (C2 - C1) * u, h1 + dh * u);
}
/** the gradient's colour at t (0..1) as [r,g,b], blended in OKLCH */
function sampleGradient(colors, t) {
	const cs = colors.map((c) => [Number(c[0]) || 0, rgbTriplet(c[1], [0, 0, 0])]).sort((a, b) => a[0] - b[0]);
	if (!cs.length) return [0, 0, 0];
	if (t <= cs[0][0]) return cs[0][1].slice();
	for (let i = 1; i < cs.length; i++) {
		if (t <= cs[i][0]) {
			const a = cs[i - 1], b = cs[i];
			const u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 1;
			return mixOklch(rgbToOklch(a[1]), rgbToOklch(b[1]), u);
		}
	}
	return cs[cs.length - 1][1].slice();
}
/** the middle of each glyph's band, 0..1 */
function bandCentres(ramp, stops) {
	const n = ramp.length - 1;
	if (!validStops(stops, ramp)) return Array.from({ length: n + 1 }, (_, i) => i / n);
	// the first glyph covers everything darker than the second, from 0,
	// wherever its own stop sits (the mapper lets it be dragged)
	return stops.map((x, i) => ((i === 0 ? 0 : x) + (i < n ? stops[i + 1] : 1)) / 2);
}
/** [r,g,b] per ramp glyph, or null when the map has no colours.
    which: 'colors' (at rest, the default) or 'lensColors' (inside the lens) */
function toneColors(map, which) {
	const key = which || 'colors';
	const t = map && map.tones;
	if (!t || !Array.isArray(t[key]) || !t[key].length) return null;
	return bandCentres(map.ramp, t.stops).map((x) => sampleGradient(t[key], x));
}

/* ════════════════════════════════════════════════════════════
   glyph sheet — the reveal's sprites.
   A scramble redraws hundreds of cells a frame in one size and a
   handful of colours, so its glyphs come from a strip rasterized
   once (one sprite per ramp glyph) and are blitted with drawImage.
   The player does NOT do this: measured 2026-10-13, a per-instance
   sprite atlas for the lens and bursts was no faster than grouped
   fillText in Chrome (whose text path has its own glyph cache) and
   cost up to 12 MB a player, so it was taken out again.
   ════════════════════════════════════════════════════════════ */

const sheets = new Map();
/** the reveal's strip: one sprite per ramp glyph, fs device px, in rgb
    ('r,g,b' for all, or one per glyph for a map with tones) */
function glyphSheet(ramp, fs, rgb, font) {
	const per = Array.isArray(rgb);
	const key = ramp + '|' + fs + '|' + (per ? rgb.join(';') : rgb) + '|' + font;
	let s = sheets.get(key);
	if (s) return s;
	const c = document.createElement('canvas');
	const x = c.getContext('2d');
	const face = fs + 'px ' + font;
	x.font = face;
	const sw = Math.ceil(x.measureText('M').width) + 1;
	const sh = Math.ceil(fs * 1.15) + 1;
	c.width = sw * ramp.length;
	c.height = sh;
	x.font = face;
	x.textBaseline = 'top';
	const n = ramp.length - 1;
	for (let g = 0; g <= n; g++) {
		if (ramp[g] === ' ') continue;
		x.fillStyle = 'rgb(' + (per ? rgb[g] : rgb) + ')';
		x.globalAlpha = per ? 1 : 0.28 + 0.72 * (g / n);
		x.fillText(ramp[g], g * sw, 0);
	}
	s = { c, sw, sh };
	sheets.set(key, s);
	return s;
}

/* ════════════════════════════════════════════════════════════
   reveal — map first, then the photo.
   the glyphs are stamped from a small pre-rendered sheet (one per
   ramp, size, colour and face) with drawImage, and only the cells
   that changed this frame are touched, so a scramble costs a few
   hundred blits instead of thousands of fillText calls. the sheet
   is kept for the life of the page; the reveal's result never is.
   ════════════════════════════════════════════════════════════ */

/** the canvas to draw on: the target itself, or one made inside it */
function revealCanvas(target) {
	if (target && target.tagName === 'CANVAS') return { canvas: target, made: false };
	const canvas = document.createElement('canvas');
	canvas.style.display = 'block';
	canvas.style.width = '100%';
	canvas.style.height = '100%';
	canvas.setAttribute('aria-hidden', 'true');
	target.appendChild(canvas);
	return { canvas, made: true };
}

/** the source rectangle of `photo` that cover-fits a W × H box (object-fit: cover) */
function coverCrop(photo, W, H) {
	const iw = photo.naturalWidth || photo.videoWidth || photo.width;
	const ih = photo.naturalHeight || photo.videoHeight || photo.height;
	const ta = W / H;
	let sw = iw, sh = ih, sx = 0, sy = 0;
	if (iw / ih > ta) { sw = sh * ta; sx = (iw - sw) / 2; } else { sh = sw / ta; sy = (ih - sh) / 2; }
	return [sx, sy, sw, sh];
}

/** the first frame's glyph indices into the ramp, one per cell */
function glyphIndices(map) {
	const { cols, rows } = map.grid;
	const frame0 = framesOf(map)[0];
	const idx = new Uint16Array(cols * rows);
	for (let r = 0; r < rows; r++) {
		const line = frame0.chars[r];
		for (let c = 0; c < cols; c++) idx[r * cols + c] = Math.max(0, map.ramp.indexOf(line[c]));
	}
	return idx;
}

function reveal(target, map, options) {
	const opts = options || {};
	map = validate(map);
	const REDUCED = reducedMotion();
	const cfg = resolveConfig(map.config, opts.config);
	const theme = resolveTheme(DEFAULT_THEME, opts.theme);
	// a map's own tone colours win over the single glyph colour
	const tones = toneColors(map);
	const rgb = tones ? tones.map((c) => c.join(',')) : (opts.color === 'ink' ? theme.ink : theme.accent).join(',');
	const manual = opts.clock === 'manual';
	const { canvas, made } = revealCanvas(target);
	const ctx = canvas.getContext('2d');
	const box = () => {
		const el = made ? target : canvas;
		return [
			Math.max(1, Math.round(opts.width || el.clientWidth || 300)),
			Math.max(1, Math.round(opts.height || el.clientHeight || 150))
		];
	};
	const dpr = dprOf(opts.dpr);

	// the map's grid, cover-fitted to the canvas: the cells fill the box,
	// centred, cropping whichever way the map is longer (the same crop as
	// object-fit: cover, so the glyphs line up with the photo they become)
	const g = map.grid;
	const ramp = map.ramp;
	const cols = g.cols, rows = g.rows, n = cols * rows;
	const idx = glyphIndices(map);
	const thr = new Float32Array(n);   // when each cell appears in the scramble, 0..~0.9
	const shown = new Uint16Array(n);  // glyph + 1 on the canvas now; 0 = nothing yet

	let W = 0, H = 0, cw = 0, chh = 0, ox = 0, oy = 0, sheet = null, fontReady = false;
	// times are on the CALLER's clock: rAF timestamps under clock:'auto',
	// whatever the host passes to frame() under 'manual' (a host that pauses
	// its own clock, say during a drag, must not see the show jump ahead)
	let t0 = null, scrambled = false, end = 0, step = -1, done = false, dead = false;
	let photo = null, photoAt = null, steps = null, raf = 0;
	const STEPS = opts.steps || [16, 8, 4, 2];

	function seed() {
		for (let k = 0; k < n; k++) thr[k] = (Math.floor(k / cols) / rows) * 0.55 + Math.random() * 0.35;
		shown.fill(0);
	}
	seed();

	/** size the canvas to its box, clear to bg, and fit the grid over it */
	function ground() {
		[W, H] = box();
		canvas.width = Math.round(W * dpr);
		canvas.height = Math.round(H * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = theme.bg;
		ctx.fillRect(0, 0, W, H);
		const s = Math.max(W / (cols * g.cellAspect), H / rows);
		chh = s;
		cw = s * g.cellAspect;
		ox = (W - cols * cw) / 2;
		oy = (H - rows * chh) / 2;
	}

	// the sheet is drawn once per size, so the face has to be in first; a
	// sheet drawn in the fallback font would be kept for the whole page
	let fontAsked = false;
	function prepFont() {
		if (sheet) return true;
		const fs = Math.max(4, Math.floor(Math.min(chh / 1.15, cw / fontAdvance(theme.font)) * dpr));
		const face = fs + 'px ' + theme.font;
		const fonts = document.fonts;
		if (!fontReady && fonts && !fonts.check(face)) {
			if (!fontAsked) {
				fontAsked = true;
				fonts.load(face).catch(() => {}).then(() => { fontReady = true; wake(); });
			}
			return false;
		}
		fontReady = true;
		sheet = glyphSheet(ramp, fs, rgb, theme.font);
		return true;
	}

	/** draw glyph `glyph` in cell k (clearing what was there if anything) */
	function cell(k, glyph) {
		const x = ox + (k % cols) * cw;
		const y = oy + Math.floor(k / cols) * chh;
		if (x + cw < 0 || y + chh < 0 || x > W || y > H) return;
		if (shown[k]) ctx.fillRect(x, y, cw, chh);
		if (ramp[glyph] !== ' ') ctx.drawImage(sheet.c, glyph * sheet.sw, 0, sheet.sw, sheet.sh, x, y, sheet.sw / dpr, sheet.sh / dpr);
	}

	// the pixel steps, made once the photo is in: cover-cropped to the box,
	// then shrunk by each block size; drawn back up with smoothing off
	function buildSteps() {
		const full = document.createElement('canvas');
		full.width = Math.round(W * dpr);
		full.height = Math.round(H * dpr);
		full.getContext('2d').drawImage(photo, ...coverCrop(photo, W, H), 0, 0, full.width, full.height);
		steps = STEPS.map((b) => {
			const c = document.createElement('canvas');
			c.width = Math.max(1, Math.ceil(W / b));
			c.height = Math.max(1, Math.ceil(H / b));
			c.getContext('2d').drawImage(full, 0, 0, c.width, c.height);
			return c;
		});
		steps.full = full;
	}

	function finish() {
		if (done) return true;
		done = true;
		if (photo) {
			if (!steps) buildSteps();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.drawImage(steps.full, 0, 0);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		if (isVideo(photo)) playVideo();
		if (opts.onDone) opts.onDone();
		return true;
	}

	/* A CLIP keeps going (2026-10-13, Kesh: "the clip should autoplay"):
	   hand resolve() a <video> sitting on its first frame and, once the
	   pixel steps land on that frame, the reveal plays it on, muted and
	   looping, drawing each new frame to the same canvas. Not under
	   reduced motion (the first frame simply stays), not with
	   options.autoplay false. */
	let vloop = 0, started = false;
	function playVideo() {
		if (REDUCED || opts.autoplay === false || dead) return;
		const v = photo;
		v.muted = true;
		v.loop = true;
		v.playsInline = true;
		const crop = coverCrop(v, W, H);
		const draw = () => {
			vloop = 0;
			if (dead || photo !== v) return;
			ctx.drawImage(v, ...crop, 0, 0, W, H);
			vloop = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
		};
		const p = v.play();
		if (p && p.catch) p.catch(() => { /* autoplay refused: the first frame stays */ });
		started = true;
		draw();
	}
	function stopVideo() {
		if (vloop && photo) {
			if (photo.cancelVideoFrameCallback) photo.cancelVideoFrameCallback(vloop);
			else cancelAnimationFrame(vloop);
		}
		vloop = 0;
		if (started && isVideo(photo)) photo.pause();
		started = false;
	}

	/** the scramble: cells appear top to bottom, flicker briefly, then settle */
	function drawScramble(now, el) {
		// reduced motion: no scramble, the map is simply there
		const t = REDUCED ? 1 : Math.min(1, el / cfg.revealMs);
		if (t === 1) scrambled = true; // the last frame always draws the whole map, however late
		const spin = Math.floor(now / 40);
		ctx.fillStyle = theme.bg;
		for (let k = 0; k < n; k++) {
			let gl = idx[k];
			if (t < 1) {
				if (t < thr[k]) continue;
				if (t < thr[k] + 0.1) gl = 1 + ((k * 7 + spin) % (ramp.length - 1));
			}
			// shown holds glyph + 1, so 0 means nothing drawn yet and
			// glyph 0 can be a real character (the tone bar allows it)
			if (gl + 1 === shown[k]) continue;
			cell(k, gl);
			shown[k] = gl + 1;
		}
		if (scrambled) end = el;
	}

	/** the pixel steps toward the photo; true once the photo is fully drawn */
	function drawSteps(el) {
		if (REDUCED) return finish();
		if (!steps) buildSteps();
		const i = Math.floor((el - Math.max(end + cfg.revealHold, photoAt - t0)) / cfg.revealStepMs);
		if (i >= STEPS.length) return finish();
		if (i >= 0 && step !== i) {
			step = i;
			const s = steps[i];
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(s, 0, 0, s.width, s.height, 0, 0, s.width * STEPS[i], s.height * STEPS[i]);
			ctx.imageSmoothingEnabled = true;
		}
		return false;
	}

	/** one frame of the show; true once the photo is fully drawn */
	function frame(now) {
		if (dead || done) return done;
		if (now == null) now = performance.now();
		if (!W) ground();
		if (!prepFont()) return false;
		if (t0 === null) t0 = now;
		const el = now - t0;
		if (!scrambled) { drawScramble(now, el); return false; }
		// the map holds for as long as the photo takes (that is the point),
		// and at least revealHold so a cached photo still shows the map
		if (!photo) return false;
		// the photo's arrival is stamped by the first frame that sees it, so a
		// reveal that slept while waiting does not skip its steps
		if (photoAt === null) photoAt = now;
		if (el - end < cfg.revealHold) return false;
		return drawSteps(el);
	}

	function tick(now) {
		raf = 0;
		if (dead) return;
		frame(now);
		if (!done && !isWaiting()) raf = requestAnimationFrame(tick);
	}
	function wake() {
		if (!manual && !raf && !dead && !done) raf = requestAnimationFrame(tick);
	}
	// waiting = the whole map is up and there is no photo yet: nothing to
	// draw, so the auto clock sleeps until resolve() wakes it
	function isWaiting() { return scrambled && !photo; }

	function resolve(source) {
		if (dead || !source) return;
		photo = source;
		photoAt = null;
		steps = null;
		wake();
	}

	if (opts.src) {
		const img = new Image();
		img.decoding = 'async';
		img.crossOrigin = opts.crossOrigin || null;
		img.src = opts.src;
		(img.decode ? img.decode() : new Promise((ok, no) => { img.onload = ok; img.onerror = no; }))
			.then(() => resolve(img))
			.catch(() => { /* no photo: the map stays, which is still a picture */ });
	}
	wake();

	return {
		canvas,
		frame,
		resolve,
		isWaiting,
		isDone() { return done; },
		/** play it again from an empty box (the photo, if any, is kept) */
		replay() {
			if (dead) return;
			stopVideo();
			if (isVideo(photo)) photo.currentTime = 0;
			W = 0; t0 = null; scrambled = false; end = 0; step = -1; done = false; sheet = null;
			photoAt = null;
			seed();
			wake();
		},
		destroy() {
			stopVideo();
			dead = true;
			if (raf) cancelAnimationFrame(raf);
			if (made) canvas.remove();
		}
	};
}

/* ════════════════════════════════════════════════════════════
   player — asciimap in, interactive canvas out.
   the pieces, each its own function below:
     prepCells      one frame's chars / ramp indices / colours, ready to draw
     createHydrator decodes an atlas (or older media) into per-frame colours
     frameIndexAt   the playback clock → frame index (wrap or ping-pong)
     burstTables    the per-grid jitter tables bursts read
     attachPointer  mouse / pen / touch rules → lookAt / lookAway / burst
     mount          wires them to a canvas, a static layer and a rAF loop
   ════════════════════════════════════════════════════════════ */

/** the canvas a player draws on, styled for its input mode */
function playerCanvas(label, managed) {
	const canvas = document.createElement('canvas');
	canvas.setAttribute('role', 'img');
	canvas.setAttribute('aria-label', label || 'interactive ascii rendering of the source image');
	canvas.style.display = 'block';
	canvas.style.width = '100%';
	if (managed) {
		canvas.style.cursor = 'crosshair';
		canvas.style.userSelect = 'none';
		canvas.style.webkitUserSelect = 'none';
		canvas.style.webkitTouchCallout = 'none';
		/* touch-action stays default so swipes over the canvas scroll the page */
	}
	return canvas;
}

/** one raw frame prepared for drawing. `col` is the per-cell colour (from the
    frame, or hydrated), `rest` the colour the glyphs sit in when restColor is
    'image', `tone` / `lensTone` the map's gradient colours per ramp glyph,
    `fills` the css colour of every cell at rest. */
function prepCells(map, raw, hydrated, cfg, theme) {
	const { cols, rows } = map.grid;
	const ramp = map.ramp, n = ramp.length - 1, count = cols * rows;
	const chars = new Array(count), idx = new Uint16Array(count);
	for (let r = 0; r < rows; r++) {
		const line = raw.chars[r];
		for (let c = 0; c < cols; c++) {
			const k = r * cols + c;
			chars[k] = line[c];
			const found = ramp.indexOf(line[c]);
			idx[k] = found >= 0 ? found : 0;
		}
	}
	let lum;
	if (raw.lum) {
		lum = Uint8Array.from(raw.lum);
	} else {
		lum = new Uint8Array(count);
		for (let k = 0; k < count; k++) lum[k] = Math.round((idx[k] / n) * 255);
	}
	const col = raw.color ? Uint8Array.from(raw.color) : (hydrated || null);
	// a map with tones paints each glyph its own colour, full strength;
	// without, the theme's ink, fainter where the picture is darker
	// restColor 'image' (2026-10-13): the picture's own colours at rest,
	// once they are in (an atlas decodes a beat after mount); it wins
	// over a rest gradient, which the mapper does not write alongside it
	const rest = cfg.restColor === 'image' && col ? col : null;
	const tone = rest ? null : toneColors(map);
	const toneFill = tone ? tone.map(rgbCss) : null;
	const lensTone = toneColors(map, 'lensColors');
	const fills = new Array(count);
	for (let k = 0; k < count; k++) {
		fills[k] = rest ? 'rgb(' + rest[k * 3] + ',' + rest[k * 3 + 1] + ',' + rest[k * 3 + 2] + ')'
			: toneFill ? toneFill[idx[k]]
			: 'rgba(' + theme.inkStr + ',' + (0.3 + 0.7 * (lum[k] / 255)).toFixed(3) + ')';
	}
	return { chars, idx, lum, col, fills, tone, rest, lensTone, ramp, n, cols, rows };
}

/* colour hydration — 'embedded' maps carry a colour atlas (or, for older
   files, the compressed source) instead of per-cell colour arrays, so the
   colour grid is re-sampled from it at load. the lens falls back to ink
   until a frame's colours arrive. a stale run (a new map arrived first) is
   cancelled by generation counter. */
function createHydrator(onColors) {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	let gen = 0;

	/** the drawable's (sx, sy) tile, or all of it, down-sampled to cols × rows, as r,g,b per cell */
	function sampleColors(drawable, cols, rows, sx, sy) {
		canvas.width = cols; canvas.height = rows;
		if (sx === undefined) ctx.drawImage(drawable, 0, 0, cols, rows);
		else ctx.drawImage(drawable, sx, sy, cols, rows, 0, 0, cols, rows);
		const px = ctx.getImageData(0, 0, cols, rows).data;
		const col = new Uint8Array(cols * rows * 3);
		for (let k = 0; k < cols * rows; k++) {
			col[k * 3] = px[k * 4]; col[k * 3 + 1] = px[k * 4 + 1]; col[k * 3 + 2] = px[k * 4 + 2];
		}
		return col;
	}

	function fromAtlas(map, frames, uri, mine) {
		const img = new Image();
		img.onload = () => {
			const tx = map.media.atlas.tilesX || 1;
			const { cols, rows } = map.grid;
			for (let i = 0; i < frames; i++) {
				if (mine !== gen) return;
				onColors(i, sampleColors(img, cols, rows, (i % tx) * cols, Math.floor(i / tx) * rows));
			}
		};
		img.src = uri;
	}

	function fromVideo(map, frames, uri, mine) {
		const v = quietVideo();
		v.addEventListener('loadedmetadata', async () => {
			const f = (map.anim && map.anim.fps) || 10;
			const { cols, rows } = map.grid;
			for (let i = 0; i < frames; i++) {
				if (mine !== gen) return;
				await seekTo(v, Math.min(i / f, Math.max(0, v.duration - 0.001)));
				onColors(i, sampleColors(v, cols, rows));
			}
		}, { once: true });
		v.src = uri;
	}

	function fromImage(map, uri, mine) {
		const img = new Image();
		img.onload = () => { if (mine === gen) onColors(0, sampleColors(img, map.grid.cols, map.grid.rows)); };
		img.src = uri;
	}

	return {
		/** start decoding `map`'s media into per-frame colours; nothing to do for maps without media or with colour arrays */
		start(map, rawFrames) {
			const mine = ++gen;
			if (!map.media || !map.media.data) return;
			if (rawFrames[0] && rawFrames[0].color) return;
			const uri = 'data:' + map.media.mime + ';base64,' + map.media.data;
			if (map.media.atlas) fromAtlas(map, rawFrames.length, uri, mine);
			else if ((map.media.mime || '').indexOf('video') === 0) fromVideo(map, rawFrames.length, uri, mine);
			else fromImage(map, uri, mine);
		},
		/** stop listening to any run in flight */
		cancel() { gen++; }
	};
}

/** which of N frames the clock (ms) is on at `fps`, wrapping or ping-ponging */
function frameIndexAt(clock, N, fps, pingpong) {
	const step = Math.floor((clock / 1000) * fps);
	if (pingpong && N > 1) {
		const p = step % (2 * N - 2);
		return p < N ? p : 2 * N - 2 - p;
	}
	return step % N;
}

/* per-cell jitter tables, computed once per grid size: the throw factor
   plus sin/cos of each cell's angle. with sin(x + φ) expanded into these,
   the per-frame swirl needs no trig inside the cell loop. */
function burstTables(count) {
	const a = new Float32Array(count), sin = new Float32Array(count), cos = new Float32Array(count);
	for (let k = 0; k < count; k++) {
		const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
		const h = s - Math.floor(s);
		a[k] = 0.7 + 0.6 * h;
		sin[k] = Math.sin(h * 6.2832);
		cos[k] = Math.cos(h * 6.2832);
	}
	return { a, sin, cos, count };
}

/* touch never drives the lens: swipes stay free to scroll the page, a tap
   does nothing, and only a ~450ms still press bursts at the point. mouse
   and pen hover the lens and burst on click. pointer:'manual' skips all of
   this — the site drives lookAt()/lookAway()/burst() itself. */
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 12;
function attachPointer(canvas, actions) {
	let lastPointerType = 'mouse';
	let lpTimer = 0, lpX = 0, lpY = 0;
	const clearLongPress = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; } };

	function onMove(e) {
		if (e.pointerType === 'touch') {
			if (lpTimer && Math.hypot(e.offsetX - lpX, e.offsetY - lpY) > LONG_PRESS_SLOP) clearLongPress();
			return;
		}
		actions.lookAt(e.offsetX, e.offsetY);
	}
	function onDown(e) {
		lastPointerType = e.pointerType || 'mouse';
		if (e.pointerType === 'touch') {
			lpX = e.offsetX; lpY = e.offsetY;
			clearLongPress();
			lpTimer = setTimeout(() => { lpTimer = 0; actions.burst(lpX, lpY); }, LONG_PRESS_MS);
			return;
		}
		onMove(e);
	}
	const onLeave = () => { clearLongPress(); actions.lookAway(); };
	const onClick = (e) => { if (lastPointerType !== 'touch') actions.burst(e.offsetX, e.offsetY); };

	const pairs = [['pointermove', onMove], ['pointerdown', onDown], ['pointerup', clearLongPress],
		['pointerleave', onLeave], ['pointercancel', onLeave], ['click', onClick]];
	for (const [type, fn] of pairs) canvas.addEventListener(type, fn);
	return () => {
		clearLongPress();
		for (const [type, fn] of pairs) canvas.removeEventListener(type, fn);
	};
}

function mount(host, map, options) {
	const opts = options || {};
	map = validate(map);
	const REDUCED = reducedMotion();
	const autoplay = opts.autoplay !== false;
	const managed = opts.pointer !== 'manual';
	let cfg = resolveConfig(map.config, opts.config);
	let theme = resolveTheme(DEFAULT_THEME, opts.theme);

	const canvas = playerCanvas(opts.label, managed);
	host.textContent = '';
	host.appendChild(canvas);
	const ctx = canvas.getContext('2d');
	const staticLayer = document.createElement('canvas');
	const sctx = staticLayer.getContext('2d');

	let settleTimer = 0; // a pending resize redraw (see onResize)
	let grid = null, raf = 0, visible = !document.hidden, onscreen = true;
	let rawFrames = null, prepped = null, frameIdx = 0, playing = false, clock = 0, lastTs = 0;
	let expls = [];
	let drawn = 0;           // frames this player has drawn (a fps readout samples it)
	let staticCells = null;  // the cells the static layer shows right now (null = must be drawn whole)
	let dirty = null;        // device-px rect the last dynamic pass painted, to restore next frame
	let hash = null;         // burst jitter tables for this grid size
	let fontCache = Object.create(null);
	const hydCols = [];
	const pointer = { x: 0, y: 0, tx: 0, ty: 0, s: 0, ts: 0 };

	const fps = () => (map.anim && map.anim.fps) || 0;
	const animated = () => rawFrames.length > 1 && fps() > 0;
	const resetPrepped = () => { prepped = new Array(rawFrames.length).fill(null); };

	/* ── frames and colours ── */

	function cellsFor(i) {
		if (!prepped[i]) prepped[i] = prepCells(map, rawFrames[i], hydCols[i], cfg, theme);
		return prepped[i];
	}

	const hydrator = createHydrator((i, col) => {
		hydCols[i] = col;
		if (cfg.restColor === 'image') {
			// the colours are what the glyphs rest in: re-prep, and repaint now
			prepped[i] = null;
			if (i === frameIdx && grid) { renderStatic(cellsFor(frameIdx)); blitStatic(); }
		} else if (prepped[i]) prepped[i].col = col;
		schedule();
	});

	/** take the map as new: frames, playback, jitter tables, colours */
	function normalize() {
		rawFrames = framesOf(map);
		resetPrepped();
		frameIdx = 0; clock = 0; lastTs = 0;
		playing = animated() && autoplay && !REDUCED;
		ensureHashes();
		hydCols.length = 0;
		hydrator.start(map, rawFrames);
	}

	function ensureHashes() {
		const count = map.grid.cols * map.grid.rows;
		if (!hash || hash.count !== count) hash = burstTables(count);
	}

	/* ── layout and the static layer ── */

	/** size both canvases to the host and draw the frame afresh */
	function layout() {
		clearTimeout(settleTimer);
		const dpr = dprOf();
		const wCss = host.clientWidth || 600;
		const { cols, rows, cellAspect } = map.grid;
		const cw = wCss / cols, ch = cw / cellAspect, hCss = ch * rows;
		canvas.style.height = hCss + 'px';
		canvas.width = Math.round(wCss * dpr);
		canvas.height = Math.round(hCss * dpr);
		staticLayer.width = canvas.width;
		staticLayer.height = canvas.height;
		const fontPx = Math.min(ch * 1.02, (cw / fontAdvance(theme.font)) * 1.05);
		grid = { dpr, wCss, hCss, cw, ch, cwD: cw * dpr, chD: ch * dpr, cols, rows, fontPx,
			restFont: '400 ' + (fontPx * dpr).toFixed(1) + 'px ' + theme.font };
		fontCache = Object.create(null);
		staticCells = null;
		renderStatic(cellsFor(frameIdx));
		blitStatic();
	}

	/** grow a cell mark by one ring of neighbours; returns the grown mark and its count */
	function growMark(mark, cols, rows) {
		const out = new Uint8Array(mark.length);
		let n = 0;
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				if (!mark[r * cols + c]) continue;
				const r0 = r > 0 ? r - 1 : 0, r1 = r < rows - 1 ? r + 1 : r;
				const c0 = c > 0 ? c - 1 : 0, c1 = c < cols - 1 ? c + 1 : c;
				for (let rr = r0; rr <= r1; rr++) {
					for (let cc = c0; cc <= c1; cc++) {
						const kk = rr * cols + cc;
						if (!out[kk]) { out[kk] = 1; n++; }
					}
				}
			}
		}
		return { mark: out, n };
	}

	/** the cells of `cells` that differ from `prev` (glyph or colour), and the two
	    rings around them: `clip` is where pixels can change (a glyph spills a
	    hair past its own cell, so a changed glyph reaches its neighbours), `draw`
	    is every glyph that reaches into the clip (the clip's own neighbours);
	    `marked` counts the draw set. null when nothing differs. */
	function diffCells(cells, prev) {
		const { cols, rows } = cells;
		const changed = new Uint8Array(cols * rows);
		let any = false;
		for (let k = 0; k < cols * rows; k++) {
			if (prev.chars[k] !== cells.chars[k] || prev.fills[k] !== cells.fills[k]) { changed[k] = 1; any = true; }
		}
		if (!any) return null;
		const clip = growMark(changed, cols, rows);
		const draw = growMark(clip.mark, cols, rows);
		return { clip: clip.mark, draw: draw.mark, marked: draw.n };
	}

	/** draw `cells` onto the static layer: whole when nothing is there (or the
	    grid changed, or most cells changed), else by diff against the frame on
	    it. THE DIFF IS EXACT (Kesh 2026-10-14, "small strips of lines that have
	    the gradient", "random shit in the bg"): the changed cells and the ring
	    where their glyphs spill, snapped to whole device pixels (a cell is a
	    fraction of a pixel wide; a clear at fractional edges half-covers the
	    boundary pixel and left a sliver of the old glyph along every seam),
	    become a clip region; inside it the background is laid down and every
	    glyph that reaches into it (that ring's own neighbours too) is drawn
	    again, so each pixel in the clip is built exactly as a whole render
	    builds it, and nothing outside is touched (verify.mjs checks pixel for
	    pixel). A clip frame change touches a fraction of the grid; one that
	    changes over half of it is drawn whole. */
	function renderStatic(cells) {
		const g = grid;
		let d = null;
		const prev = staticCells && staticCells.cols === cells.cols && staticCells.rows === cells.rows ? staticCells : null;
		if (prev) {
			d = diffCells(cells, prev);
			if (!d) { staticCells = cells; return; }
			if (d.marked >= cells.cols * cells.rows * 0.5) d = null;
		}
		sctx.setTransform(1, 0, 0, 1, 0, 0);
		sctx.textAlign = 'center';
		sctx.textBaseline = 'middle';
		if (d) {
			sctx.save();
			sctx.beginPath();
			for (let r = 0; r < g.rows; r++) {
				const y0 = Math.round(r * g.chD), y1 = Math.round((r + 1) * g.chD);
				for (let c = 0; c < g.cols; c++) {
					if (!d.clip[r * g.cols + c]) continue;
					const x0 = Math.round(c * g.cwD);
					sctx.rect(x0, y0, Math.round((c + 1) * g.cwD) - x0, y1 - y0);
				}
			}
			sctx.clip();
		}
		sctx.fillStyle = theme.bg;
		sctx.fillRect(0, 0, staticLayer.width, staticLayer.height); // only the clip, when there is one
		sctx.font = g.restFont;
		const draw = d ? d.draw : null;
		for (let r = 0; r < g.rows; r++) {
			const cy = (r + 0.5) * g.chD;
			for (let c = 0; c < g.cols; c++) {
				const k = r * g.cols + c;
				if (draw && !draw[k]) continue;
				const ch = cells.chars[k];
				if (ch === ' ') continue;
				sctx.fillStyle = cells.fills[k];
				sctx.fillText(ch, (c + 0.5) * g.cwD, cy);
			}
		}
		if (d) sctx.restore();
		staticCells = cells;
	}

	/** the whole static layer onto the canvas */
	function blitStatic() {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.drawImage(staticLayer, 0, 0);
		dirty = null;
	}

	/** only the rectangle the last dynamic pass painted, back from the static layer */
	function restoreDirty() {
		if (!dirty) return;
		const x0 = Math.max(0, dirty.x0), y0 = Math.max(0, dirty.y0);
		const x1 = Math.min(canvas.width, dirty.x1), y1 = Math.min(canvas.height, dirty.y1);
		if (x1 > x0 && y1 > y0) {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.drawImage(staticLayer, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
		}
		dirty = null;
	}

	/* ── bursts ──
	   clicks (or touch long-press) stack up to cfg.bursts live explosions —
	   the next click waits until one dies, and nothing else about the player
	   resets. motion is the drawn curve; displaced glyphs light up in the
	   current lens colour while they fly. purely analytic, no per-cell
	   physics state. */

	/* the envelope is a lookup into the drawn motion curve, scaled to
	   cfg.burstMs. both read live from cfg, so redrawing or resizing retunes
	   explosions already in flight. */
	const exTotal = () => Math.max(60, cfg.burstMs);
	function exEnvelope(e) {
		const t = e / exTotal();
		if (t >= 1) return 0;
		const cv = Array.isArray(cfg.curve) && cfg.curve.length > 1 ? cfg.curve : DEFAULT_CURVE;
		return clamp01(sampleAt(cv, t));
	}

	/** the explosions still in flight at ts, with their envelope and swirl phase */
	function liveBursts(ts) {
		expls = expls.filter((ex) => ts - ex.start < exTotal());
		const actives = [];
		for (const ex of expls) {
			const e = ts - ex.start;
			const env = exEnvelope(e);
			if (env > 0.001) actives.push({ x: ex.x, y: ex.y, env, sinE: Math.sin(e * 0.0035), cosE: Math.cos(e * 0.0035) });
		}
		return actives;
	}

	/** the cell range (c0, c1, r0, r1) the lens and the bursts can reach */
	function touchedCells(lensOn, actives) {
		const g = grid;
		const R = cfg.radius * g.wCss;
		const lensPad = R + g.ch * cfg.magnify + cfg.repel * g.ch;
		let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
		if (lensOn) {
			x0 = pointer.x - lensPad; x1 = pointer.x + lensPad;
			y0 = pointer.y - lensPad; y1 = pointer.y + lensPad;
		}
		const p = cfg.blast * g.wCss + cfg.power * g.wCss + g.ch * 2;
		for (const a of actives) {
			x0 = Math.min(x0, a.x - p); x1 = Math.max(x1, a.x + p);
			y0 = Math.min(y0, a.y - p); y1 = Math.max(y1, a.y + p);
		}
		return {
			c0: Math.max(0, Math.floor(x0 / g.cw)), c1: Math.min(g.cols - 1, Math.ceil(x1 / g.cw)),
			r0: Math.max(0, Math.floor(y0 / g.ch)), r1: Math.min(g.rows - 1, Math.ceil(y1 / g.ch))
		};
	}

	/** the css font (device px) for a lens scale and core style, cached by quantized size */
	function fontFor(scale, style) {
		// eighth-step sizes collapse into a handful of cached font strings
		const qs = ((scale * 8 + 0.5) | 0) / 8;
		const fkey = style[0] + qs;
		let f = fontCache[fkey];
		if (!f) {
			const weight = style === 'bold' ? '700 ' : style === 'italic' ? 'italic 400 ' : '400 ';
			f = fontCache[fkey] = { css: weight + (grid.fontPx * qs * grid.dpr).toFixed(1) + 'px ' + theme.font, size: qs };
		}
		return f;
	}

	/** the colour a cell blends toward inside the lens (or while flying) */
	function lensTarget(cells, k, base) {
		const mode = cfg.colorMode;
		if (mode === 'image' && cells.col) return [cells.col[k * 3], cells.col[k * 3 + 1], cells.col[k * 3 + 2]];
		if (mode === 'gradient' && cells.lensTone) return cells.lensTone[cells.idx[k]];
		if (mode === 'amber') return theme.accent;
		if (mode === 'mono') return theme.ink;
		if (cells.tone || cells.rest) return base; // 'same', or image/gradient with nothing to show
		return theme.ink;
	}

	/* ONLY THE CELLS THE LENS OR A BURST TOUCHES ARE REDRAWN (2026-10-13).
	   The static layer is already right everywhere else (the box used to be
	   wiped and every cell in it redrawn, corners and padding ring included,
	   ~2,500 fillText a frame for a maxed lens). An affected cell clears its
	   own home and is queued; untouched ones are left alone. */
	/* MAGNIFIED GLYPHS ARE DRAWN GROUPED BY SIZE (2026-10-13, Kesh: "why
	   does it lag so much when magnify is all the way maxed out?"). Each
	   magnified glyph has one of a handful of eighth-step sizes; drawn in
	   grid order, ctx.font switched for nearly every one, and every switch
	   makes the browser parse a font string (~610 changes a frame on a maxed
	   lens, ~10fps at 4x CPU). Queued by font and drawn one size at a time,
	   smallest first (so the biggest, the lens's centre, sit on top), it is
	   one font change per size in use. NOT a transform per glyph: tried, and
	   scaled fillText misses the glyph cache, ~1fps. NOT a sprite atlas
	   either: tried in 0.10.0, no faster than this in Chrome (see the glyph
	   sheet section), so the queue draws with fillText. */

	/** paints the lens and the live bursts over the (restored) static layer;
	    returns the device-px rect it touched, or null when nothing was drawn */
	function drawDynamic(S, cells, ts) {
		const g = grid;
		const lensOn = S > EPS;
		const actives = liveBursts(ts);
		if (!lensOn && !actives.length) return null;
		const { c0, c1, r0, r1 } = touchedCells(lensOn, actives);
		const R = cfg.radius * g.wCss, R2 = R * R;
		const Rex = cfg.blast * g.wCss, Rex2 = Rex * Rex;
		const throwMax = cfg.power * g.wCss;
		const dpr = g.dpr;
		const coreStyle = cfg.core || (cfg.weight ? 'bold' : 'none');
		const hashA = hash.a, hashSin = hash.sin, hashCos = hash.cos;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = theme.bg;
		// the rect this pass paints: the cleared homes, widened by where glyphs land
		let dx0 = Infinity, dy0 = Infinity, dx1 = -Infinity, dy1 = -Infinity, spill = 0;
		const queued = new Map(); // font css → [ch, x, y, fill, ...] with .font
		for (let r = r0; r <= r1; r++) {
			const cy = (r + 0.5) * g.ch;
			for (let c = c0; c <= c1; c++) {
				const k = r * g.cols + c;
				const cx = (c + 0.5) * g.cw;
				// the lens: a smoothstep falloff from the pointer
				let f = 0, ldx = 0, ldy = 0, ld = 0;
				if (lensOn) {
					ldx = cx - pointer.x; ldy = cy - pointer.y;
					const ld2 = ldx * ldx + ldy * ldy;
					if (ld2 < R2) {
						ld = Math.sqrt(ld2);
						const t = 1 - ld / R;
						f = t * t * (3 - 2 * t) * S;
					}
				}
				// the bursts: outward throw with per-cell jitter and a tangential swirl
				let exf = 0, eox = 0, eoy = 0;
				for (const a of actives) {
					const dxe = cx - a.x, dye = cy - a.y;
					const de2 = dxe * dxe + dye * dye;
					if (de2 >= Rex2) continue;
					const de = Math.sqrt(de2);
					const tt = 1 - de / Rex;
					const s = tt * tt * a.env * hashA[k];
					if (s > exf) exf = s;
					const mag = throwMax * s;
					let ux, uy;
					if (de > 0.5) { ux = dxe / de; uy = dye / de; }
					else { ux = hashCos[k]; uy = hashSin[k]; }
					const j = (a.sinE * hashCos[k] + a.cosE * hashSin[k]) * cfg.swirl;
					eox += (ux - uy * j) * mag;
					eoy += (uy + ux * j) * mag;
				}
				if (f <= LENS_EPS && exf <= EPS) continue; // untouched, or as good as: the static layer has it
				// touched: clear its home (on whole device pixels, see renderStatic), it
				// is drawn again (bigger, moved or both) below
				const hx = Math.round(c * g.cwD), hy = Math.round(r * g.chD);
				const hx1 = Math.round((c + 1) * g.cwD), hy1 = Math.round((r + 1) * g.chD);
				ctx.fillRect(hx, hy, hx1 - hx, hy1 - hy);
				if (hx < dx0) dx0 = hx; if (hy < dy0) dy0 = hy;
				if (hx1 > dx1) dx1 = hx1; if (hy1 > dy1) dy1 = hy1;
				let ch = cells.chars[k];
				if (f > EPS && cfg.charBoost > 0) {
					const bi = Math.min(cells.n, cells.idx[k] + Math.round(cfg.charBoost * cells.n * f));
					ch = cells.ramp[bi];
				}
				if (ch === ' ') continue;
				const scale = (1 + (cfg.magnify - 1) * f) * (1 + 0.45 * exf);
				// the core (f > CORE_AT) takes the core style (2026-10-13: none, bold or
				// italic; a map with only `weight` means bold or none)
				const font = fontFor(scale, f > CORE_AT ? coreStyle : 'none');
				// the colour at rest: the glyph's tone colour, or the ink
				const base = cells.rest ? [cells.rest[k * 3], cells.rest[k * 3 + 1], cells.rest[k * 3 + 2]]
					: cells.tone ? cells.tone[cells.idx[k]] : theme.ink;
				const baseA = cells.tone || cells.rest ? 1 : 0.3 + 0.7 * (cells.lum[k] / 255);
				const cf = f > exf ? f : exf;
				const tgt = lensTarget(cells, k, base);
				const rr = (base[0] + (tgt[0] - base[0]) * cf + 0.5) | 0;
				const gg = (base[1] + (tgt[1] - base[1]) * cf + 0.5) | 0;
				const bb = (base[2] + (tgt[2] - base[2]) * cf + 0.5) | 0;
				let qa = ((baseA + (1 - baseA) * cf) * 100 + 0.5) | 0;
				if (qa > 100) qa = 100;
				const fill = 'rgba(' + rr + ',' + gg + ',' + bb + ',' + ALPHA_STR[qa] + ')';
				let ox = cx + eox, oy = cy + eoy;
				if (cfg.repel > 0 && f > EPS && ld > 0.5) {
					const push = cfg.repel * g.ch * f;
					ox += (ldx / ld) * push;
					oy += (ldy / ld) * push;
				}
				ox *= dpr; oy *= dpr;
				if (ox < dx0) dx0 = ox; if (oy < dy0) dy0 = oy;
				if (ox > dx1) dx1 = ox; if (oy > dy1) dy1 = oy;
				if (font.size > spill) spill = font.size;
				let q = queued.get(font.css);
				if (!q) { q = []; q.font = font; queued.set(font.css, q); }
				q.push(ch, ox, oy, fill);
			}
		}
		if (dx0 === Infinity) return null; // everything in reach was below the threshold
		flushQueue(queued);
		// a glyph at scale s reaches about 0.75 em from its centre, in device px
		const pad = Math.ceil(g.fontPx * dpr * spill * 0.8) + 2;
		return { x0: Math.floor(dx0 - pad), y0: Math.floor(dy0 - pad), x1: Math.ceil(dx1 + pad), y1: Math.ceil(dy1 + pad) };
	}

	/** the queued glyphs, one font at a time, smallest to biggest */
	function flushQueue(queued) {
		const groups = [...queued.values()].sort((a, b) => a.font.size - b.font.size);
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		for (const q of groups) {
			ctx.font = q.font.css;
			for (let j = 0; j < q.length; j += 4) {
				ctx.fillStyle = q[j + 3];
				ctx.fillText(q[j], q[j + 1], q[j + 2]);
			}
		}
	}

	/* ── the loop ── */

	/** advance the playback clock; true when the frame on screen changed */
	function advancePlayback(ts) {
		if (!playing) { lastTs = 0; return false; }
		if (lastTs) clock += ts - lastTs;
		lastTs = ts;
		const idx = frameIndexAt(clock, rawFrames.length, fps(), cfg.pingpong);
		if (idx === frameIdx) return false;
		frameIdx = idx;
		renderStatic(cellsFor(idx));
		return true;
	}

	/** ease the pointer toward its target (snaps under reduced motion, and
	    once within SETTLE_PX so a parked lens stops changing); true when it moved */
	function easePointer() {
		const kPos = REDUCED ? 1 : cfg.ease;
		const kStr = REDUCED ? 1 : 0.12;
		const x = pointer.x, y = pointer.y, s = pointer.s;
		pointer.x += (pointer.tx - pointer.x) * kPos;
		pointer.y += (pointer.ty - pointer.y) * kPos;
		pointer.s += (pointer.ts - pointer.s) * kStr;
		if (Math.abs(pointer.tx - pointer.x) < SETTLE_PX) pointer.x = pointer.tx;
		if (Math.abs(pointer.ty - pointer.y) < SETTLE_PX) pointer.y = pointer.ty;
		if (Math.abs(pointer.ts - pointer.s) < 0.002) pointer.s = pointer.ts;
		if (pointer.s <= EPS) pointer.s = 0;
		return x !== pointer.x || y !== pointer.y || s !== pointer.s;
	}

	/* A PARKED LENS COSTS NOTHING (0.10.0): a frame where the clip did not
	   advance, the pointer did not move and no burst is in flight would draw
	   exactly what is on the canvas, so it is skipped and the loop sleeps;
	   lookAt / burst / setPlaying wake it. The painted rect is kept as dirty
	   so the first frame that does change restores it first. */
	function frame(ts) {
		raf = 0;
		if (!grid) return;
		const changed = advancePlayback(ts);
		const moved = easePointer();
		const busy = expls.length > 0;
		if (changed || moved || busy) {
			// a new clip frame: the whole static layer comes over; otherwise only
			// the rect the last pass painted is put back before this pass paints
			if (changed) blitStatic(); else restoreDirty();
			if (pointer.s > 0 || busy) dirty = drawDynamic(pointer.s, cellsFor(frameIdx), ts);
			drawn++;
		}
		if (playing || moved || busy) schedule(); else lastTs = 0;
	}

	function schedule() {
		if (!raf && visible && onscreen) raf = requestAnimationFrame(frame);
	}

	function halt() {
		if (raf) { cancelAnimationFrame(raf); raf = 0; }
		lastTs = 0;
	}

	/* ── actions ── */

	function explodeAt(x, y) {
		if (REDUCED) return;
		const now = performance.now();
		expls = expls.filter((ex) => now - ex.start < exTotal());
		if (expls.length >= Math.max(1, cfg.bursts)) return;
		expls.push({ x, y, start: now });
		schedule();
	}

	function lookAt(x, y) {
		pointer.tx = x;
		pointer.ty = y;
		if (pointer.s === 0) { pointer.x = x; pointer.y = y; }
		pointer.ts = 1;
		schedule();
	}

	function lookAway() {
		pointer.ts = 0;
		schedule();
	}

	const detachPointer = managed ? attachPointer(canvas, { lookAt, lookAway, burst: explodeAt }) : () => {};
	const onVis = () => { visible = !document.hidden; if (visible) schedule(); else halt(); };
	document.addEventListener('visibilitychange', onVis);
	const io = new IntersectionObserver((entries) => {
		onscreen = entries[0].isIntersecting;
		if (onscreen) schedule(); else halt();
	});
	io.observe(canvas);
	/* RESIZE (0.10.1, Kesh 2026-10-17: "why is the responsiveness of this page so
	   bad"): a layout redraws every glyph, and on the gallery four players
	   resizing at once cost ~150ms a step against the mapper's ~33ms, all of it
	   fillText. Two fixes. layout() sets the canvas height, which changes the
	   host's box and fired this observer a second time at the same width: a
	   height-only change is now ignored. And while the width is still moving
	   the canvas is only stretched (its height follows the width, so the
	   picture keeps its shape); the real redraw runs once the width has held
	   for RESIZE_SETTLE_MS. */
	function onResize() {
		const w = host.clientWidth || 600;
		if (!grid) { layout(); return; }
		if (Math.abs(w - grid.wCss) < 0.5) {
			// back at the drawn width (or only the height moved): no redraw needed
			clearTimeout(settleTimer);
			canvas.style.height = grid.hCss + 'px';
			return;
		}
		const { cols, rows, cellAspect } = map.grid;
		canvas.style.height = (w / cols / cellAspect) * rows + 'px';
		clearTimeout(settleTimer);
		settleTimer = setTimeout(layout, RESIZE_SETTLE_MS);
	}
	const ro = new ResizeObserver(onResize);
	ro.observe(host);

	normalize();
	layout();
	schedule();
	greet();

	return {
		/** Swap in a map. options.keep: the same clip with new glyphs (a live
		    edit in the mapper), so keep the playhead and play state, and keep
		    the decoded colours when the colour data has not changed. */
		reload(next, options) {
			const keep = !!(options && options.keep);
			const prevMedia = map.media, f = frameIdx, c = clock, p = playing;
			if (next) map = validate(next);
			if (!keep) normalize();
			else {
				rawFrames = framesOf(map);
				resetPrepped();
				frameIdx = Math.min(f, rawFrames.length - 1); clock = c; playing = p && animated();
				ensureHashes();
				const sameColour = !!(map.media && prevMedia && map.media.data === prevMedia.data) || (!map.media && !prevMedia);
				if (!sameColour) { hydCols.length = 0; hydrator.start(map, rawFrames); }
			}
			layout();
			schedule();
		},
		/** Patch the live config; a restColor change re-preps the glyph colours. */
		setConfig(patch) {
			const was = cfg.restColor;
			cfg = Object.assign({}, cfg, patch);
			if (cfg.restColor !== was) { resetPrepped(); layout(); }
			schedule();
		},
		getConfig() { return Object.assign({}, cfg); },
		/** Restyle live: any of { bg, ink, accent, font }. */
		setTheme(patch) {
			theme = resolveTheme(theme, patch);
			resetPrepped();
			layout();
			schedule();
		},
		/** Drive the lens without listeners (pointer:'manual'). CSS px, canvas-relative. */
		lookAt,
		lookAway,
		/** Trigger a burst at a point. CSS px, canvas-relative. */
		burst(x, y) { explodeAt(x, y); },
		explode(x, y) { explodeAt(x, y); },
		getExplosions() { return expls.length; },
		isAnimated() { return animated(); },
		isPlaying() { return playing; },
		setPlaying(b) { playing = !!b && animated(); lastTs = 0; schedule(); },
		getFrame() { return frameIdx; },
		/** frames drawn so far; still while the player sleeps */
		getFrameCount() { return drawn; },
		canvas,
		destroy() {
			halt();
			detachPointer();
			hydrator.cancel();
			document.removeEventListener('visibilitychange', onVis);
			io.disconnect(); ro.disconnect(); clearTimeout(settleTimer);
			canvas.remove();
		}
	};
}

return {
	VERSION,
	MAP_VERSION,
	CURVE_SAMPLES,
	DEFAULT_CONFIG,
	DEFAULT_THEME,
	validate,
	parse,
	load,
	resolveConfig,
	sampleCurve,
	bake,
	bakeValues,
	sampleGradient,
	toneColors,
	mount,
	reveal
};

}));
