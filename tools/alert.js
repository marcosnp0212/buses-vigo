// ---------- alert ----------
// With the page open it beeps and notifies from here. With the push server set up (tools/push-config.js, push/README.md)
// the alert also reaches the phone with the web closed: the server watches the bus and sends a push.
let alertOn = false, alerted = null, audio, pushSub = null;
const swReady = 'serviceWorker' in navigator ? navigator.serviceWorker.register('sw.js?push=' + encodeURIComponent(PUSH.url)).catch(() => null) : Promise.resolve(null);
const pushable = () => !!(PUSH.url && PUSH.key && 'PushManager' in window && 'serviceWorker' in navigator && 'Notification' in window);
const iosBrowser = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone;
const keyBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
function beep() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); const o = audio.createOscillator(), g = audio.createGain(); o.connect(g); g.connect(audio.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.2, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.6); o.start(); o.stop(audio.currentTime + 0.6); } catch (e) {} }
async function notify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    // Android only shows notifications through the service worker; the same tag as the server's, so they never double up
    const reg = await swReady;
    if (reg) reg.showNotification(title, { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'bus-alert', renotify: true });
    else new Notification(title, { body, tag: 'bus-alert' });
  } catch (e) {}
}
async function pushOn(t) {
  if (!pushable()) return false;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  pushSub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUSH.key) });
  const res = await fetch(PUSH.url + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sub: pushSub.toJSON(), stop: prefs.origin, line: t.line, lead: 5, minutes: Math.max(30, t.min + 30), stopName: shortName(stopName(prefs.origin)) }) });
  return res.ok;
}
function pushOff() {
  if (!pushSub) return;
  fetch(PUSH.url + '/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: pushSub.endpoint }) }).catch(() => {});
  pushSub = null;
}
async function toggleAlert() {
  alertOn = !alertOn; alerted = null;
  renderHero();
  if (!alertOn) { pushOff(); toast('Aviso quitado'); return; }
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  let remote = false;
  try { remote = !!heroTrip && await pushOn(heroTrip); } catch (e) {}
  if (remote) toast('Aviso 5 minutos antes da chegada, tamén coa web pechada');
  else if (PUSH.url && iosBrowser()) toast('Para o aviso coa web pechada, engade a web á pantalla de inicio. Mentres, mantena aberta');
  else {
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
    toast('Aviso 5 minutos antes da chegada. Mantén a web aberta');
  }
}
function checkAlert(t) {
  if (!alertOn || !t || t.kind !== "live" || t.min > 5 || !prefs.origin) return;
  // one alert per bus: identify it by line and expected arrival (5-minute slot), not by its position
  const key = t.line + ":" + Math.round((Date.now() + t.min * 60000) / 300000);
  if (alerted === key) return; alerted = key;
  const msg = `O teu ${t.line} chega a ${shortName(stopName(prefs.origin))} en ${t.min} min`;
  toast(msg); beep(); notify('Bus a 5 minutos', msg);
  pushOff();   // already told: the server doesn't need to
}
