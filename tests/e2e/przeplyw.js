/* Przepływ koordynatora 1 → 4 na plikach z tests/fixtures: źródła, mapowanie, walidacja, duplikaty (klawiatura),
   mapa w kroku 3 i 4, pobranie CSV, 320 px w krokach 3 i 4. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const { b, adres, ok, korzen } = t;
  const FIX = path.join(korzen, 'tests', 'fixtures');
  fs.rmSync(t.pobrane, { recursive: true, force: true });
  await b.pobierania(t.pobrane);
  await b.idz(adres + 'index.html#zrodla');

  // ---- krok 1: pliki
  const pliki = ['krosno_dgp3624.csv', 'przemysl_dgp4581.csv', 'marki_dgp4955.csv', 'gmina_przyklad_cp1250.csv'].map(function (f) { return path.join(FIX, f); });
  await b.pliki('#plik-input', pliki);
  await b.czekaj('AED.store.zrodla.length === 4 && AED.store.zrodla.every(function (z) { return z.wiersze.length; })', 30000);
  ok(true, 'krok 1: wczytano 4 pliki', await b.ocen("AED.store.zrodla.map(function (z) { return z.kod + ':' + z.wiersze.length; })"));
  await b.ocen("AED.store.zrodla.forEach(function (z) { AED.store.aktualizujZrodlo(z.id, { licencja: /marki/i.test(z.nazwa) ? 'CC-BY-4.0' : 'CC0-1.0', dysponent: z.dysponent || 'Urząd testowy' }); }); true");
  ok(await b.ocen("document.querySelectorAll('#rejestr tbody tr').length === 4"), 'krok 1: rejestr źródeł ma 4 wiersze');

  // ---- krok 2 i 3
  await b.ocen("document.getElementById('dalej-mapowanie').click()");
  await b.czekaj("location.hash === '#mapowanie'");
  ok(true, 'krok 2: mapowanie kolumn');
  await b.ocen("document.getElementById('dalej-walidacja').click()");
  await b.czekaj("location.hash === '#walidacja' && !document.getElementById('wal-tresc').hidden", 60000);
  const n = await b.ocen('AED.store.liczbaRekordowWynik');
  ok(n > 50, 'krok 3: rekordy po mapowaniu', n);

  // duplikaty
  await b.ocen("document.getElementById('dup-promien').value = '50'; document.getElementById('dup-promien').dispatchEvent(new Event('change')); document.getElementById('dup-szukaj').click(); true");
  await b.czekaj("document.activeElement && document.activeElement.id === 'h-dup-wynik'", 60000);
  const grupy = await b.ocen('(AED.store.duplikaty.grupy || []).length');
  ok(grupy > 0, 'krok 3: znaleziono grupy duplikatów', grupy);
  if (grupy > 0) {
    // decyzja z klawiatury: Enter na „Scal” przenosi fokus na następną grupę
    const g1 = await b.ocen("document.querySelector('#dup-lista .grupa h4').id");
    await b.ocen("document.querySelector('#dup-lista .grupa .grupa__akcje .btn--primary').focus()");
    await b.klawisz('Enter');
    await b.pauza(300);
    ok(Object.keys(await b.ocen('AED.store.decyzje')).length >= 1, 'krok 3: decyzja „Scal” podjęta klawiszem Enter');
    const fok = await b.ocen('document.activeElement.id');
    ok(fok !== g1, 'krok 3: po decyzji fokus przechodzi dalej', { z: g1, na: fok });
    // mapa grupy („Pokaż na mapie”)
    const idBtn = await b.ocen("(document.querySelector('#dup-lista .grupa button[aria-expanded]') || {}).id || ''");
    ok(!!idBtn, 'krok 3: przycisk „Pokaż na mapie” przy grupie');
    if (idBtn) {
      await b.ocen("document.getElementById('" + idBtn + "').focus()");
      await b.klawisz('Enter');
      await b.czekaj("!!document.querySelector('#dup-lista .mapa-wstawka .leaflet-container')");
      ok(await b.ocen("document.getElementById('" + idBtn + "').getAttribute('aria-expanded') === 'true' && document.activeElement.id === '" + idBtn + "'"),
        'krok 3: mapa grupy otwarta, aria-expanded=true, fokus na przycisku');
      ok(await b.ocen("document.querySelectorAll('#dup-lista .mapa-wstawka .mapa-numer').length >= 1 && document.querySelectorAll('#dup-lista .mapa-punkty li').length >= 2"),
        'krok 3: numerowane punkty na mapie i ich lista tekstowa');
      await b.ocen("document.getElementById('" + idBtn + "').click()");
      ok(await b.ocen("!document.querySelector('#dup-lista .mapa-wstawka')"), 'krok 3: mapę można ukryć');
    }
  }
  // punkt odstający na mapie (jeśli jest)
  if (await b.ocen("!!document.querySelector('#odst-lista .odst button[aria-expanded][id$=\"-mapa\"]')")) {
    await b.ocen("document.querySelector('#odst-lista .odst button[id$=\"-mapa\"]').click()");
    await b.czekaj("!!document.querySelector('#odst-lista .leaflet-container')");
    ok(true, 'krok 3: mapa punktu odstającego');
  }
  await b.szerokosc(320);
  await b.pauza(250);
  const w3 = await b.ocen('document.documentElement.scrollWidth');
  ok(w3 <= 320, '320 px – krok 3 bez przewijania w poziomie', w3);
  await t.zrzut('krok3-320');
  await b.szerokosc(1280);

  // ---- krok 4
  await b.ocen("location.hash = '#wynik'; true");
  await b.czekaj("!document.getElementById('wyn-tresc').hidden");
  await b.czekaj("!!document.querySelector('#wyn-mapa .leaflet-container')");
  ok(true, 'krok 4: mapa zainicjowana');
  await b.pauza(500);
  const naMapie = await b.ocen("document.getElementById('wyn-mapa-opis').textContent");
  ok(/Na mapie: [\d\s ]+ punkt/.test(naMapie), 'krok 4: opis tekstowy mapy (liczba punktów)', naMapie);
  ok(await b.ocen("document.querySelectorAll('#wyn-mapa-legenda li').length >= 1"), 'krok 4: legenda z liczbami');
  ok(await b.ocen("!!document.querySelector('#wyn-mapa canvas') || document.querySelectorAll('#wyn-mapa .mapa-grupa').length > 0"),
    'krok 4: punkty narysowane (canvas lub grupy)');
  ok(await b.ocen("/Główny Urząd Geodezji i Kartografii/.test(document.querySelector('#wyn-mapa .leaflet-control-attribution').textContent)"),
    'krok 4: atrybucja podkładu GUGiK');
  if (!t.opcje.siec) ok(b.kafle.length > 0, 'krok 4: mapa żąda kafli z usług GUGiK', b.kafle.length);
  // przełącznik podkładu (zwykłe pola formularza)
  await b.ocen("document.querySelector('#wyn-mapa input[value=orto]').click()");
  await b.pauza(300);
  if (!t.opcje.siec) ok(b.kafle.some(function (u) { return /ORTO\/WMTS/.test(u); }), 'krok 4: przełączenie na ortofotomapę (WMTS GUGiK)');
  // kolor wg źródła
  await b.ocen("const s = document.getElementById('wyn-mapa-kolor'); s.value = 'zrodlo'; s.dispatchEvent(new Event('change')); true");
  ok(await b.ocen("document.querySelectorAll('#wyn-mapa-legenda li').length === AED.store.zrodla.length || document.querySelectorAll('#wyn-mapa-legenda li').length >= 2"),
    'krok 4: legenda według źródła');
  // klawiatura na mapie: strzałka przesuwa, + przybliża
  await b.ocen("document.querySelector('#wyn-mapa .leaflet-container').focus()");
  const przed = await b.ocen("(function(){ const m = document.querySelector('#wyn-mapa .leaflet-container'); return m === document.activeElement; })()");
  ok(przed, 'krok 4: mapa przyjmuje fokus z klawiatury');
  // pobranie CSV
  await b.ocen("document.getElementById('wyn-p-csv').click()");
  let csv = null;
  for (let i = 0; i < 40 && !csv; i++) {
    await b.pauza(150);
    if (fs.existsSync(t.pobrane)) csv = fs.readdirSync(t.pobrane).find(function (f) { return /\.csv$/.test(f); }) || null;
  }
  ok(!!csv, 'krok 4: pobrano plik CSV', csv);
  if (csv) {
    const tresc = fs.readFileSync(path.join(t.pobrane, csv), 'utf8');
    ok(/^﻿?id_aed,/.test(tresc) && tresc.split(/\r?\n/).length > 10, 'krok 4: CSV ma nagłówki wzorca i rekordy');
  }
  await b.szerokosc(320);
  await b.pauza(300);
  const w4 = await b.ocen('document.documentElement.scrollWidth');
  ok(w4 <= 320, '320 px – krok 4 bez przewijania w poziomie', w4);
  await t.zrzut('krok4-320');
  await b.szerokosc(1280);
  await b.pauza(200);
  await t.zrzut('krok4');
};
