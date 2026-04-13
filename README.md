# Altered Card Renderer

In Altered TCG, each Unique card is one-of-a-kind: its artwork and stats are specific to a single physical card owned by a player. This renderer lets you **display the full card image** of any Unique — artwork, frame, biome values, effect text — by fetching its data from an API and drawing it into an HTML canvas.

Embed it on any page with a single `<script>` tag.  
No build step, no framework, no dependencies.

**[Live example →](https://altered-db.com/forge/standalone/altered-card-renderer-example.html)**

---

## Embed anywhere with only one tag

The simplest way to display cards on any page. Drop the `<script>` tag, then use `<altered-card>` wherever you want — in articles, CMS templates, static pages, anywhere.

**Via jsDelivr (no hosting required):**

```html
<script src="https://cdn.jsdelivr.net/gh/PolluxTroy0/Altered-Card-Renderer@main/altered-card-renderer.js"></script>

<altered-card ref="ALT_CORE_B_AX_04_U_10"></altered-card>
<altered-card ref="ALT_EOLE_B_OR_109_U_374" locale="en"></altered-card>
```

**Self-hosted:**

```html
<script src="https://your-domain.com/path/to/altered-card-renderer.js"></script>

<altered-card ref="ALT_CORE_B_AX_04_U_10"></altered-card>
<altered-card ref="ALT_EOLE_B_OR_109_U_374" locale="en"></altered-card>
```

By default the renderer automatically looks for `altered-card-renderer-proxy.php` in the same folder as `altered-card-renderer.js`, and loads card configs from `https://img.altered-db.com/forge/`. No attributes needed for a standard setup.

**Attributes on `<altered-card>`:**

| Attribute | Default | Description |
|-----------|---------|-------------|
| `ref` | — | Card reference (required) |
| `locale` | `en` | Language (`en`, `fr`, `es`, `it`, `de`) |
| `collection` | `official` | Frame collection (`official` or `community`) |

---

## Self-hosting

### What you actually need to host

The renderer itself (`altered-card-renderer.js`) is a single vanilla JS file — no build step, no npm, no framework. It fetches card config files and assets from `https://img.altered-db.com/forge/` automatically (CDN, CORS open). **You do not need to host the config or assets yourself.**

The only reason to run a server at all is the **PHP proxy** — it handles two things the browser can't do directly:
- Fetch card data from the Altered API (CORS-restricted)
- Fetch card background images from S3/CDN (CORS-restricted)

### Option A — Static hosting only (no server-side code)

Drop `altered-card-renderer.js` on any static host (GitHub Pages, Netlify, your own Apache/Nginx, a shared host…). Set `proxyUrl: false` to disable the proxy and call the API directly from the browser.

```html
<script src="/path/to/altered-card-renderer.js"
        data-proxy="false"></script>

<altered-card ref="ALT_CORE_B_AX_04_U_10"></altered-card>
```

> **Caveat:** this only works if the card API responds with `Access-Control-Allow-Origin: *`. If the API later restricts CORS, cards will silently fail to load. Use Option B for a robust setup.

### Option B — Static host + PHP proxy (recommended)

Place both files in the same folder on a PHP-enabled server:

```
your-site/
└── cards/
    ├── altered-card-renderer.js
    └── altered-card-renderer-proxy.php   ← same folder, auto-detected
```

The renderer auto-detects the proxy — no configuration needed.

**Server requirements:**

| Requirement | Details |
|---|---|
| Web server | Apache, Nginx, LiteSpeed, any shared host — anything that serves static files |
| PHP | 7.4 or later |
| PHP extension | `curl` (enabled by default on most hosts) |
| HTTPS | Strongly recommended — the card API and image CDN are HTTPS-only |

No database, no composer, no framework. If your host can run a `.php` file, it works.

**Verify cURL is available** (optional sanity check):

```bash
php -r "echo function_exists('curl_init') ? 'OK' : 'cURL missing';"
```

### Option C — jsDelivr (zero hosting)

If you don't want to host anything at all, load the renderer directly from jsDelivr. The proxy is not available in this case, so it falls back to direct API calls (same caveat as Option A).

```html
<script src="https://cdn.jsdelivr.net/gh/PolluxTroy0/Altered-Card-Renderer@main/altered-card-renderer.js"></script>

<altered-card ref="ALT_CORE_B_AX_04_U_10"></altered-card>
```

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
| `configBaseUrl` | `""` *(built)* / `https://img.altered-db.com/forge/` *(source)* | Root URL for config files and assets. In the built version the config is embedded and assets are local, so this is `""`. See note below. |
| `proxyUrl` | `null` | Proxy mode: `null` = auto-detect (`altered-card-renderer-proxy.php` next to the script), `false` = no proxy (API called directly, requires CORS), `"https://…"` = explicit URL. |
| `configIndex` | `config/index.json` | Path to the config index (relative to `configBaseUrl`). Unused when `embeddedConfig` is set. |
| `alteredIconsCss` | `assets/fonts/alteredicons.css` | Path to the Altered icon font (relative to `configBaseUrl`). |
| `qrcodeLib` | `assets/vendor/qrcodejs/qrcode.min.js` | Path to QRCode.js (relative to `configBaseUrl`, or absolute URL). |
| `useApiBackground` | `true` | `true` = use the image URL returned by the API. `false` = use a custom URL template (see `backgroundUrl`). |
| `backgroundUrl` | `""` | URL template used when `useApiBackground` is `false`. Variables: `{ref}`, `{locale}`, `{faction}` (AX, BR…), `{rarity}` (C, R, U, E), `{set}` (CORE, EOLE…), `{id}`. Browse available images at [img.altered-db.com](https://img.altered-db.com). |
| `backgroundUrlIdTransform` | `null` | Optional regex transforms applied to `{id}` before URL substitution. Array of `[regexPattern, replacement]` pairs applied in order. Example: `[["_U_\\d+$", "_U"]]` strips the collector number from unique cards (`ALT_CORE_B_AX_07_U_1698` → `ALT_CORE_B_AX_07_U`). Set to `null` to disable. |
| `embeddedConfig` | `null` | When non-null, **takes full priority** — no config files are fetched. Set by the build script. To force external JSON files instead, pass `embeddedConfig: null` explicitly to `AlteredRender.init()`. |

> **Note — config priority:** `embeddedConfig` always takes precedence over `configBaseUrl`. In the built version, config is embedded and no JSON files are fetched. To override with external config files at runtime, pass `{ embeddedConfig: null, configBaseUrl: "https://…" }` to `AlteredRender.init()`.

> **Note — `configBaseUrl`:** In the built version, `configBaseUrl` is `""` because assets are served from the same folder. If you load the renderer from jsDelivr or the source file directly, `configBaseUrl` defaults to `https://img.altered-db.com/forge/` — a CDN with `Access-Control-Allow-Origin: *`.

### In `altered-card-renderer-proxy.php`

Two variables at the top of the file:

| Variable | Default | Description |
|----------|---------|-------------|
| `$CORS_ORIGIN` | `*` | `Access-Control-Allow-Origin` header value. Restrict to a specific domain if needed. |
| `$ALLOWED_IMG_DOMAINS` | `['altered-prod-eu.s3.amazonaws.com', 'altered-db.com']` | Whitelist of domains the image proxy may fetch from (SSRF protection). Add any CDN or S3 host that serves card images. |
| `$ALLOWED_API_DOMAINS` | `['altered-core-cards-api.toxicity.be', 'api.altered.gg']` | Whitelist of domains the card API may be fetched from. The API URL is set in `RESOURCES.cardApiUrl` in the renderer and passed to the proxy — only whitelisted domains are accepted (SSRF protection). |

---

## Files

| File / Folder | Description |
|------|-------------|
| `altered-card-renderer.js` | The renderer — card config embedded, registers the `<altered-card>` custom element |
| `altered-card-renderer-proxy.php` | PHP proxy — bypasses CORS for API calls and image fetches |
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

## CORS & PHP Proxy

If your page and the card API are on different domains, `altered-card-renderer-proxy.php` (placed alongside `altered-card-renderer.js`) handles both:

```
altered-card-renderer-proxy.php?ref=ALT_CORE_B_AX_04_U_10&locale=fr   → card JSON
altered-card-renderer-proxy.php?img=https://cdn.example.com/card.webp   → proxied image
```

The card API URL comes from `RESOURCES.cardApiUrl` in the renderer — the proxy never has a hardcoded URL. Both image and API domains are validated against whitelists (`$ALLOWED_IMG_DOMAINS`, `$ALLOWED_API_DOMAINS`) to prevent SSRF attacks.

---

## Full documentation

See **[altered-card-renderer-readme.html](altered-card-renderer-readme.html)** for the complete reference.

---

## Contact

Developed by **PolluxTroy**.  
Bug reports, questions and suggestions welcome:

- **GitHub** — open an issue on this repository
- **Discord** — `.polluxtroy`
