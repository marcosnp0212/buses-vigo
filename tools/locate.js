// ---------- my location ----------
let myPos = null, myMarker = null;
function locate() {
  if (!navigator.geolocation) { toast(T`Tu navegador no puede darnos tu ubicación`); return; }
  toast(T`Buscando dónde estás…`);
  navigator.geolocation.getCurrentPosition(p => {
    myPos = [p.coords.latitude, p.coords.longitude];
    if (!myMarker) myMarker = L.circleMarker(myPos, { radius: 8, color: '#fff', weight: 3, fillColor: '#1b67a6', fillOpacity: 1 }).addTo(map);
    myMarker.setLatLng(myPos);
    const near = [...STOPS.values()].sort((a, b) => hav([a.lat, a.lon], myPos) - hav([b.lat, b.lon], myPos))[0];
    const dist = hav([near.lat, near.lon], myPos);
    map.setView(myPos, 16);
    toast(dist < 3000 ? T`La parada más cercana es ${shortName(near.name)}, ${aDist(dist)}` : T`Estás fuera de la red de Vitrasa`);
    if (!document.getElementById('editor').hidden) renderSearch();
    if (!document.getElementById('finder').hidden) renderFinder();
    renderHome();
  }, e => toast(e.code === 1 ? T`Sin permiso de ubicación: actívalo en los ajustes del navegador` : T`No se pudo obtener tu ubicación`), { enableHighAccuracy: true, timeout: 10000 });
}
