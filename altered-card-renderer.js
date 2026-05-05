/* ══════════════════════════════════════════════════════════════
   ALTERED CARD RENDERER — altered-card-renderer.js
   Canvas renderer for Altered TCG cards.
══════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  // Captured synchronously at parse time — used by the <altered-card> custom element.
  const _currentScript = document.currentScript;

  // ── CARD API URL ──────────────────────────────────────────────
  // URL of the card data API. {ref} and {locale} are substituted at runtime.
  // Overridden at build time by build_renderer_for_github.py (value from config/core.json).
  // Can also be set via config/core.json > cardApiUrl at runtime (non-embedded mode).
  const CARD_API_URL = "https://cards.alteredcore.org/api/cards?reference={ref}&locale={locale}";

  // ── EXTERNAL RESOURCES ────────────────────────────────────────
  // Edit these paths to match your deployment.
  // All relative paths resolve against configBaseUrl.
  const RESOURCES = {
    // Base URL where the forge files are served.
    // Trailing slash is optional — it is added automatically.
    // Examples: "https://forge.example.com/"  |  "/forge/"  |  ""
    configBaseUrl: "https://cdn.alteredcore.org/forge/",

    // Path to config/index.json (relative to configBaseUrl)
    configIndex: "config/index.json",

    // Path to the Altered icons CSS font file (relative to configBaseUrl)
    alteredIconsCss: "assets/fonts/alteredicons.css",

    // Path to QRCode.js (relative to configBaseUrl, or absolute URL)
    qrcodeLib: "assets/vendor/qrcodejs/qrcode.min.js",

    // Resolved from CARD_API_URL above (set at build time or via config at runtime).
    cardApiUrl: CARD_API_URL,

    // CORS proxy used by the <altered-card> custom element. Three modes:
    //   null        → auto-detect: altered-card-renderer-proxy.php next to this script (default)
    //   false       → no proxy: cardApiUrl is called directly from the browser (API must allow CORS)
    //   "https://…" → explicit proxy URL
    // Can also be overridden per-page with data-proxy="false" or data-proxy="https://…" on the <script> tag.
    proxyUrl: false,

    // Background image source. Two modes:
    //   true  → use the image URL returned by the card API (default)
    //   false → use a custom URL template defined in backgroundUrl below
    useApiBackground: false,

    // Custom background URL template — used only when useApiBackground is false.
    // Browse available images: https://cdn.alteredcore.org
    // Available variables (substituted at runtime from the API response):
    //   {ref}         → full card reference       (e.g. ALT_ALIZE_A_AX_35_R1)
    //   {locale}      → language code             (e.g. en, fr)
    //   {faction}     → faction short code        (e.g. AX, BR, LY, MU, OR, YZ)
    //   {rarity}      → rarity short code         (e.g. C, R, U, E)
    //   {set}         → set reference             (e.g. CORE, ALIZE, DUSTER)
    //   {id}          → card unique ID from the API (transformed by backgroundUrlIdTransform)
    //   {bgref}       → ref truncated to 5 parts + 1st char of 6th (e.g. ALT_ALIZE_A_AX_35_R)
    //   {framesuffix} → last 2 chars of the active frame filename   (e.g. T1, T2)
    // Example: "https://cdn.example.com/cards/{faction}/{rarity}/{ref}_{locale}.webp"
    backgroundUrl: "https://cdn.alteredcore.org/illustrations/{set}/{bgref}_FRAMELESS_{framesuffix}.webp",
    backgroundUrlBkp: "https://cdn.alteredcore.org/cards/assets/{set}/{id}.webp",

    // Optional transforms applied to {id} before substitution in backgroundUrl.
    // Format: array of [regexPattern, replacement] pairs — applied in order.
    // Example:
    //   [["_U_\\d+", "_U"], ["_R_\\d+", "_R"]]
    //   → ALT_CORE_B_AX_07_U_1698 becomes ALT_CORE_B_AX_07_U
    // Set to null to disable.
    backgroundUrlIdTransform: [
      ["_U_\\d+$", "_U"],
    ],

    // Pre-built config object — set by the build script to skip all config fetches.
    // When non-null, _loadConfig() uses this directly instead of fetching JSON files.
    // Leave as null for normal (remote) operation.
    embeddedConfig: null,
  };

  // ── API MAPPING ───────────────────────────────────────────────
  // ── FETCH MODE ───────────────────────────────────────────────────
  // Controls how <altered-card> elements fetch card data.
  //   1 → one API call per tag (default)
  //   2 → one batch API call for all tags on the page (POST /api/cards/batch)
  const FETCH_MODE = 2;

  // ── BATCH SIZE ───────────────────────────────────────────────────
  // Maximum number of card references sent in a single batch request (FETCH_MODE 2).
  // If more unique refs are collected, the list is split into chunks of this size
  // and one POST is made per chunk (in parallel).
  const BATCH_SIZE = 50;

  // ── BATCH MAX ────────────────────────────────────────────────────
  // Hard cap on the total number of unique references processed in batch mode.
  // Entries beyond this limit are silently dropped — their <altered-card> elements
  // will remain empty. Set to Infinity to disable the cap.
  const BATCH_MAX = 50;

  // ── CACHES ───────────────────────────────────────────────────────
  // Toggle each in-memory cache independently.
  //
  //   CACHE_API    — card JSON from the API (keyed by ref|locale).
  //                  Prevents repeat network requests for the same card.
  //   CACHE_IMAGES — HTMLImageElement objects for frames, logos, frame parts…
  //                  Prevents re-fetching asset images across renders.
  //   CACHE_RENDER — ImageBitmap of the fully rendered card (keyed by ref|locale).
  //                  Subsequent renders (e.g. hover) blit the bitmap instantly,
  //                  skipping image loading and canvas drawing entirely.
  //   CACHE_CANVAS — Skip fetch + render entirely when connectedCallback fires on
  //                  an element that already contains a <canvas> (e.g. DOM move).
  const CACHE_API    = true;
  const CACHE_IMAGES = true;
  const CACHE_RENDER = true;
  const CACHE_CANVAS = true;

  // ── LOADING TEXT ─────────────────────────────────────────────────
  // Text displayed on the placeholder while the card is loading.
  // Set to null or "" to disable.
  //
  //   LOADING_TEXT      — label. Supports \n (multiline) and {ref} (card reference).
  //   LOADING_X         — horizontal position: 0 = left edge, 50 = center, 100 = right edge (%).
  //   LOADING_Y         — vertical position:   0 = top  edge, 50 = center, 100 = bottom edge (%).
  //   LOADING_COLOR     — CSS color of the text. Supports any valid CSS color, including rgba().
  //   LOADING_FONT_SIZE — font size as a % of the canvas width (e.g. 5.5 → ~41px on a 744px canvas).
  const LOADING_TEXT      = "Loading…\n{ref}";
  const LOADING_X         = 50;
  const LOADING_Y         = 70;
  const LOADING_COLOR     = "rgb(255, 255, 255)";
  const LOADING_FONT_SIZE = 5.5;

  // ── ERROR TEXT ───────────────────────────────────────────────────
  // Text displayed on the card canvas when loading fails.
  // Uses the same placeholder background as the loading state.
  //
  //   ERROR_TEXT      — label. Supports \n (multiline), {ref} and {msg} placeholders.
  //   ERROR_X         — horizontal position in % (same scale as LOADING_X).
  //   ERROR_Y         — vertical position in %   (same scale as LOADING_Y).
  //   ERROR_COLOR     — CSS color of the text.
  //   ERROR_FONT_SIZE — font size as a % of the canvas width (same scale as LOADING_FONT_SIZE).
  const ERROR_TEXT      = "Error\n{msg}\n{ref}";
  const ERROR_X         = 50;
  const ERROR_Y         = 50;
  const ERROR_COLOR     = "#e06060";
  const ERROR_FONT_SIZE = 5.5;

  // ── DEFAULT COLLECTION ───────────────────────────────────────────
  // Frame collection used when forge.collection is absent from the JSON.
  // Change this if your cards are not from the "official" collection.
  const DEFAULT_COLLECTION = "official";

  // ── FACTION COLLECTION OVERRIDE ───────────────────────────────────
  // Temporarily override the collection used for specific factions.
  // faction name (from faction.name) → collection key.
  // Factions not listed here fall back to DEFAULT_COLLECTION.
  // Set to {} to disable all overrides.
  const FACTION_COLLECTION = {
    // "Axiom":    "community",
    // "Bravos":   "community",
    // "Lyra":     "community",
    // "Muna":     "community",
    // "Ordis":    "community",
    // "Yzmir":    "community",
  };
  // ─────────────────────────────────────────────────────────────────

  // ── RARITY → ASSET INDEX ─────────────────────────────────────────
  // Maps cardRarity.reference values to an index in the API's assets[]
  // array. Used by the default background resolver in API_MAPPING.
  // Adjust if your API uses different rarity codes or asset order.
  const RARITY_ASSET_INDEX = {
    "COMMON": 0,
    "RARE":   1,
    "UNIQUE": 2,
  };
  // ─────────────────────────────────────────────────────────────────

  // Helper used by API_MAPPING: resolves a field that is either a plain
  // string (locale API, e.g. ?locale=fr) or a localized object { fr, en }.
  function _loc(v, lang) {
    if (v == null) return null;
    if (typeof v === "object") return v[lang] ?? v.en ?? null;
    return v;
  }

  // ── FRAME AUTO-SELECT ─────────────────────────────────────────────
  // Automatically picks a frameType based on the card's rarity and content.
  // Only used when forge.frameType is absent from the API JSON.
  //
  // Structure:
  //   {
  //     "<RARITY_REFERENCE>": [
  //       { frameType: "<id>", test: (data, lang) => boolean },
  //       ...
  //     ]
  //   }
  //
  // Rules are evaluated in order — the first rule whose test() returns true wins.
  // If no rule matches, the renderer falls back to the defaultFrame from core.json.
  //
  // Three helper functions are available inside test():
  //   _eff1(d, lang)  → length (chars) of the main effect text
  //   _eff2(d)        → true if the card has a discard/echo effect, false otherwise
  //   _isExpPerm(d)   → true if type=PERMANENT+subtype=EXPEDITION, or type=EXPEDITION_PERMANENT
  //
  // The rarity key must match cardRarity.reference from the API JSON
  // (e.g. "UNIQUE", "COMMON", "RARE").
  // Returns the visible character count of the main effect text.
  // API tokens ({R}, {J}…) and section separators ([]) are stripped first
  // so the count reflects what is actually rendered on the card, not the raw markup.
  function _eff1(d, l) {
    const raw = _loc(d.mainEffect, l) ?? "";
    const clean = raw
      .replace(/\{[A-Za-z0-9]\}/g, "X") // {R}, {J}… each renders as one icon character
      .replace(/\[\]/g, "")              // [] section separator renders as nothing
      .replace(/ {2,}/g, " ")           // double-space line-break token → single space
      .trim();
    return clean.length;
  }
  function _eff2(d)    { const e = d.echoEffect; return Array.isArray(e) ? e.length > 0 : !!e; }
  // Returns the cardType.reference string (e.g. "CHARACTER", "PERMANENT", "SPELL", "TOKEN", "HERO").
  function _type(d)    { return d.cardType?.reference ?? ""; }
  // Returns true if any entry in cardSubTypes has the given reference (e.g. "EXPEDITION").
  function _subtype(d, ref) { return (d.cardSubTypes ?? []).some(s => s.reference === ref); }
  // Expedition permanent: either type=PERMANENT + subtype=EXPEDITION, or type=EXPEDITION_PERMANENT.
  function _isExpPerm(d) { return (_type(d) === "PERMANENT" && _subtype(d, "EXPEDITION")) || _type(d) === "EXPEDITION_PERMANENT"; }

  const FRAME_AUTO_SELECT = {
    // ── COMMON ────────────────────────────────────────────────────────
    // cardType.reference drives the prefix (char / perm / expperm / spell / tok / hero).
    // For PERMANENT: sub-type "EXPEDITION" selects the expperm_ frames.
    // TOKEN and HERO have a single frame variant each.
    // CHARACTER is the catch-all fallback (no _type() guard on the last four rules).
    "COMMON": [
      // TOKEN — single variant
      { frameType: "tok_c_1",     test: (d)    => _type(d) === "TOKEN" },
      // HERO — single variant
      { frameType: "hero_c_1",    test: (d)    => _type(d) === "HERO" },
      // EXPEDITION PERMANENT
      { frameType: "expperm_c_1", test: (d, l) => _isExpPerm(d) &&  _eff2(d) && _eff1(d, l) <  200 },
      { frameType: "expperm_c_2", test: (d, l) => _isExpPerm(d) &&  _eff2(d) && _eff1(d, l) >= 200 },
      { frameType: "expperm_c_3", test: (d, l) => _isExpPerm(d) && !_eff2(d) && _eff1(d, l) <  200 },
      { frameType: "expperm_c_4", test: (d, l) => _isExpPerm(d) && !_eff2(d) && _eff1(d, l) >= 200 },
      // PERMANENT
      { frameType: "perm_c_1",    test: (d, l) => _type(d) === "PERMANENT" &&  _eff2(d) && _eff1(d, l) <  200 },
      { frameType: "perm_c_2",    test: (d, l) => _type(d) === "PERMANENT" &&  _eff2(d) && _eff1(d, l) >= 200 },
      { frameType: "perm_c_3",    test: (d, l) => _type(d) === "PERMANENT" && !_eff2(d) && _eff1(d, l) <  200 },
      { frameType: "perm_c_4",    test: (d, l) => _type(d) === "PERMANENT" && !_eff2(d) && _eff1(d, l) >= 200 },
      // SPELL
      { frameType: "spell_c_1",   test: (d, l) => _type(d) === "SPELL" &&  _eff2(d) && _eff1(d, l) <  200 },
      { frameType: "spell_c_2",   test: (d, l) => _type(d) === "SPELL" &&  _eff2(d) && _eff1(d, l) >= 200 },
      { frameType: "spell_c_3",   test: (d, l) => _type(d) === "SPELL" && !_eff2(d) && _eff1(d, l) <  200 },
      { frameType: "spell_c_4",   test: (d, l) => _type(d) === "SPELL" && !_eff2(d) && _eff1(d, l) >= 200 },
      // CHARACTER (default — also catches any unknown type)
      { frameType: "char_c_1",    test: (d, l) =>  _eff2(d) && _eff1(d, l) <  200 },
      { frameType: "char_c_2",    test: (d, l) =>  _eff2(d) && _eff1(d, l) >= 200 },
      { frameType: "char_c_3",    test: (d, l) => !_eff2(d) && _eff1(d, l) <  200 },
      { frameType: "char_c_4",    test: (d, l) => !_eff2(d) && _eff1(d, l) >= 200 },
    ],

    // ── RARE ──────────────────────────────────────────────────────────
    // Same logic as COMMON. No TOKEN / HERO frames exist at Rare rarity.
    "RARE": [
      // EXPEDITION PERMANENT
      { frameType: "expperm_r_1", test: (d, l) => _type(d) === "PERMANENT" && _subtype(d, "EXPEDITION") &&  _eff2(d) && _eff1(d, l) <  200 },
      { frameType: "expperm_r_2", test: (d, l) => _type(d) === "PERMANENT" && _subtype(d, "EXPEDITION") &&  _eff2(d) && _eff1(d, l) >= 200 },
      { frameType: "expperm_r_3", test: (d, l) => _type(d) === "PERMANENT" && _subtype(d, "EXPEDITION") && !_eff2(d) && _eff1(d, l) <  200 },
      { frameType: "expperm_r_4", test: (d, l) => _type(d) === "PERMANENT" && _subtype(d, "EXPEDITION") && !_eff2(d) && _eff1(d, l) >= 200 },
      // PERMANENT
      { frameType: "perm_r_1",    test: (d, l) => _type(d) === "PERMANENT" &&  _eff2(d) && _eff1(d, l) <  200 },
      { frameType: "perm_r_2",    test: (d, l) => _type(d) === "PERMANENT" &&  _eff2(d) && _eff1(d, l) >= 200 },
      { frameType: "perm_r_3",    test: (d, l) => _type(d) === "PERMANENT" && !_eff2(d) && _eff1(d, l) <  200 },
      { frameType: "perm_r_4",    test: (d, l) => _type(d) === "PERMANENT" && !_eff2(d) && _eff1(d, l) >= 200 },
      // SPELL
      { frameType: "spell_r_1",   test: (d, l) => _type(d) === "SPELL" &&  _eff2(d) && _eff1(d, l) <  200 },
      { frameType: "spell_r_2",   test: (d, l) => _type(d) === "SPELL" &&  _eff2(d) && _eff1(d, l) >= 200 },
      { frameType: "spell_r_3",   test: (d, l) => _type(d) === "SPELL" && !_eff2(d) && _eff1(d, l) <  200 },
      { frameType: "spell_r_4",   test: (d, l) => _type(d) === "SPELL" && !_eff2(d) && _eff1(d, l) >= 200 },
      // CHARACTER (default)
      { frameType: "char_r_1",    test: (d, l) =>  _eff2(d) && _eff1(d, l) <  200 },
      { frameType: "char_r_2",    test: (d, l) =>  _eff2(d) && _eff1(d, l) >= 200 },
      { frameType: "char_r_3",    test: (d, l) => !_eff2(d) && _eff1(d, l) <  200 },
      { frameType: "char_r_4",    test: (d, l) => !_eff2(d) && _eff1(d, l) >= 200 },
    ],

    // ── EXALTED ───────────────────────────────────────────────────────
    // Currently only one frame variant exists (char_e_1 — Character Exalted, large effect).
    // NOTE: confirm that cardRarity.reference is "EXALTED" in your API.
    "EXALTED": [
      { frameType: "char_e_1", test: () => true },
    ],

    // ── UNIQUE ────────────────────────────────────────────────────────
    // Only Characters exist at Unique rarity — no type check needed.
    // The 200-character threshold separates "short" from "long" main effect text,
    // measured in visible characters (after stripping API tokens and markup).
    // Below 200 chars fits comfortably in the small effect zone (char_u_1 / char_u_3).
    // At 200+ chars the text needs the larger zone (char_u_2 / char_u_4).
    // Adjust this value if your cards use a different font size or text area size.
    "UNIQUE": [
      // Has discard effect + short main effect  (< 200 chars)  → small two-zone frame
      { frameType: "char_u_1", test: (d, l) =>  _eff2(d) && _eff1(d, l) <  200 },
      // Has discard effect + long main effect   (≥ 200 chars)  → large two-zone frame
      { frameType: "char_u_2", test: (d, l) =>  _eff2(d) && _eff1(d, l) >= 200 },
      // No discard effect  + short main effect  (< 200 chars)  → single-zone small frame
      { frameType: "char_u_3", test: (d, l) => !_eff2(d) && _eff1(d, l) <  200 },
      // No discard effect  + long main effect   (≥ 200 chars)  → single-zone large frame
      { frameType: "char_u_4", test: (d, l) => !_eff2(d) && _eff1(d, l) >= 200 },
    ],
  };
  // ─────────────────────────────────────────────────────────────────

  // ── BIOME VARIANT AUTO ────────────────────────────────────────────
  // Maps each biome element ID to the API field that holds its numeric value.
  // Used to compute bgVariant automatically in mountFromApi():
  //   • value == 0          → "zero"
  //   • value == highest    → "best"  (ties: all tied biomes get "best")
  //   • otherwise           → "normal"
  // Set to null to disable auto-detection for a specific biome.
  const BIOME_VARIANT_AUTO = {
    forestValue:   "forestPower",
    mountainValue: "mountainPower",
    oceanValue:    "oceanPower",
  };
  // ─────────────────────────────────────────────────────────────────

  // ── API QR CODE ───────────────────────────────────────────────────
  // Controls QR code rendering when using mountFromApi().
  //
  // visible:
  //   true  → always show the QR code on API-rendered cards
  //   false → always hide it
  //   null  → use the default from config/elements.json (may be hidden)
  //
  // url:
  //   URL template for the QR code. Supports {varName} placeholders.
  //   Each placeholder is replaced by the value defined in `vars` below.
  //   Set to null to use the value from API_MAPPING.values.qrCode instead.
  //
  // vars:
  //   { varName: "dot.path.in.api.json" }
  //   The value at that dot-path is resolved from the API JSON and
  //   substituted for every {varName} occurrence in the url template.
  //   Add any field from the API JSON as a new variable here.
  const API_QR_CODE = {
    visible: true,
    //url:     "https://altered.gg/{locale}/cards/{reference}",
    url:     "https://alteredcore.org/pages/card?ref={reference}&card_lang={lang}",
    vars: {
      reference: "reference",
      locale:    (_d, lang) => ({ en: "en-us", fr: "fr-fr", es: "es-es", it: "it-it", de: "de-de" }[lang] ?? "en-us"),
      lang: (_d, lang) => lang,
      // set:    "set.reference",
    },
  };
  // ─────────────────────────────────────────────────────────────────

  // Default mapping used by mountFromApi() when no mapping is passed.
  // Adapt this block to match the field structure of your external API.
  //
  // Each value is either:
  //   • a dot-path string  →  "a.b.c"  (navigates the JSON object)
  //   • a dot-path with {lang}  →  "name.{lang}"  (lang is resolved first)
  //   • a function  →  (data, lang) => value
  //   • a static value  →  number, object, etc.
  const API_MAPPING = {

    // ── Language ──────────────────────────────────────────────────
    // Dot-path that reads the language code from the API JSON.
    // Expected to be provided in the "forge" section added by the
    // API alongside its regular data (e.g. forge.lang = "en").
    // Used to substitute {lang} in all other dot-paths.
    lang: "forge.lang",

    // Language used when forge.lang is absent from the JSON.
    langFallback: "en",

    // ── Frame selection ───────────────────────────────────────────
    // Which forge config to use for this card.
    // faction    — read from cardGroup.faction.name in the API JSON
    // frameType  — from forge.frameType if present, otherwise auto-selected
    //              via FRAME_AUTO_SELECT based on rarity and card content
    // collection — optional in forge, defaults to "official"
    selection: (d, lang) => {
      const faction      = d.faction?.name ?? "";
      const forgeCol     = d.forge?.collection;
      const collection   = (forgeCol && forgeCol !== DEFAULT_COLLECTION)
        ? forgeCol
        : (FACTION_COLLECTION[faction] || DEFAULT_COLLECTION);
      let   frameType   = d.forge?.frameType ?? null;

      if (!frameType) {
        const rarity = d.cardRarity?.reference ?? d.rarity?.reference ?? "";
        const rules  = FRAME_AUTO_SELECT[rarity] || [];
        const match  = rules.find(r => r.test(d, lang));
        frameType    = match?.frameType ?? null;
      }

      return {
        faction,
        type: frameType ? `${collection}::${frameType}` : "",
      };
    },

    // ── Background image ──────────────────────────────────────────
    // URL of the card illustration. Dot-path or function. Optional.
    // The asset index is determined by cardRarity.reference using
    // RARITY_ASSET_INDEX (COMMON→0, RARE→1, UNIQUE→2).
    // Falls back to imagePath, which can be a plain string (locale API)
    // or a localized object { fr: "…", en: "…" }.
    background: (d, lang) => {
      if (Array.isArray(d.assets) && d.assets.length) {
        const rarity = d.cardRarity?.reference ?? d.cardGroup?.rarity?.reference ?? "";
        const idx    = RARITY_ASSET_INDEX[rarity] ?? 0;
        return d.assets[idx] ?? d.assets[0] ?? null;
      }
      const ip = d.imagePath;
      return (ip && typeof ip === "object") ? (ip[lang] ?? ip.en ?? null) : (ip ?? null);
    },

    // ── Set logo ──────────────────────────────────────────────────
    // Dot-path or function returning a set code string.
    // The code is matched against the `code` (or `set`) field of each
    // entry in config/ui.json → setLogos[].
    // Example: if the API has set.reference = "CORE" and ui.json has
    //   { "code": "CORE", "file": "assets/logos/roc.svg" }
    // the logo is loaded automatically. Return null to show no logo.
    setCode: "set.reference",

    // ── Background transform ──────────────────────────────────────
    // Fallback values used when forge.bgTransform is absent from the JSON.
    // zoom > 100 crops the image (fills the card without letterboxing).
    // x / y = focal point in % (50/50 = center).
    // flipX = mirror the image horizontally.
    bgTransform: (d) => ({
      zoom:  d.forge?.bgTransform?.zoom  ?? 100,
      x:     d.forge?.bgTransform?.x     ?? 50,
      y:     d.forge?.bgTransform?.y     ?? 50,
      flipX: d.forge?.bgTransform?.flipX ?? false,
    }),

    // ── Values ────────────────────────────────────────────────────
    // Map forge element IDs → dot-path or function.
    // Element IDs are defined in config/elements.json.
    // Fields that can be either a plain string (locale API, e.g. ?locale=fr)
    // or a localized object ({ fr: "…", en: "…" }) are handled with _loc().
    values: {
      cardName:      (d, lang) => _loc(d.name, lang) ?? "",
      handCost:      "mainCost",
      reserveCost:   "recallCost",
      forestValue:   "forestPower",
      mountainValue: "mountainPower",
      oceanValue:    "oceanPower",
      effects:       (d, lang) => _loc(d.mainEffect, lang) ?? "",
      discardEffects:(d, lang) => {
        const e = d.echoEffect;
        if (!e || (Array.isArray(e) && e.length === 0)) return null;
        return Array.isArray(e) ? e.map(s => _loc(s, lang)).filter(Boolean).join("\n") : (_loc(e, lang) || null);
      },
      cardId:        d => {
        if (d.collectorNumberFormatedId) return d.collectorNumberFormatedId;
        // Fallback: derive from reference — e.g. ALT_EOLE_B_OR_109_U_374 + set.code=ROC → ROC-OR-109-U-374
        const parts     = (d.reference ?? "").split("_");
        const collector = parts.length >= 6 ? parts.slice(3).join("-") : (d.reference ?? "");
        const setCode   = d.set?.code ?? "";
        return setCode ? `${setCode}-${collector}` : collector;
      },
      // qrCode — handled by API_QR_CODE block (url template + visibility).
      // Define here only as a fallback when API_QR_CODE.url is null.
      cardType:      (d, lang) => {
        const type = _loc(d.cardType?.name, lang) ?? "";
        const subs = (d.cardSubTypes || []).map(s => _loc(s.name, lang) ?? "").filter(Boolean).join(", ");
        return subs ? `${type} - ${subs}` : type;
      },
      artistName:    d => d.artists?.[0]?.name ?? null,
    },
  };

  // ── API TEXT TOKENS ───────────────────────────────────────────
  // Maps shorthand tokens found in external API text fields to the
  // PUA unicode characters used by the alteredicons font.
  // Applied automatically by mountFromApi() on all text values.
  // Add or remove entries to match your API's notation.
  //
  // Each value can be:
  //   • a plain string  →  the PUA character, drawn at the default icon size
  //   • { char, size }  →  PUA character + size multiplier relative to the
  //                        current font size (e.g. 0.8 = 80%, 1.2 = 120%)
  //     Example:  "{R}": { char: "\ue024", size: 0.85 }
  const API_TEXT_TOKENS = {
    // ── Action / keyword icons ──────────────────────────────────
    // Size driven by alteredIconsScale / alteredIconsSizes in core.json
    "{R}": "\ue024",   // Reserve
    "{J}": "\ue026",   // Arrow
    "{H}": "\ue023",   // Hand
    "{T}": "\ue027",   // T icon
    "{D}": "\ue029",   // D icon
    "{O}": "\ue02d",   // O icon
    "{M}": "\ue025",   // M icon
    "{V}": "\ue037",   // V icon
    "{I}": "\ue02f",   // I icon
    // Case-insensitive variants (Altered API sometimes uses lowercase)
    "{r}": "\ue024",
    "{j}": "\ue026",
    "{h}": "\ue023",
    "{t}": "\ue027",
    "{d}": "\ue029",
    // ── Number icons (circled) ──────────────────────────────────
    "{0}": "\u24ea",   // ⓪  — size driven by circledNumberScale in core.json
    "{1}": "\u2776",   // ❶
    "{2}": "\u2777",   // ❷
    "{3}": "\u2778",   // ❸
    "{4}": "\u2779",   // ❹
    "{5}": "\u277a",   // ❺
    "{6}": "\u277b",   // ❻
    "{7}": "\u277c",   // ❼
    "{8}": "\u277d",   // ❽
    "{9}": "\u277e",   // ❾
  };

  // ── API TEXT TRANSFORMS ───────────────────────────────────────
  // Regex-based transformations applied to API text AFTER token
  // substitution. Each entry has a `pattern` (RegExp) and a
  // `replacement` (string, may use $1 etc. for capture groups).
  // The resulting string is treated as HTML by the richtext renderer.
  // Applied automatically by mountFromApi() on all richtext values.
  const API_TEXT_TRANSFORMS = [
    // #text#  → colored highlight (Altered gold)
    { pattern: /#(.*?)#/g,       replacement: '<span style="color:#C37424">$1</span>' },
    // {X}     → large bold X (variable cost)
    { pattern: /\{X\}/g,         replacement: '<strong>X</strong>' },
    // (text)  → italic inside parens
    { pattern: /\(([^)]+)\)/g,   replacement: '(<em>$1</em>)' },
    // [[text]] → bold + underlined (keyword link)
    { pattern: /\[\[(.*?)\]\]/g, replacement: '<strong><u>$1</u></strong>' },
    // em dash → hyphen
    { pattern: /—/g,             replacement: '-' },
    // double space → line break \n  (must run before [] substitution)
    { pattern: /  /g,            replacement: '\n' },
    // [] section separator → single space  (after double-space, before [text])
    { pattern: /\[\]/g,          replacement: ' ' },
    // [text]  → bold (keyword)
    { pattern: /\[(.*?)\]/g,     replacement: '<strong>$1</strong>' },
  ];
  // ─────────────────────────────────────────────────────────────

  // ── Card canvas dimensions (px at 96 dpi) ────────────────────
  const CARD_W = 744;
  const CARD_H = 1039;

  // ── Module-level shared state ─────────────────────────────────
  // Config and assets are loaded once and reused by all card instances.
  let _opts          = { ...RESOURCES };   // merged at init()
  let _cfg           = null;               // merged config object
  let _cfgPromise    = null;               // in-flight load promise
  let _loadedIndex   = null;               // raw index.json (exposed for app.js lang loading)
  let _fontNames     = { regular: "serif", bold: "serif", italic: "serif", circled: null };
  let _biomeImages   = null;               // { forest:{}, mountain:{}, ocean:{} }
  let _biomePromise  = null;
  let _qrcodePromise = null;               // dynamic script load
  let _iconCssInjected  = false;
  let _placeholderImg   = null;   // pre-loaded custom placeholder image (from core.json > placeholderBg)

  // ── Image cache ───────────────────────────────────────────────────
  // Keyed by URL. Stores Promises resolving to HTMLImageElement (or null on error).
  // Shared across all card renders so frames, logos and frame parts are never
  // fetched twice, even when a new <altered-card> element is created (e.g. hover).
  const _imgCache = new Map();

  // ── Render cache ──────────────────────────────────────────────────
  // Keyed by "ref|locale". Stores Promises resolving to ImageBitmap.
  // After the first full render of a card, the result is captured as a GPU bitmap.
  // Subsequent renders (e.g. hover overlay) just blit the bitmap onto a new canvas —
  // no image loading, no canvas drawing.
  const _renderCache = new Map();

  // Set during _renderCard() so helpers can access config without
  // threading it through every function signature.
  let _activeCfg = null;


  // ══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════

  const AlteredRender = {

    /**
     * Load shared config, fonts and biome images.
     * Optional — mount() calls this automatically if needed.
     *
     * @param {object} options   Override any key from RESOURCES.
     * @returns {Promise<object>} The merged config object.
     */
    async init(options = {}) {
      Object.assign(_opts, options);
      _cfg         = await _ensureConfig();
      _biomeImages = await _ensureBiomeImages();
      return _cfg;
    },

    /**
     * Render a card into a container element.
     * Creates a responsive canvas (width: 100%, ratio locked).
     *
     * @param {HTMLElement} container  Target DOM element.
     * @param {object}      cardJson   Card config JSON (forge export).
     * @param {object}      [options]  Same keys as RESOURCES (configBaseUrl, etc.).
     * @returns {Promise<{canvas, state, redraw}>}
     */
    async mount(container, cardJson, options = {}) {
      if (Object.keys(options).length) Object.assign(_opts, options);

      // Ensure shared resources are ready
      _cfg          = await _ensureConfig();
      _biomeImages  = await _ensureBiomeImages();

      // Create responsive canvas inside the container
      const canvas = _createResponsiveCanvas(container);
      const ctx    = canvas.getContext("2d");

      // Build per-card state from JSON + shared config
      const state = _buildStateFromJson(_cfg, cardJson);
      state.fontNames   = { ..._fontNames };
      state.biomeImages = _biomeImages;

      // Draw placeholder while images load
      _drawPlaceholderBg(ctx, CARD_W, CARD_H, cardJson._ref);

      // Load all assets (frame, bg, logo, stamps, QR…)
      await _loadCardAssets(state, cardJson);

      // First render
      _renderCard(state, canvas, ctx);

      return {
        canvas,
        state,
        /** Re-render after manually updating state.values / state.settings */
        redraw() { _renderCard(state, canvas, ctx); },
      };
    },

    /**
     * Mount a card from an external API JSON using a field mapping.
     *
     * The mapping describes how to extract values from the API JSON and
     * which forge frame type to use. Each value can be a dot-path string
     * ("cardGroup.name.en") or a function (data) => value.
     *
     * @param {HTMLElement} container
     * @param {object}      apiJson    Raw JSON from the external API.
     * @param {object}      mapping    Field mapping descriptor (see doc).
     * @param {object}      [options]  Same keys as RESOURCES.
     *
     * mapping shape:
     * {
     *   // Frame selection — required.
     *   // Return { faction, type } where type is the forge internal key
     *   // "collection::Display Name", e.g. "official::Character Unique 1".
     *   selection: (data) => ({ faction: "Axiom", type: "official::Character Unique 1" })
     *             // or a static object: { faction: "Axiom", type: "official::..." }
     *
     *   // Background image URL — dot-path or function. Optional.
     *   background: "imagePath.en",
     *
     *   // Set logo — dot-path or function returning a set code string. Optional.
     *   // Matched against the `code` (or `set`) field in config/ui.json → setLogos[].
     *   setCode: "set.reference",
     *
     *   // Background transform. Optional.
     *   bgTransform: { zoom: 110, x: 50, y: 50 },
     *
     *   // Values — forge element id → dot-path string or function.
     *   values: {
     *     cardName:      "cardGroup.name.en",
     *     handCost:      "cardGroup.mainCost",
     *     reserveCost:   "cardGroup.recallCost",
     *     forestValue:   "cardGroup.forestPower",
     *     mountainValue: "cardGroup.mountainPower",
     *     oceanValue:    "cardGroup.oceanPower",
     *     effects:       "cardGroup.effect1.text.en",
     *     discardEffects:"cardGroup.effect2.text.en",
     *     cardId:        d => [d.set?.code, d.cardGroup?.slug].filter(Boolean).join('-'),
     *     qrCode:        "qrUrlDetail",
     *     cardType:      (d) => d.cardGroup.cardSubTypes.map(s => s.name.en).join(", "),
     *   },
     * }
     *
     * @returns {Promise<{canvas, state, redraw}>}
     */
    async mountFromApi(container, apiJson, mapping = API_MAPPING, options = {}) {
      if (Object.keys(options).length) Object.assign(_opts, options);
      _cfg         = await _ensureConfig();
      _biomeImages = await _ensureBiomeImages();

      // Apply per-card overrides from cards_data.json (deep-merged into forge).
      const _cardsOverride = _matchCardsData(apiJson.reference, _cfg.cardsData);
      if (_cardsOverride) {
        apiJson = { ...apiJson, forge: _deepMerge(apiJson.forge || {}, _cardsOverride) };
      }

      const cardJson = _apiToCardJson(apiJson, mapping);
      return this.mount(container, cardJson);
    },

    /**
     * Low-level render — called by app.js to share the pipeline.
     * Accepts the App object directly (it satisfies the state interface).
     *
     * @param {object}                  state  Must have: config, elements,
     *   fontNames, images, biomeImages, settings, values, overlaySettings,
     *   bg, qrSource, activeTypeCfg, activeFrameTypeId, _qrLogoOverride.
     * @param {HTMLCanvasElement}        canvas
     * @param {CanvasRenderingContext2D} ctx
     */
    _renderCard(state, canvas, ctx) {
      _renderCard(state, canvas, ctx);
    },

    /** Draw placeholder background — exposed for app.js compatibility */
    _drawPlaceholderBg(ctx, W, H, ref) {
      _drawPlaceholderBg(ctx, W, H, ref);
    },

    // ── Getters — for app.js to sync its state after init() ──────
    /** Raw index.json — app.js uses it to know which lang file to load */
    get loadedIndex() { return _loadedIndex; },
    /** Font name mapping after fonts are loaded */
    get fontNames()   { return { ..._fontNames }; },
    /** Biome images after they are loaded */
    get biomeImages() { return _biomeImages; },
  };


  // ══════════════════════════════════════════════════════════════
  // CONFIG LOADING
  // ══════════════════════════════════════════════════════════════

  async function _ensureConfig() {
    if (_cfg) return _cfg;
    if (!_cfgPromise) _cfgPromise = _loadConfig();
    _cfg = await _cfgPromise;
    await _injectAlteredIconsCss();
    await _loadFonts(_cfg.font);
    // Pre-load custom placeholder image if configured
    const ph = _cfg.placeholderBg;
    if (ph?.enabled && ph.file) {
      _placeholderImg = await new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload  = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = _resolveUrl(ph.file, _opts.configBaseUrl);
      });
    }
    return _cfg;
  }

  async function _loadConfig() {
    if (_opts.embeddedConfig) {
      const config = _opts.embeddedConfig;
      if (config.cardApiUrl) RESOURCES.cardApiUrl = config.cardApiUrl;
      return config;
    }

    const base     = _opts.configBaseUrl;
    const indexUrl = _resolveUrl(_opts.configIndex, base);

    let index;
    try {
      const r = await fetch(indexUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      index = await r.json();
      _loadedIndex = index;   // exposed for app.js lang loading
    } catch (err) {
      throw new Error(`AlteredRender: cannot load config index (${indexUrl}): ${err.message}`);
    }

    // Load all config files in parallel (same merge logic as app.js)
    const allFiles = [
      ...(index.core     || []),
      ...(index.layout   || []),
      ...(index.factions || []),
    ];

    const results = await Promise.all(
      allFiles.map(async fname => {
        const url  = _resolveUrl(`config/${fname}`, base);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Config ${fname}: HTTP ${resp.status}`);
        return resp.json();
      })
    );

    // Deep merge into a single config object
    const config = {};
    for (const part of results) {
      for (const [key, val] of Object.entries(part)) {
        if (key.startsWith("_")) continue;
        if (key === "factions") {
          if (!config.factions) config.factions = {};
          for (const [factionName, factionData] of Object.entries(val)) {
            if (!config.factions[factionName]) {
              config.factions[factionName] = { ...factionData, types: {} };
            }
            for (const [typeName, typeData] of Object.entries(factionData.types || {})) {
              if (!typeData.collection) continue;
              const key2 = `${typeData.collection}::${typeName}`;
              config.factions[factionName].types[key2] = typeData;
            }
          }
        } else {
          config[key] = val;
        }
      }
    }

    if (config.cardApiUrl) RESOURCES.cardApiUrl = config.cardApiUrl;

    // Load cards_data.json separately — stored as config.cardsData, not merged
    const cardsFiles = index.cards || [];
    if (cardsFiles.length) {
      const cardsResults = await Promise.all(
        cardsFiles.map(async fname => {
          const url  = _resolveUrl(`config/${fname}`, base);
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`Config ${fname}: HTTP ${resp.status}`);
          return resp.json();
        })
      );
      config.cardsData = {};
      for (const part of cardsResults) {
        for (const [key, val] of Object.entries(part)) {
          if (!key.startsWith("_")) config.cardsData[key] = val;
        }
      }
    }

    return config;
  }

  // ── Per-card override helpers ─────────────────────────────────

  /** Recursively deep-merge source into target (returns new object). */
  function _deepMerge(target, source) {
    const out = Object.assign({}, target);
    for (const [k, v] of Object.entries(source)) {
      if (v !== null && typeof v === "object" && !Array.isArray(v) &&
          out[k] !== null && typeof out[k] === "object" && !Array.isArray(out[k])) {
        out[k] = _deepMerge(out[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /**
   * Find all patterns in cardsData matching ref, merge them from least
   * to most specific, and return the combined override (or null if none).
   */
  function _matchCardsData(ref, cardsData) {
    if (!cardsData || !ref) return null;
    const matches = [];
    for (const [pattern, data] of Object.entries(cardsData)) {
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1);
        if (ref.startsWith(prefix)) matches.push({ specificity: prefix.length, data });
      } else if (pattern === ref) {
        matches.push({ specificity: Infinity, data });
      }
    }
    if (!matches.length) return null;
    matches.sort((a, b) => a.specificity - b.specificity);
    let merged = {};
    for (const { data } of matches) merged = _deepMerge(merged, data);
    return merged;
  }


  // ══════════════════════════════════════════════════════════════
  // FONT LOADING
  // ══════════════════════════════════════════════════════════════

  async function _loadFonts(fontCfg) {
    if (!fontCfg) return;
    const base     = _opts.configBaseUrl;
    const fallback = fontCfg.fallback || "serif";
    const isLegacy = !!fontCfg.file;

    if (isLegacy) {
      const name = await _loadOneFontFace(fontCfg.name, _resolveUrl(fontCfg.file, base), fallback);
      _fontNames.regular = _fontNames.bold = _fontNames.italic = name;
      return;
    }

    await Promise.all(["regular", "bold", "italic", "circled"].map(async v => {
      const cfg = fontCfg[v];
      if (cfg?.file) {
        _fontNames[v] = await _loadOneFontFace(cfg.name, _resolveUrl(cfg.file, base), fallback);
      } else if (v !== "circled") {
        _fontNames[v] = _fontNames.regular || fallback;
      }
      // circled stays null if not configured — _segFont falls back to baseFont
    }));
  }

  async function _loadOneFontFace(name, url, fallback) {
    try {
      const face = new FontFace(name, `url("${url}")`);
      await face.load();
      document.fonts.add(face);
      return name;
    } catch {
      console.warn(`AlteredRender: font "${name}" not found at ${url}, using ${fallback}`);
      return fallback;
    }
  }

  async function _injectAlteredIconsCss() {
    if (_iconCssInjected) return;
    _iconCssInjected = true;
    const href = _resolveUrl(_opts.alteredIconsCss, _opts.configBaseUrl);
    if (!document.querySelector(`link[href="${href}"]`)) {
      await new Promise(resolve => {
        const link  = document.createElement("link");
        link.rel    = "stylesheet";
        link.href   = href;
        link.onload  = resolve;
        link.onerror = resolve; // don't block the pipeline on a missing file
        document.head.appendChild(link);
      });
    }
    // Force the browser to actually download the icon font file.
    // CSS fonts are lazy-loaded and won't be fetched until the browser
    // sees DOM text using them — canvas draws don't trigger this.
    // Passing a PUA character ensures the correct unicode range is loaded.
    try {
      await document.fonts.load('1em "Font Awesome Kit"', '\ue024');
    } catch { /* ignore — font may be unavailable in some environments */ }
  }


  // ══════════════════════════════════════════════════════════════
  // BIOME IMAGE LOADING
  // ══════════════════════════════════════════════════════════════

  async function _ensureBiomeImages() {
    if (_biomeImages) return _biomeImages;
    if (!_biomePromise) _biomePromise = _loadBiomeImages(_cfg?.biomeBackgrounds);
    return (_biomeImages = await _biomePromise);
  }

  async function _loadBiomeImages(bgs) {
    const result = { forest: {}, mountain: {}, ocean: {} };
    if (!bgs) return result;

    const isPerBiome = bgs.forest || bgs.mountain || bgs.ocean;
    const base       = _opts.configBaseUrl;

    const loadImg = (biomeKey, variant, file) => {
      if (!file) return Promise.resolve();
      return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload  = () => { result[biomeKey][variant] = img; resolve(); };
        img.onerror = () => resolve();
        img.src = _resolveUrl(file, base);
      });
    };

    const jobs = [];
    if (isPerBiome) {
      for (const biomeKey of ["forest", "mountain", "ocean"]) {
        const biomeCfg = bgs[biomeKey];
        if (!biomeCfg) continue;
        for (const [variant, val] of Object.entries(biomeCfg)) {
          const file = typeof val === "string" ? val : val?.file;
          if (file) jobs.push(loadImg(biomeKey, variant, file));
        }
      }
    } else {
      // Legacy flat format — same images for all 3 biomes
      for (const biomeKey of ["forest", "mountain", "ocean"]) {
        for (const [variant, file] of Object.entries(bgs)) {
          if (typeof file === "string") jobs.push(loadImg(biomeKey, variant, file));
        }
      }
    }

    await Promise.all(jobs);
    return result;
  }


  // ══════════════════════════════════════════════════════════════
  // API MAPPING
  // ══════════════════════════════════════════════════════════════

  /**
   * Resolve a mapping ref against an API JSON object.
   * ref can be:
   *   - a dot-path string  : "cardGroup.name.en"
   *   - a function         : (data) => data.cardGroup.name.en
   *   - any other value    : returned as-is
   */
  function _applyTokens(text, isRich = false) {
    if (!text) return text;
    let out = text;
    for (const [token, val] of Object.entries(API_TEXT_TOKENS)) {
      const char = typeof val === "string" ? val : val.char;
      let replacement = char;
      if (isRich && char) {
        const cp = char.codePointAt(0);
        if (_isPUA(cp)) {
          const perScale = (_activeCfg?.alteredIconsSizes?.[_iconLabel(cp)]) ?? 1.0;
          const scale    = (_activeCfg?.alteredIconsScale ?? 1.0) * perScale;
          replacement = `<span style="font-size:${scale}em">${char}</span>`;
        } else if (_isCircledNumber(cp)) {
          const scale = _activeCfg?.circledNumberScale ?? 1.0;
          replacement = `<span style="font-size:${scale}em">${char}</span>`;
        }
      }
      out = out.split(token).join(replacement);
    }
    return out;
  }

  function _applyTransforms(text) {
    if (!text) return text;
    let out = text;
    for (const { pattern, replacement } of API_TEXT_TRANSFORMS) {
      out = out.replace(pattern, replacement);
    }
    return out;
  }

  function _resolve(ref, data, lang) {
    if (typeof ref === "function") return ref(data, lang);
    if (typeof ref === "string") {
      // Substitute {lang} placeholder before navigating the path
      const path = lang ? ref.replace(/\{lang\}/g, lang) : ref;
      let cur = data;
      for (const key of path.split(".")) {
        if (cur == null) return null;
        cur = cur[key];
      }
      return cur ?? null;
    }
    return ref ?? null;
  }

  /**
   * Transform an external API JSON into a forge-compatible card JSON
   * using the provided mapping descriptor.
   */
  function _apiToCardJson(apiJson, mapping) {
    // ── Language ──────────────────────────────────────────────────
    // Resolve the language code first so it can be used as {lang}
    // in all subsequent dot-path resolutions.
    const fallback = mapping.langFallback || "en";
    const lang = mapping.lang != null
      ? (_resolve(mapping.lang, apiJson) || fallback)
      : fallback;

    // ── Selection (faction + frame type) ─────────────────────────
    const sel  = _resolve(mapping.selection, apiJson, lang) || {};
    const type = sel.type || "";
    // If user passes collection + typeName separately, auto-build the internal key
    const internalType = type.includes("::")
      ? type
      : sel.collection && sel.typeName
        ? `${sel.collection}::${sel.typeName}`
        : type;

    // ── Background image URL ──────────────────────────────────────
    let bgUrl, bgBkpUrl;
    if (_opts.useApiBackground === false && _opts.backgroundUrl) {
      const rarityRef   = apiJson.cardRarity?.reference ?? apiJson.rarity?.reference ?? "";
      const rarityShort = { COMMON: "C", RARE: "R", UNIQUE: "U", EXALTED: "E" }[rarityRef] ?? rarityRef;
      const factionCode = apiJson.faction?.code ?? "";
      let cardId = apiJson.reference ?? "";
      if (_opts.backgroundUrlIdTransform) {
        for (const [pat, rep] of _opts.backgroundUrlIdTransform) {
          cardId = cardId.replace(new RegExp(pat), rep);
        }
      }
      // {bgref} — reference truncated to 5 parts + first char of 6th
      // e.g. ALT_ALIZE_A_AX_35_R1 → ALT_ALIZE_A_AX_35_R
      const refParts = (apiJson.reference ?? "").split("_");
      const bgref = refParts.length >= 6
        ? refParts.slice(0, 5).join("_") + "_" + refParts[5].charAt(0)
        : (apiJson.reference ?? "");
      // {framesuffix} — last 2 chars of the active frame filename (e.g. T1, T2)
      const factionCfg = _cfg?.factions?.[sel.faction] || {};
      let resolvedTypeCfg = factionCfg.types?.[internalType] || null;
      if (!resolvedTypeCfg && internalType?.includes("::")) {
        const [col, ftKey] = internalType.split("::");
        resolvedTypeCfg = Object.values(factionCfg.types || {}).find(
          t => t.collection === col && t.frameType === ftKey
        ) || null;
      }
      const frameBase    = (resolvedTypeCfg?.frameFile || "").split("/").pop().replace(/\.[^.]+$/, "");
      const framesuffix  = frameBase.slice(-2);
      let rawUrl = _opts.backgroundUrl
        .replace("{ref}",         apiJson.reference ?? "")
        .replace("{locale}",      lang)
        .replace("{faction}",     factionCode)
        .replace("{rarity}",      rarityShort)
        .replace("{id}",          cardId)
        .replace("{set}",         apiJson.set?.reference ?? "")
        .replace("{bgref}",       bgref)
        .replace("{framesuffix}", framesuffix);
      // Proxy the custom URL if a proxy is in use (CORS)
      const proxy = _opts._resolvedProxy;
      bgUrl = (proxy && rawUrl) ? proxy + "?img=" + encodeURIComponent(rawUrl) : rawUrl;
      // Backup URL — used if the primary fails to load
      if (_opts.backgroundUrlBkp) {
        let cardIdBkp = apiJson.reference ?? "";
        if (_opts.backgroundUrlIdTransform) {
          for (const [pat, rep] of _opts.backgroundUrlIdTransform) {
            cardIdBkp = cardIdBkp.replace(new RegExp(pat), rep);
          }
        }
        const rawBkp = _opts.backgroundUrlBkp
          .replace("{ref}",         apiJson.reference ?? "")
          .replace("{locale}",      lang)
          .replace("{faction}",     factionCode)
          .replace("{rarity}",      rarityShort)
          .replace("{id}",          cardIdBkp)
          .replace("{set}",         apiJson.set?.reference ?? "")
          .replace("{bgref}",       bgref)
          .replace("{framesuffix}", framesuffix);
        bgBkpUrl = (proxy && rawBkp) ? proxy + "?img=" + encodeURIComponent(rawBkp) : rawBkp;
      }
    } else {
      bgUrl = mapping.background != null
        ? _resolve(mapping.background, apiJson, lang)
        : null;
    }

    // ── Set logo code ─────────────────────────────────────────────
    const setCode = mapping.setCode != null
      ? (_resolve(mapping.setCode, apiJson, lang) ?? null)
      : null;

    // ── Background transform ──────────────────────────────────────
    const bgTransform = mapping.bgTransform
      ? _resolve(mapping.bgTransform, apiJson, lang)
      : { zoom: 100, x: 50, y: 50 };

    // ── Values → globalDefaults ───────────────────────────────────
    // Only value/url is set per element — all visual settings (x, y,
    // fontSize, color…) come from the frame type defaults in the config.
    const elements      = _cfg?.elements || [];
    const globalDefaults = {};

    for (const [elementId, ref] of Object.entries(mapping.values || {})) {
      const raw = _resolve(ref, apiJson, lang);
      const el  = elements.find(e => e.id === elementId);
      if (raw == null) {
        // Field absent from API JSON — hide the element entirely.
        globalDefaults[elementId] = { visible: false };
      } else {
        const val = String(raw);
        const isRich = el?.inputType === "richtext";
        globalDefaults[elementId] = el?.inputType === "qr"
          ? { url: val }
          : { value: isRich ? _applyTransforms(_applyTokens(val, true)) : _applyTokens(val) };
      }
    }

    // ── Biome bgVariant auto-detection ───────────────────────────
    // Rules (applied per-biome, comparing all 3 values together):
    //   zero   : value == 0
    //   best   : unique max AND at least 2 non-zero biomes
    //   small  : unique min (non-zero) AND no biome is at zero
    //   normal : everything else
    if (BIOME_VARIANT_AUTO) {
      const nums = {};
      for (const [elId, path] of Object.entries(BIOME_VARIANT_AUTO)) {
        if (!path) continue;
        const raw = _resolve(path, apiJson, lang);
        nums[elId] = raw != null ? Number(raw) : null;
      }
      const defined   = Object.values(nums).filter(v => v != null);
      const nonZero   = defined.filter(v => v > 0);
      const maxVal    = defined.length ? Math.max(...defined) : null;
      const minVal    = nonZero.length ? Math.min(...nonZero) : null;
      const maxCount  = defined.filter(v => v === maxVal).length;
      const minCount  = nonZero.filter(v => v === minVal).length;
      const allNonZero = defined.length > 0 && !defined.some(v => v === 0);
      for (const [elId, val] of Object.entries(nums)) {
        if (val == null) continue;
        let variant;
        if (val === 0)                                              variant = "zero";
        else if (val === maxVal && maxCount === 1 && nonZero.length >= 2) variant = "best";
        else if (val === minVal && minCount === 1 && allNonZero)   variant = "small";
        else                                                        variant = "normal";
        if (globalDefaults[elId]) {
          globalDefaults[elId].bgVariant = variant;
        } else {
          globalDefaults[elId] = { bgVariant: variant };
        }
      }
    }

    // ── QR code — API_QR_CODE template ───────────────────────────
    if (API_QR_CODE) {
      const qrEntry = globalDefaults.qrCode || {};

      if (API_QR_CODE.url != null) {
        // Resolve all template variables from the API JSON
        const vars = {};
        for (const [k, path] of Object.entries(API_QR_CODE.vars || {})) {
          const v = _resolve(path, apiJson, lang);
          vars[k] = v != null ? String(v) : "";
        }
        qrEntry.url = API_QR_CODE.url.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
      }

      if (API_QR_CODE.visible != null) {
        qrEntry.visible = Boolean(API_QR_CODE.visible);
      }

      globalDefaults.qrCode = qrEntry;
    }

    // ── Assemble forge card JSON ──────────────────────────────────
    const cardJson = {
      _type: "card-config",
      _ref: apiJson.reference || "",
      _selection: {
        faction:     sel.faction    || "",
        collection:  sel.collection || "official",
        type:        internalType,
        setCode,
        bgTransform,
      },
      globalDefaults,
    };

    if (bgUrl || bgBkpUrl) cardJson._urls = { bg: bgUrl || null, bgBkp: bgBkpUrl || null };

    return cardJson;
  }


  // ══════════════════════════════════════════════════════════════
  // STATE BUILDING
  // ══════════════════════════════════════════════════════════════

  /**
   * Build a render-state object from card JSON + merged config.
   * The state interface matches what app.js's App object exposes,
   * so _renderCard() works with both.
   */
  function _buildStateFromJson(config, cardJson) {
    const G    = config.globalDefaults  || {};
    const defs = cardJson.globalDefaults || {};
    const sel  = cardJson._selection    || {};

    // Resolve frame type defaults for overlay settings
    const factionCfg = config.factions?.[sel.faction] || {};
    // Primary lookup: full display key "collection::Display Name (…)"
    // Fallback: short key "collection::frameTypeId" (e.g. "official::char_u_1")
    let typeCfg = factionCfg.types?.[sel.type] || null;
    if (!typeCfg && sel.type?.includes("::")) {
      const [col, ftKey] = sel.type.split("::");
      typeCfg = Object.values(factionCfg.types || {}).find(
        t => t.collection === col && t.frameType === ftKey
      ) || null;
    }
    typeCfg = typeCfg || {};
    const ftId              = typeCfg.frameType               || null;
    const ftDefaults        = ftId ? (config.frameTypes?.[ftId] || {}) : {};
    const ftFactionOverride = sel.faction ? (ftDefaults.factionOverrides?.[sel.faction] || {}) : {};
    const frameDefs         = typeCfg.defaults                || {};

    const elements = config.elements || [];
    const settings = {};
    const values   = {};

    for (const el of elements) {
      // Cascade (lowest → highest priority):
      //   g   = config.globalDefaults
      //   ft  = framedata.json overrides for this frameType
      //   fto = framedata.json factionOverrides[faction] for this frameType
      //   fr  = faction_*.json defaults for this specific frame
      //   d   = per-card overrides from cardJson.globalDefaults
      const g   = G[el.id]                    || {};
      const ft  = ftDefaults?.[el.id]         || {};
      const fto = ftFactionOverride[el.id]    || {};
      const fr  = frameDefs?.[el.id]          || {};
      const d   = defs[el.id]                 || {};

      settings[el.id] = {
        x:           d.x          ?? fr.x          ?? fto.x          ?? ft.x          ?? g.x          ?? 50,
        y:           d.y          ?? fr.y          ?? fto.y          ?? ft.y          ?? g.y          ?? 50,
        fontSize:    d.fontSize   ?? fr.fontSize   ?? fto.fontSize   ?? ft.fontSize   ?? g.fontSize   ?? 18,
        color:       d.color      ?? fr.color      ?? fto.color      ?? ft.color      ?? g.color      ?? "#ffffff",
        maxWidth:    d.maxWidth   ?? fr.maxWidth   ?? fto.maxWidth   ?? ft.maxWidth   ?? g.maxWidth   ?? 85,
        lineHeight:  d.lineHeight ?? fr.lineHeight ?? fto.lineHeight ?? ft.lineHeight ?? g.lineHeight ?? 1.4,
        maxLines:    d.maxLines   ?? fr.maxLines   ?? fto.maxLines   ?? ft.maxLines   ?? g.maxLines   ?? 0,
        x2:          d.x2        ?? fr.x2         ?? fto.x2         ?? ft.x2         ?? g.x2         ?? null,
        maxWidth2:   d.maxWidth2  ?? fr.maxWidth2  ?? fto.maxWidth2  ?? ft.maxWidth2  ?? g.maxWidth2  ?? null,
        size:        d.size       ?? fr.size       ?? fto.size       ?? ft.size       ?? g.size       ?? 10,
        w:           d.w          ?? fr.w          ?? fto.w          ?? ft.w          ?? g.w          ?? null,
        h:           d.h          ?? fr.h          ?? fto.h          ?? ft.h          ?? g.h          ?? null,
        visible:     d.visible    ?? fr.visible    ?? fto.visible    ?? ft.visible    ?? g.visible    ?? true,
        align:       d.align      ?? fr.align      ?? fto.align      ?? ft.align      ?? g.align      ?? el.align ?? "left",
        fontStyle:   d.fontStyle  ?? fr.fontStyle  ?? fto.fontStyle  ?? ft.fontStyle  ?? g.fontStyle  ?? "regular",
        textShadow:  d.textShadow ?? fr.textShadow ?? fto.textShadow ?? ft.textShadow ?? g.textShadow ?? null,
        opacity:     d.opacity    ?? fr.opacity    ?? fto.opacity    ?? ft.opacity    ?? g.opacity    ?? 1.0,
        defaultValue: el.inputType === "qr" ? "" : (d.value ?? fr.value ?? fto.value ?? ft.value ?? g.value ?? ""),
        // herostat
        rectCount:   d.rectCount  ?? fr.rectCount  ?? fto.rectCount  ?? ft.rectCount  ?? g.rectCount  ?? 2,
        rectW:       d.rectW      ?? fr.rectW      ?? fto.rectW      ?? ft.rectW      ?? g.rectW      ?? 18,
        rectH:       d.rectH      ?? fr.rectH      ?? fto.rectH      ?? ft.rectH      ?? g.rectH      ?? 14,
        rectGap:     d.rectGap    ?? fr.rectGap    ?? fto.rectGap    ?? ft.rectGap    ?? g.rectGap    ?? 5,
        rectRadius:  d.rectRadius ?? fr.rectRadius ?? fto.rectRadius ?? ft.rectRadius ?? g.rectRadius ?? 3,
        rectColor:   d.rectColor  ?? fr.rectColor  ?? fto.rectColor  ?? ft.rectColor  ?? g.rectColor  ?? "#ffffff",
        // biome
        bgVariant:   d.bgVariant  ?? fr.bgVariant  ?? fto.bgVariant  ?? ft.bgVariant  ?? g.bgVariant  ?? "none",
        bgSize:      d.bgSize     ?? fr.bgSize     ?? fto.bgSize     ?? ft.bgSize     ?? g.bgSize     ?? 8.0,
        bgX:         d.bgX        ?? fr.bgX        ?? fto.bgX        ?? ft.bgX        ?? g.bgX        ?? (d.x ?? fr.x ?? fto.x ?? ft.x ?? g.x ?? 50),
        bgY:         d.bgY        ?? fr.bgY        ?? fto.bgY        ?? ft.bgY        ?? g.bgY        ?? (d.y ?? fr.y ?? fto.y ?? ft.y ?? g.y ?? 50),
        bgW:         d.bgW        ?? fr.bgW        ?? fto.bgW        ?? ft.bgW        ?? g.bgW        ?? 0,
        bgH:         d.bgH        ?? fr.bgH        ?? fto.bgH        ?? ft.bgH        ?? g.bgH        ?? 0,
      };

      values[el.id] = el.inputType === "qr"
        ? (d.url   || g.url   || "")
        : (d.value || g.value || "");

      // For biome elements, apply per-variant position/size from biomes.json.
      // biomes.json is authoritative for bgX/bgY/bgSize/bgW/bgH/textShadow
      // per variant. Per-card overrides (d.*) keep priority.
      if (el.isBiome) {
        const biomeKey = el.biomeKey || el.id;
        const variant  = settings[el.id].bgVariant;
        const biomeCfg = variant && variant !== "none"
          ? (config.biomeBackgrounds?.[biomeKey]?.[variant] || {})
          : {};
        if (biomeCfg.bgX      != null && d.bgX      == null) settings[el.id].bgX      = biomeCfg.bgX;
        if (biomeCfg.bgY      != null && d.bgY      == null) settings[el.id].bgY      = biomeCfg.bgY;
        if (biomeCfg.bgSize   != null && d.bgSize   == null) settings[el.id].bgSize   = biomeCfg.bgSize;
        if (biomeCfg.bgW      != null && d.bgW      == null) settings[el.id].bgW      = biomeCfg.bgW;
        if (biomeCfg.bgH      != null && d.bgH      == null) settings[el.id].bgH      = biomeCfg.bgH;
        if (biomeCfg.textShadow != null && d.textShadow == null) settings[el.id].textShadow = biomeCfg.textShadow;
      }
    }

    // Overlay settings (frame parts) — same cascade as app.js
    const overlaySettings = {};
    for (const ov of (config.frameParts || [])) {
      const id   = ov.id;
      const base = ov.default                             || {};
      const ft   = ftDefaults?.frameParts?.[id]           || {};
      const fto  = ftFactionOverride.frameParts?.[id]     || {};
      const fr   = frameDefs?.frameParts?.[id]            || {};
      overlaySettings[id] = {
        visible: fr.visible ?? fto.visible ?? ft.visible ?? base.visible ?? false,
        x:       fr.x       ?? fto.x       ?? ft.x       ?? base.x       ?? 50,
        y:       fr.y       ?? fto.y       ?? ft.y       ?? base.y       ?? 50,
        size:    fr.size    ?? fto.size    ?? ft.size    ?? base.size    ?? 15,
      };
    }

    const bgt = sel.bgTransform || {};

    return {
      config,
      elements,
      fontNames:        { regular: "serif", bold: "serif", italic: "serif" },
      images:           { bg: null, frame: null, logo: null, frameParts: {}, adminWatermark: null, qrLogo: null },
      biomeImages:      { forest: {}, mountain: {}, ocean: {} },
      settings,
      values,
      overlaySettings,
      bg:               { zoom: bgt.zoom ?? 100, x: bgt.x ?? 50, y: bgt.y ?? 50, flipX: bgt.flipX ?? false },
      qrSource:         null,
      activeTypeCfg:    typeCfg,
      activeFrameTypeId: ftId,
      _qrLogoOverride:  null,
      _isAdmin:         false,
      _ref:             cardJson._ref || "",
    };
  }


  // ══════════════════════════════════════════════════════════════
  // ASSET LOADING (standalone use)
  // ══════════════════════════════════════════════════════════════

  async function _loadCardAssets(state, cardJson) {
    const imgs = cardJson._images    || {};
    const urls = cardJson._urls      || {};   // optional URL overrides
    const sel  = cardJson._selection || {};
    const base = _opts.configBaseUrl;

    const loadImg = src => {
      if (!src) return Promise.resolve(null);
      if (CACHE_IMAGES && _imgCache.has(src)) return _imgCache.get(src);
      const p = new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload  = () => resolve(img);
        img.onerror = () => { _imgCache.delete(src); resolve(null); };
        img.src = src;
      });
      if (CACHE_IMAGES) _imgCache.set(src, p);
      return p;
    };

    const jobs = [];

    // ── Background ───────────────────────────────────────────────
    jobs.push(
      loadImg(imgs.bg || urls.bg || null)
        .then(img => img || loadImg(urls.bgBkp || null))
        .then(img => { state.images.bg = img; })
    );

    // ── Frame: embedded > explicit URL > config lookup ───────────
    let frameUrl = imgs.frame || urls.frame || null;
    if (!frameUrl) {
      const fc = state.activeTypeCfg?.frameFile;
      if (fc) frameUrl = _resolveUrl(fc, base);
    }
    jobs.push(loadImg(frameUrl).then(img => { state.images.frame = img; }));

    // ── Set logo: embedded > explicit URL > set code match ───────
    let logoUrl = imgs.logo || urls.logo || null;
    if (!logoUrl && sel.setCode) {
      const entry = (state.config.setLogos || []).find(
        l => l.code === sel.setCode
      );
      if (entry?.file) logoUrl = _resolveUrl(entry.file, base);
    }
    jobs.push(loadImg(logoUrl).then(img => { state.images.logo = img; }));

    // ── QR logo ──────────────────────────────────────────────────
    const qrCfg = state.config.qrLogo || {};
    if (qrCfg.enabled && qrCfg.file) {
      jobs.push(
        loadImg(_resolveUrl(qrCfg.file, base))
          .then(img => { state.images.qrLogo = img; })
      );
    }

    // ── Frame parts for this frame type ─────────────────────────
    const ftId = state.activeFrameTypeId;
    if (ftId) {
      const ft   = state.config.frameTypes?.[ftId] || {};
      const used = ft.frameParts || {};
      for (const [partId, partCfg] of Object.entries(used)) {
        if (partCfg.visible === false) continue;
        const def = (state.config.frameParts || []).find(p => p.id === partId);
        if (def?.file) {
          const pUrl = _resolveUrl(def.file, base);
          jobs.push(loadImg(pUrl).then(img => { if (img) state.images.frameParts[partId] = img; }));
        }
      }
    }

    // ── Stamps ───────────────────────────────────────────────────
    for (const el of state.elements.filter(e => e.inputType === "stamp")) {
      const src = imgs[el.id] || urls[el.id] || null;
      if (src) jobs.push(loadImg(src).then(img => { state.images[el.id] = img; }));
    }

    // ── Static SVG/image elements ────────────────────────────────
    for (const el of state.elements.filter(e => e.inputType === "svgimage")) {
      const g   = (state.config.globalDefaults || {})[el.id] || {};
      const src = g.file ? _resolveUrl(g.file, base) : null;
      if (src) jobs.push(loadImg(src).then(img => { state.images[el.id] = img; }));
    }

    await Promise.all(jobs);

    // ── QR code generation ───────────────────────────────────────
    const qrEl = state.elements.find(e => e.inputType === "qr");
    if (qrEl) {
      const qrUrl = state.values[qrEl.id] || state.settings[qrEl.id]?.defaultValue || "";
      if (qrUrl) state.qrSource = await _generateQRImage(qrUrl);
    }
  }


  // ── QR code generation ────────────────────────────────────────

  async function _loadQRCodeLib() {
    if (window.QRCode) return;
    if (_qrcodePromise) return _qrcodePromise;
    _qrcodePromise = new Promise((resolve, reject) => {
      const s   = document.createElement("script");
      s.src     = _resolveUrl(_opts.qrcodeLib, _opts.configBaseUrl);
      s.onload  = resolve;
      s.onerror = () => reject(new Error(`AlteredRender: cannot load QRCode lib from ${s.src}`));
      document.head.appendChild(s);
    });
    return _qrcodePromise;
  }

  async function _generateQRImage(url) {
    try {
      await _loadQRCodeLib();
      if (!window.QRCode) return null;
    } catch { return null; }

    return new Promise(resolve => {
      const div = document.createElement("div");
      div.style.cssText = "position:fixed;left:-99999px;top:-99999px;width:1px;overflow:hidden;visibility:hidden";
      document.body.appendChild(div);

      try {
        const qr = new QRCode(div, { // eslint-disable-line no-undef
          text:         url,
          width:        256,
          height:       256,
          colorDark:    "#000000",
          colorLight:   "#ffffff",
          correctLevel: QRCode.CorrectLevel.H, // eslint-disable-line no-undef
        });

        const model = qr._oQRCode;
        const cleanup = () => { try { document.body.removeChild(div); } catch {} };

        if (model) {
          const n = model.getModuleCount();
          const rects = [];
          for (let r = 0; r < n; r++)
            for (let c = 0; c < n; c++)
              if (model.isDark(r, c)) rects.push(`<rect x="${c}" y="${r}" width="1" height="1"/>`);

          const svg     = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}">` +
                          `<rect width="${n}" height="${n}" fill="#fff"/>` +
                          `<g fill="#000">${rects.join("")}</g></svg>`;
          const blob    = new Blob([svg], { type: "image/svg+xml" });
          const blobUrl = URL.createObjectURL(blob);
          const img     = new Image();
          img.onload = () => { URL.revokeObjectURL(blobUrl); cleanup(); resolve(img); };
          img.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            setTimeout(() => { cleanup(); resolve(div.querySelector("canvas") || null); }, 80);
          };
          img.src = blobUrl;
        } else {
          setTimeout(() => { cleanup(); resolve(div.querySelector("canvas") || null); }, 80);
        }
      } catch (e) {
        try { document.body.removeChild(div); } catch {}
        resolve(null);
      }
    });
  }


  // ══════════════════════════════════════════════════════════════
  // RESPONSIVE CANVAS
  // ══════════════════════════════════════════════════════════════

  function _createResponsiveCanvas(container) {
    container.innerHTML = "";
    container.style.position = "relative";

    // Aspect-ratio wrapper: padding-bottom trick keeps the card ratio
    const wrapper = document.createElement("div");
    wrapper.style.cssText = [
      "position:relative",
      `padding-bottom:${((CARD_H / CARD_W) * 100).toFixed(4)}%`,
      "width:100%",
      "overflow:hidden",
    ].join(";");

    const canvas = document.createElement("canvas");
    canvas.width  = CARD_W;
    canvas.height = CARD_H;
    canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;display:block;";

    wrapper.appendChild(canvas);
    container.appendChild(wrapper);
    return canvas;
  }


  // ══════════════════════════════════════════════════════════════
  // URL RESOLUTION HELPER
  // ══════════════════════════════════════════════════════════════

  function _resolveUrl(path, base) {
    if (!path) return "";
    // Already absolute: data URI, protocol-relative or absolute URL
    if (path.startsWith("data:") ||
        path.startsWith("http://") ||
        path.startsWith("https://") ||
        path.startsWith("//") ||
        path.startsWith("/")) {
      return path;
    }
    const b = base ? base.replace(/\/?$/, "/") : "";
    return b + path;
  }


  // ══════════════════════════════════════════════════════════════
  // CANVAS DRAWING HELPERS
  // (private — shared internally by all rendering functions)
  // ══════════════════════════════════════════════════════════════

  // ── Color normalizer ─────────────────────────────────────────
  function _normalizeColor(raw) {
    if (!raw) return null;
    raw = raw.trim();
    if (!raw) return null;
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
    if (/^#[0-9a-f]{3}$/i.test(raw)) return "#" + raw[1]+raw[1]+raw[2]+raw[2]+raw[3]+raw[3];
    const m = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return "#" + [m[1],m[2],m[3]].map(n => parseInt(n).toString(16).padStart(2,"0")).join("");
    try {
      const tmp = document.createElement("canvas");
      tmp.width = tmp.height = 1;
      const c = tmp.getContext("2d");
      c.fillStyle = raw; c.fillRect(0,0,1,1);
      const [r,g,b,a] = c.getImageData(0,0,1,1).data;
      if (a === 0) return null;
      return "#" + [r,g,b].map(n => n.toString(16).padStart(2,"0")).join("");
    } catch { return null; }
  }

  // ── Icon / circled-number detection ─────────────────────────
  function _isPUA(cp) {
    return cp >= 0xE000 && cp <= 0xF8FF;
  }

  function _isCircledNumber(cp) {
    return (cp >= 0x2460 && cp <= 0x249B) ||
           (cp >= 0x24EA && cp <= 0x24FF) ||
           (cp >= 0x2776 && cp <= 0x2793);
  }

  // Returns the alteredIconsTokens label for a PUA codepoint (e.g. 0xe024 → "R").
  // Falls back to hex string if not found. Result is cached per config instance.
  let _iconLabelMap = null, _iconLabelCfg = null;
  function _iconLabel(cp) {
    if (_activeCfg !== _iconLabelCfg) {
      _iconLabelMap = {};
      _iconLabelCfg = _activeCfg;
      for (const [label, hex] of Object.entries(_activeCfg?.alteredIconsTokens ?? {})) {
        if (!label.startsWith("_")) _iconLabelMap[parseInt(hex, 16)] = label;
      }
    }
    return _iconLabelMap[cp] ?? cp.toString(16);
  }

  // Uses _activeCfg set at start of _renderCard()
  function _getCircledScale(text) {
    const base = _activeCfg?.circledNumberScale ?? 1.0;
    if (text?.codePointAt(0) === 0x24FF) return base * 0.64;
    return base;
  }

  // ── Mixed-font tokeniser ──────────────────────────────────────
  function _tokenizeMixed(text) {
    const segs = [];
    let buf = "", bufIcon = false, bufCircled = false;
    for (const ch of text) {
      const cp        = ch.codePointAt(0);
      const isIcon    = _isPUA(cp);
      const isCircled = !isIcon && _isCircledNumber(cp);
      if (isIcon !== bufIcon || isCircled !== bufCircled) {
        if (buf) segs.push({ text: buf, isIcon: bufIcon, isCircled: bufCircled });
        buf = ch; bufIcon = isIcon; bufCircled = isCircled;
      } else { buf += ch; }
    }
    if (buf) segs.push({ text: buf, isIcon: bufIcon, isCircled: bufCircled });
    return segs;
  }

  // Returns the canvas font string for a token
  function _segFont(isIcon, baseFont, isCircled = false, text = "") {
    if (isIcon) {
      const key      = _iconLabel(text.codePointAt(0));
      const perScale = (_activeCfg?.alteredIconsSizes?.[key]) ?? 1.0;
      const newSize  = Math.round(parseFloat(baseFont) * (_activeCfg?.alteredIconsScale ?? 1.0) * perScale);
      return `${newSize}px "Font Awesome Kit"`;
    }
    if (isCircled) {
      const scale   = _getCircledScale(text);
      const newSize = Math.round(parseFloat(baseFont) * scale);
      if (_fontNames.circled) return `${newSize}px "${_fontNames.circled}"`;
      return baseFont.replace(/^[\d.]+px/, `${newSize}px`);
    }
    return baseFont;
  }

  // Pixel width of mixed-font text (icons + circled numbers + regular)
  function _measureMixed(ctx, text, baseFont) {
    let w = 0;
    for (const s of _tokenizeMixed(text)) {
      ctx.font = _segFont(s.isIcon, baseFont, s.isCircled, s.text);
      w += ctx.measureText(s.text).width;
    }
    return w;
  }

  // Draw a single line of mixed-font text
  function _drawMixedLine(ctx, text, x, y, baseFont) {
    let cx = x;
    for (const s of _tokenizeMixed(text)) {
      ctx.font = _segFont(s.isIcon, baseFont, s.isCircled, s.text);
      ctx.fillText(s.text, cx, y);
      cx += ctx.measureText(s.text).width;
    }
  }

  // Draw wrapped text (plain / non-richtext)
  // zone2 = { fromLine, x, maxWidth } — optional second zone (different width/x after N lines)
  function _drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, baseFont, zone2 = null) {
    const paragraphs = text.split("\n");
    let curY = y, lineCount = 0;
    let curX = x, curMaxWidth = maxWidth;

    for (const para of paragraphs) {
      if (!para.trim()) { curY += lineHeight * 0.5; continue; }

      const rawSegs = _tokenizeMixed(para);
      const tokens  = [];
      for (const seg of rawSegs) {
        if (seg.isIcon) {
          for (const ch of seg.text) {
            ctx.font = _segFont(true, baseFont, false);
            tokens.push({ text: ch, isIcon: true, isCircled: false, w: ctx.measureText(ch).width });
          }
        } else if (seg.isCircled) {
          for (const ch of seg.text) {
            ctx.font = _segFont(false, baseFont, true, ch);
            tokens.push({ text: ch, isIcon: false, isCircled: true, w: ctx.measureText(ch).width });
          }
        } else {
          for (const p of seg.text.split(/(\s+)/)) {
            if (!p) continue;
            ctx.font = _segFont(false, baseFont, false);
            tokens.push({ text: p, isIcon: false, isCircled: false, w: ctx.measureText(p).width });
          }
        }
      }

      let lineToks = [], lineW = 0;

      const flushLine = () => {
        while (lineToks.length && !lineToks[0].isIcon && !lineToks[0].text.trim()) lineToks.shift();
        while (lineToks.length && !lineToks[lineToks.length-1].isIcon && !lineToks[lineToks.length-1].text.trim()) lineToks.pop();
        const iconOffsetY = _activeCfg?.alteredIconsOffsetY ?? 0;
        let cx = curX;
        for (const t of lineToks) {
          ctx.font = _segFont(t.isIcon, baseFont, t.isCircled, t.text);
          ctx.fillText(t.text, cx, curY + (t.isIcon ? iconOffsetY : 0));
          cx += t.w;
        }
        lineCount++;
        curY += lineHeight;
        lineToks = []; lineW = 0;
        if (zone2 && lineCount === zone2.fromLine) { curX = zone2.x; curMaxWidth = zone2.maxWidth; }
      };

      for (const tok of tokens) {
        if (lineW + tok.w > curMaxWidth && lineW > 0) flushLine();
        lineToks.push(tok); lineW += tok.w;
      }
      if (lineToks.length) flushLine();
    }
  }

  // ── HTML richtext → canvas runs ──────────────────────────────
  function _htmlToRuns(html) {
    const div = document.createElement("div");
    div.innerHTML = html || "";
    const runs = [];
    let firstBlock = true;

    function mergeOrPush(text, bold, italic, underline, strike, isIcon, color, fontScale) {
      const last = runs[runs.length - 1];
      if (!isIcon && last && !last.isIcon &&
          last.bold === bold && last.italic === italic &&
          last.underline === underline && last.strike === strike &&
          last.color === color && last.fontScale === fontScale) {
        last.text += text;
      } else {
        runs.push({ text, bold, italic, underline, strike, isIcon, color, fontScale });
      }
    }

    function walk(node, bold, italic, underline, strike, color, fontScale) {
      if (node.nodeType === 3) {
        const text = node.textContent;
        if (!text) return;
        for (const ch of text) {
          const isIcon = _isPUA(ch.codePointAt(0));
          mergeOrPush(ch, bold, italic, underline, strike, isIcon, color, fontScale);
        }
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toUpperCase();

      if (node.classList?.contains("altered-icon-span")) {
        const hex = node.dataset.unicode;
        if (hex) runs.push({ text: String.fromCodePoint(parseInt(hex, 16)), bold, italic, underline, strike, isIcon: true, color, fontScale });
        return;
      }

      if (["DIV", "P"].includes(tag)) {
        if (!firstBlock && runs.length > 0) {
          const last = runs[runs.length - 1];
          if (last && !last.text.endsWith("\n")) {
            if (last.isIcon) runs.push({ text: "\n", bold, italic, underline, strike, isIcon: false, color, fontScale });
            else last.text += "\n";
          }
        }
        firstBlock = false;
      }

      if (tag === "BR") {
        const last = runs[runs.length - 1];
        if (last && !last.isIcon) last.text += "\n";
        else runs.push({ text: "\n", bold, italic, underline, strike, isIcon: false, color, fontScale });
        return;
      }

      let b = bold, it = italic, u = underline, s = strike, c = color, fs = fontScale;
      if (tag === "B" || tag === "STRONG") b  = true;
      if (tag === "I" || tag === "EM")     it = true;
      if (tag === "U")                     u  = true;
      if (["S","STRIKE","DEL"].includes(tag)) s = true;
      if (tag === "FONT" && node.color) c = _normalizeColor(node.color) || c;
      if (node.style) {
        if (node.style.fontWeight === "bold")   b  = true;
        if (node.style.fontStyle  === "italic") it = true;
        const td = node.style.textDecorationLine || node.style.textDecoration;
        if (td?.includes("underline"))    u = true;
        if (td?.includes("line-through")) s = true;
        if (node.style.color) c = _normalizeColor(node.style.color) || c;
        if (node.style.fontSize) {
          const m = node.style.fontSize.match(/^([0-9.]+)em$/);
          if (m) fs = fontScale * parseFloat(m[1]);
        }
      }
      for (const child of node.childNodes) walk(child, b, it, u, s, c, fs);
    }

    walk(div, false, false, false, false, null, 1.0);
    return runs.filter(r => r.text !== "");
  }

  // Draw richtext runs with word-wrap
  // zone2 = { fromLine, x, maxWidth } — optional second zone (different width/x after N lines)
  function _drawRichText(ctx, runs, x, y, maxWidth, lineHeight, fontSize, color, fontNames, zone2 = null) {
    const getFontName = (bold, italic) => {
      if (bold)   return fontNames.bold   || fontNames.regular;
      if (italic) return fontNames.italic || fontNames.regular;
      return fontNames.regular;
    };

    const tokens = [];
    for (const run of runs) {
      const fs = run.fontScale ?? 1.0;
      if (run.isIcon) { tokens.push({ ...run, isCircled: false, fontScale: fs }); continue; }
      for (const part of run.text.split(/(\n)/)) {
        if (part === "\n") {
          tokens.push({ text: "\n", bold: run.bold, italic: run.italic, underline: run.underline,
                        strike: run.strike, color: run.color, isIcon: false, isCircled: false, isNewline: true, fontScale: fs });
        } else if (part) {
          for (const seg of _tokenizeMixed(part)) {
            if (seg.isCircled) {
              for (const ch of seg.text) {
                tokens.push({ text: ch, bold: run.bold, italic: run.italic, underline: run.underline,
                              strike: run.strike, color: run.color, isIcon: false, isCircled: true, isNewline: false, fontScale: fs });
              }
            } else {
              for (const sub of seg.text.split(/(\s+)/)) {
                if (sub) tokens.push({ text: sub, bold: run.bold, italic: run.italic, underline: run.underline,
                                       strike: run.strike, color: run.color, isIcon: false, isCircled: false, isNewline: false, fontScale: fs });
              }
            }
          }
        }
      }
    }

    const _iconScale = (ch) => {
      const key = _iconLabel(ch.codePointAt(0));
      return (_activeCfg?.alteredIconsSizes?.[key]) ?? 1.0;
    };

    const measureTok = tok => {
      if (tok.isNewline) return 0;
      const fn  = tok.isIcon ? "Font Awesome Kit" : getFontName(tok.bold, tok.italic);
      const fs  = tok.fontScale ?? 1.0;
      const size = tok.isIcon    ? Math.round(fontSize * fs * (_activeCfg?.alteredIconsScale ?? 1.0) * _iconScale(tok.text))
                 : tok.isCircled ? Math.round(fontSize * fs * _getCircledScale(tok.text))
                 : Math.round(fontSize * fs);
      ctx.font = `${size}px "${fn}"`;
      return ctx.measureText(tok.text).width;
    };

    let lineTokens = [], lineWidth = 0, curY = y;
    let lineCount = 0, curX = x, curMaxWidth = maxWidth;

    const flushLine = () => {
      while (lineTokens.length && !lineTokens[lineTokens.length-1].isIcon && lineTokens[lineTokens.length-1].text.trim() === "") lineTokens.pop();
      let cx = curX;
      ctx.textBaseline = "middle"; ctx.textAlign = "left";
      const iconOffsetY = _activeCfg?.alteredIconsOffsetY ?? 0;
      for (const tok of lineTokens) {
        if (tok.isNewline) continue;
        const fn  = tok.isIcon ? "Font Awesome Kit" : getFontName(tok.bold, tok.italic);
        const fs  = tok.fontScale ?? 1.0;
        const size = tok.isIcon    ? Math.round(fontSize * fs * (_activeCfg?.alteredIconsScale ?? 1.0) * _iconScale(tok.text))
                   : tok.isCircled ? Math.round(fontSize * fs * _getCircledScale(tok.text))
                   : Math.round(fontSize * fs);
        ctx.font      = `${size}px "${fn}"`;
        ctx.fillStyle = tok.color || color;
        ctx.fillText(tok.text, cx, curY + (tok.isIcon ? iconOffsetY : 0));
        const tw = ctx.measureText(tok.text).width;
        if (tok.underline || tok.strike) {
          ctx.save();
          ctx.strokeStyle = tok.color || color;
          ctx.lineWidth   = Math.max(1, fontSize * 0.06);
          ctx.beginPath();
          if (tok.underline) { ctx.moveTo(cx, curY + fontSize*0.4);  ctx.lineTo(cx+tw, curY + fontSize*0.4); }
          if (tok.strike)    { ctx.moveTo(cx, curY - fontSize*0.05); ctx.lineTo(cx+tw, curY - fontSize*0.05); }
          ctx.stroke(); ctx.restore();
        }
        cx += tw;
      }
      lineCount++;
      curY += lineHeight; lineTokens = []; lineWidth = 0;
      if (zone2 && lineCount === zone2.fromLine) { curX = zone2.x; curMaxWidth = zone2.maxWidth; }
    };

    for (const tok of tokens) {
      if (tok.isNewline) { flushLine(); continue; }
      const tw = measureTok(tok);
      if (lineWidth + tw > curMaxWidth && lineWidth > 0 && tok.text.trim() !== "") flushLine();
      lineTokens.push(tok); lineWidth += tw;
    }
    if (lineTokens.length) flushLine();
  }

  // ── Rounded rectangle path ───────────────────────────────────
  function _drawRoundedRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);       ctx.arcTo(x+w, y,     x+w, y+r,     r);
    ctx.lineTo(x+w, y+h-r);     ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
    ctx.lineTo(x+r,  y+h);      ctx.arcTo(x,   y+h, x,   y+h-r, r);
    ctx.lineTo(x,    y+r);      ctx.arcTo(x,   y,   x+r, y,     r);
    ctx.closePath();
  }

  // ── Placeholder background ───────────────────────────────────
  // Shown while card images are loading.
  // Controlled by core.json > placeholderBg: { enabled, file }.
  // To customize the built-in gradient/grid, edit _drawCardBg() directly.

  // ── Shared background (gradient or custom image) ─────────────────
  function _drawCardBg(ctx, W, H) {
    if (_placeholderImg) {
      const sc = Math.max(W / _placeholderImg.naturalWidth, H / _placeholderImg.naturalHeight);
      const dw = _placeholderImg.naturalWidth  * sc;
      const dh = _placeholderImg.naturalHeight * sc;
      ctx.drawImage(_placeholderImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      // Built-in animated gradient — edit colours/grid/emoji below as needed
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0,   "#1a1a3a");
      grad.addColorStop(0.5, "#0e1428");
      grad.addColorStop(1,   "#080810");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx,0); ctx.lineTo(gx,H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(W,gy); ctx.stroke(); }
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.font = "bold 80px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🃏", W/2, H/2);
    }
  }

  // ── Shared text label (multiline, drop shadow) ───────────────────
  // template supports {ref} and {msg} placeholders, and \n for line breaks.
  function _drawCardLabel(ctx, W, H, template, x, y, color, fontSize, ref, msg) {
    if (!template) return;
    const resolved = template
      .replace(/\{ref\}/g, ref || "")
      .replace(/\{msg\}/g, msg || "");
    const lines    = resolved.split("\n");
    fontSize       = Math.round(W * fontSize / 100);
    const lineH    = fontSize * 1.3;
    const tx       = W * x / 100;
    const blockTop = H * y / 100 - (lines.length - 1) * lineH / 2;
    ctx.save();
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.font         = `bold ${fontSize}px sans-serif`;
    for (let i = 0; i < lines.length; i++) {
      const ty = blockTop + i * lineH;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillText(lines[i], tx + 2, ty + 2);
      ctx.fillStyle = color;
      ctx.fillText(lines[i], tx,     ty);
    }
    ctx.restore();
  }

  function _drawPlaceholderBg(ctx, W, H, ref) {
    _drawCardBg(ctx, W, H);
    _drawCardLabel(ctx, W, H, LOADING_TEXT, LOADING_X, LOADING_Y, LOADING_COLOR, LOADING_FONT_SIZE, ref);
  }

  function _drawErrorBg(ctx, W, H, ref, msg) {
    _drawCardBg(ctx, W, H);
    _drawCardLabel(ctx, W, H, ERROR_TEXT, ERROR_X, ERROR_Y, ERROR_COLOR, ERROR_FONT_SIZE, ref, msg);
  }


  // ══════════════════════════════════════════════════════════════
  // MAIN RENDERER
  // Canonical render pipeline — shared by app.js and standalone.
  // ══════════════════════════════════════════════════════════════

  function _renderCard(state, _canvas, ctx) {
    // Make config accessible to helpers without threading it through every call
    _activeCfg = state.config;

    const W = CARD_W, H = CARD_H;
    ctx.clearRect(0, 0, W, H);

    // ── 1. Background ──────────────────────────────────────────
    if (state.images.bg) {
      const img  = state.images.bg;
      const zoom = (state.bg.zoom || 100) / 100;
      const ox   = (state.bg.x   !== undefined ? state.bg.x : 50) / 100;
      const oy   = (state.bg.y   !== undefined ? state.bg.y : 50) / 100;
      const sc   = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom;
      const dw   = img.naturalWidth  * sc;
      const dh   = img.naturalHeight * sc;
      const dx   = (W - dw) * ox;
      const dy   = (H - dh) * oy;
      if (state.bg.flipX) {
        ctx.save();
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, W - dx - dw, dy, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(img, dx, dy, dw, dh);
      }
    } else {
      _drawCardBg(ctx, W, H);
    }

    // ── 1b. Black inset border for blackBleed frames ───────────
    {
      const isBlackBleed = state.activeTypeCfg?.blackBleed ||
        state.config.frameTypes?.[state.activeFrameTypeId]?.blackBleed;
      if (isBlackBleed) {
        const INSET = 2;
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, W, INSET);
        ctx.fillRect(0, H - INSET, W, INSET);
        ctx.fillRect(0, INSET, INSET, H - 2*INSET);
        ctx.fillRect(W - INSET, INSET, INSET, H - 2*INSET);
      }
    }

    // ── 1c. Biome background badges (under frame) ──────────────
    for (const el of state.elements.filter(e => e.isBiome)) {
      const s = state.settings[el.id];
      if (!s.visible || !s.bgVariant || s.bgVariant === "none") continue;
      const biomeKey = el.biomeKey || el.id;
      const img      = state.biomeImages?.[biomeKey]?.[s.bgVariant];
      if (!img) continue;
      const cx = ((s.bgX ?? s.x) / 100) * W;
      const cy = ((s.bgY ?? s.y) / 100) * H;
      let dw, dh;
      if (s.bgW > 0 && s.bgH > 0) {
        dw = (s.bgW / 100) * W;
        dh = (s.bgH / 100) * H;
      } else {
        const asp = img.naturalWidth / img.naturalHeight;
        dw = ((s.bgSize ?? 8) / 100) * W;
        dh = dw / asp;
      }
      ctx.drawImage(img, cx - dw/2, cy - dh/2, dw, dh);
    }

    // ── 2. Frame overlay ───────────────────────────────────────
    if (state.images.frame) {
      ctx.drawImage(state.images.frame, 0, 0, W, H);
    }

    // ── 3. Frame parts (sorted by order) ──────────────────────
    {
      const parts = (state.config.frameParts || []).slice().sort((a,b) => (a.order??0) - (b.order??0));
      for (const part of parts) {
        const s   = state.overlaySettings[part.id];
        const img = state.images.frameParts[part.id];
        if (!img || !s || s.visible === false) continue;
        const cx  = (s.x    / 100) * W;
        const cy  = (s.y    / 100) * H;
        const sz  = (s.size / 100) * W;
        const asp = img.naturalWidth / img.naturalHeight;
        ctx.drawImage(img, cx - sz/2, cy - (sz/asp)/2, sz, sz/asp);
      }
    }

    // ── 4. Set logo ────────────────────────────────────────────
    // All logos are drawn at the same width (w), so they appear the same size
    // regardless of their intrinsic aspect ratio. Height is computed from the
    // ratio automatically. If h is set and the computed height would exceed it,
    // we clamp to h instead (tall logos won't overflow the reserved area).
    if (state.images.logo && state.settings.setLogo?.visible) {
      const s    = state.settings.setLogo;
      const img  = state.images.logo;
      const cx   = (s.x / 100) * W;
      const cy   = (s.y / 100) * H;
      const boxW = ((s.w ?? s.size ?? 5) / 100) * W;
      const boxH = ((s.h ?? s.size ?? 5) / 100) * H;
      const imgW = img.naturalWidth  || 1;
      const imgH = img.naturalHeight || 1;
      // Fill full width; clamp by height only if the logo would overflow
      const scaleW = boxW / imgW;
      const scaleH = boxH / imgH;
      const scale  = scaleW * imgH > boxH ? scaleH : scaleW;
      const drawW  = imgW * scale;
      const drawH  = imgH * scale;
      const off   = document.createElement("canvas");
      off.width   = imgW; off.height = imgH;
      const oCtx  = off.getContext("2d");
      oCtx.drawImage(img, 0, 0, imgW, imgH);
      oCtx.globalCompositeOperation = "source-atop";
      oCtx.fillStyle = s.color || "#ffffff";
      oCtx.fillRect(0, 0, imgW, imgH);
      ctx.drawImage(off, cx - drawW/2, cy - drawH/2, drawW, drawH);
    }

    // ── 5. QR code ─────────────────────────────────────────────
    if (state.qrSource && state.settings.qrCode?.visible) {
      const s    = state.settings.qrCode;
      const size = (s.size / 100) * W;
      const x    = (s.x   / 100) * W;
      const y    = (s.y   / 100) * H;
      try {
        ctx.drawImage(state.qrSource, x - size/2, y - size/2, size, size);
        const qrCfg  = state.config.qrLogo || {};
        const qrLogo = state._qrLogoOverride || (qrCfg.enabled ? state.images.qrLogo : null);
        if (qrLogo) {
          const logoRatio = Math.min(qrCfg.logoRatio ?? 0.22, 0.25);
          const lSize     = size * logoRatio;
          const lPad      = lSize * 0.12;
          ctx.save();
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x - lSize/2 - lPad, y - lSize/2 - lPad, lSize + lPad*2, lSize + lPad*2);
          ctx.drawImage(qrLogo, x - lSize/2, y - lSize/2, lSize, lSize);
          ctx.restore();
        }
      } catch { /* source not ready */ }
    }

    // ── 6. Text elements ───────────────────────────────────────
    const textEls = state.elements.filter(el =>
      (el.inputType === "text" || el.inputType === "textarea" || el.inputType === "richtext")
      && !el.isAdmin && !el.infoLinePart
    );

    for (const el of textEls) {
      const s   = state.settings[el.id];
      const val = state.values[el.id] || s.defaultValue || "";
      if (!s.visible || !val) continue;

      const x        = (s.x / 100) * W;
      const y        = (s.y / 100) * H;
      const fontSize = Math.round(s.fontSize);
      const style    = s.fontStyle || "regular";
      const fontName = state.fontNames[style] || state.fontNames.regular;

      ctx.save();
      ctx.fillStyle    = s.color || "#ffffff";
      ctx.textBaseline = "middle";

      if (s.textShadow) {
        ctx.shadowColor   = s.textShadow.color   ?? "transparent";
        ctx.shadowBlur    = s.textShadow.blur     ?? 0;
        ctx.shadowOffsetX = s.textShadow.offsetX  ?? 0;
        ctx.shadowOffsetY = s.textShadow.offsetY  ?? 0;
      }

      if (el.inputType === "richtext") {
        const runs  = _htmlToRuns(val);
        const maxPx = (s.maxWidth / 100) * W;
        const lineH = fontSize * (s.lineHeight || 1.4);
        const zone2 = (s.maxLines > 0 && s.x2 != null && s.maxWidth2 != null)
          ? { fromLine: s.maxLines, x: (s.x2 / 100) * W, maxWidth: (s.maxWidth2 / 100) * W }
          : null;
        _drawRichText(ctx, runs, x, y, maxPx, lineH, fontSize, s.color || "#ffffff", state.fontNames, zone2);
      } else {
        const baseFont = `${fontSize}px "${fontName}"`;
        if (el.hasMaxWidth) {
          ctx.textAlign = "left";
          const maxPx   = (s.maxWidth / 100) * W;
          const lineH   = fontSize * (s.lineHeight || 1.4);
          const zone2   = (s.maxLines > 0 && s.x2 != null && s.maxWidth2 != null)
            ? { fromLine: s.maxLines, x: (s.x2 / 100) * W, maxWidth: (s.maxWidth2 / 100) * W }
            : null;
          _drawWrappedText(ctx, val, x, y, maxPx, lineH, baseFont, zone2);
        } else if (s.align === "center") {
          ctx.textAlign = "left";
          _drawMixedLine(ctx, val, x - _measureMixed(ctx, val, baseFont) / 2, y, baseFont);
        } else if (s.align === "right") {
          ctx.textAlign = "left";
          _drawMixedLine(ctx, val, x - _measureMixed(ctx, val, baseFont), y, baseFont);
        } else {
          ctx.textAlign = "left";
          _drawMixedLine(ctx, val, x, y, baseFont);
        }
      }
      ctx.restore();
    }

    // ── 6b. InfoLine composite elements ───────────────────────
    for (const el of state.elements.filter(e => e.inputType === "infoLine")) {
      const s = state.settings[el.id];
      if (!s.visible) continue;
      const x        = (s.x / 100) * W;
      const y        = (s.y / 100) * H;
      const fontSize = Math.round(s.fontSize);
      const style    = s.fontStyle || "regular";
      const fontName = state.fontNames[style] || state.fontNames.regular;
      const baseFont = `${fontSize}px "${fontName}"`;

      const parts = [];
      for (const f of (el.fields || [])) {
        const fS  = state.settings[f.ref];
        if (fS?.visible === false) continue;
        const val = state.values[f.ref] || fS?.defaultValue || "";
        if (val) parts.push((f.prefix || "") + val + (f.suffix || ""));
      }
      const fullText = parts.join("");
      if (!fullText) continue;

      ctx.save();
      ctx.fillStyle = s.color || "#ffffff"; ctx.textBaseline = "middle";
      if (s.textShadow) {
        ctx.shadowColor   = s.textShadow.color   ?? "transparent";
        ctx.shadowBlur    = s.textShadow.blur     ?? 0;
        ctx.shadowOffsetX = s.textShadow.offsetX  ?? 0;
        ctx.shadowOffsetY = s.textShadow.offsetY  ?? 0;
      }
      ctx.textAlign = "left";
      if (s.align === "center") {
        _drawMixedLine(ctx, fullText, x - _measureMixed(ctx, fullText, baseFont)/2, y, baseFont);
      } else if (s.align === "right") {
        _drawMixedLine(ctx, fullText, x - _measureMixed(ctx, fullText, baseFont), y, baseFont);
      } else {
        _drawMixedLine(ctx, fullText, x, y, baseFont);
      }
      ctx.restore();
    }

    // ── 7. Herostat elements ───────────────────────────────────
    for (const el of state.elements.filter(e => e.inputType === "herostat")) {
      const s   = state.settings[el.id];
      const val = state.values[el.id] || s.defaultValue || "";
      if (!s.visible) continue;

      const x        = (s.x / 100) * W;
      const y        = (s.y / 100) * H;
      const fontSize = Math.round(s.fontSize);
      const style    = s.fontStyle || "regular";
      const fontName = state.fontNames[style] || state.fontNames.regular;
      const baseFont = `${fontSize}px "${fontName}"`;

      ctx.save();
      ctx.textBaseline = "middle"; ctx.textAlign = "left";
      let curX = x;
      if (val) {
        ctx.fillStyle = s.color || "#ffffff";
        ctx.font = baseFont;
        _drawMixedLine(ctx, val, curX, y, baseFont);
        curX += _measureMixed(ctx, val, baseFont);
      }
      const count  = Math.round(s.rectCount || 0);
      const rW     = s.rectW    || 18;
      const rH     = s.rectH    || 14;
      const gap    = s.rectGap  || 5;
      const radius = s.rectRadius || 3;
      if (count > 0) {
        ctx.fillStyle = s.rectColor || "#ffffff";
        curX += gap;
        for (let i = 0; i < count; i++) {
          _drawRoundedRect(ctx, curX, y - rH/2, rW, rH, radius);
          ctx.fill();
          curX += rW + gap;
        }
      }
      ctx.restore();
    }

    // ── 7b. Static SVG/image elements ─────────────────────────
    for (const el of state.elements.filter(e => e.inputType === "svgimage")) {
      const img = state.images[el.id];
      const s   = state.settings[el.id];
      if (!img || s?.visible === false) continue;
      const cx  = ((s?.x    ?? 50) / 100) * W;
      const cy  = ((s?.y    ?? 50) / 100) * H;
      const sz  = ((s?.size ?? 15) / 100) * W;
      const asp = img.naturalWidth / img.naturalHeight;
      ctx.drawImage(img, cx - sz/2, cy - (sz/asp)/2, sz, sz/asp);
    }

    // ── 7c. Custom stamp images ────────────────────────────────
    for (const el of state.elements.filter(e => e.inputType === "stamp")) {
      const img = state.images[el.id];
      const s   = state.settings[el.id];
      if (!img || s?.visible === false) continue;
      const cx  = ((s?.x    ?? 50) / 100) * W;
      const cy  = ((s?.y    ?? 50) / 100) * H;
      const sz  = ((s?.size ?? 30) / 100) * W;
      const asp = img.naturalWidth / img.naturalHeight;
      ctx.save();
      ctx.globalAlpha = s?.opacity ?? 1.0;
      ctx.drawImage(img, cx - sz/2, cy - (sz/asp)/2, sz, sz/asp);
      ctx.restore();
    }

    // ── 8. Admin elements ──────────────────────────────────────

    // Admin watermark image
    const wm  = state.images.adminWatermark;
    const wmS = state.settings.adminWatermark;
    if (wm && wmS?.visible !== false) {
      const wx  = ((wmS?.x    ?? 50) / 100) * W;
      const wy  = ((wmS?.y    ?? 95) / 100) * H;
      const wSz = ((wmS?.size ?? 10) / 100) * W;
      const asp = wm.naturalWidth / wm.naturalHeight;
      ctx.save();
      ctx.globalAlpha = wmS?.opacity ?? 0.5;
      ctx.drawImage(wm, wx - wSz/2, wy - (wSz/asp)/2, wSz, wSz/asp);
      ctx.restore();
    }

    // Admin text (skip if part of an infoLine composite)
    const adminTextEl = state.elements.find(e => e.id === "adminText");
    if (!adminTextEl?.infoLinePart) {
      const atS = state.settings.adminText;
      const atV = state.values.adminText || state.config.ui?.adminTextDefault || "";
      if (atV && atS?.visible !== false) {
        const ax  = ((atS?.x ?? 50) / 100) * W;
        const ay  = ((atS?.y ?? 98) / 100) * H;
        const aFs = Math.round(atS?.fontSize ?? 11);
        ctx.save();
        ctx.font         = `${aFs}px "${state.fontNames.regular}"`;
        ctx.fillStyle    = atS?.color ?? "#ffffff";
        ctx.textBaseline = "middle";
        ctx.textAlign    = atS?.align === "right" ? "right"
                         : atS?.align === "center" ? "center" : "left";
        ctx.fillText(atV, ax, ay);
        ctx.restore();
      }
    }
  }

  // ── <altered-card> custom element ────────────────────────────
  // Registers a drop-in HTML element that fetches and renders a card.
  //
  // Usage — include render-core.js with two data attributes, then use
  // the <altered-card> tag anywhere on the page:
  //
  //   <script src="https://altered-db.com/forge/render-core.js"
  //           data-proxy="https://altered-db.com/forge/standalone/altered-card-renderer-proxy.php"
  //           data-config-base="https://cdn.alteredcore.org/forge/"></script>
  //
  //   <altered-card ref="ALT_CORE_B_AX_04_U_10"></altered-card>
  //   <altered-card ref="ALT_EOLE_B_OR_109_U_374" locale="fr"></altered-card>
  //
  // Attributes on <altered-card>:
  //   ref        — card reference (required)
  //   locale     — "en" or "fr" (default: "en")
  //   collection — forge collection key (default: DEFAULT_COLLECTION)
  //
  // <script> data attributes:
  //   data-proxy       — URL to altered-card-renderer-proxy.php (handles CORS for API + images)
  //   data-config-base — forge config root URL (default: RESOURCES.configBaseUrl)
  if (typeof customElements !== "undefined") {
    (function () {
      const _scriptEl  = _currentScript;

      // Proxy resolution — three modes controlled by RESOURCES.proxyUrl:
      //   null  (default) → auto-detect: altered-card-renderer-proxy.php next to this script
      //   false           → no proxy: card API is called directly from the browser (requires CORS)
      //   "https://…"     → explicit proxy URL
      // Override per-page with data-proxy on the <script> tag.
      const _scriptDir  = _scriptEl?.src
        ? _scriptEl.src.substring(0, _scriptEl.src.lastIndexOf('/') + 1)
        : './';
      const _proxyRaw   = _scriptEl?.dataset?.proxy ?? RESOURCES.proxyUrl;
      const _proxyBase  = _proxyRaw === false || _proxyRaw === "false"
        ? false
        : (_proxyRaw ?? (_scriptDir + 'altered-card-renderer-proxy.php'));
      const _cfgBase    = _scriptEl?.dataset?.configBase ?? RESOURCES.configBaseUrl;

      // Inject responsive styles once
      if (!document.getElementById("altered-card-style")) {
        const s = document.createElement("style");
        s.id = "altered-card-style";
        s.textContent = "altered-card{display:block}"
                      + "altered-card canvas{display:block;width:100%!important;height:auto!important}";
        document.head.appendChild(s);
      }

      function _cardErrCanvas(element, ref, msg) {
        const canvas = document.createElement("canvas");
        canvas.width  = CARD_W;
        canvas.height = CARD_H;
        _drawErrorBg(canvas.getContext("2d"), CARD_W, CARD_H, ref, msg);
        element.innerHTML = "";
        element.appendChild(canvas);
      }

      // ── API data cache ────────────────────────────────────────────
      // Keyed by "ref|locale". Stores resolved API data so re-connecting
      // an element (e.g. on hover) never triggers a second network request.
      const _apiCache = new Map();

      // ── Mode 2 — batch queue ──────────────────────────────────────
      // Entries: { element, ref, locale, collection }
      // Populated by connectedCallback() when FETCH_MODE === 2.
      // Flushed once per tick via setTimeout(0) after the last tag connects.
      const _batchQueue     = [];
      let   _batchScheduled = false;

      async function _flushBatch() {
        _batchScheduled = false;
        const entries = _batchQueue.splice(0);
        if (!entries.length) return;

        // Locale for the batch request: first tag that explicitly set one, else "en".
        const batchLocale = entries.find(e => e.element.hasAttribute("locale"))?.locale ?? "en";

        // Unique refs (preserve order), capped at BATCH_MAX then split into chunks of BATCH_SIZE.
        // Refs already in the API cache are served directly — only uncached refs are fetched.
        const allRefs = [...new Set(entries.map(e => e.ref))];
        const uncachedRefs = CACHE_API
          ? allRefs.filter(r => !_apiCache.has(r + "|" + batchLocale))
          : allRefs;
        if (allRefs.length > BATCH_MAX)
          console.warn(`[altered-card] ${allRefs.length} unique refs exceed BATCH_MAX (${BATCH_MAX}) — truncating.`);
        const refs = uncachedRefs.slice(0, BATCH_MAX);
        const chunks = [];
        for (let i = 0; i < refs.length; i += BATCH_SIZE) chunks.push(refs.slice(i, i + BATCH_SIZE));

        // Fire all chunks in parallel, collect results into a single map ref → data.
        const byRef = new Map();
        try {
          const fetchChunk = async (chunk) => {
            let res;
            if (_proxyBase === false) {
              const _apiOrigin = RESOURCES.cardApiUrl.match(/^https?:\/\/[^/]+/)?.[0] ?? '';
              const batchUrl = _apiOrigin + RESOURCES.cardApiUrl.slice(_apiOrigin.length).replace(/\/cards.*$/, '/cards/batch');
              res = await fetch(batchUrl, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body:    JSON.stringify({ references: chunk, locale: batchLocale }),
              });
            } else {
              res = await fetch(
                _proxyBase + "?batch=1&locale=" + batchLocale
                           + "&api=" + encodeURIComponent(RESOURCES.cardApiUrl),
                {
                  method:  'POST',
                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                  body:    JSON.stringify({ references: chunk }),
                }
              );
            }
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json();
          };

          const responses = await Promise.all(chunks.map(fetchChunk));
          for (const results of responses) {
            if (Array.isArray(results)) {
              for (const item of results) {
                if (item?.reference) {
                  if (_proxyBase !== false && Array.isArray(item.assets))
                    item.assets = item.assets.map(u => u ? _proxyBase + "?img=" + encodeURIComponent(u) : u);
                  byRef.set(item.reference, item);
                  if (CACHE_API) _apiCache.set(item.reference + "|" + batchLocale, Promise.resolve(item));
                }
              }
            }
          }
        } catch (err) {
          console.error("[altered-card] batch fetch failed, falling back to individual calls", err);
          for (const e of entries) {
            AlteredCardElement._loadSingle(e.element, e.ref, e.locale, e.collection);
          }
          return;
        }

        // Distribute to each waiting element.
        for (const e of entries) {
          const renderKey = e.ref + "|" + e.locale;

          // ── Render cache hit: blit bitmap, skip everything ───────
          if (CACHE_RENDER) {
            const cachedBitmap = _renderCache.get(renderKey);
            if (cachedBitmap) {
              cachedBitmap.then(bmp => AlteredCardElement._mountBitmap(e.element, bmp))
                .catch(err => { _cardErrCanvas(e.element, e.ref, "render error"); console.error(err); });
              continue;
            }
          }

          // Serve from API cache if available (covers both batch results and previously cached refs).
          const cachedPromise = CACHE_API ? _apiCache.get(e.ref + "|" + batchLocale) : undefined;
          const data = byRef.get(e.ref) ?? (cachedPromise ? await cachedPromise : null);
          if (!data) {
            // Ref missing from batch response — fall back to individual call.
            AlteredCardElement._loadSingle(e.element, e.ref, e.locale, e.collection);
            continue;
          }
          // Set forge metadata — lang is per-element, not shared.
          data.forge = { collection: e.collection, lang: e.locale };
          AlteredRender.mountFromApi(e.element, data, undefined, { _resolvedProxy: _proxyBase })
            .then(({ canvas }) => {
              if (CACHE_RENDER && canvas && typeof createImageBitmap === "function")
                _renderCache.set(renderKey, createImageBitmap(canvas));
            })
            .catch(err => { _cardErrCanvas(e.element, e.ref, "render error"); console.error(err); });
        }
      }

      class AlteredCardElement extends HTMLElement {
        connectedCallback() {
          const ref = this.getAttribute("ref");
          if (!ref) return;
          // Already rendered — skip fetch and re-render on DOM re-insertion (e.g. hover overlays).
          if (CACHE_CANVAS && this.querySelector("canvas")) return;
          const locale     = this.getAttribute("locale")     || "en";
          const collection = this.getAttribute("collection") || DEFAULT_COLLECTION;

          if (FETCH_MODE === 2) {
            _batchQueue.push({ element: this, ref, locale, collection });
            if (!_batchScheduled) {
              _batchScheduled = true;
              AlteredRender.init({ configBaseUrl: _cfgBase })
                .then(() => setTimeout(_flushBatch, 0))
                .catch(err => {
                  _batchScheduled = false;
                  console.error("[altered-card] init error", err);
                  _batchQueue.splice(0).forEach(e => {
                    _cardErrCanvas(e.element, e.ref, "init error");
                  });
                });
            }
          } else {
            AlteredRender.init({ configBaseUrl: _cfgBase })
              .then(() => AlteredCardElement._loadSingle(this, ref, locale, collection))
              .catch(err => { _cardErrCanvas(this, ref, "init error"); console.error(err); });
          }
        }

        // Blit a cached ImageBitmap into a new canvas inside element.
        static _mountBitmap(element, bitmap) {
          const canvas = document.createElement("canvas");
          canvas.width  = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext("2d").drawImage(bitmap, 0, 0);
          element.innerHTML = "";
          element.appendChild(canvas);
        }

        // Mode 1 individual load — also used as fallback in mode 2.
        static async _loadSingle(element, ref, locale, collection) {
          const cacheKey = ref + "|" + locale;

          // ── Render cache hit: blit bitmap, skip everything else ──
          if (CACHE_RENDER) {
            const cachedBitmap = _renderCache.get(cacheKey);
            if (cachedBitmap) {
              AlteredCardElement._mountBitmap(element, await cachedBitmap);
              return;
            }
          }

          // ── API data cache ───────────────────────────────────────
          let dataPromise = CACHE_API ? _apiCache.get(cacheKey) : undefined;
          if (!dataPromise) {
            let url;
            if (_proxyBase === false) {
              url = RESOURCES.cardApiUrl
                .replace('{ref}',    encodeURIComponent(ref))
                .replace('{locale}', locale);
            } else {
              url = _proxyBase + "?ref=" + encodeURIComponent(ref) + "&locale=" + locale
                  + "&api=" + encodeURIComponent(RESOURCES.cardApiUrl);
            }
            dataPromise = fetch(url)
              .then(res => { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
              .then(data => {
                if (_proxyBase !== false && Array.isArray(data.assets))
                  data.assets = data.assets.map(u => u ? _proxyBase + "?img=" + encodeURIComponent(u) : u);
                return data;
              })
              .catch(err => { if (CACHE_API) _apiCache.delete(cacheKey); throw err; });
            if (CACHE_API) _apiCache.set(cacheKey, dataPromise);
          }
          let data;
          try {
            data = await dataPromise;
          } catch {
            _cardErrCanvas(element, ref, "not found");
            return;
          }
          data.forge = { collection, lang: locale };
          const { canvas } = await AlteredRender.mountFromApi(element, data, undefined, { _resolvedProxy: _proxyBase });

          // ── Store rendered bitmap for instant future renders ─────
          if (CACHE_RENDER && canvas && typeof createImageBitmap === "function") {
            _renderCache.set(cacheKey, createImageBitmap(canvas));
          }
        }
      }

      customElements.define("altered-card", AlteredCardElement);
    })();
  }

  // ── Export ────────────────────────────────────────────────────
  global.AlteredRender = AlteredRender;

})(window);
