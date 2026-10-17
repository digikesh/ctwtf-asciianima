# AGENTS.md

A reference for building the ascii anima player into a website. It's written for coding agents, and it works just as well for people. The friendlier overview, with pictures, is the [README](README.md).

## What you're working with

The player is one file, `ctwtf-asciiplayer/ascii-player.js`. It has no dependencies and no build step. Loaded with a plain `<script>` it defines `window.AsciiPlayer`; it also works with CommonJS and AMD.

It plays `.asciimap` files: JSON grids of text characters baked from an image or a short clip. People make them in the mapper at [asciianima.creativetech.wtf/mapper.html](https://asciianima.creativetech.wtf/mapper.html). A map holds its own hover and click settings, so a plain `mount(host, map)` behaves exactly as it did in the mapper.

## Two ways to show a map

`mount` draws a live picture. The cursor makes a lens, clicks throw the characters outward, and clips play.

`reveal` uses a map as a placeholder. The map appears at once, holds while a photo downloads, then resolves into the photo.

## mount(host, map, options)

`host` is any block element; the canvas fills its width and keeps the map's shape. `map` is a parsed map, usually from `await AsciiPlayer.load(url)`. Every option is optional.

| Option | What it does |
|---|---|
| `theme` | The page's look: `{ bg, ink, accent, font }`. `bg` takes any CSS colour; `ink` and `accent` take `'#rrggbb'` or `[r, g, b]`. |
| `config` | Overrides any setting the map baked, for example `{ radius: 0.2, blast: 0.4 }`. |
| `pointer` | `'manual'` turns off the built-in mouse and touch handling. Drive the lens yourself with `lookAt(x, y)` and `lookAway()`. Useful when many players share one page-wide pointer. |
| `autoplay` | `false` keeps a clip paused until `setPlaying(true)`. |
| `label` | The canvas's accessible name. |

The returned player has these methods.

| Method | What it does |
|---|---|
| `setConfig(patch)`, `getConfig()` | Change or read the live settings. |
| `setTheme(patch)` | Restyle live. |
| `lookAt(x, y)`, `lookAway()` | Move or hide the lens. CSS pixels, relative to the canvas. |
| `burst(x, y)` | Fire a click burst at a point. |
| `setPlaying(bool)`, `isPlaying()`, `isAnimated()`, `getFrame()` | Control and read clip playback. |
| `reload(map, { keep })` | Swap in a new map. `keep: true` keeps the clip's playhead. |
| `getFrameCount()`, `getExplosions()` | Frames drawn so far, and bursts in flight. |
| `canvas` | The canvas element. |
| `destroy()` | Stop and remove everything. Call it when the element leaves the page. |

## reveal(target, map, options)

`target` is a box sized to the photo's shape (give it an `aspect-ratio`) or a canvas.

| Option | What it does |
|---|---|
| `src` | The photo's URL. Or leave it out and call `.resolve(image)` when you have one. |
| `theme` | As for mount. |
| `color` | `'accent'` (default) or `'ink'` for the characters. |
| `clock` | `'auto'` (default) runs its own animation loop. `'manual'` draws only when you call `.frame(now)`, for pages that run many reveals in one loop. |
| `onDone` | Called once the photo is fully drawn. |
| `autoplay` | A `<video>` handed to `.resolve()` plays on after the reveal unless this is `false`. |

The returned object has `frame(now)`, `resolve(source)`, `replay()`, `isWaiting()`, `isDone()`, `canvas` and `destroy()`.

## Other exports

`load(url)` fetches and validates a map. `parse(json)` and `validate(map)` do the same for a map you already have, and throw readable errors on a bad file. `resolveConfig(baked, overrides)` shows the settings a player would use. `bake(pixels, cols, rows, options)` turns RGBA pixels into a map's characters without a DOM, so a build step in Node can make maps. `VERSION` and `MAP_VERSION` report what you have.

## The .asciimap format

A map is JSON, currently version 3. Older versions still load.

```jsonc
{
  "version": 3,
  "source": { "width": 480, "height": 480, "kind": "image" },
  "grid":   { "cols": 110, "rows": 61, "cellAspect": 0.55 },
  "ramp":   " .:-=+*#%@",
  "anim":   { "fps": 10, "frames": 26 },
  "frames": [{ "chars": ["one string per row", "…"] }],
  "media":  { "mime": "image/jpeg", "data": "…base64…", "atlas": { "tilesX": 4, "frames": 26 } },
  "tones":  { "stops": [], "colors": [], "lensColors": [] },
  "config": { "radius": 0.16, "magnify": 1.8, "power": 0.22, "blast": 0.5, "burstMs": 1760 }
}
```

`grid` sets the size in characters; `cellAspect` is a cell's width over its height. `ramp` lists the characters from light to dense. `frames` holds each frame's rows of characters, and `anim` appears only for clips, which cap at 240 frames. `media` is optional colour: one small JPEG holding every frame's colours at grid size. `tones` is optional too, for custom characters and gradients. `config` is the hover and click behaviour.

Sizes in `config` (`radius`, `power`, `blast`) are fractions of the grid's width, so a map behaves the same at any size on screen. Settings resolve in this order: the player's defaults, then the map's `config`, then the `config` you pass to `mount`.

Serve `.asciimap` files with a JSON content type so your host compresses them. A map gzips to a fraction of its size.

## Things to watch for

The page sets the colours, never the map. Pass a `theme` that matches your site. A map whose author painted it with their own gradient keeps those colours, as you'd expect.

Anything layered over a player, such as a caption or an overlay, needs `pointer-events: none`, or the player stops getting the cursor.

Touch never moves the lens. Swipes scroll the page as normal, and a still press of about half a second fires a burst.

`reload()` keeps the player's current settings. Call `setConfig()` afterwards if the new map should bring its own.

The player pauses itself when nothing moves, when it scrolls out of view, and when the tab is hidden, so many players on one page stay cheap. A very wide blast radius makes most of the grid move at once, and that's the setting that costs frame rate.

Fade a player in once its canvas exists, not on page load, or it pops.

Call `destroy()` when you remove a player, especially in single-page apps.
