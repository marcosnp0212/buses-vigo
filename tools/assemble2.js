// Assembles the network app: template + CSS + shared blocks, plus the data as separate compact JSON files.
// usage: node assemble2.js <network json in tools/> <output html>  → also writes data/net.json and data/sched.json next to the html
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const d = __dirname;
const r = (f) => fs.readFileSync(path.join(d, f), 'utf8');
const out = path.resolve(process.argv[3]);

// route shapes as Google encoded polylines (1e-5 degrees): a third of the size of coordinate arrays
function encodePolyline(coords) {
  let s = '', pLat = 0, pLon = 0;
  const put = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 32) { s += String.fromCharCode((32 | (v & 31)) + 63); v >>= 5; } s += String.fromCharCode(v + 63); };
  for (const [lat, lon] of coords) { const a = Math.round(lat * 1e5), o = Math.round(lon * 1e5); put(a - pLat); put(o - pLon); pLat = a; pLon = o; }
  return s;
}
const net = JSON.parse(r(process.argv[2] || 'network.json'));
net.routes = net.routes.map((x) => ({ ...x, coords: encodePolyline(x.coords) }));
// timetable: each distinct stop list once; patterns as [line, head, stop list, minute deltas]
const sched = JSON.parse(r('sched-gtfs.json'));
const seqs = [], seqIdx = new Map();
const patterns = sched.patterns.map((p) => {
  const k = p.stops.join(',');
  if (!seqIdx.has(k)) { seqIdx.set(k, seqs.length); seqs.push(p.stops); }
  return [p.line, p.head, seqIdx.get(k), p.off.map((v, i) => (i ? v - p.off[i - 1] : v))];
});
const files = { 'net.json': JSON.stringify(net), 'sched.json': JSON.stringify({ seqs, patterns, trips: sched.trips, dates: sched.dates }) };
// the version in the URL changes only when the data does, so browsers can cache it between visits
const ver = crypto.createHash('sha1').update(files['net.json']).update(files['sched.json']).digest('hex').slice(0, 10);

let t = r('app2-template.html');
t = t.replace('/*BASECSS*/', () => r('base.css'))
  .replace('/*TRIPBLOCK*/', () => r('tripblock2.js'))
  .replace('/*LOCATE*/', () => r('locate.js'))
  .replace('/*ALERT*/', () => r('alert.js'))
  .replaceAll('__DATAVER__', ver);
const js = t.match(/<script type="module">([\s\S]*)<\/script>/)[1];
new Function('return async () => {' + js + '}'); // syntax check
fs.mkdirSync(path.join(path.dirname(out), 'data'), { recursive: true });
for (const [f, txt] of Object.entries(files)) fs.writeFileSync(path.join(path.dirname(out), 'data', f), txt);
fs.writeFileSync(out, t);
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log('ok', kb(t.length), '+ datos', Object.entries(files).map(([f, x]) => `${f} ${kb(x.length)}`).join(', '), 'v' + ver);
