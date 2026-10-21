// ---------- my location ----------
let myPos = null, myMarker = null;
function locate() {
  if (!navigator.geolocation) { toast('Tu navegador no permite saber dónde estás'); return; }
  navigator.geolocation.getCurrentPosition(p => {
    myPos = [p.coords.latitude, p.coords.longitude];
    if (!myMarker) myMarker = L.circleMarker(myPos, { radius: 8, color: '#fff', weight: 3, fillColor: '#2b7de9', fillOpacity: 1 }).addTo(map);
    myMarker.setLatLng(myPos);
    const near = [...STOPS.values()].sort((a, b) => hav([a.lat, a.lon], myPos) - hav([b.lat, b.lon], myPos))[0];
    const dist = Math.round(hav([near.lat, near.lon], myPos));
    map.setView(myPos, 16);
    if (dist < 3000) toast(`Parada más cercana: ${shortName(near.name)} (${dist} m)`); else toast('Estás lejos de estas líneas');
    if (!document.getElementById('editor').hidden) renderSearch();
  }, () => toast('No se pudo obtener tu ubicación'), { enableHighAccuracy: true, timeout: 10000 });
}

