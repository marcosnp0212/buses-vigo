// Converts Vitrasa's official GTFS into the app's data:
//  network-gtfs.json: lines, routes (official shapes, simplified) with stop distances, stops keyed by the real-time stop number
//  sched-gtfs.json:   compact timetable (patterns + trips + service dates) for every line
const fs = require('fs');
const path = require('path');
// GTFS folder (unzipped gtfs_vigo.zip): first argument, or gtfs/raw next to this script
const dir = path.resolve(process.argv[2] || path.join(__dirname, 'gtfs', 'raw'));

function csv(file) {
  const txt = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, '');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const out = {}; let i = 0, cur = '', q = false, k = 0;
    for (; i <= l.length; i++) {
      const ch = l[i];
      if (ch === '"') { q = !q; continue; }
      if ((ch === ',' && !q) || i === l.length) { out[head[k++]] = cur.trim(); cur = ''; } else cur += ch;
    }
    return out;
  });
}
const hav = (a, b) => { // [lat, lon]
  const t = Math.PI / 180, dLat = (b[0] - a[0]) * t, dLon = (b[1] - a[1]) * t;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
};
function simplify(c, tol) {
  if (c.length < 3) return c.map((_, i) => i);
  const k = Math.cos(c[0][0] * Math.PI / 180) * 111320, m = 110540, P = c.map((p) => [p[1] * k, p[0] * m]);
  const keep = new Uint8Array(c.length); keep[0] = keep[c.length - 1] = 1;
  const st = [[0, c.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let idx = -1, dmax = 0;
    const [ax, ay] = P[a], [bx, by] = P[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * P[i][0] - dx * P[i][1] + bx * ay - by * ax) / L; if (d > dmax) { dmax = d; idx = i; } }
    if (dmax > tol) { keep[idx] = 1; st.push([a, idx], [idx, b]); }
  }
  return [...keep.keys()].filter((i) => keep[i]);
}
const secs = (t) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + (s || 0); };
// "15B." / "4A-" / "LZD." are variants of the same line in the real-time feed
const baseCode = (s) => s.trim().replace(/[.\-]+$/, '').replace(/^TUR$/i, 'TURISTICO');

const routesTxt = csv('routes.txt'), tripsTxt = csv('trips.txt'), stopsTxt = csv('stops.txt');
const stopVid = new Map(), stops = {};
for (const s of stopsTxt) {
  const vid = parseInt(String(s.stop_code).replace(/^\D+/, ''), 10) || parseInt(s.stop_id, 10);
  stopVid.set(s.stop_id, vid);
  stops[vid] = [s.stop_name.replace(/\s{2,}/g, ' ').trim(), +(+s.stop_lat).toFixed(6), +(+s.stop_lon).toFixed(6)];
}
const routeInfo = new Map(routesTxt.map((r) => [r.route_id, r]));

// shapes
const shapes = new Map();
for (const p of csv('shapes.txt')) {
  if (!shapes.has(p.shape_id)) shapes.set(p.shape_id, []);
  shapes.get(p.shape_id).push([+p.shape_pt_sequence, +p.shape_pt_lat, +p.shape_pt_lon, +p.shape_dist_traveled]);
}
for (const v of shapes.values()) v.sort((a, b) => a[0] - b[0]);

// stop_times grouped by trip
const st = new Map();
for (const r of csv('stop_times.txt')) {
  if (!st.has(r.trip_id)) st.set(r.trip_id, []);
  st.get(r.trip_id).push(r);
}
for (const v of st.values()) v.sort((a, b) => +a.stop_sequence - +b.stop_sequence);

// lines
const lineByCode = new Map();
for (const r of routesTxt) {
  const code = baseCode(r.route_short_name); if (!code) continue;
  if (!lineByCode.has(code) || r.route_short_name.trim() === code) {
    lineByCode.set(code, { code, name: r.route_long_name.trim(), color: '#' + (r.route_color || '555555'), text: '#' + (r.route_text_color || 'ffffff') });
  }
}

// one route per (line, direction, shape) with the stop sequence of its most common pattern
const groups = new Map();
for (const t of tripsTxt) {
  const ri = routeInfo.get(t.route_id); if (!ri) continue;
  const code = baseCode(ri.route_short_name); if (!code) continue;
  const key = `${code}|${t.direction_id}|${t.shape_id}`;
  if (!groups.has(key)) groups.set(key, { code, dir: t.direction_id, shape: t.shape_id, trips: [], heads: new Map() });
  const g = groups.get(key); g.trips.push(t.trip_id); g.heads.set(t.trip_headsign, (g.heads.get(t.trip_headsign) || 0) + 1);
}
const routes = [];
for (const g of groups.values()) {
  const sh = shapes.get(g.shape); if (!sh || sh.length < 2) continue;
  // most common stop pattern among the trips of this shape
  const pats = new Map();
  for (const tid of g.trips) { const s = st.get(tid); if (!s) continue; const k = s.map((x) => x.stop_id).join(','); pats.set(k, (pats.get(k) || 0) + 1); }
  const bestPat = [...pats.entries()].sort((a, b) => b[1] - a[1])[0]; if (!bestPat) continue;
  const tripOf = g.trips.find((tid) => st.get(tid) && st.get(tid).map((x) => x.stop_id).join(',') === bestPat[0]);
  const seq = st.get(tripOf);
  const pts = sh.map((p) => [p[1], p[2]]);
  const keep = simplify(pts, 3);
  const coords = keep.map((i) => [+pts[i][0].toFixed(5), +pts[i][1].toFixed(5)]);
  let len = 0; for (let i = 1; i < coords.length; i++) len += hav(coords[i - 1], coords[i]);
  const shapeTotal = sh[sh.length - 1][3] || len;
  const scale = len / shapeTotal;
  const rstops = seq.map((x) => [stopVid.get(x.stop_id), Math.round((+x.shape_dist_traveled || 0) * scale)]);
  const head = [...g.heads.entries()].sort((a, b) => b[1] - a[1])[0][0];
  routes.push({ line: g.code, dir: +g.dir, shape: g.shape, rank: g.trips.length, head, length: Math.round(len), coords, stops: rstops });
}
// ids; keep variants that serve at least 3 trips
const kept = routes.filter((r) => r.rank >= 1);
// main trip per line and direction: the most complete one among the frequent ones (short runs like "García Barbón" are variants)
const byDir = new Map();
for (const r of kept) { const k = `${r.line}-${r.dir}`; if (!byDir.has(k)) byDir.set(k, []); byDir.get(k).push(r); }
for (const [k, list] of byDir) {
  const maxRank = Math.max(...list.map((r) => r.rank));
  const main = list.filter((r) => r.rank >= 0.3 * maxRank).sort((a, b) => b.stops.length - a.stops.length || b.rank - a.rank)[0];
  list.sort((a, b) => (b === main) - (a === main) || b.rank - a.rank);
  list.forEach((r, i) => { r.id = `${k}-${i + 1}`; r.main = r === main; });
}
kept.sort((a, b) => a.line.localeCompare(b.line, 'es', { numeric: true }) || a.dir - b.dir || b.main - a.main || b.rank - a.rank);

// timetable: patterns (stop list + offsets) and trips (pattern, start, service)
const patterns = [], patIdx = new Map(), trips = [], svcIdx = new Map(), services = [];
for (const t of tripsTxt) {
  const ri = routeInfo.get(t.route_id); const s = st.get(t.trip_id); if (!ri || !s) continue;
  const code = baseCode(ri.route_short_name);
  const t0 = secs(s[0].departure_time || s[0].arrival_time);
  const stopsP = s.map((x) => stopVid.get(x.stop_id)), off = s.map((x) => Math.round((secs(x.arrival_time) - t0) / 60));
  const key = code + '|' + t.trip_headsign + '|' + stopsP.join(',') + '|' + off.join(',');
  if (!patIdx.has(key)) { patIdx.set(key, patterns.length); patterns.push({ line: code, head: t.trip_headsign, stops: stopsP, off }); }
  if (!svcIdx.has(t.service_id)) { svcIdx.set(t.service_id, services.length); services.push(t.service_id); }
  trips.push([patIdx.get(key), Math.round(t0 / 60), svcIdx.get(t.service_id)]);
}
const dates = services.map(() => []);
for (const c of csv('calendar_dates.txt')) { const i = svcIdx.get(c.service_id); if (i !== undefined && c.exception_type === '1') dates[i].push(+c.date); }

const usedStops = {};
for (const r of kept) for (const [id] of r.stops) usedStops[id] = stops[id];
const lines = [...lineByCode.values()].filter((l) => kept.some((r) => r.line === l.code)).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
fs.writeFileSync(path.join(__dirname, 'network-gtfs.json'), JSON.stringify({ lines, routes: kept.map(({ shape, ...r }) => r), stops: usedStops }));
fs.writeFileSync(path.join(__dirname, 'sched-gtfs.json'), JSON.stringify({ patterns, trips, dates }));
const kb = (f) => (fs.statSync(path.join(__dirname, f)).size / 1024).toFixed(0) + ' KB';
console.log(`${lines.length} líneas, ${kept.length} trayectos (${kept.filter((r) => r.main).length} principales), ${Object.keys(usedStops).length} paradas; red ${kb('network-gtfs.json')}`);
console.log(`${patterns.length} patrones, ${trips.length} viajes, fechas ${Math.min(...dates.flat())}–${Math.max(...dates.flat())}; horario ${kb('sched-gtfs.json')}`);
console.log(lines.map((l) => l.code).join(' '));
