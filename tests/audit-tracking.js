#!/usr/bin/env node
/**
 * Meta Pixel audit — Almagemela Quiz
 * Run: node tests/audit-tracking.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const results = { passed: 0, failed: 0, tests: [], fbqLog: [] };

function test(name, fn) {
  try {
    fn();
    results.passed++;
    results.tests.push({ name, ok: true });
  } catch (e) {
    results.failed++;
    results.tests.push({ name, ok: false, error: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function createMockEnv() {
  const storage = {};
  const fbqLog = [];

  const sessionStorage = {
    getItem(k) { return storage[k] ?? null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; },
    clear() { Object.keys(storage).forEach((k) => delete storage[k]); },
  };
  const storageApi = sessionStorage;

  function fbq() {
    const args = Array.from(arguments);
    fbqLog.push({ method: args[0], args: args.slice(1), ts: Date.now() });
    if (args[0] === 'track' || args[0] === 'trackCustom') return;
  }
  fbq.loaded = true;
  fbq.queue = [];

  const sandbox = { sessionStorage, fbq, crypto: { randomUUID: () => 'test-uuid-' + fbqLog.length } };
  sandbox.window = sandbox;

  const utilsPath = path.join(ROOT, 'js', 'meta-tracking-utils.js');
  const utilsCode = fs.readFileSync(utilsPath, 'utf8');
  vm.runInNewContext(utilsCode, sandbox, { filename: 'meta-tracking-utils.js' });

  return { window: sandbox, fbqLog, sessionStorage, storage };
}

console.log('═══════════════════════════════════════════════');
console.log('  TESTES AUTOMATIZADOS — META PIXEL');
console.log('  ' + new Date().toISOString());
console.log('═══════════════════════════════════════════════\n');

// --- trackOnce basics ---
{
  const { window, fbqLog, storage } = createMockEnv();
  test('trackOnce dispara fbq track com eventID', () => {
    const id = window.trackOnce('Lead', { content_name: 'test' });
    assert(id === 'test-uuid-0', 'retorna eventId');
    assert(fbqLog.length === 1, '1 disparo');
    assert(fbqLog[0].args[0] === 'Lead', 'evento Lead');
    assert(fbqLog[0].args[2]?.eventID, 'tem eventID');
  });

  test('trackOnce bloqueia re-fire na mesma sessão', () => {
    const id2 = window.trackOnce('Lead', { content_name: 'test2' });
    assert(id2 === null, 'segundo Lead bloqueado');
    assert(fbqLog.length === 1, 'ainda 1 disparo');
  });

  test('trackInitiateCheckout bloqueado sem Lead', () => {
    Object.keys(storage).forEach((k) => delete storage[k]);
    fbqLog.length = 0;
    const ic = window.trackInitiateCheckout({ value: 9, currency: 'USD' });
    assert(ic === null, 'IC sem Lead = null');
    assert(fbqLog.length === 0, 'nenhum fbq');
  });

  test('trackInitiateCheckout dispara após Lead', () => {
    window.trackOnce('Lead', {});
    const ic = window.trackInitiateCheckout({ value: 9, currency: 'USD' });
    assert(ic !== null, 'IC após Lead');
    assert(fbqLog.some((x) => x.args[0] === 'InitiateCheckout'), 'InitiateCheckout no log');
  });

  test('trackPurchase bloqueado sem InitiateCheckout', () => {
    Object.keys(storage).forEach((k) => delete storage[k]);
    fbqLog.length = 0;
    window.trackOnce('Lead', {});
    const p = window.trackPurchase({ value: 9, currency: 'USD' });
    assert(p === null, 'Purchase sem IC = null');
  });

  test('trackPurchase dispara após Lead + IC', () => {
    window.trackInitiateCheckout({ value: 9, currency: 'USD' });
    const p = window.trackPurchase({ value: 9, currency: 'USD' });
    assert(p !== null, 'Purchase após IC');
    assert(fbqLog.some((x) => x.args[0] === 'Purchase'), 'Purchase no log');
  });

  test('trackOnceCustom usa trackCustom', () => {
    Object.keys(storage).forEach((k) => delete storage[k]);
    fbqLog.length = 0;
    window.trackOnceCustom('order-bump', { content_name: 'x' });
    assert(fbqLog[0].method === 'trackCustom', 'trackCustom');
    assert(fbqLog[0].args[0] === 'order-bump', 'nome custom');
  });

  test('waitForPixel executa callback quando fbq.loaded', (done) => {
    let called = false;
    window.waitForPixel(() => { called = true; });
    assert(called, 'callback imediato');
  });
}

// --- Static scan ---
console.log('\n--- Varredura estática ---\n');

const scanExts = ['.html', '.js'];
const scanDirs = [ROOT];
const findings = {
  fbqInit: [],
  fbqTrack: [],
  fbqTrackCustom: [],
  trackOnce: [],
  waitForPixel: [],
  directFbqContact: [],
  mapaRedirect: false,
};

function scanFile(filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    const ln = i + 1;
    if (/fbq\s*\(\s*['"]init['"]/.test(line)) {
      const m = line.match(/init['"],\s*['"](\d+)['"]/);
      findings.fbqInit.push({ file: rel, line: ln, pixelId: m ? m[1] : '38539014385698035' });
    }
    if (/fbq\s*\(\s*['"]track['"]/.test(line) && !/meta-tracking-utils/.test(rel)) {
      findings.fbqTrack.push({ file: rel, line: ln, code: line.trim().slice(0, 80) });
    }
    if (/fbq\s*\(\s*['"]trackCustom['"]/.test(line)) {
      findings.fbqTrackCustom.push({ file: rel, line: ln, code: line.trim().slice(0, 80) });
    }
    if (/trackOnce\s*\(/.test(line)) {
      findings.trackOnce.push({ file: rel, line: ln, code: line.trim().slice(0, 80) });
    }
    if (/waitForPixel\s*\(/.test(line)) {
      findings.waitForPixel.push({ file: rel, line: ln, code: line.trim().slice(0, 80) });
    }
    if (/fbq\s*\(\s*['"]track['"],\s*['"]Contact['"]/.test(line)) {
      findings.directFbqContact.push({ file: rel, line: ln });
    }
  });
}

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '__pycache__' || ent.name === 'tests') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (scanExts.some((e) => ent.name.endsWith(e))) scanFile(full);
  }
}

walk(ROOT);

const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
findings.mapaRedirect = (vercel.redirects || []).some(
  (r) => r.source === '/mapa' && r.destination && r.destination.includes('hotmart')
);

test('Produção index.html carrega meta-tracking-utils.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert(html.includes('meta-tracking-utils.js'), 'utils presente');
});

test('Produção index.html dispara Lead em startLoading', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const startLoading = html.match(/function startLoading\(\)[\s\S]*?^}/m);
  assert(startLoading, 'startLoading existe');
  assert(/trackOnce\s*\(\s*['"]Lead['"]/.test(startLoading[0]), 'Lead via trackOnce');
});

test('/mapa serve página intermediária com Pixel + InitiateCheckout', () => {
  const mapa = fs.readFileSync(path.join(ROOT, 'mapa', 'index.html'), 'utf8');
  assert(mapa.includes("fbq('init','38539014385698035')"), 'pixel init');
  assert(mapa.includes("trackOnce('InitiateCheckout'"), 'InitiateCheckout via trackOnce');
  assert(mapa.includes('meta-tracking-utils.js'), 'utils carregado');
  assert(!findings.mapaRedirect, 'sem redirect server-side /mapa');
});

test('next.config.js não redireciona /mapa ou /acesso', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'next.config.js'), 'utf8');
  assert(!/\/mapa[\s\S]*hotmart/.test(cfg), 'sem redirect /mapa');
  assert(!/\/acesso[\s\S]*hotmart/.test(cfg), 'sem redirect /acesso');
});

test('api/mapa.js serve HTML em vez de redirect 302', () => {
  const api = fs.readFileSync(path.join(ROOT, 'api', 'mapa.js'), 'utf8');
  assert(!api.includes('redirect(302'), 'sem redirect 302');
  assert(api.includes('text/html'), 'serve HTML');
});

test('Produção index.html dispara InitiateCheckout no slide 19', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const block = html.match(/if\s*\(\s*n\s*===\s*19\s*\)[\s\S]*?trackProgress\(\{\s*event:\s*'vsl_page'/);
  assert(block, 'bloco slide 19 existe');
  assert(/trackOnce\s*\(\s*['"]InitiateCheckout['"]/.test(block[0]), 'InitiateCheckout via trackOnce');
  assert(block[0].includes("'Oferta Almagemela'"), 'content_name Oferta');
});

test('index.html produção dispara Contact via rotator (trackOnce)', () => {
  const rot = fs.readFileSync(path.join(ROOT, 'js', 'vesto-global-rotator.js'), 'utf8');
  assert(rot.includes("trackOnce('Contact'"), 'Contact via trackOnce');
  assert(rot.includes('waitForPixel'), 'waitForPixel no Contact');
});

console.log('\n--- Resultados dos testes ---\n');
results.tests.forEach((t) => {
  console.log((t.ok ? '✅' : '❌') + ' ' + t.name + (t.error ? ' — ' + t.error : ''));
});
console.log(`\nTotal: ${results.passed} passou, ${results.failed} falhou\n`);

// Write JSON report for reference
const reportPath = path.join(__dirname, 'audit-tracking-output.json');
fs.writeFileSync(
  reportPath,
  JSON.stringify({ date: new Date().toISOString(), results, findings }, null, 2)
);
console.log('Relatório JSON: tests/audit-tracking-output.json');

process.exit(results.failed > 0 ? 1 : 0);
