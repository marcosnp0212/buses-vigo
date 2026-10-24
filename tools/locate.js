// ---------- my location ----------
let myPos = null, myMarker = null;
function locate() {
  if (!navigator.geolocation) { toast('Este navegador non permite obter a localización'); return; }
  toast('Buscando a túa localización…');
  navigator.geolocation.getCurrentPosition(p => {
    myPos = [p.coords.latitude, p.coords.longitude];
    if (!myMarker) myMarker = L.circleMarker(myPos, { radius: 8, color: '#fff', weight: 3, fillColor: '#1b67a6', fillOpacity: 1 }).addTo(map);
    myMarker.setLatLng(myPos);
    const near = [...STOPS.values()].sort((a, b) => hav([a.lat, a.lon], myPos) - hav([b.lat, b.lon], myPos))[0];
    const dist = hav([near.lat, near.lon], myPos);
    map.setView(myPos, 16);
    toast(dist < 3000 ? `A parada máis próxima é ${shortName(near.name)}, ${aDist(dist)}` : 'Estás fóra da rede de Vitrasa');
    if (!document.getElementById('editor').hidden) renderSearch();
    if (!document.getElementById('finder').hidden) renderFinder();
    renderHome();
  }, e => toast(e.code === 1 ? 'Sen permiso de localización: actívao nos axustes do navegador' : 'Non se puido obter a túa localización'), { enableHighAccuracy: true, timeout: 10000 });
}
