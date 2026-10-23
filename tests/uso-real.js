// Proba de uso real: o que fai unha persoa co móbil, paso a paso e con xestos de dedo, e en cada pantalla unha
// revisión de accesibilidade (contraste, tamaño de letra e de botóns, nomes para lectores de pantalla, nada tapado).
//
//   cd tests && npm install && node uso-real.js            (CHROME=/ruta/a/chrome se non está en /opt/pw-browsers)
//   REAL=1 node uso-real.js     co mapa e a API de verdade (precisa internet; así córrese en GitHub Actions)
//
// A API de Vitrasa simúlase con datos coherentes coa rede real (liñas que pasan pola parada, destinos reais,
// metros que cadran cos minutos) e en ISO-8859-1, como a de verdade. Capturas en tests/out/.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'out'), NM = process.env.NM || path.join(__dirname, 'node_modules');
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find(f => fs.existsSync(f)), REAL = !!process.env.REAL;
fs.mkdirSync(OUT, { recursive: true });

// ---------- API simulada ----------
const net = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/net.json'), 'utf8'));
const routesAt = {};
for (const r of net.routes) if (r.main) for (const [id] of r.stops) (routesAt[id] ||= []).push(r);
let apiDown = false;
function estimates(id) {
  const out = []; let h = id % 97;
  for (const r of routesAt[id] || []) {
    h = (h * 31 + r.line.length * 7 + r.line.charCodeAt(0)) % 997;
    const every = 8 + h % 15, first = 1 + h % every;               // un bus cada 8-22 min
    for (let m = first; m < 60; m += every) out.push({ linea: r.line, ruta: r.head || r.line, minutos: m, metros: Math.round(m * 260 + (h % 7) * 20) });
  }
  return { parada: [{ nombre: 'Parada ' + id }], estimaciones: out };
}
const latin1 = s => Buffer.from(s, 'latin1');

// ---------- revisión de accesibilidade dunha pantalla ----------
async function audit(page, name) {
  const r = await page.evaluate(() => {
    const vis = el => { const s = getComputedStyle(el), b = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 && b.width > 0 && b.height > 0 && b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth && !el.closest('[hidden]'); };
    const rgb = c => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 0]; };
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c[3] === undefined || c[3] > 0.5) return c; } return rgb(getComputedStyle(document.body).backgroundColor); };
    const fails = [], warns = [];
    const label = el => (el.getAttribute('aria-label') || el.textContent || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    // botóns e campos: nome accesible e tamaño para o dedo (24 px mínimo WCAG 2.2 AA; 44 px recomendado)
    for (const el of document.querySelectorAll('button, a[href], input, [role=button]')) {
      if (!vis(el)) continue;
      const b = el.getBoundingClientRect(), nm = label(el) || (el.labels && el.labels[0] && el.labels[0].textContent.trim()) || el.placeholder;
      if (!nm) fails.push(`botón sen nome: ${el.outerHTML.slice(0, 80)}`);
      if (el.closest('.leaflet-control-attribution')) continue;   // a atribución legal do mapa é texto, non un botón
      if (b.width < 24 || b.height < 24) fails.push(`botón pequeno ${Math.round(b.width)}×${Math.round(b.height)}: ${nm}`);
      else if ((b.width < 44 || b.height < 44) && !el.classList.contains('link') && !el.closest('.leaflet-control-attribution')) warns.push(`botón ${Math.round(b.width)}×${Math.round(b.height)} (<44): ${nm}`);
    }
    // texto: tamaño e contraste
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      const el = n.parentElement; if (!n.textContent.trim() || seen.has(el) || !vis(el) || el.closest('.leaflet-control-attribution, svg')) continue; seen.add(el);
      const s = getComputedStyle(el), px = parseFloat(s.fontSize), bold = +s.fontWeight >= 600, txt = n.textContent.trim().slice(0, 30);
      if (px < 11) fails.push(`letra de ${px}px: "${txt}"`); else if (px < 12) warns.push(`letra de ${px}px: "${txt}"`);
      const fg = rgb(s.color), bg = bgOf(el), a = (fg[3] ?? 1) * +s.opacity;
      const mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
      const L1 = lum(mix), L2 = lum(bg), cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
      if (cr < need) fails.push(`contraste ${cr.toFixed(2)} (<${need}): "${txt}"`);
    }
    // nada tapado: as etiquetas dos buses entre si, e os nomes das paradas entre si
    const rects = sel => [...document.querySelectorAll(sel)].filter(vis).map(e => ({ e, b: e.getBoundingClientRect() }));
    const cross = (A, what) => { for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) { const a = A[i].b, b = A[j].b, ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ox > 4 && oy > 4) fails.push(`${what} tapados: "${label(A[i].e)}" e "${label(A[j].e)}"`); } };
    const pills = rects('.busp'); cross(pills, 'buses'); cross(rects('.stn-lbl'), 'nomes de parada');
    for (const { e } of pills) if (!e.getAttribute('aria-label')) fails.push('bus sen descrición para lector de pantalla');
    if (document.scrollingElement.scrollWidth > innerWidth + 1) fails.push('a páxina desprázase de lado');
    return { fails, warns, pills: pills.map(p => p.e.textContent.trim()) };
  });
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  return r;
}

// ---------- xestos ----------
const pause = (page, ms = 600) => page.waitForTimeout(ms);
async function tap(page, locator) { const b = await locator.boundingBox(); if (!b) throw new Error('non se ve: ' + locator); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await pause(page); }
async function drag(page, x, y, dx, dy) {
  const s = await page.context().newCDPSession(page), steps = 12;
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) { await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / steps, y: y + dy * i / steps }] }); await page.waitForTimeout(16); }
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pause(page, 900);
}
async function doubleTap(page, x, y) { await page.touchscreen.tap(x, y); await page.waitForTimeout(120); await page.touchscreen.tap(x, y); await pause(page, 1200); }
// cantas cores de liña (non fondo) hai debuxadas no mapa nunha zona
async function inkOnMap(page) {
  return page.evaluate(() => { let n = 0; for (const c of document.querySelectorAll('.leaflet-overlay-pane canvas')) { const x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 200 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 60) n++; } return n; });
}

// ---------- o escenario ----------
const results = [];
function check(step, ok, detail = '') { results.push({ step, ok, detail }); console.log(`${ok ? 'OK  ' : 'FALLA'} ${step}${detail ? ' — ' + detail : ''}`); }
async function screenCheck(page, step, name) {
  const a = await audit(page, name);
  check(`${step}: accesibilidade`, !a.fails.length, a.fails.slice(0, 6).join('; '));
  if (a.warns.length) console.log('      avisos:', [...new Set(a.warns)].slice(0, 6).join('; '));
  return a;
}

async function newPhone(browser, { dark = false, desktop = false, state } = {}) {
  const ctx = await browser.newContext(desktop ? { viewport: { width: 1366, height: 820 }, colorScheme: dark ? 'dark' : 'light', storageState: state }
    : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light', storageState: state,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (REAL && !u.startsWith('http://local/') && !(apiDown && u.includes('datos.vigo.org'))) return route.continue();
    const lib = { 'leaflet-maplibre-gl.js': '@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl.js', 'leaflet.js': 'leaflet/dist/leaflet.js', 'leaflet.css': 'leaflet/dist/leaflet.css', 'maplibre-gl.js': 'maplibre-gl/dist/maplibre-gl.js', 'maplibre-gl.css': 'maplibre-gl/dist/maplibre-gl.css' };
    for (const k in lib) if (u.endsWith(k)) return route.fulfill({ path: path.join(NM, lib[k]) });
    if (u.includes('fonts.googleapis')) return route.fulfill({ contentType: 'text/css', body: [300, 400, 500, 600].map(w => `@font-face{font-family:'Jost';font-weight:${w};src:url(http://local/__font/jost-latin-${w}-normal.woff2)}`).join('\n') });
    if (u.includes('/__font/')) return route.fulfill({ path: path.join(NM, '@fontsource/jost/files', u.split('/__font/')[1]), contentType: 'font/woff2' });
    if (u.includes('openfreemap.org/styles')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': u.endsWith('dark') ? '#1b232a' : '#ece8df' } }] }) });
    if (u.includes('datos.vigo.org')) return apiDown ? route.fulfill({ status: 503, body: 'down' }) : route.fulfill({ contentType: 'application/json; charset=ISO-8859-1', body: latin1(JSON.stringify(estimates(+new URL(u).searchParams.get('id')))) });
    if (u.startsWith('http://local/')) { const f = path.join(ROOT, decodeURIComponent(new URL(u).pathname)); if (fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ path: f }); return route.fulfill({ status: 404, body: '' }); }
    return route.abort();
  });
  return { ctx, page, errors };
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const { ctx, page, errors } = await newPhone(browser);

  // 1. Primeira visita
  await page.goto('http://local/index.html'); await pause(page, 2500);
  check('1. primeira visita: invita a gardar paradas', await page.getByText('Garda as paradas que usas').isVisible());
  await screenCheck(page, '1. benvida', '01-benvida');

  // 2. Busca a súa parada escribindo, como faría calquera, e gárdaa coa estrela
  await tap(page, page.locator('#wFind'));
  await page.keyboard.type('policarpo', { delay: 90 }); await pause(page);
  const first = page.locator('#fdResults .res').filter({ hasText: 'Policarpo Sanz 40' }).first();
  check('2. a busca atopa "Policarpo Sanz 40"', await first.isVisible());
  await screenCheck(page, '2. busca', '02-busca');
  await tap(page, first.locator('[data-star]'));
  await page.fill('#fdSearch', ''); await page.keyboard.type('torrecedeira 16', { delay: 90 }); await pause(page);
  const second = page.locator('#fdResults .res').filter({ hasText: 'Torrecedeira 16' }).first();
  check('2. a busca atopa "Torrecedeira 16"', await second.isVisible());
  await tap(page, second.locator('[data-star]'));
  await tap(page, page.locator('#fdClose'));

  // 3. Inicio: cando chega cada bus ás súas paradas (coa API de verdade pode tardar un pouco)
  await page.locator('#favs .dep').first().waitFor({ timeout: 15000 }).catch(() => {}); await pause(page, 1500);
  const rows = await page.locator('#favs .dep').count();
  check('3. inicio: amosa chegadas ás dúas paradas', rows >= 2 && await page.locator('#favs .fav').count() === 2, `${rows} chegadas`);
  check('3. inicio: di que os datos son en directo', await page.getByText('En directo').isVisible());
  await screenCheck(page, '3. inicio', '03-inicio');

  // 4. Mira o mapa: baixa o panel
  await tap(page, page.locator('#sheetGrab')); await pause(page, 1500);
  const a4 = await screenCheck(page, '4. mapa', '04-mapa');
  check('4. mapa: como moito 5 buses, cada un co tempo que lle falta', a4.pills.length > 0 && a4.pills.length <= 5 && a4.pills.every(t => /\d+ min|chegando/.test(t)), a4.pills.join(' | '));
  { const ink = await inkOnMap(page); check('4. mapa: as liñas ata as paradas están debuxadas', ink > 300, ink + ' px de liña'); }
  check('4. mapa: as paradas din o seu nome', await page.locator('.stn-lbl:visible').count() >= 1);

  // 5. Toca un bus: ve a súa liña enteira; toca o mapa baleiro e desaparece
  await tap(page, page.locator('.busp').first());
  check('5. tocar un bus abre a súa ficha', await page.locator('#busCard').isVisible());
  await screenCheck(page, '5. ficha do bus', '05-bus');
  await page.touchscreen.tap(60, 420); await pause(page, 800);
  check('5. tocar o mapa pecha a ficha', !(await page.locator('#busCard').isVisible()));

  // 6. Arrasta o mapa co dedo e achégase con dobre toque
  await drag(page, 200, 500, -80, -120);
  await doubleTap(page, 200, 420);
  check('6. arrastrar e achegar sen erros', errors.length === 0, errors.join('; '));
  await screenCheck(page, '6. mapa achegado', '06-achegado');

  // 7. Abre a súa parada desde a lista e escolle un bus
  await tap(page, page.locator('#sheetGrab'));
  await tap(page, page.locator('.fav-open').first()); await pause(page, 2500);
  check('7. parada: panel aberto con chegadas', await page.locator('#stopPanel').isVisible() && await page.locator('#stopPanel').getByText('min').first().isVisible());
  await screenCheck(page, '7. parada', '07-parada');
  await tap(page, page.locator('#spClose'));
  check('7. pechar a parada volve ao inicio', !(await page.locator('#stopPanel').isVisible()));

  // 8. Volve outro día: as súas paradas seguen aí
  const state = await ctx.storageState();
  const t0 = Date.now(); await page.reload();
  await page.locator('#favs .dep').first().waitFor({ timeout: 15000 });
  check('8. ao abrila, as chegadas aparecen en menos de 4 s', Date.now() - t0 < 4000, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await pause(page, 1500);
  check('8. ao volver, as paradas seguen gardadas', await page.locator('#favs .fav').count() === 2 && !(await page.getByText('Garda as paradas que usas').isVisible()));
  await ctx.close();

  // 9. Vitrasa sen datos: horario oficial e aviso claro
  apiDown = true;
  const down = await newPhone(browser, { state });
  await down.page.goto('http://local/index.html'); await pause(down.page, 4000);
  check('9. sen datos: avisa e amosa o horario', await down.page.getByText('amosamos o horario oficial').isVisible() && await down.page.locator('#favs .dep').count() > 0);
  await screenCheck(down.page, '9. sen datos', '09-sen-datos');
  await down.ctx.close(); apiDown = false;

  // 10. De noite (tema escuro) e no ordenador
  const night = await newPhone(browser, { dark: true, state });
  await night.page.goto('http://local/index.html'); await pause(night.page, 4000);
  await screenCheck(night.page, '10. tema escuro', '10-escuro'); await night.ctx.close();
  const desk = await newPhone(browser, { desktop: true, state });
  await desk.page.goto('http://local/index.html'); await pause(desk.page, 4000);
  await screenCheck(desk.page, '11. ordenador', '11-ordenador');
  check('11. sen erros en ningunha pantalla', errors.length + desk.errors.length + night.errors.length + down.errors.length === 0);
  await desk.ctx.close();

  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} pasos ben. Capturas en ${path.relative(process.cwd(), OUT)}/`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
