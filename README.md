# Altered Card Renderer

> **Active development** — Frequent updates are to be expected; breaking changes may occur between versions.

In Altered TCG, each Unique card is one-of-a-kind: its artwork and stats are specific to a single physical card owned by a player. This renderer lets you **display the full card image** of any Unique — artwork, frame, biome values, effect text — by fetching its data from an API and drawing it into an HTML canvas.

Embed it on any page with a single `<script>` tag.  
No build step, no framework, no dependencies.

**[Live example →](https://cardrenderer.alteredcore.org)**

---

## Embed anywhere with one tag

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

The renderer loads card configs from `https://cdn.alteredcore.org/forge/` and fetches card data and images directly from the API and CDN — both expose `Access-Control-Allow-Origin: *`, so no proxy is needed.

**Attributes on `<altered-card>`:**

| Attribute | Default | Description |
|-----------|---------|-------------|
| `ref` | — | Card reference (required) |
| `locale` | `en` | Language (`en`, `fr`, `es`, `it`, `de`) |
| `collection` | `official` | Frame collection (`official` or `community`) |

> **Limit:** a maximum of 200 unique card references per page are rendered. Elements beyond this limit are silently ignored.

---

## Configuration

All configurable paths and URLs are in the `RESOURCES` object at the top of `altered-card-renderer.js`:

| Key | Default | Description |
|-----|---------|-------------|
| `configBaseUrl` | `https://cdn.alteredcore.org/forge/` | Root URL for config files and assets. |
| `alteredIconsCss` | `assets/fonts/alteredicons.css` | Path to the Altered icon font. |
| `qrcodeLib` | `assets/vendor/qrcodejs/qrcode.min.js` | Path to QRCode.js. |
| `useApiBackground` | `true` | `true` = use the image URL returned by the API. `false` = use a custom URL template (see `backgroundUrl`). |
| `backgroundUrl` | `""` | URL template used when `useApiBackground` is `false`. Variables: `{ref}`, `{locale}`, `{faction}`, `{rarity}`, `{set}`, `{id}`, `{bgref}`, `{framesuffix}`, `{imgfolder}`, `{imgext}`. |
| `backgroundUrlIdTransform` | `null` | Optional regex transforms applied to `{id}`. Array of `[regexPattern, replacement]` pairs. |

**Image quality — `?q=` page URL parameter**

When `useApiBackground` is `false`, add `?q=hd` to the page URL to fetch illustrations from the HD folder (`illustrations_hd/`, `.jpg`). Omit the parameter or use `?q=sd` for standard quality (`illustrations/`, `.webp`).

```
https://your-page.html         → standard quality (default)
https://your-page.html?q=sd   → standard quality
https://your-page.html?q=hd   → HD quality
```

This controls the `{imgfolder}` and `{imgext}` variables in the `backgroundUrl` template.

---

## Files

| File / Folder | Description |
|------|-------------|
| `altered-card-renderer.js` | The renderer — registers the `<altered-card>` custom element |
| `altered-card-renderer-example.html` | Live demo — cards rendered side by side |
| `altered-card-renderer-card.json` | Sample card JSON — shows the expected API response format |
| `altered-card-renderer-readme.html` | **Full documentation** |
| `assets/fonts/` | Card fonts (HapticPro, Jali) + `alteredicons.css` |
| `assets/frames/` | Frame PNGs/SVGs — `OFFICIAL/` and `COMMUNITY/`, organised by faction |
| `assets/biomes/` | Biome badge images |
| `assets/logos/` | Set logos and QR code logo |
| `assets/img/` | Placeholder background shown while images load |
| `assets/vendor/qrcodejs/` | QRCode.js library |

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

Proprietary - Copyright © 2025 PolluxTroy. All rights reserved.

This software is proprietary and confidential. Unauthorized copying,
distribution, modification, or use of this software, in whole or in part,
is strictly prohibited without prior written permission from the copyright holder.

> **Note:** Altered TCG card artwork, frames, and game assets remain the property of their respective owners. This renderer is a fan-made tool and is not affiliated with or endorsed by Equinox.
