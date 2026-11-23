/* Testy części 5: formularz dysponenta (AED.formularz), geokoder GUGiK (AED.geokoder) i transformacja PUWG 1992 <-> WGS84.
   Uruchomienie: node tests/czesc5.test.js   (Node 18+, bez zależności npm)
   Odpowiedzi usług GUGiK: prawdziwe wycinki z 2026-11-21 w tests/fixtures/api/uug_*.json i uldk_*.txt (fetch podmieniony). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const KORZEN = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'api');
const czytaj = function (p) { return fs.readFileSync(path.join(KORZEN, p), 'utf8'); };
const fixture = function (n) { return fs.readFileSync(path.join(FIX, n), 'utf8'); };

// ------------------------------------------------------------ środowisko
const magazyn = new Map();
let localStorageWyjatek = false;
const localStorage = {
  getItem: function (k) { if (localStorageWyjatek) throw new Error('SecurityError'); return magazyn.has(k) ? magazyn.get(k) : null; },
  setItem: function (k, v) { if (localStorageWyjatek) throw new Error('QuotaExceededError'); magazyn.set(k, String(v)); },
  removeItem: function (k) { magazyn.delete(k); }
};
let obslugaFetch = null;
const wywolania = [];
const ctx = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, TextDecoder, TextEncoder, AbortController, Blob, File, Response, Headers,
  ArrayBuffer, Uint8Array, crypto: globalThis.crypto, localStorage: localStorage,
  fetch: function (url, init) { wywolania.push(String(url)); return obslugaFetch(String(url), init || {}); }
};
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);
['vendor/papaparse/papaparse.min.js', 'js/core/ns.js', 'js/schema/schema.js', 'js/ui/dom.js',
  'js/sources/file.js', 'js/sources/geokoder.js', 'js/core/store.js',
  'js/core/normalizacja.js', 'js/core/mapowanie.js', 'js/core/walidacja.js',
  'js/core/duplikaty.js', 'js/core/eksport.js', 'js/core/formularz.js'].forEach(function (p) {
  vm.runInContext(czytaj(p), ctx, { filename: p });
});
const AED = ctx.AED;
const F = AED.formularz, G = AED.geokoder, M = AED.mapowanie, store = AED.store;
G.odstepMs = 0;

const zwykly = function (x) { return JSON.parse(JSON.stringify(x)); };
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const json = function (t, status) { return new Response(t, { status: status || 200, headers: { 'Content-Type': 'application/json;' } }); };
const tekst = function (t, status) { return new Response(t, { status: status || 200, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } }); };

async function oczekujBledu(obietnica, kod) {
  try { await obietnica; } catch (e) {
    assert.strictEqual(e.kod, kod, 'oczekiwano kodu ' + kod + ', jest ' + e.kod + ' (' + e.message + ')');
    assert.ok(typeof e.message === 'string' && e.message.length > 10, 'czytelny komunikat');
    return e;
  }
  assert.fail('oczekiwano błędu ' + kod);
}
/** Odległość w metrach (przybliżenie równoleżnikowe – wystarcza do porównań rzędu cm–m). */
function odlM(a, b) {
  const dy = (a.lat - b.lat) * 111320, dx = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

const testy = [];
const test = function (nazwa, fn) { testy.push({ nazwa, fn }); };

/** Rekord formularza wypełniony jak przez dysponenta (Krosno, Rynek 1). */
function rekordKrosno(nadpisz) {
  const r = F.pusty('Urząd Miasta Krosna', { teraz: new Date(2026, 10, 21, 10, 15, 0) });
  F.ustawPunkt(r, 49.693996, 21.765857, 'mapa');
  return Object.assign(r, { nazwa: 'Urząd Miasta Krosna – hol', miejscowosc: 'Krosno', cecha_ulicy: 'ul.', ulica: 'Lwowska', numer_budynku: '28a',
    kod_pocztowy: '38-400', opis_lokalizacji: 'Parter, przy portierni', wewnatrz_budynku: true, kondygnacja: 0, dostepnosc: 'publiczna_w_godzinach',
    godziny_dostepnosci: 'Mo-Fr 07:30-15:30', sposob_dostepu: 'otwarta_szafka', telefon_kontaktowy: '134743000', kod_terc_gminy: '1861011',
    wojewodztwo: 'podkarpackie' }, nadpisz || {});
}

// ================================================================ transformacja 2180 <-> 4326
// Wartości odniesienia: pyproj 3.7 (PROJ), Transformer.from_crs(2180, 4326, always_xy=True) – policzone 2026-11-21.
const PUNKTY_2180 = [
  { x: 699403.76, y: 206628.35, lat: 49.693996408, lon: 21.765857351, opis: 'Krosno, Rynek 1 (odpowiedź UUG w 2180)' },
  { x: 500000, y: 500000, lat: 52.365947621, lon: 19.0, opis: 'południk osiowy' },
  { x: 637433.0, y: 486591.0, lat: 52.228193469, lon: 21.012875905, opis: 'Warszawa' },
  { x: 210000, y: 520000, lat: 52.468655694, lon: 14.728682200, opis: 'zachodnia granica' },
  { x: 800000, y: 700000, lat: 54.076764831, lon: 23.588035845, opis: 'północny wschód' }
];
const PUNKTY_4326 = [
  { lat: 52.2297, lon: 21.0122, x: 637382.2044, y: 486757.2095 },
  { lat: 54.35205, lon: 18.64664, x: 477040.2263, y: 720942.0696 },
  { lat: 49.0, lon: 24.1, x: 872846.3789, y: 138365.9166 },
  { lat: 53.9, lon: 14.2, x: 184816.0951, y: 681281.2864 }
];

test('PUWG 1992 -> WGS84: zgodność z PROJ < 1 cm', function () {
  PUNKTY_2180.forEach(function (p) {
    const w = G.zPuwg92(p.x, p.y);
    assert.ok(odlM(w, p) < 0.01, p.opis + ': ' + JSON.stringify(w) + ' vs ' + p.lat + ',' + p.lon + ' (' + odlM(w, p).toFixed(4) + ' m)');
  });
});

test('WGS84 -> PUWG 1992: zgodność z PROJ < 1 cm; przejście tam i z powrotem', function () {
  PUNKTY_4326.forEach(function (p) {
    const w = G.doPuwg92(p.lat, p.lon);
    assert.ok(Math.abs(w.x - p.x) < 0.01 && Math.abs(w.y - p.y) < 0.01, JSON.stringify(w) + ' vs ' + p.x + ',' + p.y);
    const z = G.zPuwg92(w.x, w.y);
    assert.ok(Math.abs(z.lat - p.lat) < 1e-9 && Math.abs(z.lon - p.lon) < 1e-9, 'powrót: ' + JSON.stringify(z));
  });
});

// ================================================================ geokoder (fixture'y UUG / ULDK)
test('geokoder.szukaj: adres w Krośnie po przeliczeniu z PUWG 1992 i Warszawa w WGS84', async function () {
  G._reset();
  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_adres_krosno_rynek1_2180.json'))); };
  const k = await G.szukaj('Krosno, Rynek 1');
  assert.strictEqual(k.length, 1);
  assert.ok(odlM(k[0], { lat: 49.693996, lon: 21.765857 }) < 0.2, JSON.stringify(k[0]));
  assert.strictEqual(k[0].miejscowosc, 'Krosno');
  assert.strictEqual(k[0].ulica, 'Rynek');
  assert.strictEqual(k[0].cecha_ulicy, 'inne', '„Rynek”: w TERYT ULIC cecha „rynek”, we wzorcu „inne”; wyraz zostaje w nazwie');
  assert.strictEqual(k[0].numer, '1');
  assert.strictEqual(k[0].kod_pocztowy, '38-400');
  assert.strictEqual(k[0].kod_terc_gminy, '1861011', 'miasto na prawach powiatu -> rodzaj gminy 1');
  assert.strictEqual(k[0].kod_simc, '0952410');
  assert.strictEqual(k[0].kod_ulic, '19253');
  assert.strictEqual(k[0].wojewodztwo, 'podkarpackie');
  assert.strictEqual(k[0].dokladnosc, 'adres');
  assert.ok(/Rynek 1, 38-400 Krosno/.test(k[0].opis), k[0].opis);
  const u = new URL(wywolania[wywolania.length - 1]);
  assert.strictEqual(u.origin + u.pathname, 'https://services.gugik.gov.pl/uug/');
  assert.strictEqual(u.searchParams.get('request'), 'GetAddress');
  assert.strictEqual(u.searchParams.get('address'), 'Krosno, Rynek 1');
  assert.strictEqual(u.searchParams.get('srid'), '4326');

  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_adres_warszawa_marszalkowska140.json'))); };
  const w = await G.szukaj('Warszawa, Marszałkowska 140');
  assert.deepStrictEqual([w[0].lat, w[0].lon], [52.237122, 21.007878]);
  assert.strictEqual(w[0].cecha_ulicy, 'ul.');
  assert.strictEqual(w[0].ulica, 'Marszałkowska', '„ulica Marszałkowska” -> cecha + nazwa');
  assert.strictEqual(w[0].kod_terc_gminy, '1465011');
  assert.strictEqual(w[0].wojewodztwo, 'mazowieckie');
  assert.strictEqual(w[0].trafnosc, 0.8);
  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_adres_przemysl_rynek2.json'))); };
  const p = await G.szukaj('Przemyśl, Rynek 2');
  assert.strictEqual(p[0].miejscowosc, 'Przemyśl');
  assert.strictEqual(p[0].kod_terc_gminy, '1862011');
});

test('geokoder.szukaj: sama ulica, sama miejscowość (gmina miejsko-wiejska bez rodzaju), brak wyników', async function () {
  G._reset();
  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_ulica_krosno_lwowska.json'))); };
  const u = await G.szukaj('Krosno, Lwowska');
  assert.strictEqual(u[0].dokladnosc, 'ulica');
  assert.strictEqual(u[0].numer, null);
  assert.strictEqual(u[0].ulica, 'Lwowska');
  assert.strictEqual(u[0].cecha_ulicy, 'ul.');
  assert.strictEqual(u[0].kod_terc_gminy, '1861011');
  assert.strictEqual(u[0].wojewodztwo, 'podkarpackie', 'z kodu TERYT, gdy brak nazwy');
  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_miejscowosc_rymanow.json'))); };
  const r = await G.szukaj('Rymanów');
  assert.strictEqual(r[0].dokladnosc, 'miejscowosc');
  assert.strictEqual(r[0].miejscowosc, 'Rymanów');
  assert.strictEqual(r[0].ulica, null);
  assert.strictEqual(r[0].kod_terc_gminy, null, 'gmina 180708 – rodzaj (3/4/5) nieznany bez ULDK');
  assert.strictEqual(r[0].teryt_gminy6, '180708');
  assert.strictEqual(r[0].wojewodztwo, 'podkarpackie');
  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_brak.json'))); };
  assert.deepStrictEqual(zwykly(await G.szukaj('Atlantyda Podwodna 99')), []);
});

test('geokoder.szukaj: numer nieznaleziony (found > 0, returned 0) -> jedna próba bez numeru; „Miejscowość, Numer” -> format UUG', async function () {
  G._reset(); wywolania.length = 0;
  obslugaFetch = function (url) {
    const a = new URL(url).searchParams.get('address');
    return Promise.resolve(json(a === 'Iwonicz 100' ? fixture('uug_iwonicz100_brak.json') : fixture('uug_miejscowosc_rymanow.json')));
  };
  const w = await G.szukaj('Iwonicz, 100');
  assert.deepStrictEqual(wywolania.map(function (u) { return new URL(u).searchParams.get('address'); }), ['Iwonicz 100', 'Iwonicz']);
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].przyblizony, true);
  assert.strictEqual(w[0].dokladnosc, 'miejscowosc');
  assert.ok(/Nie znaleziono numeru „100” pod adresem „Iwonicz”.*wskaż dokładne miejsce na mapie/.test(w[0].wskazowka), w[0].wskazowka);
  // „found objects”: null (nic podobnego) -> bez drugiej próby
  G._reset(); wywolania.length = 0;
  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_brak.json'))); };
  assert.deepStrictEqual(zwykly(await G.szukaj('Atlantyda 7')), []);
  assert.strictEqual(wywolania.length, 1);
  // druga próba też pusta -> [] (najwyżej 2 zapytania)
  G._reset(); wywolania.length = 0;
  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_iwonicz100_brak.json'))); };
  assert.deepStrictEqual(zwykly(await G.szukaj('Iwonicz 100')), []);
  assert.strictEqual(wywolania.length, 2);
  // trafienie dokładne nie ma flagi przybliżenia
  G._reset();
  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_adres_przemysl_rynek2.json'))); };
  const p = await G.szukaj('Przemyśl, Rynek 2');
  assert.strictEqual(p[0].przyblizony, undefined);
});

test('geokoder: cecha ulicy z nazwy UUG (TERYT ULIC)', function () {
  const r = function (t) { return zwykly(G._test.rozdzielUlice(t)); };
  assert.deepStrictEqual(r('ulica Marszałkowska'), { cecha: 'ul.', nazwa: 'Marszałkowska' });
  assert.deepStrictEqual(r('Adama Asnyka'), { cecha: 'ul.', nazwa: 'Adama Asnyka' });
  assert.deepStrictEqual(r('Aleja Jana Pawła II'), { cecha: 'al.', nazwa: 'Jana Pawła II' });
  assert.deepStrictEqual(r('Plac Konstytucji 3 Maja'), { cecha: 'pl.', nazwa: 'Konstytucji 3 Maja' });
  assert.deepStrictEqual(r('Rynek'), { cecha: 'inne', nazwa: 'Rynek' });
  assert.deepStrictEqual(r('Rynek Główny'), { cecha: 'inne', nazwa: 'Rynek Główny' });
  assert.deepStrictEqual(r('Park Miejski'), { cecha: 'inne', nazwa: 'Park Miejski' });
  assert.deepStrictEqual(r(''), { cecha: null, nazwa: null });
  // walidacja: „Rynek” bez cechy -> podpowiedź „inne”, a nie „ul.”
  const pr = AED.walidacja.walidujRekord({ _id: 'x', ulica: 'Rynek', cecha_ulicy: null, numer_budynku: '1' })
    .find(function (p) { return p.pole === 'cecha_ulicy'; });
  assert.strictEqual(pr.podpowiedz, 'inne');
  assert.strictEqual(pr.poziom, 'ostrzezenie');
  assert.strictEqual(AED.normalizacja.rozdzielCeche('Rynek Główny').cecha, 'inne');
});

test('geokoder: błędy z czytelnym kodem – blokada, strona WAF, HTTP 5xx, brak sieci/CORS, przerwanie, pusty adres', async function () {
  G._reset();
  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_zablokowane.json'))); };
  const e1 = await oczekujBledu(G.szukaj('Krosno, Rynek 5'), 'LIMIT');
  assert.ok(/Odczekaj/.test(e1.message));
  obslugaFetch = function () { return Promise.resolve(new Response(fixture('uug_odrzucone_waf.html'), { status: 200, headers: { 'Content-Type': 'text/html' } })); };
  await oczekujBledu(G.szukaj('Krosno, Rynek 6'), 'FORMAT');
  obslugaFetch = function () { return Promise.resolve(json('{}', 503)); };
  await oczekujBledu(G.szukaj('Krosno, Rynek 7'), 'SIEC');
  obslugaFetch = function () { return Promise.resolve(json('{}', 429)); };
  await oczekujBledu(G.szukaj('Krosno, Rynek 8'), 'LIMIT');
  obslugaFetch = function () { return Promise.reject(new TypeError('Failed to fetch')); };
  const e2 = await oczekujBledu(G.szukaj('Krosno, Rynek 9'), 'SIEC');
  assert.ok(/wskaż punkt na mapie/.test(e2.message));
  await oczekujBledu(G.szukaj('  '), 'FORMAT');
  await oczekujBledu(G.szukaj('x'.repeat(201)), 'FORMAT');
  const ctrl = new AbortController();
  obslugaFetch = function (url, init) {
    return new Promise(function (_, odrzuc) {
      init.signal.addEventListener('abort', function () { const e = new Error('aborted'); e.name = 'AbortError'; odrzuc(e); });
    });
  };
  const p = G.szukaj('Krosno, Rynek 10', { signal: ctrl.signal });
  setTimeout(function () { ctrl.abort(); }, 10);
  await oczekujBledu(p, 'PRZERWANO');
  ctrl.abort();
  await oczekujBledu(G.szukaj('Krosno, Rynek 11', { signal: ctrl.signal }), 'PRZERWANO');
});

test('geokoder: pamięć odpowiedzi (te same zapytania nie idą drugi raz) i odstęp między zapytaniami', async function () {
  G._reset();
  let n = 0;
  obslugaFetch = function () { n++; return Promise.resolve(json(fixture('uug_adres_warszawa_marszalkowska140.json'))); };
  await G.szukaj('Warszawa, Marszałkowska 140');
  await G.szukaj('Warszawa,   Marszałkowska 140 ');
  assert.strictEqual(n, 1, 'drugie zapytanie z pamięci');
  // blokada nie trafia do pamięci
  G._reset(); n = 0;
  obslugaFetch = function () { n++; return Promise.resolve(json(n === 1 ? fixture('uug_zablokowane.json') : fixture('uug_brak.json'))); };
  await oczekujBledu(G.szukaj('Nowe Miasto'), 'LIMIT');
  assert.deepStrictEqual(zwykly(await G.szukaj('Nowe Miasto')), []);
  assert.strictEqual(n, 2);
  // odstęp
  G._reset(); G.odstepMs = 60;
  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_brak.json'))); };
  const t0 = Date.now();
  await Promise.all([G.szukaj('Abc 1'), G.szukaj('Abc 2'), G.szukaj('Abc 3')]);
  assert.ok(Date.now() - t0 >= 110, 'trzy zapytania rozłożone w czasie: ' + (Date.now() - t0) + ' ms');
  G.odstepMs = 0;
});

test('geokoder.gmina i odwrotne: ULDK (TERC 7 cyfr) + UUG GetAddressReverse; zapytanie ULDK w PUWG 1992', async function () {
  G._reset();
  obslugaFetch = function (url) {
    if (/uldk\.gugik\.gov\.pl/.test(url)) return Promise.resolve(tekst(fixture('uldk_gmina_krosno.txt')));
    if (/GetAddressReverse/.test(url)) return Promise.resolve(json(fixture('uug_odwrotne_krosno.json')));
    return Promise.resolve(json('{}', 404));
  };
  const g = await G.gmina(49.6886, 21.7655);
  assert.deepStrictEqual(zwykly(g), { kod_terc_gminy: '1861011', gmina: 'Krosno (miasto)', powiat: 'powiat Krosno', wojewodztwo: 'podkarpackie' });
  const u = new URL(wywolania[wywolania.length - 1]);
  assert.strictEqual(u.searchParams.get('request'), 'GetCommuneByXY');
  const xy = u.searchParams.get('xy').split(',').map(Number);
  assert.strictEqual(xy.length, 2, 'bez sufiksu SRID (domyślnie 2180)');
  assert.ok(Math.abs(xy[0] - 699370) < 400 && Math.abs(xy[1] - 205950) < 400, 'PUWG 1992: ' + xy);

  // Krosno: TERC wynika z odpowiedzi UUG (miasto na prawach powiatu) -> ULDK nie jest pytane
  G._reset();
  wywolania.length = 0;
  const o = await G.odwrotne(49.6886, 21.7655);
  assert.strictEqual(o.lat, 49.6886, 'współrzędne = wskazany punkt');
  assert.strictEqual(o.lon, 21.7655);
  assert.strictEqual(o.miejscowosc, 'Krosno');
  assert.strictEqual(o.ulica, 'Grodzka');
  assert.strictEqual(o.numer, '22');
  assert.strictEqual(o.kod_terc_gminy, '1861011');
  assert.strictEqual(o.gmina, null);
  assert.strictEqual(o.ostrzezenie, undefined);
  assert.ok(Math.abs(o.odleglosc_m - 25.9) < 0.1);
  assert.ok(odlM({ lat: o.adres_lat, lon: o.adres_lon }, { lat: 49.688400, lon: 21.765686 }) < 0.2);
  assert.strictEqual(wywolania.length, 1, 'tylko UUG: ' + wywolania.join(' | '));
  assert.strictEqual(new URL(wywolania[0]).searchParams.get('location'), 'POINT(21.7655 49.6886)');

  // gmina miejsko-wiejska (teryt 180708 – dane syntetyczne na bazie odpowiedzi z Krosna): UUG, potem ULDK – po kolei, nie równolegle
  const odwrotneWies = fixture('uug_odwrotne_krosno.json').replace(/186101/g, '180708').replace('Krosno,Krosno', 'krośnieński,Rymanów');
  const uldkRymanow = '0\n180708_4|Rymanów (miasto)|powiat krośnieński|podkarpackie';
  G._reset(); G.ponowienieUldkMs = 0;
  let wToku = 0, maks = 0;
  const kolejnosc = [], opcjeUldk = [];
  const zLicznikiem = function (url, init, odp) {
    wToku++; maks = Math.max(maks, wToku); kolejnosc.push(/uldk/.test(url) ? 'ULDK' : 'UUG');
    if (/uldk/.test(url)) opcjeUldk.push(init.redirect);
    return new Promise(function (ok) { setTimeout(function () { wToku--; ok(odp()); }, 5); });
  };
  obslugaFetch = function (url, init) {
    return zLicznikiem(url, init, function () { return /uldk/.test(url) ? tekst(uldkRymanow) : json(odwrotneWies); });
  };
  const ow = await G.odwrotne(49.6886, 21.7655);
  assert.deepStrictEqual(kolejnosc, ['UUG', 'ULDK']);
  assert.strictEqual(maks, 1, 'zapytania nie biegną równolegle');
  assert.deepStrictEqual(opcjeUldk, ['manual'], 'ULDK bez podążania za przekierowaniem');
  assert.strictEqual(ow.kod_terc_gminy, '1807084');
  assert.strictEqual(ow.gmina, 'Rymanów (miasto)');
  // ULDK: losowe przekierowanie (302 na stronę-pułapkę bez CORS) -> ponowienie; w przeglądarce to odpowiedź „opaqueredirect”
  G._reset(); kolejnosc.length = 0;
  let n302 = 0;
  obslugaFetch = function (url, init) {
    return zLicznikiem(url, init, function () {
      if (!/uldk/.test(url)) return json(odwrotneWies);
      if (n302++ < 2) return new Response(null, { status: 302, headers: { Location: 'https://integracja01.gugik.gov.pl/resp/uldk.php' } });
      return tekst(uldkRymanow);
    });
  };
  const ow2 = await G.odwrotne(49.6886, 21.7655);
  assert.deepStrictEqual(kolejnosc, ['UUG', 'ULDK', 'ULDK', 'ULDK'], 'dwa ponowienia');
  assert.strictEqual(ow2.kod_terc_gminy, '1807084');
  // ULDK stale przekierowuje / brak sieci -> wynik bez gminy, przyjazny komunikat, najwyżej 3 próby
  for (const zle of [function () { return new Response(null, { status: 302, headers: { Location: 'https://integracja01.gugik.gov.pl/resp/uldk.php' } }); },
    function () { return { type: 'opaqueredirect', status: 0, ok: false, text: function () { return Promise.resolve(''); } }; }]) {
    G._reset(); kolejnosc.length = 0;
    obslugaFetch = function (url) { return Promise.resolve(/uldk/.test(url) ? zle() : json(odwrotneWies)); };
    const o2 = await G.odwrotne(49.6886, 21.7655);
    assert.strictEqual(o2.miejscowosc, 'Krosno');
    assert.strictEqual(o2.kod_terc_gminy, null);
    assert.strictEqual(o2.teryt_gminy6, '180708');
    assert.strictEqual(o2.gmina, null);
    assert.ok(/kodu gminy \(TERC\).*nie jest obowiązkowy/.test(o2.ostrzezenie), o2.ostrzezenie);
  }
  G._reset();
  let nUldk = 0;
  obslugaFetch = function (url) { if (/uldk/.test(url)) { nUldk++; return Promise.reject(new TypeError('Failed to fetch')); } return Promise.resolve(json(odwrotneWies)); };
  const o4 = await G.odwrotne(49.6886, 21.7655);
  assert.strictEqual(nUldk, 3);
  assert.strictEqual(o4.kod_terc_gminy, null);
  // UUG zablokowane, ULDK działa -> sama gmina
  G._reset();
  obslugaFetch = function (url) {
    if (/uldk/.test(url)) return Promise.resolve(tekst(fixture('uldk_gmina_krosno.txt')));
    return Promise.resolve(json(fixture('uug_zablokowane.json')));
  };
  const o3 = await G.odwrotne(49.6886, 21.7655);
  assert.strictEqual(o3.dokladnosc, 'gmina');
  assert.strictEqual(o3.miejscowosc, null);
  assert.strictEqual(o3.kod_terc_gminy, '1861011');
  assert.strictEqual(o3.gmina, 'Krosno (miasto)');
  assert.ok(/Nie udało się ustalić adresu.*Odczekaj/.test(o3.ostrzezenie));
  // poza Polską: puste odpowiedzi -> null
  G._reset();
  obslugaFetch = function (url) {
    if (/uldk/.test(url)) return Promise.resolve(tekst(fixture('uldk_pusta.txt')));
    return Promise.resolve(json(JSON.stringify({ type: 'address', 'returned objects': 0, results: null })));
  };
  assert.strictEqual(await G.odwrotne(48.85, 2.35), null);
  // oba nie działają -> błąd UUG
  G._reset();
  obslugaFetch = function () { return Promise.reject(new TypeError('Failed to fetch')); };
  await oczekujBledu(G.odwrotne(49.6886, 21.7655), 'SIEC');
  await oczekujBledu(G.odwrotne(NaN, 21), 'FORMAT');
  assert.throws(function () { G._test.gminaZTekstu('<html>'); }, /stronę/);
  assert.strictEqual(G._test.gminaZTekstu('-1 brak wyników'), null);
});

// ================================================================ formularz
test('formularz.pusty: pola wzorca i wartości domyślne zgłoszenia dysponenta', function () {
  const r = F.pusty({ nazwa: 'Szkoła Podstawowa nr 3 w Krośnie', telefon: '+48 13 474 30 00', email: 'Sekretariat@SP3.example.pl' },
    { teraz: new Date(2026, 10, 21, 9, 5, 7) });
  assert.deepStrictEqual(zwykly(Object.keys(r).sort()), zwykly(AED.wzorzec.schema.fields.map(function (f) { return f.name; }).sort()));
  assert.ok(RE_UUID.test(r.id_aed), 'UUID v4');
  assert.notStrictEqual(F.pusty().id_aed, F.pusty().id_aed);
  assert.strictEqual(r.status, 'aktywny');
  assert.strictEqual(r.zrodlo_wspolrzednych, null, 'ustawia je dopiero ustawPunkt');
  assert.strictEqual(r.lokalizacja_przyblizona, false);
  assert.strictEqual(r.sposob_weryfikacji, 'potwierdzenie_dysponenta');
  assert.strictEqual(r.data_weryfikacji, '2026-11-21');
  assert.strictEqual(r.data_aktualizacji_rekordu, '2026-11-21T09:05:07');
  assert.strictEqual(r.licencja_rekordu, 'CC0-1.0');
  assert.strictEqual(r.zrodlo_danych, 'FORMULARZ', 'kod z rejestru źródeł wzorca');
  assert.strictEqual(r.dysponent_nazwa, 'Szkoła Podstawowa nr 3 w Krośnie');
  assert.strictEqual(r.dysponent_typ, 'placowka_oswiatowa', 'typ zgadnięty z nazwy');
  assert.strictEqual(r.telefon_kontaktowy, '+48134743000');
  assert.strictEqual(r.email_kontaktowy, 'sekretariat@sp3.example.pl');
  F.ustawPunkt(r, 50.1, 19.9);
  assert.strictEqual(r.zrodlo_wspolrzednych, 'wskazanie_na_mapie', 'domyślnie mapa');
  F.ustawPunkt(r, 50.1234567, 19.9876543, 'adres');
  assert.deepStrictEqual([r.szerokosc_geograficzna, r.dlugosc_geograficzna, r.zrodlo_wspolrzednych, r.lokalizacja_przyblizona], [50.123457, 19.987654, 'geokodowanie_adresu', true]);
  F.ustawPunkt(r, 50.1, 19.9, 'gps');
  assert.deepStrictEqual([r.zrodlo_wspolrzednych, r.lokalizacja_przyblizona], ['pomiar_gps', false]);
});

test('formularz.POLA_FORMULARZA: kolejność, grupy, oznaczenia; bez pól technicznych', function () {
  const P = F.POLA_FORMULARZA;
  const grupy = F.GRUPY.map(function (g) { return g.id; });
  const nazwy = P.map(function (f) { return f.pole; });
  assert.strictEqual(new Set(nazwy).size, nazwy.length, 'pola nie powtarzają się');
  P.forEach(function (f) {
    assert.ok(AED.wzorzec.schema.fields.some(function (x) { return x.name === f.pole; }), f.pole + ' jest we wzorcu');
    assert.ok(grupy.indexOf(f.grupa) >= 0, f.pole + ': grupa ' + f.grupa);
    assert.ok(typeof f.etykieta === 'string' && f.etykieta.length > 2);
    assert.ok(!(f.wymagane && f.zalecane));
    if (f.typ === 'slownik') assert.ok(f.slownik.length > 1 && f.slownik.every(function (s) { return s.kod && s.etykieta; }), f.pole);
  });
  // kolejność grup = kolejność pól
  let ostatnia = 0;
  P.forEach(function (f) { const i = grupy.indexOf(f.grupa); assert.ok(i >= ostatnia, 'pola pogrupowane: ' + f.pole); ostatnia = i; });
  F.POLA_TECHNICZNE.forEach(function (t) { assert.ok(nazwy.indexOf(t) < 0, t + ' nie jest pokazywane'); });
  // każde pole wzorca jest albo w formularzu, albo techniczne
  AED.wzorzec.schema.fields.forEach(function (f) { assert.ok(nazwy.indexOf(f.name) >= 0 || F.POLA_TECHNICZNE.indexOf(f.name) >= 0, f.name); });
  // wymagane w formularzu = obowiązkowe we wzorcu, które wpisuje dysponent
  const obow = AED.wzorzec.schema.fields.filter(function (f) { return f.constraints && f.constraints.required; }).map(function (f) { return f.name; })
    .filter(function (n) { return F.POLA_TECHNICZNE.indexOf(n) < 0; }).sort();
  assert.deepStrictEqual(zwykly(P.filter(function (f) { return f.wymagane; }).map(function (f) { return f.pole; }).sort()), zwykly(obow));
  assert.deepStrictEqual(zwykly(F.POLA_FORMULARZA.find(function (f) { return f.pole === 'licencja_rekordu'; }) || null), null);
});

test('formularz.normalizujWpis: wpisy w języku potocznym -> wartości wzorca; problemy po polsku', function () {
  const n = function (p, t) { return zwykly(F.normalizujWpis(p, t)); };
  assert.deepStrictEqual(n('godziny_dostepnosci', 'pn-pt 7:30-15:30'), { wartosc: 'Mo-Fr 07:30-15:30' });
  assert.deepStrictEqual(n('godziny_dostepnosci', 'całodobowo'), { wartosc: '24/7' });
  assert.deepStrictEqual(n('godziny_dostepnosci', '24/7'), { wartosc: '24/7' });
  assert.ok(n('godziny_dostepnosci', 'rano i wieczorem').problem);
  assert.deepStrictEqual(n('dostepnosc', 'całodobowo'), { wartosc: 'publiczna_24_7' });
  assert.deepStrictEqual(n('sposob_dostepu', 'szafka z alarmem'), { wartosc: 'szafka_z_alarmem' });
  assert.ok(/Wybierz jedną z listy/.test(n('sposob_dostepu', 'coś dziwnego').problem));
  assert.deepStrictEqual(n('kod_pocztowy', '38 400'), { wartosc: '38-400' });
  assert.ok(n('kod_pocztowy', '38-4000').problem);
  assert.deepStrictEqual(n('telefon_kontaktowy', '13 474 30 00'), { wartosc: '134743000' });
  assert.deepStrictEqual(n('email_kontaktowy', ' Sekretariat@Gmina.PL '), { wartosc: 'sekretariat@gmina.pl' });
  assert.deepStrictEqual(n('szerokosc_geograficzna', '49,6939961'), { wartosc: 49.693996 });
  assert.ok(n('szerokosc_geograficzna', 'północ').problem);
  assert.deepStrictEqual(n('kondygnacja', 'parter'), { wartosc: 0 });
  assert.deepStrictEqual(n('kondygnacja', 'I piętro'), { wartosc: 1 });
  assert.deepStrictEqual(n('wewnatrz_budynku', 'tak'), { wartosc: true });
  assert.deepStrictEqual(n('tryb_pediatryczny', false), { wartosc: false });
  assert.deepStrictEqual(n('data_waznosci_elektrod', '30.06.2027'), { wartosc: '2027-06-30' });
  assert.ok(n('data_przegladu', '31.02.2026').problem);
  assert.deepStrictEqual(n('dysponent_regon', '012 345 678'), { wartosc: '012345678' });
  assert.deepStrictEqual(n('ulica', 'ul. Lwowska'), { wartosc: 'Lwowska', cecha_ulicy: 'ul.' });
  assert.deepStrictEqual(n('ulica', 'Lwowska'), { wartosc: 'Lwowska' });
  assert.deepStrictEqual(n('nazwa', '  '), { wartosc: null });
  assert.ok(/150 znaków/.test(n('nazwa', 'x'.repeat(151)).problem));
  assert.ok(n('nie_ma_takiego', 'x').problem);
});

test('formularz.waliduj: reguły wzorca + wymagane w formularzu; rekord kompletny bez błędów', function () {
  const pusty = F.pusty();
  const p = F.waliduj(pusty);
  const bledne = Array.from(new Set(p.filter(function (x) { return x.poziom === 'blad'; }).map(function (x) { return x.pole; }))).sort();
  assert.deepStrictEqual(zwykly(bledne), ['dlugosc_geograficzna', 'dostepnosc', 'dysponent_nazwa', 'miejscowosc', 'nazwa', 'opis_lokalizacji',
    'sposob_dostepu', 'szerokosc_geograficzna']);
  assert.ok(p.every(function (x) { return typeof x.komunikat === 'string' && x.komunikat.length > 5; }));
  assert.strictEqual(F.gotowy(pusty), false);
  const r = rekordKrosno();
  const ok = F.waliduj(r, { dzis: '2026-11-21' });
  assert.deepStrictEqual(zwykly(ok.filter(function (x) { return x.poziom === 'blad'; })), []);
  assert.strictEqual(F.gotowy(r, { dzis: '2026-11-21' }), true);
  // reguły warunkowe i spójności z walidacji wzorca
  const zle = F.waliduj(rekordKrosno({ godziny_dostepnosci: null, sposob_dostepu: 'szafka_na_kod', instrukcja_dostepu: 'kod 4821',
    szerokosc_geograficzna: 21.765857, dlugosc_geograficzna: 49.693996 }), { dzis: '2026-11-21' });
  const kody = zle.map(function (x) { return x.pole + ':' + x.kod; });
  ['godziny_dostepnosci:WYMAGANE', 'instrukcja_dostepu:PODEJRZANY', 'szerokosc_geograficzna:ZAKRES'].forEach(function (k) { assert.ok(kody.indexOf(k) >= 0, k + ' w ' + kody); });
  assert.strictEqual(r._id, undefined, 'rekord wejściowy bez zmian');
});

test('formularz.zGeokodera: adres z wyniku szukaj (punkt = geokodowanie) i odwrotne (punkt bez zmian)', async function () {
  G._reset();
  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_adres_warszawa_marszalkowska140.json'))); };
  const w = (await G.szukaj('Warszawa, Marszałkowska 140'))[0];
  const r = F.zGeokodera(F.pusty('Urząd m.st. Warszawy'), w);
  assert.deepStrictEqual([r.miejscowosc, r.cecha_ulicy, r.ulica, r.numer_budynku, r.kod_pocztowy, r.kod_terc_gminy, r.wojewodztwo, r.kod_simc, r.kod_ulic],
    ['Warszawa', 'ul.', 'Marszałkowska', '140', '00-061', '1465011', 'mazowieckie', '0918123', '12400']);
  assert.deepStrictEqual([r.szerokosc_geograficzna, r.dlugosc_geograficzna, r.zrodlo_wspolrzednych, r.lokalizacja_przyblizona], [52.237122, 21.007878, 'geokodowanie_adresu', true]);
  // nadpisz wynikiem „miejscowość”: ulica, numer i kody poprzedniego adresu są czyszczone
  G._reset();
  obslugaFetch = function () { return Promise.resolve(json(fixture('uug_miejscowosc_rymanow.json'))); };
  F.zGeokodera(r, (await G.szukaj('Rymanów'))[0], { nadpisz: true, punkt: false });
  assert.deepStrictEqual([r.miejscowosc, r.ulica, r.cecha_ulicy, r.numer_budynku, r.kod_pocztowy, r.kod_ulic, r.kod_terc_gminy, r.kod_simc],
    ['Rymanów', null, null, null, null, null, null, '0953421']);
  assert.strictEqual(r.szerokosc_geograficzna, 52.237122, 'punkt bez zmian (punkt: false)');
  // wpis użytkownika zostaje (bez nadpisz)
  const r2 = F.pusty(); r2.miejscowosc = 'Warszawa-Śródmieście';
  F.zGeokodera(r2, w, { punkt: false });
  assert.strictEqual(r2.miejscowosc, 'Warszawa-Śródmieście');
  assert.strictEqual(r2.szerokosc_geograficzna, null);
  // wynik odwrotnego geokodowania: punkt z mapy zostaje
  G._reset();
  obslugaFetch = function (url) {
    return Promise.resolve(/uldk/.test(url) ? tekst(fixture('uldk_gmina_krosno.txt')) : json(fixture('uug_odwrotne_krosno.json')));
  };
  const r3 = F.ustawPunkt(F.pusty(), 49.6886, 21.7655, 'mapa');
  F.zGeokodera(r3, await G.odwrotne(49.6886, 21.7655));
  assert.deepStrictEqual([r3.szerokosc_geograficzna, r3.zrodlo_wspolrzednych, r3.ulica, r3.kod_terc_gminy], [49.6886, 'wskazanie_na_mapie', 'Grodzka', '1861011']);
});

test('formularz.dodajDoZbioru: źródło FORMULARZ -> podpowiedź 1:1 (100% pól z kolumn) -> przelicz -> CSV round-trip', function () {
  const a = rekordKrosno();
  const b = rekordKrosno({ nazwa: 'Szkoła Podstawowa nr 3 – sala gimnastyczna', id_aed: F.pusty().id_aed, ulica: 'Grodzka', numer_budynku: '22',
    szerokosc_geograficzna: 49.6884, dlugosc_geograficzna: 21.765686, dostepnosc: 'publiczna_24_7', godziny_dostepnosci: '24/7',
    wewnatrz_budynku: false, kondygnacja: null, sposob_dostepu: 'szafka_na_klucz', instrukcja_dostepu: 'Klucz u woźnego (całodobowo)',
    tryb_pediatryczny: true, data_waznosci_elektrod: '2027-06-30', uwagi: 'Tekst z przecinkiem, "cudzysłowem"; średnikiem i znakiem = w środku' });
  assert.throws(function () { F.dodajDoZbioru([]); }, /żadnego/);
  assert.throws(function () { F.dodajDoZbioru([a], { licencja: 'GPL' }); }, /licencji wzorca/);
  const zdarzeniaZr = [];
  AED.on('zrodla:zmiana', function (e) { zdarzeniaZr.push(e.akcja); });
  const kodPrzed = store.przewidzKod('FORMULARZ');
  b.data_aktualizacji_rekordu = null;   // UI nie ustawiło daty -> uzupełni ją dodajDoZbioru
  const z = F.dodajDoZbioru([a, b], { dysponent: 'Urząd Miasta Krosna', licencja: 'CC-BY-4.0' });
  assert.deepStrictEqual(zdarzeniaZr, ['dodano'], 'jedno zdarzenie, źródło od razu z wierszami');
  assert.strictEqual(z.kod, kodPrzed);
  assert.strictEqual(z.meta.format, 'formularz dysponenta');
  assert.strictEqual(z.wiersze[0].data_aktualizacji_rekordu, a.data_aktualizacji_rekordu, 'data ustawiona przez UI zostaje');
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(z.wiersze[1].data_aktualizacji_rekordu), 'brak daty -> teraz');
  b.data_aktualizacji_rekordu = z.wiersze[1].data_aktualizacji_rekordu;
  assert.strictEqual(z.typ, 'FORMULARZ');
  assert.ok(/^FORMULARZ-\d{2}$/.test(z.kod));
  assert.strictEqual(z.priorytet, 2);
  assert.strictEqual(z.licencja, 'CC-BY-4.0');
  assert.strictEqual(z.dysponent, 'Urząd Miasta Krosna');
  assert.strictEqual(store.TYP_OPIS.FORMULARZ, 'formularz dysponenta');
  assert.deepStrictEqual(zwykly(z.kolumny), zwykly(AED.wzorzec.schema.fields.map(function (f) { return f.name; })));
  assert.strictEqual(z.wiersze.length, 2);
  assert.ok(Object.keys(z.wiersze[0]).every(function (k) { return typeof z.wiersze[0][k] === 'string'; }), 'wiersze tekstowe');
  assert.strictEqual(z.wiersze[0].wewnatrz_budynku, 'true');
  assert.strictEqual(z.wiersze[0].zrodlo_danych, z.kod);
  const m = M.podpowiedz(store.zrodlo(z.id));
  AED.wzorzec.schema.fields.forEach(function (f) {
    assert.strictEqual(m[f.name].regula, 'kolumna', f.name + ': ' + JSON.stringify(m[f.name]));
    assert.strictEqual(m[f.name].kolumna, f.name, f.name);
  });
  const p = store.przelicz();
  assert.strictEqual(p.rekordy, 2);
  const r = store.rekordy;
  ['id_aed', 'nazwa', 'szerokosc_geograficzna', 'dlugosc_geograficzna', 'godziny_dostepnosci', 'kondygnacja', 'wewnatrz_budynku', 'kod_terc_gminy',
    'telefon_kontaktowy', 'data_weryfikacji', 'data_aktualizacji_rekordu'].forEach(function (k) { assert.strictEqual(r[0][k], a[k], k); });
  assert.strictEqual(r[1].uwagi, b.uwagi);
  assert.strictEqual(r[1].kondygnacja, null);
  assert.strictEqual(r[0].licencja_rekordu, 'CC-BY-4.0');
  assert.strictEqual(r[0].zrodlo_danych, z.kod);
  assert.strictEqual(r[0]._kodZrodla, z.kod);
  assert.strictEqual(r[0]._wiersz, 1, 'numer urządzenia w formularzu (bez wiersza nagłówka)');
  assert.deepStrictEqual(zwykly(r[0]._naprawy), [], 'nic do naprawiania');
  const wal = AED.walidacja.waliduj(r, { dzis: '2026-11-21' });
  assert.strictEqual(wal.podsumowanie.bledy, 0, JSON.stringify(wal.problemy.filter(function (x) { return x.poziom === 'blad'; })));
  // CSV dla dysponenta: zgodny z eksportem zbioru i z wzorcem
  const c = F.csv([a, b]);
  assert.strictEqual(c, AED.eksport.csv([a, b]));
  const naglowek = c.split('\r\n')[0];
  assert.strictEqual(naglowek, AED.wzorzec.schema.fields.map(function (f) { return f.name; }).join(','));
  assert.strictEqual(naglowek, czytaj('wzorzec/szablon_aed.csv').split(/\r?\n/)[0], 'nagłówek = szablon_aed.csv');
  const sparsowane = ctx.Papa.parse(c, { header: true, skipEmptyLines: true });
  assert.strictEqual(sparsowane.data.length, 2);
  assert.strictEqual(sparsowane.data[1].uwagi, b.uwagi);
  // round-trip: CSV -> źródło PLIK -> mapowanie -> te same rekordy
  const zp = { id: 'csv-z-formularza', kod: 'PLIK-77', typ: 'PLIK', licencja: 'CC0-1.0', kolumny: sparsowane.meta.fields, wiersze: sparsowane.data, meta: {} };
  const w = M.zastosuj(zp, M.podpowiedz(zp)).rekordy;
  AED.wzorzec.schema.fields.forEach(function (f) {
    [a, b].forEach(function (x, i) { assert.deepStrictEqual(w[i][f.name], x[f.name] === undefined ? null : x[f.name], 'round-trip ' + f.name + ' #' + i); });
  });
  assert.ok(F.csv([a], { bom: true }).charCodeAt(0) === 0xfeff);
  const bezDaty = Object.assign({}, a, { data_aktualizacji_rekordu: null });
  const wiersz = ctx.Papa.parse(F.csv([bezDaty]), { header: true, skipEmptyLines: true }).data[0];
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(wiersz.data_aktualizacji_rekordu), 'CSV: brak daty -> teraz');
  assert.strictEqual(ctx.Papa.parse(F.csv([a]), { header: true }).data[0].data_aktualizacji_rekordu, a.data_aktualizacji_rekordu);
  const rej = AED.eksport.rejestrZrodel([store.zrodlo(z.id)], r).wiersze[0];
  assert.strictEqual(rej.kod_zrodla, z.kod);
  assert.strictEqual(rej.typ_zrodla, 'formularz dysponenta');
  assert.strictEqual(rej.format, 'formularz dysponenta');
  assert.strictEqual(rej.licencja, 'CC-BY-4.0');
  assert.ok(/walidowane w formularzu/.test(rej.problemy_jakosci), 'opis z rejestru źródeł wzorca (FORMULARZ)');
  assert.strictEqual(rej.liczba_rekordow, 2);
  store.usunZrodlo(z.id);
  assert.strictEqual(store.rekordy.length, 0);
});

test('formularz: szkic w localStorage (zapis, odczyt, usunięcie, błędy przeglądarki)', function () {
  const a = rekordKrosno();
  a._techniczne = 'x';
  assert.strictEqual(F.zapiszSzkic([a]), true);
  const s = F.wczytajSzkic();
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].id_aed, a.id_aed);
  assert.strictEqual(s[0].wewnatrz_budynku, true);
  assert.strictEqual(s[0]._techniczne, undefined, 'tylko pola wzorca');
  assert.ok(JSON.parse(magazyn.get(F.KLUCZ_SZKICU)).zapisano);
  magazyn.set(F.KLUCZ_SZKICU, '{zepsuty');
  assert.deepStrictEqual(zwykly(F.wczytajSzkic()), []);
  assert.strictEqual(F.usunSzkic(), true);
  assert.deepStrictEqual(zwykly(F.wczytajSzkic()), []);
  // stan interfejsu w tym samym wpisie
  assert.strictEqual(F.wczytajStanSzkicu(), null);
  assert.strictEqual(F.zapiszSzkic([a], { dysponent: { dysponent_nazwa: 'UM Krosno' }, licencja: 'CC-BY-4.0', edycja: null }), true);
  assert.deepStrictEqual(zwykly(F.wczytajStanSzkicu()), { dysponent: { dysponent_nazwa: 'UM Krosno' }, licencja: 'CC-BY-4.0', edycja: null });
  assert.strictEqual(F.wczytajSzkic().length, 1);
  F.usunSzkic();
  assert.strictEqual(F.wczytajStanSzkicu(), null);
  localStorageWyjatek = true;
  assert.strictEqual(F.zapiszSzkic([a]), false);
  assert.deepStrictEqual(zwykly(F.wczytajSzkic()), []);
  localStorageWyjatek = false;
});

// ================================================================ uruchomienie
(async function () {
  let ok = 0;
  const bledy = [];
  for (const t of testy) {
    try {
      await t.fn();
      ok++;
      console.log('  ✓ ' + t.nazwa);
    } catch (e) {
      bledy.push(t.nazwa);
      console.log('  ✗ ' + t.nazwa + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n    ') : e));
    }
  }
  console.log('\n' + ok + '/' + testy.length + ' testów zaliczonych');
  if (bledy.length) process.exit(1);
})();
