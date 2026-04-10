<?php
// Proxy — bypasses browser CORS restrictions.
//
// Card JSON:  altered-card-renderer-proxy.php?ref=ALT_CORE_B_AX_04_U_10&locale=fr
// Image:      altered-card-renderer-proxy.php?img=https://s3.amazonaws.com/…/card.jpg
//
// ── Configuration ─────────────────────────────────────────────────
//
// The card API URL is configured in RESOURCES.cardApiUrl in altered-card-renderer.js
// and passed here via the ?api= parameter. Only domains listed in
// $ALLOWED_API_DOMAINS below are accepted (SSRF protection).

// CORS origin — '*' allows all domains. Restrict to a specific domain if needed.
$CORS_ORIGIN = '*';

// Allowed image proxy domains (SSRF protection).
// Add any CDN or S3 bucket host that serves card images.
$ALLOWED_IMG_DOMAINS = [
  'altered-prod-eu.s3.amazonaws.com',
  'img.altered-db.com',
];

// Allowed card API domains (SSRF protection).
// The API URL is passed by the renderer via ?api= — only whitelisted domains are accepted.
$ALLOWED_API_DOMAINS = [
  'altered-core-cards-api.toxicity.be',
  'api.altered.gg',
];

// ──────────────────────────────────────────────────────────────────

header('Access-Control-Allow-Origin: ' . $CORS_ORIGIN);

// ── Image proxy ───────────────────────────────────────────────────
if (isset($_GET['img'])) {
  $url  = $_GET['img'];
  $host = parse_url($url, PHP_URL_HOST);
  if (!in_array($host, $ALLOWED_IMG_DOMAINS)) { http_response_code(403); exit('Forbidden'); }

  $ctx  = stream_context_create(['http' => ['timeout' => 10]]);
  $body = @file_get_contents($url, false, $ctx);
  if ($body === false) { http_response_code(502); exit('Upstream error'); }

  // Forward content-type from response headers
  $ct = 'image/jpeg';
  foreach ($http_response_header as $h) {
    if (stripos($h, 'content-type:') === 0) { $ct = trim(substr($h, 13)); break; }
  }
  header("Content-Type: $ct");
  echo $body;
  exit;
}

// ── Card JSON proxy ───────────────────────────────────────────────
$ref    = preg_replace('/[^A-Z0-9_]/', '', $_GET['ref']    ?? '');
$locale = preg_replace('/[^a-z]/',     '', $_GET['locale'] ?? 'en');
$apiTpl = $_GET['api'] ?? '';

if (!$ref)    { http_response_code(400); exit('Missing ref'); }
if (!$apiTpl) { http_response_code(400); exit('Missing api'); }

$apiHost = parse_url($apiTpl, PHP_URL_HOST);
if (!in_array($apiHost, $ALLOWED_API_DOMAINS)) { http_response_code(403); exit('Forbidden'); }

$url = str_replace(['{ref}', '{locale}'], [$ref, $locale], $apiTpl);
$ctx  = stream_context_create(['http' => ['timeout' => 10]]);
$body = @file_get_contents($url, false, $ctx);

if ($body === false) { http_response_code(502); exit('Upstream error'); }

$json = json_decode($body, true);
if ($json !== null) {
  if (!isset($json['forge'])) $json['forge'] = [];
  $json['forge']['lang'] = $locale;
  $body = json_encode($json);
}

header('Content-Type: application/json');
echo $body;
