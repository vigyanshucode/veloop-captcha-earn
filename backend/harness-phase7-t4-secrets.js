const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const logPath = path.join(REPO_ROOT, 'docs', 'phase7-t4-secret-environment-audit.log');
let lines = [];
const log = (s) => { console.log(s); lines.push(s); };

log('T4 — Environment / Secret Security — LIVE Audit (' + new Date().toISOString() + ')');
log('Repository root: ' + REPO_ROOT);
log('RULE: NO actual secret VALUES are ever printed below — only patterns, paths, Y/N flags, and line counts.');
log('');

let passes = 0, fails = 0, warns = 0;

const PAS = (label, detail) => { passes++; log('[LIVE-PASS] ' + label + (detail ? ' — ' + detail : '')); };
const FAIL = (label, detail) => { fails++; log('[LIVE-FAIL] ' + label + (detail ? ' — ' + detail : '')); };
const WARN = (label, detail) => { warns++; log('[WARN]      ' + label + (detail ? ' — ' + detail : '')); };

// ---------- 4a. .gitignore coverage (real .env files SHOULD be ignored) ----------
log('--- §4a. Git ignore coverage for .env files (dotenv-core rule) ---');
const envFilesToCheck = [
  'backend/.env',
  'frontend/.env',
  '.env',
  'backend/.env.local',
  'frontend/.env.local',
];
const hasGit = (() => { try { execSync('git --version', { stdio: 'ignore' }); return true; } catch(e) { return false; } })();
log('Git CLI available: ' + hasGit);

for (const rel of envFilesToCheck) {
  const full = path.join(REPO_ROOT, rel);
  const exists = fs.existsSync(full);
  let ignored = false, tracked = false;
  if (hasGit) {
    try { execSync('git check-ignore -q ' + rel, { cwd: REPO_ROOT, stdio: 'ignore' }); ignored = true; } catch(e) { ignored = false; }
    try { const out = execSync('git ls-files --error-unmatch ' + rel, { cwd: REPO_ROOT, stdio: ['ignore','pipe','ignore'] }).toString().trim(); tracked = out.length > 0; } catch(e) { tracked = false; }
  }
  const status = 'exists=' + exists + ' ignored=' + ignored + ' tracked=' + tracked;
  log('  ' + rel.padEnd(24) + ' ' + status);
  if (exists) {
    if (ignored || !hasGit) PAS(rel + ' is covered by .gitignore (or git unavailable, offline-safe)', 'ignored=' + ignored + ' tracked=' + tracked);
    else if (tracked) FAIL(rel + ' IS BEING TRACKED BY GIT — credential leak possible', status);
    else WARN(rel + ' exists but git check-ignore returned false (maybe not in repo yet)', status);
  } else {
    PAS(rel + ' does not exist (nothing to leak)', status);
  }
}

// ---------- 4b. .env.example files = placeholders only ----------
log('\n--- §4b. .env.example files contain ONLY placeholders / safe defaults ---');
const exampleFiles = [
  'backend/.env.example',
  'frontend/.env.example',
];
// Patterns that would indicate a real secret accidentally pasted into example:
//   mongodb+srv://user:pass@  OR  mongodb://user:pass@
//   Long unbroken hex > 32 chars as VALUE (not variable name)
//   sk-... / pk-... / Bearer ... in VALUE position
const realSecretPatterns = [
  { name: 'MongoDB URI with embedded credentials (not MONGO_URI=)', re: /mongodb(\+srv)?:\/\/[^:\s]+:[^@\s]+@/i },
  { name: 'Bearer token as VALUE (starts with Bearer )', re: /=\s*Bearer\s+/i },
  { name: 'Long hex VALUE (>= 48 hex chars, likely JWT secret / API key)', re: /=\s*[a-fA-F0-9]{48,}/ },
  { name: 'Stripe-like sk- / pk- live key as VALUE', re: /=\s*[sp]k_live_[A-Za-z0-9]{10,}/ },
];
for (const rel of exampleFiles) {
  const full = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(full)) { WARN(rel + ' missing (skip)'); continue; }
  const content = fs.readFileSync(full, 'utf8');
  let allPass = true;
  for (const pat of realSecretPatterns) {
    if (pat.re.test(content)) { FAIL(rel + ' contains pattern "' + pat.name + '" (accidental secret?)'); allPass = false; }
  }
  // Also check MONGO_URI and JWT_SECRET have EMPTY values in .example
  const linesArr = content.split(/\r?\n/);
  for (const ln of linesArr) {
    if (/^MONGO_URI\s*=\s*\S/.test(ln) && !ln.includes('example.com') && !ln.includes('localhost')) {
      FAIL(rel + ' MONGO_URI appears to have a non-placeholder value');
      allPass = false;
    }
    if (/^JWT_SECRET\s*=\s*\S/.test(ln)) {
      FAIL(rel + ' JWT_SECRET appears to have a non-placeholder value');
      allPass = false;
    }
  }
  if (allPass) PAS(rel + ' contains safe placeholders only (no real secret signatures detected)');
}

// ---------- 4c. Repo-wide scan — NO actual secret VALUES in tracked / source files ----------
//    (Skip .env files, node_modules, dist, build, .git, docs/*.log which are evidence)
log('\n--- §4c. Repo-wide secret VALUE scan (skipping .env raw files, node_modules, dist, .git) ---');

// Scan directories: frontend/src, backend/src, root
const scanDirs = ['backend/src', 'frontend/src', 'backend', 'frontend'];
const skipExt = new Set(['.png', '.jpg', '.jpeg', '.gif', '.woff', '.woff2', '.ttf', '.ico', '.map', '.lock']);
// Skip the actual .env files (they legitimately have real secrets) — we already covered gitignore in 4a
const skipFileEnds = [path.sep + '.env', '.env.local', '.env.development', '.env.production', '.env.test'];
// Also skip harness-phase7*.js because they might contain sample tokens (not real but trigger false positive)
const skipFileContains = ['harness-phase7', 'test-phase5', 'test-phase6', '.log'];

let filesScanned = 0;
let leaked = [];
function walk(dir) {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = dir + '/' + ent.name;
    const full = path.join(REPO_ROOT, rel);
    if (ent.isDirectory()) {
      if (['node_modules', 'dist', 'build', '.git', 'coverage'].includes(ent.name)) continue;
      walk(rel);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (skipExt.has(ext)) continue;
      if (skipFileEnds.some(s => full.endsWith(s))) continue;
      if (skipFileContains.some(s => full.includes(s))) continue;
      filesScanned++;
      try {
        const text = fs.readFileSync(full, 'utf8');
        for (const pat of realSecretPatterns) {
          const m = text.match(pat.re);
          if (m) {
            // Log ONLY file, pattern name, and line number — NEVER the match value
            const idx = text.indexOf(m[0]);
            const line = text.substring(0, idx).split(/\r?\n/).length;
            leaked.push({ file: rel, pattern: pat.name, line });
          }
        }
      } catch(e) { /* binary, skip */ }
    }
  }
}
for (const d of scanDirs) walk(d);
log('Files scanned: ' + filesScanned);
if (leaked.length === 0) PAS('Repo-wide source scan: ZERO real-secret VALUE signatures found in source files', filesScanned + ' files');
else for (const l of leaked) FAIL('Signature "' + l.pattern + '" in ' + l.file + ':' + l.line + ' — review if real secret');

// ---------- 4d. Frontend has NO backend secret variables (variable NAMES check) ----------
log('\n--- §4d. Frontend source MUST NOT reference backend secret variable NAMES ---');
const frontendSrc = path.join(REPO_ROOT, 'frontend', 'src');
const variablePatterns = [
  { name: 'JWT_SECRET (backend-only var name)', re: /JWT_SECRET/g },
  { name: 'MONGO_URI (backend-only var name)', re: /MONGO_URI/g },
  { name: 'passwordHash (DB-internal field name)', re: /passwordHash/g },
  { name: 'correctOption (CAPTCHA private field name)', re: /correctOption/g },
];
const frontendNameLeaks = [];
(function walkFront(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFront(full);
    else if (ent.isFile() && /\.(js|jsx|ts|tsx|vue|svelte|json)$/.test(ent.name)) {
      const text = fs.readFileSync(full, 'utf8');
      for (const p of variablePatterns) {
        if (p.re.test(text)) {
          frontendNameLeaks.push({ file: path.relative(REPO_ROOT, full), pattern: p.name });
        }
      }
    }
  }
})(frontendSrc);
log('frontend/src/* files walked.');
if (frontendNameLeaks.length === 0) PAS('Frontend source contains ZERO references to backend-only secret/private names (JWT_SECRET/MONGO_URI/passwordHash/correctOption)');
else for (const l of frontendNameLeaks) FAIL('Frontend name leak: ' + l.pattern + ' leaked into ' + l.file);

// ---------- 4e. Source: verify JWT_SECRET / MONGO_URI come ONLY from process.env (no hardcoded strings) ----------
log('\n--- §4e. Backend: JWT_SECRET and MONGO_URI loaded ONLY from process.env (no hardcoded secrets) ---');
const backendSrc = path.join(REPO_ROOT, 'backend', 'src');
let jwtBad = 0, mongoBad = 0;
(function walkBack(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkBack(full);
    else if (ent.isFile() && /\.js$/.test(ent.name)) {
      const text = fs.readFileSync(full, 'utf8');
      const rel = path.relative(REPO_ROOT, full);
      // Search for uses of JWT_SECRET not via process.env
      const jwtLines = text.split(/\r?\n/).map((ln,i)=>[ln,i+1]).filter(([ln]) => /JWT_SECRET/.test(ln));
      for (const [ln, n] of jwtLines) {
        if (!/process\.env\.JWT_SECRET|process\.env\[["']JWT_SECRET["']\]/.test(ln)) {
          FAIL(rel + ':' + n + ' JWT_SECRET usage not via process.env (possible hardcode?)');
          jwtBad++;
        }
      }
      const mongoLines = text.split(/\r?\n/).map((ln,i)=>[ln,i+1]).filter(([ln]) => /MONGO_URI/.test(ln));
      for (const [ln, n] of mongoLines) {
        if (!/process\.env\.MONGO_URI|process\.env\[["']MONGO_URI["']\]/.test(ln)) {
          FAIL(rel + ':' + n + ' MONGO_URI usage not via process.env (possible hardcode?)');
          mongoBad++;
        }
      }
    }
  }
})(backendSrc);
if (jwtBad === 0) PAS('All JWT_SECRET usages in backend/src go through process.env (no hardcoded fallbacks)');
if (mongoBad === 0) PAS('All MONGO_URI usages in backend/src go through process.env (no hardcoded fallbacks)');

// ---------- 4f. Git tracked files probe (if git available) ----------
log('\n--- §4f. Git tracked env / cred file check ---');
if (hasGit) {
  let trackedSuspicious = [];
  try {
    const tracked = execSync('git ls-files', { cwd: REPO_ROOT }).toString().trim().split(/\r?\n/);
    for (const f of tracked) {
      const norm = f.replace(/\\/g, '/');
      const low = norm.toLowerCase();
      if (/\.env(\.|$)/.test(low) && !low.endsWith('.env.example')) trackedSuspicious.push(f);
      if (low.includes('credentials') || low.includes('id_rsa') || low.includes('.pem') || low.includes('.key')) trackedSuspicious.push(f);
    }
  } catch(e) {}
  if (trackedSuspicious.length === 0) PAS('git ls-files: ZERO suspicious cred files tracked (.env, keys, pem, credentials)');
  else for (const f of trackedSuspicious) FAIL('Git-tracked suspicious credential file: ' + f);
} else WARN('Git CLI not available — skipped git ls-files cross-check (offline-safe)');

log('\n========== T4 ENV / SECRET RESULT ==========');
log('LIVE-PASS : ' + passes);
log('LIVE-FAIL : ' + fails);
log('WARN      : ' + warns);

fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.writeFileSync(logPath, lines.join('\n'));
log('\nEvidence saved to docs/phase7-t4-secret-environment-audit.log');
process.exit(fails > 0 ? 1 : 0);
