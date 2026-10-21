// ---------- alert ----------
let alertOn = false, alerted = null, audio;
function beep() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); const o = audio.createOscillator(), g = audio.createGain(); o.connect(g); g.connect(audio.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.2, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.6); o.start(); o.stop(audio.currentTime + 0.6); } catch (e) {} }
function toggleAlert() {
  alertOn = !alertOn; alerted = null;
  if (alertOn) { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {} try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} toast('Te aviso cuando falten 5 minutos'); }
  renderHero();
}
function checkAlert(t) {
  if (!alertOn || !t || t.kind !== "live" || t.min > 5 || !prefs.origin) return;
  // one alert per bus: identify it by line and expected arrival (5-minute slot), not by its position
  const key = t.line + ":" + Math.round((Date.now() + t.min * 60000) / 300000);
  if (alerted === key) return; alerted = key;
  const msg = `Tu ${t.line} llega a ${shortName(stopName(prefs.origin))} en ${t.min} min`;
  toast(msg); beep();
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Sal ya', { body: msg }); } catch (e) {}
}

