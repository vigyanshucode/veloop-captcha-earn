const http = require('http');
const fs = require('fs');
const path = require('path');

function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
    if (postData) req.write(postData);
    req.end();
  });
}

(async function(){
  let log = [];
  const push = (s) => { console.log(s); log.push(s); };
  push('T3 — CORS Hardening — LIVE Evidence Collected ' + new Date().toISOString());
  push('Backend: http://localhost:5000');
  push('FRONTEND_URL (from env): http://localhost:5173');
  push('');
  let passes = 0, fails = 0;

  const BASE = { hostname: 'localhost', port: 5000 };
  const assertEq = (label, got, want, opts = {}) => {
    const ok = opts.caseInsensitive ? String(got).toLowerCase() === String(want).toLowerCase() : got === want;
    if (ok) { push('[LIVE-PASS] ' + label + (opts.detail ? ' (' + opts.detail + ')' : '')); passes++; }
    else { push('[LIVE-FAIL] ' + label + '  expected=' + JSON.stringify(want) + '  got=' + JSON.stringify(got)); fails++; }
    return ok;
  };
  const assertHas = (label, haystack, needle) => {
    const ok = (haystack || '').toString().toLowerCase().includes(String(needle).toLowerCase());
    if (ok) { push('[LIVE-PASS] ' + label + ' (found: ' + needle + ')'); passes++; }
    else { push('[LIVE-FAIL] ' + label + '  MISSING needle=' + JSON.stringify(needle)); fails++; }
    return ok;
  };
  const assertAbsent = (label, haystack, needle) => {
    const ok = !(haystack || '').toString().toLowerCase().includes(String(needle).toLowerCase());
    if (ok) { push('[LIVE-PASS] ' + label + ' (correctly absent: ' + needle + ')'); passes++; }
    else { push('[LIVE-FAIL] ' + label + '  UNEXPECTED needle=' + JSON.stringify(needle)); fails++; }
    return ok;
  };

  push('=== Test 1: Allowed Origin http://localhost:5173 ===');
  const t1 = await makeRequest({ ...BASE, path: '/api/health', method: 'GET', headers: { 'Origin': 'http://localhost:5173' } });
  push('  status=' + t1.status + '  body=' + (t1.body||'').substring(0,100));
  push('  access-control-allow-origin=' + JSON.stringify(t1.headers['access-control-allow-origin']));
  assertEq('Status 200 (allowed origin)', t1.status, 200);
  assertEq('ACAO header = exact origin (localhost:5173), NOT *', t1.headers['access-control-allow-origin'], 'http://localhost:5173');
  assertAbsent('ACAO header != wildcard *', t1.headers['access-control-allow-origin'] || '', '*');

  push('\n=== Test 2: Allowed Dev Origin http://127.0.0.1:5173 ===');
  const t2 = await makeRequest({ ...BASE, path: '/api/health', method: 'GET', headers: { 'Origin': 'http://127.0.0.1:5173' } });
  push('  status=' + t2.status);
  push('  access-control-allow-origin=' + JSON.stringify(t2.headers['access-control-allow-origin']));
  assertEq('Status 200 (allowed dev fallback)', t2.status, 200);
  assertEq('ACAO header = exact origin (127.0.0.1:5173)', t2.headers['access-control-allow-origin'], 'http://127.0.0.1:5173');

  push('\n=== Test 3: DISALLOWED Origin https://evil-attacker.com ===');
  const t3 = await makeRequest({ ...BASE, path: '/api/health', method: 'GET', headers: { 'Origin': 'https://evil-attacker.com' } });
  push('  status=' + t3.status);
  push('  access-control-allow-origin=' + JSON.stringify(t3.headers['access-control-allow-origin']));
  push('  body (first 200 chars)=' + JSON.stringify((t3.body||'').substring(0,200)));
  assertAbsent('NO ACAO for attacker origin (evil-attacker.com)', t3.headers['access-control-allow-origin'] || '', 'evil-attacker');
  assertAbsent('NO wildcard * in ACAO for attacker origin', t3.headers['access-control-allow-origin'] || '', '*');
  if (!t3.headers['access-control-allow-origin']) { passes++; push('[LIVE-PASS] ACAO header completely absent for attacker origin -> browser blocks CORS'); }
  else { fails++; push('[LIVE-FAIL] ACAO header present for attacker origin'); }

  push('\n=== Test 4: No Origin header (same-origin / server request) ===');
  const t4 = await makeRequest({ ...BASE, path: '/api/health', method: 'GET' });
  push('  status=' + t4.status);
  assertEq('Status 200 (no-Origin request still succeeds, server-side)', t4.status, 200);
  assertHas('health body contains running/api message', t4.body || '', 'running');

  push('\n=== Test 5: Preflight OPTIONS - allowed origin + POST method ===');
  const t5 = await makeRequest({
    ...BASE, path: '/api/auth/login', method: 'OPTIONS',
    headers: {
      'Origin': 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type,Authorization',
    }
  });
  push('  status=' + t5.status);
  push('  access-control-allow-origin=' + JSON.stringify(t5.headers['access-control-allow-origin']));
  push('  access-control-allow-methods=' + JSON.stringify(t5.headers['access-control-allow-methods']));
  push('  access-control-allow-headers=' + JSON.stringify(t5.headers['access-control-allow-headers']));
  assertEq('Preflight status 204 No Content', t5.status, 204);
  assertEq('Preflight ACAO = localhost:5173 (exact, not *)', t5.headers['access-control-allow-origin'], 'http://localhost:5173');
  assertHas('Preflight ACAM includes POST', t5.headers['access-control-allow-methods'] || '', 'POST');
  assertHas('Preflight ACAH includes Content-Type', t5.headers['access-control-allow-headers'] || '', 'Content-Type');
  assertHas('Preflight ACAH includes Authorization', t5.headers['access-control-allow-headers'] || '', 'Authorization');

  push('\n=== Test 6: Preflight OPTIONS - DISALLOWED origin ===');
  const t6 = await makeRequest({
    ...BASE, path: '/api/auth/login', method: 'OPTIONS',
    headers: {
      'Origin': 'https://phish.evil.com',
      'Access-Control-Request-Method': 'POST',
    }
  });
  push('  status=' + t6.status);
  push('  access-control-allow-origin=' + JSON.stringify(t6.headers['access-control-allow-origin']));
  push('  access-control-allow-methods=' + JSON.stringify(t6.headers['access-control-allow-methods']));
  assertAbsent('Disallowed preflight: NO ACAO for phish.evil.com', t6.headers['access-control-allow-origin'] || '', 'phish.evil');
  assertAbsent('Disallowed preflight: NO ACAO wildcard *', t6.headers['access-control-allow-origin'] || '', '*');
  if (!t6.headers['access-control-allow-origin']) { passes++; push('[LIVE-PASS] Disallowed preflight: ACAO absent -> browser blocks'); }
  else { fails++; push('[LIVE-FAIL] Disallowed preflight: ACAO unexpectedly present'); }

  push('\n=== Test 7: Verify server.js does NOT contain origin wildcard / origin:true ===');
  const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const hasWildcardDirect = /origin\s*:\s*["']\*["']/.test(serverCode);
  const hasTrueNoValidate = /origin\s*:\s*true\b/.test(serverCode);
  push('  hardcoded origin:"*" in server.js? ' + hasWildcardDirect);
  push('  origin:true (no-validation reflect) in server.js? ' + hasTrueNoValidate);
  if (!hasWildcardDirect) { passes++; push('[LIVE-PASS] No hardcoded origin wildcard in server.js (CORS allow-all removed)'); }
  else { fails++; push('[LIVE-FAIL] Found origin:"*" in server.js'); }
  if (!hasTrueNoValidate) { passes++; push('[LIVE-PASS] No origin:true (unvalidated reflect) in server.js'); }
  else { fails++; push('[LIVE-FAIL] Found origin:true without validation in server.js'); }

  push('\n========== T3 CORS RESULT ==========');
  push('LIVE-PASS: ' + passes + ' / LIVE-FAIL: ' + fails);
  push('Total assertions: ' + (passes + fails));

  const outPath = path.join(__dirname, '..', 'docs', 'phase7-t3-cors-hardening.log');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, log.join('\n'));
  push('');
  push('Evidence saved to docs/phase7-t3-cors-hardening.log');

  process.exit(fails > 0 ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
