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

  test('waitForPixel executa callback quando fbq.loaded', () => {
    let called = false;
    window.waitForPixel(() => { called = true; });
    assert(called, 'callback imediato');
  });
}

// --- Static scan ---
console.log('\n--- Varredura estática ---\n');

const scanExts = ['.html', '.js'];
const findings = {
  fbqInit: [],
  fbqTrack: [],
  trackOnce: [],
  indexLead: [],
  indexViewContent: [],
  indexInitiateCheckout: [],
  indexPurchase: [],
  mapaRedirect: false,
};

function scanFile(filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  if (rel.startsWith('v777/') || rel.startsWith('leitura/')) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    const ln = i + 1;
    if (/fbq\s*\(\s*['"]init['"]/.test(line)) {
      findings.fbqInit.push({ file: rel, line: ln });
    }
    if (/fbq\s*\(\s*['"]track['"]/.test(line) && !/meta-tracking-utils/.test(rel)) {
      findings.fbqTrack.push({ file: rel, line: ln, code: line.trim().slice(0, 80) });
    }
    if (/trackOnce\s*\(/.test(line)) {
      findings.trackOnce.push({ file: rel, line: ln, code: line.trim().slice(0, 80) });
    }
    if (rel === 'index.html') {
      if (/trackOnce\s*\(\s*['"]Lead['"]/.test(line)) findings.indexLead.push(ln);
      if (/trackOnce\s*\(\s*['"]ViewContent['"]/.test(line)) findings.indexViewContent.push(ln);
      if (/trackOnce\s*\(\s*['"]InitiateCheckout['"]/.test(line)) findings.indexInitiateCheckout.push(ln);
      if (/trackOnce\s*\(\s*['"]Purchase['"]|trackPurchase\s*\(/.test(line)) findings.indexPurchase.push(ln);
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

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const rotator = fs.readFileSync(path.join(ROOT, 'js', 'vesto-global-rotator.js'), 'utf8');
const webhook = fs.readFileSync(path.join(ROOT, 'api', 'hotmart-webhook.js'), 'utf8');

test('index.html: PageView no carregamento', () => {
  assert(/fbq\s*\(\s*['"]track['"],\s*['"]PageView['"]/.test(indexHtml), 'PageView presente');
});

test('index.html: NÃO dispara Lead no quiz (só no botão WA pós-VSL)', () => {
  const startLoading = indexHtml.match(/function startLoading\(\)[\s\S]*?^}/m);
  assert(startLoading, 'startLoading existe');
  assert(!/trackOnce\s*\(\s*['"]Lead['"]/.test(startLoading[0]), 'sem Lead em startLoading');
  assert(findings.indexLead.length === 0, 'sem Lead inline no index.html');
});

test('index.html: NÃO dispara ViewContent', () => {
  assert(findings.indexViewContent.length === 0, 'sem ViewContent');
});

test('index.html: NÃO dispara InitiateCheckout (checkout é na Hotmart)', () => {
  assert(findings.indexInitiateCheckout.length === 0, 'sem IC no index');
  const slide19 = indexHtml.match(/if\s*\(\s*n\s*===\s*19\s*\)[\s\S]*?trackProgress\(\{\s*event:\s*'vsl_page'/);
  assert(slide19 && !/InitiateCheckout/.test(slide19[0]), 'slide 19 sem IC');
});

test('index.html: NÃO dispara Purchase no browser', () => {
  assert(findings.indexPurchase.length === 0, 'sem Purchase no index');
});

test('index.html: autoConfig desligado (evita Lead automático duplicado)', () => {
  assert(indexHtml.includes("fbq('set','autoConfig',false"), 'autoConfig false');
});

test('index.html: botão WA com data-fb-disable-automatic-logging', () => {
  assert(indexHtml.includes('data-fb-disable-automatic-logging'), 'disable auto log no botão');
});

test('Lead dispara no clique do botão WA pós-VSL (rotator)', () => {
  assert(rotator.includes("trackOnce('Lead'"), 'Lead via trackOnce');
  assert(rotator.includes('Quiz Almagemela Completado'), 'content_name correto');
  assert(rotator.includes('waitForPixel'), 'waitForPixel');
  assert(!rotator.includes("trackOnce('Contact'"), 'sem Contact no rotator');
});

test('/mapa: bridge PageView only — InitiateCheckout fica na Hotmart', () => {
  const mapa = fs.readFileSync(path.join(ROOT, 'mapa', 'index.html'), 'utf8');
  assert(mapa.includes("fbq('init','38539014385698035')"), 'pixel init');
  assert(mapa.includes("fbq('track','PageView')"), 'PageView');
  assert(!mapa.includes("trackOnce('InitiateCheckout'"), 'sem IC no bridge');
  assert(mapa.includes('pay.hotmart.com'), 'redirect Hotmart');
  assert(!findings.mapaRedirect, 'sem redirect server-side /mapa no vercel.json');
});

test('/acesso: bridge PageView only — InitiateCheckout fica na Hotmart', () => {
  const acesso = fs.readFileSync(path.join(ROOT, 'acesso', 'index.html'), 'utf8');
  assert(acesso.includes("fbq('track','PageView')"), 'PageView');
  assert(!acesso.includes("trackOnce('InitiateCheckout'"), 'sem IC no bridge');
});

test('Purchase: webhook Hotmart usa CAPI nativo (não duplica no browser)', () => {
  assert(webhook.includes("META_CAPI_FROM_WEBHOOK !== 'true'"), 'CAPI do webhook desligado por padrão');
  assert(webhook.includes('disabled_use_hotmart_native'), 'doc usa integração Hotmart');
});

test('api/mapa.js serve HTML (não redirect 302)', () => {
  const api = fs.readFileSync(path.join(ROOT, 'api', 'mapa.js'), 'utf8');
  assert(!api.includes('redirect(302'), 'sem redirect 302');
  assert(api.includes('text/html'), 'serve HTML');
});

test('next.config.js não redireciona /mapa ou /acesso', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'next.config.js'), 'utf8');
  assert(!/\/mapa[\s\S]*hotmart/.test(cfg), 'sem redirect /mapa');
  assert(!/\/acesso[\s\S]*hotmart/.test(cfg), 'sem redirect /acesso');
});

console.log('\n--- Resultados dos testes ---\n');
results.tests.forEach((t) => {
  console.log((t.ok ? '✅' : '❌') + ' ' + t.name + (t.error ? ' — ' + t.error : ''));
});
console.log(`\nTotal: ${results.passed} passou, ${results.failed} falhou\n`);

const reportPath = path.join(__dirname, 'audit-tracking-output.json');
fs.writeFileSync(
  reportPath,
  JSON.stringify({ date: new Date().toISOString(), funnel: {
    quiz: ['PageView', 'Lead (botão WA pós-VSL)'],
    checkout: ['InitiateCheckout (Hotmart nativo ao carregar checkout)'],
    purchase: ['Hotmart Pixel+CAPI nativo'],
  }, results, findings }, null, 2)
);
console.log('Relatório JSON: tests/audit-tracking-output.json');

process.exit(results.failed > 0 ? 1 : 0);
