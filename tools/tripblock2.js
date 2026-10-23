// ---------- trip logic ----------
const tripRoute = line => routesOfLine(line).filter(r => r.stopById.has(prefs.origin) && r.stopById.has(prefs.dest) && r.stopById.get(prefs.dest).d > r.stopById.get(prefs.origin).d).sort((a, b) => b.main - a.main || b.rank - a.rank)[0];
const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');   // 24 h whatever the phone's locale
// ---- official timetable (GTFS): patterns of stops with minute offsets, trips with start minute and service dates ----
const SVC = SCHED.dates.map(d => new Set(d));
const STOPIDX = new Map(), TRIPS_BY_PAT = SCHED.patterns.map(() => []);
SCHED.patterns.forEach((p, pi) => p.stops.forEach((s, i) => { if (!STOPIDX.has(s)) STOPIDX.set(s, []); STOPIDX.get(s).push([pi, i]); }));
SCHED.trips.forEach(([pi, start, svc]) => TRIPS_BY_PAT[pi].push([start, svc]));
const ymd = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
// The timetable covers one week. Outside it, use the same weekday of the covered week (Vitrasa repeats it weekly).
const COVERED = new Set(SCHED.dates.flat());
const COV_MIN = Math.min(...COVERED), COV_MAX = Math.max(...COVERED);
function serviceKey(day) {
  let k = ymd(day); if (COVERED.has(k)) return k;
  const d = new Date(day);
  for (let i = 0; i < 400 && !COVERED.has(k); i++) { d.setDate(d.getDate() + (k > COV_MAX ? -7 : 7)); k = ymd(d); if (k < COV_MIN && k > COV_MAX) break; }
  return k;
}
// scheduled passes of 'line' (or any line when null) at 'stop' between 'from' and 'from + toMin', as [{t, ruta, line, pi, pos}]
function schedule(stop, line, from, toMin) {
  const out = [], until = from.getTime() + toMin * 60000;
  for (const dayOff of [-1, 0, 1]) {
    const day = new Date(from); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + dayOff);
    const key = serviceKey(day), base = day.getTime();
    for (const [pi, pos] of STOPIDX.get(stop) || []) {
      const P = SCHED.patterns[pi]; if (line && P.line !== line) continue;
      for (const [start, svc] of TRIPS_BY_PAT[pi]) {
        if (!SVC[svc].has(key)) continue;
        const t = base + (start + P.off[pos]) * 60000;
        if (t >= from.getTime() && t <= until) out.push({ t: new Date(t), ruta: niceRuta(P.head), line: P.line, pi, pos });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
// Vitrasa splits some trips in two at a terminus: the A reaches "Universidade." and a minute later leaves Enxeñeiros,
// two metres away, as another trip that goes round the campus. Same line, same spot, within a few minutes: same bus.
const CONT = new Map();
function continuations(pi) {
  if (!CONT.has(pi)) {
    const P = SCHED.patterns[pi], end = STOPS.get(P.stops[P.stops.length - 1]), near = id => { const s = STOPS.get(id); return s && end && hav([s.lat, s.lon], [end.lat, end.lon]) < 80; };
    CONT.set(pi, SCHED.patterns.map((Q, qi) => qi).filter(qi => qi !== pi && SCHED.patterns[qi].line === P.line && near(SCHED.patterns[qi].stops[0])));
  }
  return CONT.get(pi);
}
// when a trip that passed 'pos' of pattern 'pi' at 'passT' gets to 'stop' (following its continuation if it ends before), or null
function arrivalAt(pi, pos, passT, stop) {
  const P = SCHED.patterns[pi], j = P.stops.indexOf(stop, pos + 1);
  if (j >= 0) return new Date(passT.getTime() + (P.off[j] - P.off[pos]) * 60000);
  const endT = new Date(passT.getTime() + (P.off[P.off.length - 1] - P.off[pos]) * 60000);
  const day = new Date(endT); day.setHours(0, 0, 0, 0); const key = serviceKey(day), endMin = Math.round((endT - day) / 60000);
  for (const qi of continuations(pi)) {
    const k = SCHED.patterns[qi].stops.indexOf(stop); if (k < 0) continue;
    for (const [start, svc] of TRIPS_BY_PAT[qi]) if (SVC[svc].has(key) && start >= endMin && start <= endMin + 6) return new Date(day.getTime() + (start + SCHED.patterns[qi].off[k]) * 60000);
  }
  return null;
}
const sameRuta = (a, b) => a.replace(/\W/g, '').toLowerCase() === b.replace(/\W/g, '').toLowerCase();
function delayFor(line, ruta, min) {
  const now = new Date(), pred = new Date(now.getTime() + min * 60000);
  let list = schedule(prefs.origin, line, new Date(now.getTime() - 40 * 60000), 120);
  if (list.some(x => sameRuta(x.ruta, ruta))) list = list.filter(x => sameRuta(x.ruta, ruta));
  let best = null;
  for (const x of list) { const diff = Math.round((pred - x.t) / 60000); if (Math.abs(diff) <= 20 && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, at: x.t }; }
  return best;
}
// the scheduled trip closest to 'passT' at the origin: does its stop list continue to the destination? when does it get there?
function rutaReachesDest(line, ruta, passT) {
  let c = schedule(prefs.origin, line, new Date(passT.getTime() - 20 * 60000), 40);
  if (c.some(x => sameRuta(x.ruta, ruta))) c = c.filter(x => sameRuta(x.ruta, ruta));
  const x = c.sort((a, b) => Math.abs(a.t - passT) - Math.abs(b.t - passT))[0];
  if (!x) return null;
  const t = arrivalAt(x.pi, x.pos, x.t, prefs.dest);
  return t ? { t } : null;
}
const hasSchedule = (stop, line) => (STOPIDX.get(stop) || []).some(([pi]) => SCHED.patterns[pi].line === line);
function trips() {
  const atO = results.get(prefs.origin), atD = results.get(prefs.dest);
  if (!atO) return null;
  const now = new Date();
  const out = [], usedDest = new Set();
  for (const e of atO.slice().sort((a, b) => a.minutos - b.minutos)) {
    const r = tripRoute(e.linea); if (!r) continue;
    const gap = r.stopById.get(prefs.dest).d - r.stopById.get(prefs.origin).d;
    const expect = e.metros + gap;
    let destMin = null, sure = false;
    const passT = new Date(now.getTime() + e.minutos * 60000);
    const sch = rutaReachesDest(e.linea, e.ruta, passT);
    const knowsLabel = hasSchedule(prefs.origin, e.linea);
    // when the timetable knows this line at the destination, it decides whether this trip gets there
    const mayReach = sch ? true : knowsLabel ? false : !/fadrique|remata/i.test(e.ruta);
    if (atD && mayReach) {
      // each bus at the destination can only be one of ours, and must arrive after it passes our stop
      const c = atD.filter(x => x.linea === e.linea && !usedDest.has(x) && x.minutos >= e.minutos + gap / 1000)
        .map(x => ({ x, err: Math.abs(x.metros - expect) })).sort((a, b) => a.err - b.err)[0];
      if (c && c.err < Math.max(900, 0.35 * expect)) { destMin = c.x.minutos; sure = true; usedDest.add(c.x); }
    }
    const reaches = mayReach;
    if (destMin === null && reaches) {
      // timetable gives the travel time between the two stops; otherwise ~2.4 min per km
      destMin = sch ? Math.round(e.minutos + (sch.t - (delayFor(e.linea, e.ruta, e.minutos)?.at || passT)) / 60000) : Math.round(e.minutos + gap / 1000 * 2.4);
    }
    out.push({ kind: 'live', e, line: e.linea, ruta: e.ruta, min: e.minutos, r, along: r.stopById.get(prefs.origin).d - e.metros, destMin, sure, reaches, delay: delayFor(e.linea, e.ruta, e.minutos) });
  }
  // timetable departures not covered by a live bus (beyond the live horizon, or buses not yet out)
  for (const line of LINES) {
    const r = tripRoute(line); if (!r) continue;
    for (const x of schedule(prefs.origin, line, now, 90)) {
      const min = Math.round((x.t - now) / 60000);
      const covered = out.some(t => t.line === line && t.delay && Math.abs(t.delay.at - x.t) < 60000);
      if (covered || min < 0) continue;
      const atDest = rutaReachesDest(line, x.ruta, x.t);
      if (!atDest) continue;
      out.push({ kind: 'sched', line, ruta: x.ruta, min, r, destMin: Math.round((atDest.t - now) / 60000), sure: false, reaches: true, delay: null, at: x.t });
    }
  }
  return out.sort((a, b) => (b.reaches - a.reaches) || (a.min - b.min));
}
let heroBus = null, heroTrip = null;   // the bus shown big for the trip, and its departure
function stateBadge(t) {
  if (t.kind === 'sched') return `<span class="state">Segundo o horario</span>`;
  const d = t.delay; if (!d) return '';
  if (d.diff >= 2) return `<span class="state late">${d.diff} min tarde</span>`;
  if (d.diff <= -2) return `<span class="state early">${-d.diff} min adiantado</span>`;
  return `<span class="state ok">Á súa hora</span>`;
}
function renderHero() {
  const el = document.getElementById('hero');
  if (!hasTrip()) { heroBus = null; heroTrip = null; return; }
  const list = trips();
  if (list === null) { el.innerHTML = results.has(prefs.origin) ? `<div class="empty">A túa parada non responde agora. Volvo tentalo nuns segundos.</div>` : `<div class="empty">Consultando a túa parada…</div>`; return; }
  const t = list.find(x => x.reaches); heroTrip = t || null;
  if (!t) { el.innerHTML = `<div class="empty">Ningún bus vai cara a ${shortName(stopName(prefs.dest))} na próxima hora e media.</div>`; heroBus = null; renderNext(list); return; }
  const now = new Date();
  const passAt = hhmm(new Date(now.getTime() + t.min * 60000)), arrAt = t.destMin !== null ? hhmm(new Date(now.getTime() + t.destMin * 60000)) : '—';
  let progress = '';
  heroBus = null;
  if (t.kind === 'live') {
    const passed = t.r.stops.filter(s => s.d <= t.along).pop();
    const windowM = 6000, pct = Math.max(4, Math.min(100, 100 * (1 - t.e.metros / windowM)));
    const startStop = t.r.stops.filter(s => s.d <= t.r.stopById.get(prefs.origin).d - windowM).pop();
    const stopsLeft = t.r.stops.filter(s => s.d > t.along && s.d <= t.r.stopById.get(prefs.origin).d).length;
    progress = `<div class="bar"><div style="width:${pct}%;background:${t.r.color}"></div></div>
      <div class="marks"><span>${startStop ? shortName(startStop.name) : ''}</span><span>${passed ? `Por ${shortName(passed.name)}` : 'Saíndo da cabeceira'}</span><span>${stopsLeft <= 0 ? 'Xa chega' : stopsLeft === 1 ? 'Falta 1 parada' : `Faltan ${stopsLeft} paradas`}</span></div>`;
    heroBus = [...buses.values()].filter(b => b.route === t.r).sort((a, b) => Math.abs(a.fix - t.along) - Math.abs(b.fix - t.along))[0] || null;
    if (heroBus && Math.abs(heroBus.fix - t.along) > 1500) heroBus = null;
  } else {
    progress = `<div class="sub">Aínda non saíu: é a hora do horario de Vitrasa.</div>`;
  }
  const following = follow && heroBus && follow === heroBus.id;
  el.innerHTML = `
    <div class="row1"><span class="who">${badge(t.line)}<span>${t.ruta}</span></span>${stateBadge(t)}</div>
    ${t.min <= 0 ? `<div class="big now">Chegando</div>` : `<div class="big">${t.min}<small>min</small></div>`}
    <div class="sub n">Pasa ás <b>${passAt}</b> e chegas a ${shortName(stopName(prefs.dest))} ás <b>${arrAt}</b>${t.sure ? '' : ' (aprox.)'}</div>
    ${progress}
    <div class="actions">
      <button class="btn sig" id="alertBtn" aria-pressed="${alertOn}">${alertOn ? 'Aviso activado' : 'Avisarme'}</button>
      <button class="btn" id="followBtn" aria-pressed="${!!following}" ${t.kind === 'sched' ? 'disabled' : ''}>${following ? 'Seguíndoo' : 'Ver no mapa'}</button>
    </div>`;
  document.getElementById('alertBtn').onclick = toggleAlert;
  document.getElementById('followBtn').onclick = () => {
    if (!heroBus) { toast('Este bus aínda non está no mapa'); return; }
    if (following) { follow = null; } else { follow = heroBus.id; map.setView(heroBus.marker.getLatLng(), Math.max(map.getZoom(), 15)); showBusCard(heroBus); }
    renderHero(); restyleBuses();
  };
  restyleBuses();
  checkAlert(t);
  renderNext(list, t);
}
function nextLabel(t) {
  if (!t.reaches) return 'Non vai ao teu destino';
  const arr = t.destMin !== null ? `, chegas ás ${hhmm(new Date(Date.now() + t.destMin * 60000))}` : '';
  if (t.kind === 'sched') return 'Segundo o horario' + arr;
  const d = t.delay;
  return (d ? (d.diff >= 2 ? `${d.diff} min tarde` : d.diff <= -2 ? `${-d.diff} min adiantado` : 'Á súa hora') : 'En camiño') + arr;
}
function renderNext(list, hero) {
  const el = document.getElementById('nextList');
  const rest = (list || []).filter(t => t !== hero && t.reaches).slice(0, 4);
  if (!rest.length) { el.innerHTML = `<div class="empty">Ningún máis na próxima hora e media.</div>`; return; }
  el.innerHTML = rest.map(t => `<div class="dep">${badge(t.line)}<span class="to"><b>${t.ruta}</b><span>${nextLabel(t)}</span></span>${whenHtml([t.min], t.kind === 'live')}</div>`).join('');
}
// ---------- bus card ----------
let busCardId = null;
function showBusCard(b) { busCardId = b ? b.id : null; renderBusCard(); }
function renderBusCard() {
  const el = document.getElementById('busCard');
  const b = busCardId && buses.get(busCardId);
  if (!b) { el.hidden = true; return; }
  const r = b.route, ahead = r.stops.filter(s => s.d > b.shown).slice(0, 4);
  const rows = ahead.map(s => {
    const l = results.get(s.id);
    const e = l && l.filter(x => x.linea === r.line).map(x => ({ x, err: Math.abs(x.metros - (s.d - b.fix)) })).sort((p, q) => p.err - q.err)[0];
    const min = e && e.err < 900 + 0.3 * (s.d - b.fix) ? e.x.minutos : Math.max(0, Math.round((s.d - b.shown) / 1000 * 2.4));
    const mine = s.id === prefs.origin ? 'a túa parada' : s.id === prefs.dest ? 'o teu destino' : '';
    return `<div class="item"><span class="d">${s.name}${mine ? `<span>${mine}</span>` : ''}</span><span class="m n">${min <= 0 ? 'Xa' : min + ' min'}</span></div>`;
  }).join('');
  const following = follow === b.id;
  el.innerHTML = `<div class="bc-h">${badge(r.line)}<b>${b.info.ruta}</b><button class="x" id="busClose" aria-label="Pechar">✕</button></div>
    <div class="sub">As súas próximas paradas</div>${rows || `<div class="empty">Chegando ao final da liña.</div>`}
    <div class="actions"><button class="btn${following ? '' : ' pri'}" id="busFollow">${following ? 'Deixar de seguir' : 'Seguir este bus'}</button></div>`;
  el.hidden = false;
  el.querySelector('#busClose').onclick = () => { busCardId = null; if (follow === b.id) { follow = null; renderHero(); restyleBuses(); } renderBusCard(); setHighlight(null); };
  el.querySelector('#busFollow').onclick = () => { follow = following ? null : b.id; if (follow) map.setView(b.marker.getLatLng(), Math.max(map.getZoom(), 15)); renderHero(); restyleBuses(); renderBusCard(); };
}

// ---------- trip editor ----------
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let editing = 'origin';
function openEditor(which) {
  editing = which || 'origin';
  const el = document.getElementById('editor'); el.hidden = false;
  document.getElementById('edOrigin').textContent = prefs.origin ? stopName(prefs.origin) : 'Sen escoller';
  document.getElementById('edDest').textContent = prefs.dest ? stopName(prefs.dest) : 'Sen escoller';
  document.getElementById('edOriginBtn').setAttribute('aria-pressed', String(editing === 'origin'));
  document.getElementById('edDestBtn').setAttribute('aria-pressed', String(editing === 'dest'));
  const q = document.getElementById('edSearch'); q.value = ''; q.placeholder = editing === 'origin' ? 'Onde subes? Rúa ou número de parada' : 'Onde baixas? Rúa ou número de parada';
  renderSearch(); setTimeout(() => q.focus(), 50);
}
function closeEditor() { document.getElementById('editor').hidden = true; }
function renderSearch() {
  const q = document.getElementById('edSearch').value.trim();
  let list, hint = '';
  if (q) list = findStops(q).slice(0, 30);
  else if (myPos) { list = [...STOPS.values()].sort((a, b) => hav([a.lat, a.lon], myPos) - hav([b.lat, b.lon], myPos)).slice(0, 8); hint = 'Preto de ti'; }
  else { list = prefs.favs.map(id => STOPS.get(id)); hint = list.length ? 'As túas paradas' : 'Escribe a rúa ou o número que aparece no poste da parada.'; }
  document.getElementById('edResults').innerHTML = (hint ? `<div class="hint">${hint}</div>` : '') + list.map(s => stopRow(s, false)).join('')
    + (q && !list.length ? `<div class="empty">Ningunha parada se chama así. Proba con outra palabra ou co número do poste.</div>` : '');
}
function setTripStop(which, id) {
  if (which === 'origin') { if (id === prefs.dest) prefs.dest = prefs.origin; prefs.origin = id; }
  else { if (id === prefs.origin) prefs.origin = prefs.dest; prefs.dest = id; }
  viewStop = prefs.dest; savePrefs(); afterTripChange();
}

