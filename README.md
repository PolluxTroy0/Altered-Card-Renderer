# Altered Card Renderer

> **Active development** — This renderer is under active development. Frequent updates are to be expected; breaking changes may occur between versions. Check the repository for the latest release before upgrading.

In Altered TCG, each Unique card is one-of-a-kind: its artwork and stats are specific to a single physical card owned by a player. This renderer lets you **display the full card image** of any Unique — artwork, frame, biome values, effect text — by fetching its data from an API and drawing it into an HTML canvas.

Embed it on any page with a single `<script>` tag.  
No build step, no framework, no dependencies.

**[Live example →](https://altered-db.com/forge/standalone/altered-card-renderer-example.html)**

---

## Embed anywhere with only one tag

The simplest way to display cards on any page. Drop the `<script>` tag, then use `<altered-card>` wherever you want — in articles, CMS templates, static pages, anywhere.

**Via jsDelivr (no hosting required):**

```html
<script src="https://cdn.jsdelivr.net/gh/PolluxTroy0/Altered-Card-Renderer@main/altered-card-renderer-minified.js"></script>

<altered-card ref="ALT_CORE_B_AX_04_U_10"></altered-card>
<altered-card ref="ALT_EOLE_B_OR_109_U_374" locale="en"></altered-card>
```

**Self-hosted:**

```html
<script src="https://your-domain.com/path/to/altered-card-renderer-minified.js"></script>

<altered-card ref="ALT_CORE_B_AX_04_U_10"></altered-card>
<altered-card ref="ALT_EOLE_B_OR_109_U_374" locale="en"></altered-card>
```

The renderer loads card configs from `https://cdn.alteredcore.org/forge/` and fetches card data and images directly from the API and CDN — both expose `Access-Control-Allow-Origin: *`, so no proxy is needed. No attributes required for a standard setup.

**Attributes on `<altered-card>`:**

| Attribute | Default | Description |
|-----------|---------|-------------|
| `ref` | — | Card reference (required) |
| `locale` | `en` | Language (`en`, `fr`, `es`, `it`, `de`) |
| `collection` | `official` | Frame collection (`official` or `community`) |

> **Limit:** a maximum of 50 `<altered-card>` elements per page are rendered. Elements beyond this limit are silently ignored.

---

## Configuration

### In `altered-card-renderer.js`

The `RESOURCES` object at the top of the file centralises all configurable paths and URLs:

| Key | Default | Description |
|-----|---------|-------------|
There is also a top-level variable above `RESOURCES` for the API URL:

| Variable | Default | Description |
|----------|---------|-------------|
| `CARD_API_URL` | `""` *(source)* / filled at build time | Card data API URL. `{ref}` and `{locale}` are substituted at runtime. Set by `build_renderer_for_github.py` from `config/core.json`, or leave empty and provide it via `config/core.json` at runtime. |

| Key | Default | Description |
|-----|---------|-------------|
| `configBaseUrl` | `""` *(built)* / `https://cdn.alteredcore.org/forge/` *(source)* | Root URL for config files and assets. In the built version the config is embedded and assets are local, so this is `""`. See note below. |
| `configIndex` | `config/index.json` | Path to the config index (relative to `configBaseUrl`). Unused when `embeddedConfig` is set. |
| `alteredIconsCss` | `assets/fonts/alteredicons.css` | Path to the Altered icon font (relative to `configBaseUrl`). |
| `qrcodeLib` | `assets/vendor/qrcodejs/qrcode.min.js` | Path to QRCode.js (relative to `configBaseUrl`, or absolute URL). |
| `useApiBackground` | `true` | `true` = use the image URL returned by the API. `false` = use a custom URL template (see `backgroundUrl`). |
| `backgroundUrl` | `""` | URL template used when `useApiBackground` is `false`. Variables: `{ref}`, `{locale}`, `{faction}` (AX, BR…), `{rarity}` (C, R, U, E), `{set}` (CORE, EOLE…), `{id}`. Browse available images at [cdn.alteredcore.org](https://cdn.alteredcore.org). |
| `backgroundUrlIdTransform` | `null` | Optional regex transforms applied to `{id}` before URL substitution. Array of `[regexPattern, replacement]` pairs applied in order. Example: `[["_U_\\d+$", "_U"]]` strips the collector number from unique cards (`ALT_CORE_B_AX_07_U_1698` → `ALT_CORE_B_AX_07_U`). Set to `null` to disable. |
| `embeddedConfig` | `null` | When non-null, **takes full priority** — no config files are fetched. Set by the build script. To force external JSON files instead, pass `embeddedConfig: null` explicitly to `AlteredRender.init()`. |

> **Note — config priority:** `embeddedConfig` always takes precedence over `configBaseUrl`. In the built version, config is embedded and no JSON files are fetched. To override with external config files at runtime, pass `{ embeddedConfig: null, configBaseUrl: "https://…" }` to `AlteredRender.init()`.

> **Note — `configBaseUrl`:** In the built version, `configBaseUrl` is `""` because assets are served from the same folder. If you load the renderer from jsDelivr or the source file directly, `configBaseUrl` defaults to `https://cdn.alteredcore.org/forge/` — a CDN with `Access-Control-Allow-Origin: *`.

---

## Files

| File / Folder | Description |
|------|-------------|
| `altered-card-renderer.js` | The renderer — card config embedded, registers the `<altered-card>` custom element |
| `altered-card-renderer-example.html` | Live demo — cards rendered side by side |
| `altered-card-renderer-card.json` | Sample card JSON — shows the expected API response format |
| `altered-card-renderer-readme.html` | **Full documentation** |
| `assets/fonts/` | Card fonts (HapticPro, Jali) + `alteredicons.css` (Altered icon font, base64 embedded) |
| `assets/frames/` | Frame PNGs/SVGs — `OFFICIAL/` and `COMMUNITY/`, organised by faction |
| `assets/biomes/` | Biome badge images |
| `assets/logos/` | Set logos and QR code logo |
| `assets/img/` | Placeholder background shown while images load |
| `assets/vendor/qrcodejs/` | QRCode.js library (self-hosted, no CDN dependency) |

---

## Full documentation

See **[altered-card-renderer-readme.html](altered-card-renderer-readme.html)** for the complete reference.

---

## Contact

Developed by **PolluxTroy**.  
Bug reports, questions and suggestions welcome:

- **GitHub** — open an issue on this repository
- **Discord** — `.polluxtroy`

---

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.

You are free to use, modify, and distribute this software, provided that:

- The original author (**PolluxTroy**) and the source repository ([github.com/PolluxTroy0/Altered-Card-Renderer](https://github.com/PolluxTroy0/Altered-Card-Renderer)) are credited in any derivative work or redistribution.
- Any modified version is distributed under the same GPL-3.0 license and made publicly available with its full source code.
- The original copyright notice and license text are preserved in all copies.

See the full license text at [gnu.org/licenses/gpl-3.0](https://www.gnu.org/licenses/gpl-3.0.html).

> **Note:** Altered TCG card artwork, frames, and game assets remain the property of their respective owners. This renderer is a fan-made tool and is not affiliated with or endorsed by Equinox.
