/* Mapa (Leaflet 1.9.4, kopia w vendor/leaflet) z podkładami GUGiK (Geoportal.gov.pl) w układzie EPSG:3857.
   Mapa nigdy nie jest jedynym sposobem: każdy ekran z mapą ma też listę, tabelę albo pola współrzędnych.
   Podkłady:
   - mapa topograficzna – WMS GUGiK (usługa reprojektuje do EPSG:3857),
   - ortofotomapa – WMTS GUGiK, macierz kafli EPSG:3857 (zgodna z kaflami „Google”, poziomy 0–19),
   - nakładka „adresy i ulice” – WMS Krajowej Integracji Numeracji Adresowej (GUGiK).
   Treści z rekordów (niezaufane) trafiają do okienek wyłącznie jako węzły DOM z AED.dom.h(). */
(function (AED) {
  'use strict';
  const { h, liczba, odmiana } = AED.dom;

  const ATRYBUCJA = 'Podkład: © <a href="https://www.geoportal.gov.pl" target="_blank" rel="noopener noreferrer">' +
    'Główny Urząd Geodezji i Kartografii (Geoportal.gov.pl)</a>';
  const POLSKA = { srodek: [52.07, 19.48], zoom: 6 };

  const PODKLADY = [
    { kod: 'topo', etykieta: 'Mapa topograficzna',
      utworz: function () {
        return L.tileLayer.wms('https://mapy.geoportal.gov.pl/wss/service/img/guest/TOPO/MapServer/WMSServer', {
          layers: 'Raster', styles: '', format: 'image/png', transparent: false, version: '1.3.0',
          crs: L.CRS.EPSG3857, maxZoom: 19, maxNativeZoom: 18, attribution: ATRYBUCJA });
      } },
    { kod: 'orto', etykieta: 'Ortofotomapa (zdjęcia lotnicze)',
      utworz: function () {
        return L.tileLayer('https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution' +
          '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg' +
          '&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}', {
          maxZoom: 19, maxNativeZoom: 19, attribution: ATRYBUCJA });
      } }
  ];
  function nakladkaAdresow() {
    return L.tileLayer.wms('https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaNumeracjiAdresowej', {
      layers: 'A08_Ulice,A07_Punkty_adresowe', styles: '', format: 'image/png', transparent: true, version: '1.3.0',
      crs: L.CRS.EPSG3857, minZoom: 15, maxZoom: 19, attribution: ATRYBUCJA });
  }

  // Kolory punktów: ciemne wypełnienie + biała obwódka (kontrast ≥ 3:1 na jasnym i ciemnym podkładzie, WCAG 1.4.11).
  // Znaczenie koloru jest zawsze podane także tekstem (legenda z liczbami, okienko punktu) – WCAG 1.4.1.
  const KOLORY_STATUSU = {
    aktywny: '#1b6e2e', tymczasowo_niedostepny: '#9a4b00', wycofany: '#4a4a4a', do_weryfikacji: '#1f4fa3', '': '#6b2c91'
  };
  const PALETA = ['#1f4fa3', '#9a4b00', '#1b6e2e', '#8a1c4a', '#4a4a4a', '#6b2c91', '#00646e', '#7a5c00'];

  let licznik = 0;
  let ustawionyPodklad = 'topo';
  let nakladkaWlaczona = false;

  function dostepna() { return typeof window.L !== 'undefined' && !!L.map; }
  function liczbaWsp(v) {
    if (typeof v === 'number') return v;
    if (v === null || v === undefined || v === '') return NaN;
    return Number(String(v).replace(',', '.'));
  }
  /** [lat, lon] z rekordu albo null, gdy brak poprawnych współrzędnych. */
  function wspolrzedne(r) {
    if (!r) return null;
    const a = liczbaWsp(r.szerokosc_geograficzna), b = liczbaWsp(r.dlugosc_geograficzna);
    if (!isFinite(a) || !isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
    return [a, b];
  }

  /** Polskie etykiety elementów Leaflet, których nie da się ustawić opcjami. */
  function spolszcz(mapa) {
    mapa.on('popupopen', function (e) {
      const b = e.popup.getElement() && e.popup.getElement().querySelector('.leaflet-popup-close-button');
      if (b) { b.setAttribute('aria-label', 'Zamknij okienko'); b.setAttribute('title', 'Zamknij okienko'); }
    });
  }

  /** Mapa z przełącznikiem podkładu (poza mapą, zwykłe pola formularza) i opisem obsługi klawiaturą.
      o: { etykieta, opisDodatkowy?, klasa?, srodek?, zoom? } → { element, mapa, zniszcz(), odswiez(), dopasuj(punkty) } */
  function utworz(o) {
    o = o || {};
    const id = 'mapa-' + (++licznik);
    const pomoc = h('p', { class: 'hint mapa__pomoc', id: id + '-pomoc' },
      'Obsługa klawiaturą: zaznacz mapę klawiszem Tab, strzałki przesuwają widok, klawisze + i − przybliżają i oddalają. ',
      o.opisDodatkowy || '');
    const okno = h('div', { class: 'mapa__okno' + (o.klasa ? ' ' + o.klasa : ''), id: id });
    const wrap = h('div', { class: 'mapa' });
    if (!dostepna()) {
      wrap.appendChild(h('p', { class: 'alert alert--warn' }, 'Nie wczytano biblioteki mapy (vendor/leaflet). ',
        'Wszystkie informacje są dostępne także bez mapy – w listach i polach współrzędnych na tej stronie.'));
      return { element: wrap, mapa: null, zniszcz: function () {}, odswiez: function () {}, dopasuj: function () {} };
    }
    const podklad = h('fieldset', { class: 'radio-group mapa__podklad' },
      h('legend', null, 'Podkład mapy'),
      h('div', { class: 'mapa__opcje' },
        PODKLADY.map(function (p) {
          const idp = id + '-podklad-' + p.kod;
          return h('div', { class: 'radio' },
            h('input', { type: 'radio', name: id + '-podklad', id: idp, value: p.kod, checked: p.kod === ustawionyPodklad,
              onchange: function () { ustawPodklad(p.kod); } }),
            h('label', { for: idp }, p.etykieta));
        }),
        h('div', { class: 'radio' },
          h('input', { type: 'checkbox', id: id + '-adresy', checked: nakladkaWlaczona, 'aria-describedby': id + '-adresy-pomoc',
            onchange: function (e) { ustawNakladke(e.target.checked); } }),
          h('label', { for: id + '-adresy' }, 'Pokaż punkty adresowe i ulice'))),
      h('p', { class: 'hint', id: id + '-adresy-pomoc' }, 'Punkty adresowe widać po dużym przybliżeniu (ulice i budynki).'));
    wrap.append(podklad, pomoc, okno);

    const mapa = L.map(okno, {
      center: o.srodek || POLSKA.srodek, zoom: o.zoom || POLSKA.zoom, minZoom: 5, maxZoom: 19,
      preferCanvas: true, keyboard: true, zoomControl: false, attributionControl: false
    });
    L.control.zoom({ zoomInTitle: 'Przybliż', zoomOutTitle: 'Oddal' }).addTo(mapa);
    L.control.attribution({ prefix: '<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>' }).addTo(mapa);
    L.control.scale({ imperial: false }).addTo(mapa);
    spolszcz(mapa);
    // kontener mapy dostaje fokus (Leaflet: tabindex=0) – nadajemy mu nazwę i opis
    okno.setAttribute('role', 'region');
    okno.setAttribute('aria-roledescription', 'mapa');
    okno.setAttribute('aria-label', o.etykieta || 'Mapa');
    okno.setAttribute('aria-describedby', id + '-pomoc');

    let warstwa = null, nakladka = null;
    function ustawPodklad(kod) {
      const def = PODKLADY.find(function (p) { return p.kod === kod; }) || PODKLADY[0];
      ustawionyPodklad = def.kod;
      if (warstwa) mapa.removeLayer(warstwa);
      warstwa = def.utworz();
      warstwa.addTo(mapa);
      warstwa.bringToBack();
    }
    function ustawNakladke(wl) {
      nakladkaWlaczona = !!wl;
      if (nakladka) { mapa.removeLayer(nakladka); nakladka = null; }
      if (wl) { nakladka = nakladkaAdresow(); nakladka.addTo(mapa); }
    }
    ustawPodklad(ustawionyPodklad);
    ustawNakladke(nakladkaWlaczona);

    return {
      element: wrap,
      mapa: mapa,
      /** Po pokazaniu ukrytego kontenera Leaflet musi przeliczyć rozmiar. */
      odswiez: function () { mapa.invalidateSize(false); },
      dopasuj: function (punkty, maxZoom) {
        const p = (punkty || []).filter(Boolean);
        if (!p.length) return;
        if (p.length === 1) mapa.setView(p[0], Math.min(maxZoom || 17, 19));
        else mapa.fitBounds(L.latLngBounds(p), { padding: [30, 30], maxZoom: maxZoom || 17 });
      },
      zniszcz: function () { try { mapa.remove(); } catch (e) { /* już usunięta */ } }
    };
  }

  /** Warstwa wielu punktów (do 50 tys.) – rysowane na canvas (circleMarker); przy małym przybliżeniu
      punkty bliżej niż ~50 px łączymy w grupy z liczbą (kliknięcie przybliża). Liczone tylko dla widocznego obszaru.
      punkty: [{ wsp:[lat,lon], kolor, rekord }]; o: { popup(rekord) → Node, prog? } */
  function warstwaPunktow(mapa, punkty, o) {
    o = o || {};
    const grupa = L.layerGroup().addTo(mapa);
    const renderer = L.canvas({ padding: 0.3 });
    const KOMORKA = 50, BEZ_GRUP_ZOOM = 15, PROG = o.prog || 1500;
    let dane = punkty || [];

    function okienko(p) {
      const tresc = o.popup ? o.popup(p.rekord) : h('p', null, String(p.rekord && p.rekord.nazwa || 'Punkt'));
      L.popup({ maxWidth: 280 }).setLatLng(p.wsp).setContent(tresc).openOn(mapa);
    }
    function rysuj() {
      grupa.clearLayers();
      if (!dane.length) return;
      const b = mapa.getBounds().pad(0.25);
      const z = mapa.getZoom();
      const widoczne = [];
      for (let i = 0; i < dane.length; i++) if (b.contains(dane[i].wsp)) widoczne.push(dane[i]);
      const kropka = function (p) {
        L.circleMarker(p.wsp, { renderer: renderer, radius: 7, color: '#ffffff', weight: 2, fillColor: p.kolor, fillOpacity: 1 })
          .on('click', function () { okienko(p); }).addTo(grupa);
      };
      if (z >= BEZ_GRUP_ZOOM || widoczne.length <= PROG) { widoczne.forEach(kropka); return; }
      const komorki = new Map();
      widoczne.forEach(function (p) {
        const px = mapa.project(p.wsp, z);
        const k = Math.floor(px.x / KOMORKA) + ':' + Math.floor(px.y / KOMORKA);
        let c = komorki.get(k);
        if (!c) { c = { n: 0, lat: 0, lon: 0, p: p }; komorki.set(k, c); }
        c.n++; c.lat += p.wsp[0]; c.lon += p.wsp[1];
      });
      komorki.forEach(function (c) {
        if (c.n === 1) { kropka(c.p); return; }
        const srodek = [c.lat / c.n, c.lon / c.n];
        const r = c.n < 10 ? 30 : c.n < 100 ? 36 : c.n < 1000 ? 42 : 48;
        L.marker(srodek, {
          keyboard: false, // klawiatura: dane są w tabeli i plikach; setki grup w kolejności Tab utrudniałyby nawigację
          icon: L.divIcon({ className: 'mapa-grupa', html: '<span>' + liczba(c.n) + '</span>', iconSize: [r, r] }),
          title: liczba(c.n) + ' ' + odmiana(c.n, 'punkt', 'punkty', 'punktów') + ' – kliknij, aby przybliżyć'
        }).on('click', function () { mapa.setView(srodek, Math.min(z + 2, 19)); }).addTo(grupa);
      });
    }
    mapa.on('moveend', rysuj);
    rysuj();
    return {
      ustaw: function (nowe) { dane = nowe || []; rysuj(); },
      usun: function () { mapa.off('moveend', rysuj); mapa.removeLayer(grupa); }
    };
  }

  /** Okienko punktu: nazwa, adres, źródło, status (tylko tekst, bez HTML z danych). */
  function opisPunktu(r, dodatki) {
    if (!r) return h('p', null, 'Punkt');
    const adres = [r.ulica ? [r.cecha_ulicy, r.ulica].filter(Boolean).join(' ') + (r.numer_budynku ? ' ' + r.numer_budynku : '') : null,
      [r.kod_pocztowy, r.miejscowosc].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return h('div', { class: 'mapa-okienko' },
      h('p', { class: 'mapa-okienko__nazwa' }, h('strong', null, String(r.nazwa || 'Bez nazwy'))),
      adres ? h('p', null, adres) : null,
      r.opis_lokalizacji ? h('p', { class: 'meta' }, String(r.opis_lokalizacji)) : null,
      h('p', { class: 'meta' }, 'Źródło: ', String(r._kodZrodla || r.zrodlo_danych || '—'),
        r._wiersz ? ', wiersz ' + r._wiersz : '', r.status ? ' · status: ' + etykietaStatusu(r.status) : ''),
      dodatki || null);
  }

  function etykietaStatusu(kod) {
    const s = AED.wzorzec && AED.wzorzec.slowniki && AED.wzorzec.slowniki.status;
    const x = s && s.find(function (y) { return y.kod === kod; });
    return x ? x.etykieta : String(kod || 'brak');
  }

  AED.ui = AED.ui || {};
  AED.ui.mapa = {
    dostepna: dostepna,
    utworz: utworz,
    warstwaPunktow: warstwaPunktow,
    wspolrzedne: wspolrzedne,
    opisPunktu: opisPunktu,
    etykietaStatusu: etykietaStatusu,
    KOLORY_STATUSU: KOLORY_STATUSU,
    PALETA: PALETA,
    ATRYBUCJA_TEKST: '© Główny Urząd Geodezji i Kartografii (Geoportal.gov.pl)'
  };
})(window.AED);
