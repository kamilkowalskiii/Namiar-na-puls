/* Testy części 3: normalizacja, mapowanie kolumn, walidacja, rekordy w store.
   Uruchomienie: node tests/czesc3.test.js   (Node 18+, bez zależności npm)
   Skrypty aplikacji ładujemy w vm z minimalnym `window` (jak w tests/zdalne.test.js).
   Prawdziwe zbiory z dane.gov.pl (Krosno, Przemyśl, Marki) wczytujemy przez AED.zrodla.plik.wczytaj. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const KORZEN = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const czytaj = function (p) { return fs.readFileSync(path.join(KORZEN, p), 'utf8'); };

// ------------------------------------------------------------ środowisko
// ArrayBuffer/Uint8Array z głównego kontekstu – inaczej SheetJS w vm nie rozpozna bufora z File.arrayBuffer()
let obslugaFetch = null;
const zdarzenia = [];
const ctx = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, TextDecoder, TextEncoder,
  AbortController, Blob, File, Response, ArrayBuffer, Uint8Array, Headers, ReadableStream, crypto: globalThis.crypto,
  fetch: function (url, init) { return obslugaFetch(String(url), init || {}); }
};
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);
['vendor/papaparse/papaparse.min.js', 'vendor/sheetjs/xlsx.full.min.js', 'js/core/ns.js', 'js/schema/schema.js', 'js/ui/dom.js',
  'js/sources/file.js', 'js/core/store.js',
  'js/core/normalizacja.js', 'js/core/mapowanie.js', 'js/core/walidacja.js'].forEach(function (p) {
  vm.runInContext(czytaj(p), ctx, { filename: p });
});
const AED = ctx.AED;
const N = AED.normalizacja, M = AED.mapowanie, W = AED.walidacja, store = AED.store;
['zrodla:zmiana', 'rekordy:zmiana'].forEach(function (e) { AED.on(e, function (p) { zdarzenia.push({ e: e, p: p }); }); });

const zwykly = function (x) { return JSON.parse(JSON.stringify(x)); };
const DZIS = '2026-11-21';
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function wczytajPlik(nazwa) {
  const bufor = fs.readFileSync(path.join(FIX, nazwa));
  const plik = new File([bufor], nazwa);
  return AED.zrodla.plik.wczytaj(plik);
}
let licznikZrodel = 0;
function zrodloZ(w, dodatki) {
  licznikZrodel++;
  return Object.assign({ id: 'test-' + licznikZrodel, kod: 'PLIK-' + String(licznikZrodel).padStart(2, '0'), typ: 'PLIK',
    nazwa: 'test', dysponent: '', licencja: 'CC0-1.0', meta: w.meta || {}, dataPobrania: '2026-11-21T10:00:00',
    kolumny: w.kolumny, wiersze: w.wiersze }, dodatki || {});
}
function zKolumny(m) { return Object.keys(m).filter(function (p) { return m[p].regula !== 'brak' && m[p].regula !== 'stala'; }); }
function zStalych(m) { return Object.keys(m).filter(function (p) { return m[p].regula === 'stala'; }); }
function kodyProblemow(problemy) {
  const k = {};
  problemy.forEach(function (p) { k[p.kod] = (k[p.kod] || 0) + 1; });
  return k;
}
const statystyki = [];
function zapiszStatystyke(nazwa, z, m, wynik) {
  const wal = W.waliduj(wynik.rekordy, { dzis: DZIS });
  statystyki.push({ zbior: nazwa, rekordy: wynik.rekordy.length, polaZKolumn: zKolumny(m).length, polaStale: zStalych(m).length,
    polaBrak: Object.keys(m).length - zKolumny(m).length - zStalych(m).length, naprawy: wynik.podsumowanie.naprawy,
    bledy: wal.podsumowanie.bledy, ostrzezenia: wal.podsumowanie.ostrzezenia, rekordyZBledami: wal.podsumowanie.rekordyZBledami,
    kody: JSON.stringify(kodyProblemow(wal.problemy)) });
  return wal;
}

const testy = [];
const test = function (nazwa, fn) { testy.push({ nazwa, fn }); };

// ================================================================ normalizacja
test('normalizacja: liczby', function () {
  assert.strictEqual(N.liczba('52,2297'), 52.2297);
  assert.strictEqual(N.liczba(' 1 234,5 '), 1234.5);
  assert.strictEqual(N.liczba('1.234,5'), 1234.5);
  assert.strictEqual(N.liczba('abc'), null);
  assert.strictEqual(N.liczba(''), null);
  assert.strictEqual(N.liczba(7), 7);
});

test('normalizacja: współrzędne – zamiana, przecinek, DMS, litery N/E, brak kropki, precyzja, poza PL', function () {
  let w = N.wspolrzedne('21.7203', '49.7188');
  assert.strictEqual(w.lat, 49.7188); assert.strictEqual(w.lon, 21.7203);
  assert.ok(/Zamieniono szerokość/.test(w.naprawy.join(' ')));
  w = N.wspolrzedne('51,1001', '17,0302');
  assert.strictEqual(w.lat, 51.1001); assert.ok(/przecinek/.test(w.naprawy.join(' ')));
  w = N.wspolrzedne('50°41\'12"N', '21°45\'30"E');
  assert.ok(Math.abs(w.lat - 50.686667) < 1e-6 && Math.abs(w.lon - 21.758333) < 1e-6);
  assert.ok(/stopnie-minuty-sekundy/.test(w.naprawy.join(' ')));
  w = N.wspolrzedne('21°45\'30"E', '50°41\'12"N');
  assert.ok(Math.abs(w.lat - 50.686667) < 1e-6, 'litery N/E wskazują zamianę');
  w = N.wspolrzedne('N 50 41 12', 'E 21 45 30');
  assert.ok(Math.abs(w.lon - 21.758333) < 1e-6);
  w = N.wspolrzedne('52229676', '21012229');
  assert.strictEqual(w.lat, 52.229676); assert.ok(/kropkę dziesiętną/.test(w.naprawy.join(' ')));
  w = N.wspolrzedne('52.2', '21.0');
  assert.strictEqual(w.precyzja, 1); assert.strictEqual(w.ostrzezenia.length, 1);
  w = N.wspolrzedne('48.1', '2.3');
  assert.ok(w.blad && /poza Polską/.test(w.blad));
  w = N.wspolrzedne('500123.4', '250456.7');
  assert.ok(/PL-1992/.test(w.blad));
  assert.ok(N.wspolrzedne('', '').blad);
  assert.ok(/szerokości/.test(N.wspolrzedne('abc', '21.0').blad));
});

test('normalizacja: współrzędne w jednej kolumnie (WKT, GeoJSON, para, DMS)', function () {
  let w = N.wspolrzedneZTekstu('POINT(21.7 50.1)');
  assert.deepStrictEqual([w.lat, w.lon], [50.1, 21.7]);
  w = N.wspolrzedneZTekstu('{"type":"Point","coordinates":[22.7750936,49.7812096]}');
  assert.deepStrictEqual([w.lat, w.lon], [49.7812096, 22.7750936]);
  w = N.wspolrzedneZTekstu('50,1 21,7');
  assert.deepStrictEqual([w.lat, w.lon], [50.1, 21.7]);
  w = N.wspolrzedneZTekstu('52.326697, 21.107557');
  assert.deepStrictEqual([w.lat, w.lon], [52.326697, 21.107557]);
  w = N.wspolrzedneZTekstu('21.107557;52.326697');
  assert.deepStrictEqual([w.lat, w.lon], [52.326697, 21.107557]);
  w = N.wspolrzedneZTekstu('50°41\'12"N, 21°45\'30"E');
  assert.ok(Math.abs(w.lat - 50.686667) < 1e-6);
  assert.ok(N.wspolrzedneZTekstu('przy wejściu').blad);
});

test('normalizacja: adresy (14 przypadków)', function () {
  const P = [
    ['ul. Lwowska 28a, 38-400 Krosno', { cecha_ulicy: 'ul.', ulica: 'Lwowska', numer_budynku: '28a', kod_pocztowy: '38-400', miejscowosc: 'Krosno' }],
    ['Al. Jana Pawła II 4/6', { cecha_ulicy: 'al.', ulica: 'Jana Pawła II', numer_budynku: '4/6' }],
    ['pl. Konstytucji 3 Maja 1', { cecha_ulicy: 'pl.', ulica: 'Konstytucji 3 Maja', numer_budynku: '1' }],
    ['Łąkiewka 12', { ulica: null, cecha_ulicy: null, numer_budynku: '12', miejscowosc: 'Łąkiewka' }],
    ['Łąkiewka 12, 00-001 Łąkiewka', { ulica: null, numer_budynku: '12', miejscowosc: 'Łąkiewka', kod_pocztowy: '00-001' }],
    ['Al.. Piłsudskiego 95, 05-270 Marki', { cecha_ulicy: 'al.', ulica: 'Piłsudskiego', numer_budynku: '95', miejscowosc: 'Marki' }],
    ['ul. Kazimierza Wielkiego 4, , 38-400 Krosno', { ulica: 'Kazimierza Wielkiego', numer_budynku: '4', miejscowosc: 'Krosno' }],
    ['38-400 Krosno, ul. Lwowska 28a', { ulica: 'Lwowska', numer_budynku: '28a', miejscowosc: 'Krosno', kod_pocztowy: '38-400' }],
    ['Krosno, Lwowska 28', { cecha_ulicy: 'ul.', ulica: 'Lwowska', numer_budynku: '28', miejscowosc: 'Krosno' }],
    ['ul. Jasna, 38-400 Krosno', { ulica: 'Jasna', numer_budynku: null, miejscowosc: 'Krosno' }],
    ['ul. 3 Maja 19', { ulica: '3 Maja', numer_budynku: '19' }],
    ['ul. Główna 1, 00001 Przykładowo', { kod_pocztowy: '00-001', miejscowosc: 'Przykładowo' }],
    ['os. Tysiąclecia 5, 31-610 Kraków', { cecha_ulicy: 'os.', ulica: 'Tysiąclecia', numer_budynku: '5', miejscowosc: 'Kraków' }],
    ['Aleja Wojska Polskiego 12/14, 05-270 Marki', { cecha_ulicy: 'al.', ulica: 'Wojska Polskiego', numer_budynku: '12/14' }]
  ];
  P.forEach(function (p) {
    const a = N.adres(p[0]);
    Object.keys(p[1]).forEach(function (k) { assert.strictEqual(a[k], p[1][k], p[0] + ' -> ' + k + ': ' + a[k]); });
  });
  assert.ok(N.adres('Krosno, Lwowska 28').naprawy.length === 1, 'przyjęcie cechy „ul.” to naprawa');
});

test('normalizacja: kod pocztowy, telefon, e-mail', function () {
  assert.strictEqual(N.kodPocztowy('38400'), '38-400');
  assert.strictEqual(N.kodPocztowy('1234'), '01-234');
  assert.strictEqual(N.kodPocztowy('abc'), null);
  assert.strictEqual(N.telefon('+48 13 000 00 00'), '+48130000000');
  assert.strictEqual(N.telefon('\'+48166779500'), '+48166779500');   // Przemyśl: apostrof z Excela
  assert.strictEqual(N.telefon('13 43 20 000'), '134320000');
  assert.strictEqual(N.telefon('0048 600-100-200'), '+48600100200');
  assert.strictEqual(N.telefon('tel. (22) 597-09-27'), '225970927');
  assert.strictEqual(N.telefon('600100200, 601 222 333'), '600100200');
  assert.strictEqual(N.telefon('123'), null);
  assert.strictEqual(N.email(' Sekretariat@Przyklad.PL '), 'sekretariat@przyklad.pl');
  assert.strictEqual(N.email('mailto:a@b.pl'), 'a@b.pl');
  assert.strictEqual(N.email('brak@'), null);
});

test('normalizacja: daty i daty z czasem (w tym liczba seryjna Excela)', function () {
  assert.strictEqual(N.data('21.11.2026'), '2026-11-21');
  assert.strictEqual(N.data('1.2.26'), '2026-02-01');
  assert.strictEqual(N.data('2026-11-21'), '2026-11-21');
  assert.strictEqual(N.data('2026/1/5'), '2026-01-05');
  assert.strictEqual(N.data(46000), '2025-12-09');
  assert.strictEqual(N.data('46000'), '2025-12-09');
  assert.strictEqual(N.data(45658), '2025-01-01');
  assert.strictEqual(N.data('06/2027'), '2027-06-30');
  assert.strictEqual(N.data('15 marca 2026'), '2026-03-15');
  assert.strictEqual(N.data('31.02.2026'), null);
  assert.strictEqual(N.data('jutro'), null);
  assert.strictEqual(N.dataCzas('2026-11-21T12:00:00Z'), '2026-11-21T12:00:00');
  assert.strictEqual(N.dataCzas('21.11.2026 9:05'), '2026-11-21T09:05:00');
  assert.strictEqual(N.dataCzas('2026-11-21'), '2026-11-21T00:00:00');
  assert.strictEqual(N.dataCzas(46000.5), '2025-12-09T12:00:00');
});

test('normalizacja: wartości logiczne, kondygnacja, godziny', function () {
  ['tak', 'T', 'yes', '1', 'true', 'x', 'TAK'].forEach(function (v) { assert.strictEqual(N.bool(v), true, v); });
  ['nie', 'n', 'no', '0', 'false'].forEach(function (v) { assert.strictEqual(N.bool(v), false, v); });
  assert.strictEqual(N.bool('może'), null);
  assert.strictEqual(N.kondygnacja('parter'), 0);
  assert.strictEqual(N.kondygnacja('I piętro'), 1);
  assert.strictEqual(N.kondygnacja('-1'), -1);
  assert.strictEqual(N.kondygnacja('piwnica'), -1);
  assert.strictEqual(N.godziny('pn-pt 7:30-15:30'), 'Mo-Fr 07:30-15:30');
  assert.strictEqual(N.godziny('pn-pt 7-16'), 'Mo-Fr 07:00-16:00');
  assert.strictEqual(N.godziny('całodobowo'), '24/7');
  assert.strictEqual(N.godziny('poniedziałek - piątek 8.00 - 16.00'), 'Mo-Fr 08:00-16:00');
  assert.ok(N.poprawneGodziny('Mo-Fr 07:00-17:00; Sa 08:00-14:00'));
  assert.ok(!N.poprawneGodziny('rano'));
});

test('normalizacja: słowniki (synonimy PL i EN) oraz województwa', function () {
  const s = function (n, t) { return zwykly(N.slownik(n, t)); };
  assert.deepStrictEqual(s('dostepnosc', '24h'), { wartosc: 'publiczna_24_7', pewnosc: 'wysoka' });
  assert.deepStrictEqual(s('dostepnosc', 'całodobowo'), { wartosc: 'publiczna_24_7', pewnosc: 'wysoka' });
  assert.strictEqual(s('dostepnosc', 'yes').wartosc, null, 'samo „yes” nic nie mówi o dostępności');
  assert.strictEqual(s('dostepnosc', 'public').wartosc, 'publiczna_w_godzinach');
  assert.strictEqual(s('dostepnosc', 'customers').wartosc, 'dla_klientow');
  assert.strictEqual(s('dostepnosc', 'private').wartosc, 'tylko_personel');
  assert.strictEqual(s('dostepnosc', 'Publiczna 24/7').wartosc, 'publiczna_24_7');
  assert.strictEqual(s('dostepnosc', 'ogólnodostępny w godzinach pracy szkoły').wartosc, 'publiczna_w_godzinach');
  assert.strictEqual(s('dysponent_typ', 'szkoła').wartosc, 'placowka_oswiatowa');
  assert.strictEqual(s('dysponent_typ', 'Szkoła Podstawowa nr 1').wartosc, 'placowka_oswiatowa');
  assert.strictEqual(s('dysponent_typ', 'Urząd Miasta Krosna').wartosc, 'jst');
  assert.strictEqual(s('dysponent_typ', 'OSP Turaszówka').wartosc, 'sluzby');
  assert.strictEqual(s('dysponent_typ', 'Wojewódzki Szpital Podkarpacki').wartosc, 'podmiot_leczniczy');
  assert.strictEqual(s('sposob_dostepu', 'szafka z alarmem').wartosc, 'szafka_z_alarmem');
  assert.strictEqual(s('sposob_dostepu', 'bez zamka').wartosc, 'otwarta_szafka');
  assert.strictEqual(s('typ_urzadzenia', 'półautomatyczny').wartosc, 'polautomatyczny');
  assert.strictEqual(s('typ_urzadzenia', 'automatyczny').wartosc, 'automatyczny');
  assert.strictEqual(s('licencja_rekordu', 'CC BY 4.0').wartosc, 'CC-BY-4.0');
  assert.strictEqual(s('licencja_rekordu', 'cc0').wartosc, 'CC0-1.0');
  assert.strictEqual(s('cecha_ulicy', 'Aleja').wartosc, 'al.');
  assert.strictEqual(s('status', 'aktywny').wartosc, 'aktywny');
  assert.strictEqual(s('status', 'w serwisie').wartosc, 'tymczasowo_niedostepny');
  assert.deepStrictEqual(s('status', 'coś dziwnego'), { wartosc: null, pewnosc: 'niska' });
  assert.strictEqual(s('wojewodztwo', 'woj. Mazowieckie').wartosc, 'mazowieckie');
  assert.strictEqual(N.wojewodztwo('14'), 'mazowieckie');
  assert.strictEqual(N.wojewodztwo('PL-18'), 'podkarpackie');
  assert.strictEqual(N.wojewodztwo('PL-SL'), 'śląskie');
  assert.strictEqual(N.wojewodztwo('ŚWIĘTOKRZYSKIE'), 'świętokrzyskie');
  assert.strictEqual(N.wojewodztwo('województwo łódzkie'), 'łódzkie');
  assert.strictEqual(N.wojewodztwo('2'), 'dolnośląskie');
  assert.strictEqual(N.wojewodztwo('Bawaria'), null);
});

// ================================================================ mapowanie – prawdziwe zbiory
test('mapowanie: Krosno (DGP-3624) – adres w jednym polu, „Nazwa” stała', async function () {
  const w = await wczytajPlik('krosno_dgp3624.csv');
  const z = zrodloZ(w, { dysponent: 'Urząd Miasta Krosna' });
  const m = M.podpowiedz(z);
  assert.strictEqual(m.szerokosc_geograficzna.kolumna, 'Szerokość geograficzna');
  assert.strictEqual(m.dlugosc_geograficzna.kolumna, 'Długość geograficzna');
  assert.strictEqual(m.id_lokalne.kolumna, 'Numer Id');
  assert.strictEqual(m.opis_lokalizacji.kolumna, 'Lokalizacja');
  assert.strictEqual(m.nazwa.kolumna, 'Lokalizacja', 'kolumna „Nazwa” ma zawsze „Defibrylator” – nazwą jest „Lokalizacja”');
  assert.strictEqual(m.nazwa.pewnosc, 'srednia');
  assert.ok(/Defibrylator/.test(m.nazwa.powod));
  assert.strictEqual(m.opis_lokalizacji.pewnosc, 'niska', 'opis z tej samej kolumny – pewność niska');
  ['miejscowosc', 'ulica', 'numer_budynku', 'kod_pocztowy', 'cecha_ulicy'].forEach(function (p) {
    assert.strictEqual(m[p].regula, 'adres'); assert.strictEqual(m[p].kolumna, 'Adres');
  });
  assert.strictEqual(m.zrodlo_danych.wartosc, z.kod);
  assert.strictEqual(m.licencja_rekordu.wartosc, 'CC0-1.0');
  assert.strictEqual(m.dysponent_nazwa.wartosc, 'Urząd Miasta Krosna');
  assert.strictEqual(m.sposob_weryfikacji.wartosc, 'import_bez_weryfikacji');
  Object.keys(m).forEach(function (p) {
    assert.ok(M.REGULY.indexOf(m[p].regula) >= 0, p);
    assert.ok(['wysoka', 'srednia', 'niska'].indexOf(m[p].pewnosc) >= 0, p);
    assert.ok(typeof m[p].powod === 'string' && m[p].powod.length > 10, p);
  });
  const wynik = M.zastosuj(z, m);
  assert.strictEqual(wynik.rekordy.length, 21);
  const r = wynik.rekordy.find(function (x) { return x.id_lokalne === '22'; });
  assert.strictEqual(r.ulica, 'Lwowska'); assert.strictEqual(r.numer_budynku, '28a'); assert.strictEqual(r.kod_pocztowy, '38-400');
  assert.strictEqual(r.miejscowosc, 'Krosno'); assert.strictEqual(r.cecha_ulicy, 'ul.');
  assert.strictEqual(typeof r.szerokosc_geograficzna, 'number');
  assert.strictEqual(r._wiersz, 21, 'nr wiersza jak w pliku (nagłówek = 1)');
  assert.strictEqual(r.dysponent_typ, 'jst');
  const wal = zapiszStatystyke('Krosno (DGP-3624)', z, m, wynik);
  assert.strictEqual(r.nazwa, 'Urząd Miasta Krosna');
  assert.ok(wal.problemy.some(function (p) { return p.pole === 'opis_lokalizacji' && p.kod === 'PODEJRZANY'; }), 'opis = nazwa');
  assert.ok(wal.problemy.some(function (p) { return p.pole === 'dostepnosc' && p.kod === 'WYMAGANE'; }));
});

test('mapowanie: Przemyśl (DGP-4581) – średnik, współrzędne GeoJSON, ogólny opis pominięty', async function () {
  const w = await wczytajPlik('przemysl_dgp4581.csv');
  const z = zrodloZ(w);
  const m = M.podpowiedz(z);
  assert.strictEqual(m.szerokosc_geograficzna.regula, 'wspolrzedne_tekst');
  assert.strictEqual(m.szerokosc_geograficzna.kolumna, 'geometry');
  assert.strictEqual(m.dlugosc_geograficzna.kolumna, 'geometry');
  assert.strictEqual(m.id_lokalne.kolumna, 'name', 'numer AED wpisany w nazwę');
  assert.ok(m.id_lokalne.wzorzec);
  assert.strictEqual(m.zrodlo_id_rekordu.kolumna, 'id', 'techniczne id wiersza -> ID rekordu w źródle');
  assert.strictEqual(m.nazwa.kolumna, 'name');
  assert.strictEqual(m.miejscowosc.kolumna, 'city');
  assert.strictEqual(m.ulica.kolumna, 'street');
  assert.strictEqual(m.numer_budynku.kolumna, 'home_number');
  assert.strictEqual(m.kod_pocztowy.kolumna, 'postcode');
  assert.strictEqual(m.telefon_kontaktowy.kolumna, 'phone');
  assert.strictEqual(m.email_kontaktowy.kolumna, 'email');
  assert.strictEqual(m.opis_lokalizacji.regula, 'brak', 'ogólny opis AED powtórzony w każdym wierszu nie jest opisem miejsca');
  assert.ok(/ten sam długi tekst/.test(m.opis_lokalizacji.powod));
  const wynik = M.zastosuj(z, m);
  const r = wynik.rekordy[0];
  assert.strictEqual(r.szerokosc_geograficzna, 49.7812096);
  assert.strictEqual(r.dlugosc_geograficzna, 22.7750936);
  const plac = wynik.rekordy.find(function (x) { return /Legionów/.test(x.ulica || ''); });
  assert.strictEqual(plac.cecha_ulicy, 'pl.'); assert.strictEqual(plac.ulica, 'Legionów');
  const tel = wynik.rekordy.find(function (x) { return x.telefon_kontaktowy; });
  assert.strictEqual(tel.telefon_kontaktowy, '+48166779500');
  zapiszStatystyke('Przemyśl (DGP-4581)', z, m, wynik);
});

test('mapowanie: Marki (DGP-4955) CSV – zamienione nagłówki i jeden wiersz z odwrotną kolejnością', async function () {
  const w = await wczytajPlik('marki_dgp4955.csv');
  const z = zrodloZ(w, { licencja: 'CC-BY-4.0' });
  const m = M.podpowiedz(z);
  assert.strictEqual(m.szerokosc_geograficzna.kolumna, 'Długość geograficzna', 'nagłówki zamienione – decyduje zawartość');
  assert.strictEqual(m.dlugosc_geograficzna.kolumna, 'Szerokość geograficzna');
  assert.ok(/zamienione/.test(m.szerokosc_geograficzna.powod));
  const wynik = M.zastosuj(z, m);
  wynik.rekordy.forEach(function (r) {
    assert.ok(r.szerokosc_geograficzna > 49 && r.szerokosc_geograficzna < 55, 'szerokość w PL: ' + r.szerokosc_geograficzna);
    assert.ok(r.dlugosc_geograficzna > 14 && r.dlugosc_geograficzna < 25);
  });
  const r7 = wynik.rekordy.find(function (r) { return r.id_lokalne === '7'; });
  assert.ok(r7._naprawy.some(function (n) { return n.pole === 'szerokosc_geograficzna' && /Zamieniono/.test(n.opis); }));
  const r1 = wynik.rekordy[0];
  assert.strictEqual(r1.cecha_ulicy, 'al.'); assert.strictEqual(r1.ulica, 'Piłsudskiego');
  zapiszStatystyke('Marki (DGP-4955) CSV', z, m, wynik);
});

test('mapowanie: Marki XLSX (cały wiersz w jednej komórce) daje to samo co CSV', async function () {
  const w = await wczytajPlik('marki_dgp4955.xlsx');
  const z = zrodloZ(w, { licencja: 'CC-BY-4.0' });
  const m = M.podpowiedz(z);
  assert.strictEqual(m.szerokosc_geograficzna.kolumna, 'Długość geograficzna');
  const wynik = M.zastosuj(z, m);
  assert.strictEqual(wynik.rekordy.length, 8);
  assert.ok(wynik.rekordy.every(function (r) { return r.szerokosc_geograficzna > 52 && r.szerokosc_geograficzna < 53 || r.id_lokalne === '7'; }));
});

test('mapowanie: gmina (Windows-1250, „Szer.”, „Dł.”, przecinek dziesiętny, godziny po polsku)', async function () {
  const w = await wczytajPlik('gmina_przyklad_cp1250.csv');
  const z = zrodloZ(w, { dysponent: 'Urząd Gminy Przykładowo' });
  const m = M.podpowiedz(z);
  assert.strictEqual(m.szerokosc_geograficzna.kolumna, 'Szer.');
  assert.strictEqual(m.dlugosc_geograficzna.kolumna, 'Dł.');
  assert.strictEqual(m.nazwa.kolumna, 'Miejsce');
  assert.strictEqual(m.godziny_dostepnosci.kolumna, 'Godziny');
  assert.strictEqual(m.ulica.regula, 'adres');
  const wynik = M.zastosuj(z, m);
  assert.strictEqual(wynik.rekordy[0].szerokosc_geograficzna, 51.1001);
  assert.strictEqual(wynik.rekordy[0].godziny_dostepnosci, 'Mo-Fr 07:30-15:30');
  assert.strictEqual(wynik.rekordy[2].godziny_dostepnosci, '24/7');
  assert.strictEqual(wynik.rekordy[2].miejscowosc, 'Żółkiewka', 'wieś bez ulic: „Żółkiewka 12”');
  assert.strictEqual(wynik.rekordy[2].ulica, null);
  // file.js pomija puste linie przy liczeniu wiersza nagłówka (meta.wierszNaglowka = 2), więc numer jest liczony bez nich
  assert.strictEqual(wynik.rekordy[0]._wiersz, 3, 'tytuł + nagłówek nad danymi');
  zapiszStatystyke('Gmina (fikcyjna, cp1250)', z, m, wynik);
});

test('mapowanie: plik zgodny ze wzorcem – 100% pól z kolumn, wartości bez zmian, 0 błędów', async function () {
  for (const nazwa of ['przyklad_wzorzec.csv', 'przyklad_wzorzec.xlsx']) {
    const w = await wczytajPlik(nazwa);
    const z = zrodloZ(w);
    const m = M.podpowiedz(z);
    AED.wzorzec.schema.fields.forEach(function (f) {
      assert.strictEqual(m[f.name].regula, 'kolumna', nazwa + ': ' + f.name);
      assert.strictEqual(m[f.name].kolumna, f.name, nazwa + ': ' + f.name);
    });
    const wynik = M.zastosuj(z, m);
    const r = wynik.rekordy[0];
    assert.strictEqual(r.id_aed, '8a37653b-c8c9-52dd-b615-d285eac8fcc9', 'UUID ze źródła zachowany');
    assert.strictEqual(r.szerokosc_geograficzna, 52.229676);
    assert.strictEqual(r.lokalizacja_przyblizona, false);
    assert.strictEqual(r.tryb_pediatryczny, true);
    assert.strictEqual(r.kondygnacja, 0);
    assert.strictEqual(r.kod_simc, '0918123');
    assert.strictEqual(r.data_aktualizacji_rekordu, '2026-11-21T10:15:00');
    assert.strictEqual(r.zrodlo_danych, 'PRZYKLAD-PLIK');
    const wal = W.waliduj(wynik.rekordy, { dzis: DZIS });
    assert.strictEqual(wal.podsumowanie.bledy, 0, nazwa + ': ' + JSON.stringify(wal.problemy.filter(function (p) { return p.poziom === 'blad'; })));
    if (nazwa.endsWith('.csv')) zapiszStatystyke('przyklad_wzorzec.csv', z, m, wynik);
  }
});

test('mapowanie: dopasowanie po zawartości (nagłówki bez znaczenia)', function () {
  const wiersze = [];
  for (let i = 0; i < 20; i++) {
    wiersze.push({ k1: (50 + i / 100).toFixed(5), k2: (19 + i / 100).toFixed(5), k3: 'a' + i + '@gmina.pl', k4: 'ul. Długa ' + i + ', 30-001 Kraków',
      k5: M.nowyUuid(), k6: '30-00' + (i % 10) });
  }
  const m = M.podpowiedz(zrodloZ({ kolumny: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'], wiersze: wiersze, meta: {} }));
  assert.strictEqual(m.szerokosc_geograficzna.kolumna, 'k1');
  assert.strictEqual(m.dlugosc_geograficzna.kolumna, 'k2');
  assert.strictEqual(m.email_kontaktowy.kolumna, 'k3');
  assert.strictEqual(m.ulica.regula, 'adres'); assert.strictEqual(m.ulica.kolumna, 'k4');
  assert.strictEqual(m.id_aed.kolumna, 'k5');
  assert.strictEqual(m.kod_pocztowy.kolumna, 'k6', 'osobna kolumna kodów ma pierwszeństwo przed adresem');
  assert.strictEqual(m.szerokosc_geograficzna.pewnosc, 'srednia');
  // „Lokalizacja” z parami współrzędnych -> współrzędne, nie opis
  const m2 = M.podpowiedz(zrodloZ({ kolumny: ['Lokalizacja', 'Nazwa'], wiersze: wiersze.map(function (w, i) {
    return { Lokalizacja: w.k1 + ', ' + w.k2, Nazwa: 'Szkoła ' + i };
  }), meta: {} }));
  assert.strictEqual(m2.szerokosc_geograficzna.regula, 'wspolrzedne_tekst');
  assert.strictEqual(m2.opis_lokalizacji.regula, 'brak');
  // synonimy: „Y”/„X”, „Adres”, „Miejsce”
  const m3 = M.podpowiedz(zrodloZ({ kolumny: ['X', 'Y', 'Miejsce', 'Adres'], wiersze: [{ X: '21.01', Y: '52.22', Miejsce: 'Urząd', Adres: 'ul. A 1, 00-001 Warszawa' }], meta: {} }));
  assert.strictEqual(m3.szerokosc_geograficzna.kolumna, 'Y');
  assert.strictEqual(m3.dlugosc_geograficzna.kolumna, 'X');
  assert.strictEqual(m3.nazwa.kolumna, 'Miejsce');
  assert.strictEqual(m3.miejscowosc.regula, 'adres');
});

test('mapowanie: stabilność id_aed, zachowanie UUID ze źródła, reguły kolumna+wartosc, stala zZrodla', function () {
  const uuid = '8f14e45f-ceea-467a-9a3b-2c1d0e5f6a7b';
  const z = zrodloZ({ kolumny: ['id', 'lat', 'lon', 'dost'], wiersze: [
    { id: uuid.toUpperCase(), lat: '52.1', lon: '21.1', dost: '' }, { id: '17', lat: '52.2', lon: '21.2', dost: '24h' }], meta: {} });
  const m = M.podpowiedz(z);
  m.id_aed = { regula: 'kolumna', kolumna: 'id', pewnosc: 'wysoka', powod: 'test' };
  m.dostepnosc = { regula: 'kolumna', kolumna: 'dost', wartosc: 'tylko_personel', pewnosc: 'wysoka', powod: 'test' };
  const a = M.zastosuj(z, m), b = M.zastosuj(z, m);
  assert.strictEqual(a.rekordy[0].id_aed, uuid, 'UUID ze źródła (małe litery)');
  assert.ok(RE_UUID.test(a.rekordy[1].id_aed));
  assert.strictEqual(a.rekordy[1].id_aed, b.rekordy[1].id_aed, 'ponowne zastosowanie nie zmienia ID');
  assert.strictEqual(a.rekordy[1]._id, b.rekordy[1]._id);
  assert.ok(a.rekordy[1]._naprawy.some(function (n) { return n.pole === 'id_aed'; }), 'ID „17” zastąpione UUID – naprawa');
  assert.strictEqual(a.rekordy[0].dostepnosc, 'tylko_personel', 'wartość domyślna dla pustej komórki');
  assert.strictEqual(a.rekordy[1].dostepnosc, 'publiczna_24_7');
  z.licencja = 'CC-BY-4.0';
  assert.strictEqual(M.zastosuj(z, m).rekordy[0].licencja_rekordu, 'CC-BY-4.0', 'licencja brana z bieżących danych źródła');
  assert.strictEqual(a.podsumowanie.rekordy, 2);
  assert.ok(a.podsumowanie.puste.uwagi === 2);
  const pola = M.pola();
  assert.strictEqual(pola.length, AED.wzorzec.schema.fields.length);
  assert.ok(pola.every(function (p) { return p.name && p.grupa && p.obowiazkowosc; }));
});

// ================================================================ walidacja
function rekordWzorcowy() {
  return {
    _id: 'T:2', _zrodlo: 'T', _kodZrodla: 'PLIK-99', _wiersz: 2, _naprawy: [],
    id_aed: '8f14e45f-ceea-467a-9a3b-2c1d0e5f6a7b', id_lokalne: 'A1', nazwa: 'Szkoła Podstawowa nr 1', status: 'aktywny',
    szerokosc_geograficzna: 52.229676, dlugosc_geograficzna: 21.012229, lokalizacja_przyblizona: false, zrodlo_wspolrzednych: 'pomiar_gps',
    kod_terc_gminy: '1465011', wojewodztwo: 'mazowieckie', miejscowosc: 'Warszawa', kod_simc: null, cecha_ulicy: 'ul.', ulica: 'Szkolna',
    kod_ulic: null, numer_budynku: '5', kod_pocztowy: '00-001', opis_lokalizacji: 'Hol główny, przy portierni', opis_lokalizacji_en: null,
    wewnatrz_budynku: true, kondygnacja: 0, dostepnosc: 'publiczna_w_godzinach', godziny_dostepnosci: 'Mo-Fr 07:00-17:00',
    sposob_dostepu: 'szafka_z_alarmem', instrukcja_dostepu: null, typ_urzadzenia: 'polautomatyczny', producent: null, model: null,
    tryb_pediatryczny: true, data_waznosci_elektrod: '2027-06-30', data_waznosci_baterii: '2029-01-31', data_przegladu: '2026-09-15',
    dysponent_nazwa: 'Szkoła Podstawowa nr 1', dysponent_typ: 'placowka_oswiatowa', dysponent_regon: null, telefon_kontaktowy: '225970927',
    email_kontaktowy: 'sekretariat@sp1.pl', data_weryfikacji: '2026-10-01', sposob_weryfikacji: 'wizja_lokalna', zrodlo_danych: 'PLIK-99',
    zrodlo_id_rekordu: null, licencja_rekordu: 'CC0-1.0', data_aktualizacji_rekordu: '2026-10-01T12:00:00', uwagi: null
  };
}
function problemy(zmiany) {
  return W.walidujRekord(Object.assign(rekordWzorcowy(), zmiany), { dzis: DZIS });
}
function jest(lista, pole, kod, poziom) {
  const p = lista.find(function (x) { return x.pole === pole && x.kod === kod; });
  assert.ok(p, 'oczekiwano ' + kod + ' w polu ' + pole + '; są: ' + JSON.stringify(lista.map(function (x) { return x.pole + ':' + x.kod; })));
  if (poziom) assert.strictEqual(p.poziom, poziom, pole + ':' + kod);
  assert.ok(p.komunikat && p.komunikat.length > 20);
  assert.strictEqual(p.rekordId, 'T:2'); assert.strictEqual(p.kodZrodla, 'PLIK-99'); assert.strictEqual(p.wiersz, 2);
  return p;
}

test('walidacja: poprawny rekord nie ma problemów', function () {
  assert.deepStrictEqual(zwykly(problemy({})), []);
});

test('walidacja: każdy kod problemu', function () {
  jest(problemy({ dostepnosc: null }), 'dostepnosc', 'WYMAGANE', 'blad');
  assert.strictEqual(jest(problemy({ sposob_dostepu: '' }), 'sposob_dostepu', 'WYMAGANE').podpowiedz, 'nieznany');
  assert.strictEqual(jest(problemy({ szerokosc_geograficzna: '52,1' }), 'szerokosc_geograficzna', 'TYP', 'blad').podpowiedz, 52.1);
  assert.strictEqual(jest(problemy({ data_przegladu: '15.09.2026' }), 'data_przegladu', 'TYP').podpowiedz, '2026-09-15');
  jest(problemy({ wewnatrz_budynku: 'może' }), 'wewnatrz_budynku', 'TYP');
  jest(problemy({ kondygnacja: 1.5 }), 'kondygnacja', 'TYP');
  jest(problemy({ data_aktualizacji_rekordu: '2026-10-01' }), 'data_aktualizacji_rekordu', 'TYP');
  assert.strictEqual(jest(problemy({ dostepnosc: '24h' }), 'dostepnosc', 'SLOWNIK', 'blad').podpowiedz, 'publiczna_24_7');
  jest(problemy({ wojewodztwo: 'Bawaria' }), 'wojewodztwo', 'SLOWNIK');
  assert.strictEqual(jest(problemy({ kod_pocztowy: '00001' }), 'kod_pocztowy', 'WZORZEC').podpowiedz, '00-001');
  jest(problemy({ id_aed: '17' }), 'id_aed', 'WZORZEC');
  jest(problemy({ email_kontaktowy: 'zly@' }), 'email_kontaktowy', 'WZORZEC');
  jest(problemy({ godziny_dostepnosci: 'pn-pt 7-15' }), 'godziny_dostepnosci', 'WZORZEC', 'ostrzezenie');
  jest(problemy({ szerokosc_geograficzna: 48.5 }), 'szerokosc_geograficzna', 'ZAKRES', 'blad');
  const zamL = problemy({ szerokosc_geograficzna: 21.01, dlugosc_geograficzna: 52.22 });
  const zam = jest(zamL, 'szerokosc_geograficzna', 'ZAKRES');
  assert.ok(/zamienione/.test(zam.komunikat));
  assert.deepStrictEqual(zwykly(zam.podpowiedz), { wartosc: 52.22, zmiany: { szerokosc_geograficzna: 52.22, dlugosc_geograficzna: 21.01 }, opis: 'Zamień szerokość z długością' });
  assert.ok(!zamL.some(function (p) { return p.pole === 'dlugosc_geograficzna' && p.kod === 'ZAKRES'; }), 'zamiana zgłaszana raz na rekord');
  // po zastosowaniu zmian – brak problemów zakresu
  assert.ok(!problemy(zwykly(zam.podpowiedz.zmiany)).some(function (p) { return p.kod === 'ZAKRES'; }));
  // punkt poza Polską (bez zamiany) – oba pola zgłaszane osobno, bez podpowiedzi
  const poza = problemy({ szerokosc_geograficzna: 48.1, dlugosc_geograficzna: 2.3 });
  assert.strictEqual(poza.filter(function (p) { return p.kod === 'ZAKRES'; }).length, 2);
  jest(problemy({ kondygnacja: 200 }), 'kondygnacja', 'ZAKRES');
  jest(problemy({ data_waznosci_elektrod: '2025-01-31' }), 'data_waznosci_elektrod', 'ZAKRES', 'ostrzezenie');
  jest(problemy({ data_weryfikacji: '2023-05-01' }), 'data_weryfikacji', 'ZAKRES', 'ostrzezenie');
  jest(problemy({ data_weryfikacji: '2027-01-01' }), 'data_weryfikacji', 'ZAKRES', 'blad');
  jest(problemy({ nazwa: 'x'.repeat(151) }), 'nazwa', 'DLUGOSC', 'blad');
  jest(problemy({ lokalizacja_przyblizona: false, zrodlo_wspolrzednych: 'geokodowanie_adresu' }), 'lokalizacja_przyblizona', 'NIESPOJNY', 'ostrzezenie');
  jest(problemy({ wojewodztwo: 'podkarpackie' }), 'wojewodztwo', 'NIESPOJNY');
  jest(problemy({ lokalizacja_przyblizona: true, zrodlo_wspolrzednych: 'pomiar_gps' }), 'lokalizacja_przyblizona', 'NIESPOJNY', 'ostrzezenie');
  jest(problemy({ dostepnosc: 'publiczna_24_7' }), 'godziny_dostepnosci', 'NIESPOJNY');
  jest(problemy({ szerokosc_geograficzna: 52.23, dlugosc_geograficzna: 21.01 }), 'szerokosc_geograficzna', 'PODEJRZANY', 'ostrzezenie');
  jest(problemy({ nazwa: 'Defibrylator' }), 'nazwa', 'PODEJRZANY');
  const kod = jest(problemy({ instrukcja_dostepu: 'Kod do szafki: 4821' }), 'instrukcja_dostepu', 'PODEJRZANY', 'ostrzezenie');
  assert.ok(kod.podpowiedz.indexOf('4821') < 0);
  // obowiązkowość warunkowa (W)
  jest(problemy({ cecha_ulicy: null }), 'cecha_ulicy', 'WYMAGANE', 'ostrzezenie');
  assert.ok(/wieś bez ulic/.test(jest(problemy({ ulica: null, cecha_ulicy: null }), 'ulica', 'WYMAGANE', 'ostrzezenie').komunikat));
  jest(problemy({ godziny_dostepnosci: null }), 'godziny_dostepnosci', 'WYMAGANE', 'blad');
  jest(problemy({ sposob_dostepu: 'szafka_na_kod' }), 'instrukcja_dostepu', 'WYMAGANE', 'ostrzezenie');
  jest(problemy({ numer_budynku: null }), 'numer_budynku', 'WYMAGANE', 'ostrzezenie');
});

test('walidacja: zbiór – UNIKALNY i podsumowania wg pola i źródła', function () {
  const a = rekordWzorcowy(), b = Object.assign(rekordWzorcowy(), { _id: 'T:3', _wiersz: 3 });
  const c = Object.assign(rekordWzorcowy(), { _id: 'U:2', _kodZrodla: 'DGP-01', id_aed: M.nowyUuid(), id_lokalne: null, dostepnosc: null });
  const w = W.waliduj([a, b, c], { dzis: DZIS });
  const u = w.problemy.filter(function (p) { return p.kod === 'UNIKALNY'; });
  assert.strictEqual(u.length, 2, 'id_aed (błąd) i id_lokalne (ostrzeżenie) w drugim rekordzie');
  assert.ok(u.every(function (p) { return p.rekordId === 'T:3'; }));
  assert.ok(RE_UUID.test(u.find(function (p) { return p.pole === 'id_aed'; }).podpowiedz));
  assert.strictEqual(w.podsumowanie.rekordy, 3);
  assert.strictEqual(w.podsumowanie.bledy, 2);
  assert.strictEqual(w.podsumowanie.ostrzezenia, 1);
  assert.strictEqual(w.podsumowanie.rekordyZBledami, 2);
  assert.deepStrictEqual(zwykly(w.podsumowanie.wgPola.id_aed), { bledy: 1, ostrzezenia: 0 });
  assert.deepStrictEqual(zwykly(w.podsumowanie.wgZrodla['DGP-01']), { rekordy: 1, bledy: 1, ostrzezenia: 0, rekordyZBledami: 1 });
  assert.deepStrictEqual(zwykly(w.podsumowanie.wgZrodla['PLIK-99']), { rekordy: 2, bledy: 1, ostrzezenia: 1, rekordyZBledami: 1 });
  const ids = new Set(w.problemy.map(function (p) { return p.id; }));
  assert.strictEqual(ids.size, w.problemy.length, 'id problemów unikalne');
  // reguły między rekordami dla jednego rekordu (po ręcznej edycji)
  const u2 = W.walidujUnikalnosc([a, b, c], b);
  assert.deepStrictEqual(zwykly(u2.map(function (p) { return p.pole + ':' + p.poziom; })).sort(), ['id_aed:blad', 'id_lokalne:ostrzezenie']);
  assert.deepStrictEqual(zwykly(W.walidujUnikalnosc([a, b, c], c)), []);
  // podpowiedzi to zawsze wartości, nie teksty wskazówek
  w.problemy.concat(problemy({ dostepnosc: '24h', kod_pocztowy: '00001' })).forEach(function (p) {
    if ('podpowiedz' in p) assert.ok(p.podpowiedz === null || ['string', 'number', 'boolean'].indexOf(typeof p.podpowiedz) >= 0);
  });
});

test('mapowanie: stałe rodzaje napraw i pola automatyczne', async function () {
  const w = await wczytajPlik('marki_dgp4955.csv');
  const z = zrodloZ(w);
  const m = M.podpowiedz(z);
  const wynik = M.zastosuj(z, m);
  const rodzaje = {};
  wynik.rekordy.forEach(function (r) {
    r._naprawy.forEach(function (n) {
      assert.ok(M.RODZAJE_NAPRAW[n.rodzaj], 'nieznany rodzaj ' + n.rodzaj);
      assert.strictEqual(n.opisRodzaju, M.RODZAJE_NAPRAW[n.rodzaj]);
      rodzaje[n.rodzaj] = (rodzaje[n.rodzaj] || 0) + 1;
    });
  });
  assert.ok(rodzaje.zamiana_wspolrzednych >= 1 && rodzaje.cecha_ulicy >= 1);
  assert.deepStrictEqual(zwykly(M.POLA_AUTOMATYCZNE), ['id_aed', 'zrodlo_danych', 'licencja_rekordu', 'data_aktualizacji_rekordu']);
  // bez mapowania pola automatyczne i tak są uzupełnione
  const brak = {};
  M.POLA_AUTOMATYCZNE.forEach(function (p) { brak[p] = { regula: 'brak', pewnosc: 'niska', powod: 'test' }; });
  const r = M.zastosuj(z, Object.assign({}, m, brak)).rekordy[0];
  assert.ok(RE_UUID.test(r.id_aed));
  assert.strictEqual(r.zrodlo_danych, z.kod);
  assert.strictEqual(r.licencja_rekordu, 'CC0-1.0');
  assert.strictEqual(r.data_aktualizacji_rekordu, '2026-11-21T10:00:00');
});

// ================================================================ store
test('store: ustawMapowanie, przelicz, ręczne poprawki przetrwają przeliczenie, cofnięcie, usunięcie źródła', async function () {
  const w = await wczytajPlik('krosno_dgp3624.csv');
  const z = store.dodajZrodlo({ typ: 'PLIK', nazwa: 'krosno', licencja: 'CC0-1.0', dysponent: 'Urząd Miasta Krosna', kolumny: w.kolumny, wiersze: w.wiersze, meta: w.meta });
  zdarzenia.length = 0;
  const wynik = store.przelicz();
  assert.strictEqual(wynik.rekordy, 21);
  assert.strictEqual(store.rekordy.length, 21);
  assert.ok(zdarzenia.some(function (e) { return e.e === 'rekordy:zmiana' && e.p.akcja === 'ustawiono'; }));
  const r = store.rekordy[0];
  const id = r.id_aed;
  zdarzenia.length = 0;
  store.aktualizujRekord(r._id, { dostepnosc: 'publiczna_24_7', nazwa: 'Basen – hol', _id: 'hack' });
  assert.strictEqual(store.rekord(r._id).dostepnosc, 'publiczna_24_7');
  assert.strictEqual(store.rekord(r._id)._id, r._id, 'pola techniczne nie są nadpisywane');
  const e = zdarzenia.find(function (x) { return x.e === 'rekordy:zmiana'; });
  assert.strictEqual(e.p.akcja, 'zmieniono'); assert.strictEqual(e.p.rekord._id, r._id);

  // zmiana mapowania + przeliczenie
  const m = M.podpowiedz(z);
  m.opis_lokalizacji = { regula: 'brak', pewnosc: 'niska', powod: 'test' };
  zdarzenia.length = 0;
  store.ustawMapowanie(z.id, m);
  const ez = zdarzenia.find(function (x) { return x.e === 'zrodla:zmiana'; });
  assert.deepStrictEqual(zwykly(ez.p.pola), ['mapowanie']);
  store.przelicz();
  const po = store.rekord(r._id);
  assert.strictEqual(po.opis_lokalizacji, null, 'nowe mapowanie zastosowane');
  assert.strictEqual(po.dostepnosc, 'publiczna_24_7', 'ręczna poprawka zachowana');
  assert.strictEqual(po.nazwa, 'Basen – hol');
  assert.deepStrictEqual(zwykly(po._poprawione).sort(), ['dostepnosc', 'nazwa']);
  assert.strictEqual(po.id_aed, id, 'id_aed stabilne po przeliczeniu');
  store.cofnijPoprawke(r._id, 'nazwa');
  assert.strictEqual(store.rekord(r._id).nazwa, 'Zespół Krytych Pływalni');
  assert.deepStrictEqual(zwykly(store.rekord(r._id)._poprawione), ['dostepnosc']);
  store.usunZrodlo(z.id);
  assert.strictEqual(store.rekordy.length, 0, 'rekordy usuniętego źródła znikają');
});

// ================================================================ poprawki po przeglądzie FRONT
test('przegląd: współrzędne z przedrostkiem „szer.”/„dł.” nie są półkulą S; litera tylko samodzielna', function () {
  let w = N.wspolrzedne('szer. 50.1234', 'dł. 21.5678');
  assert.deepStrictEqual([w.lat, w.lon, w.blad], [50.1234, 21.5678, undefined]);
  w = N.wspolrzedne('Szerokość: 50,1234', 'Długość: 21,5678');
  assert.deepStrictEqual([w.lat, w.lon], [50.1234, 21.5678]);
  assert.strictEqual(N.stopnie('S 50.1').wartosc, -50.1, 'samodzielna litera S nadal oznacza półkulę');
  assert.strictEqual(N.stopnie('50.1N').os, 'NS');
});

test('przegląd: adresy – bez przecinka, „28 a”, kod pocztowy ze spacją tylko przed miejscowością', function () {
  let a = N.adres('Krosno ul. Lwowska 28');
  assert.deepStrictEqual([a.miejscowosc, a.cecha_ulicy, a.ulica, a.numer_budynku], ['Krosno', 'ul.', 'Lwowska', '28']);
  a = N.adres('38-400 Krosno ul. Lwowska 28a');
  assert.deepStrictEqual([a.kod_pocztowy, a.miejscowosc, a.ulica, a.numer_budynku], ['38-400', 'Krosno', 'Lwowska', '28a']);
  assert.strictEqual(N.adres('ul. Lwowska 28 a, 38-400 Krosno').numer_budynku, '28a');
  assert.strictEqual(N.adres('ul. Długa 12 345 Krosno').kod_pocztowy, null, '„12 345” w środku to nie kod pocztowy');
  a = N.adres('ul. Długa 5, 12 345 Wieś');
  assert.deepStrictEqual([a.kod_pocztowy, a.miejscowosc], ['12-345', 'Wieś']);
});

test('przegląd: dostępność 24/7 ma pierwszeństwo, kondygnacje, data z obiektu Date w czasie lokalnym', function () {
  assert.strictEqual(N.slownik('dostepnosc', 'całodobowo – ogólnodostępny').wartosc, 'publiczna_24_7');
  assert.strictEqual(N.slownik('dostepnosc', 'ogólnodostępny 24h').wartosc, 'publiczna_24_7');
  assert.strictEqual(N.slownik('dostepnosc', 'ogólnodostępny w godzinach pracy').wartosc, 'publiczna_w_godzinach');
  [['1. piętro', 1], ['piętro 2', 2], ['poziom 1', 1], ['2 p.', 2], ['p', null], ['parter', 0], ['III piętro', 3], ['0;1', 0]].forEach(function (k) {
    assert.strictEqual(N.kondygnacja(k[0]), k[1], k[0]);
  });
  assert.strictEqual(N.data(vm.runInContext("new Date(2026, 0, 5)", ctx)), '2026-01-05');
  assert.strictEqual(N.dataCzas(vm.runInContext("new Date(2026, 0, 5, 9, 7, 3)", ctx)), '2026-01-05T09:07:03');
});

test('przegląd: precyzja z tekstu źródła (_precyzja), przyszła data bez podpowiedzi, kod szafki tylko przy słowie kod/szyfr/PIN', function () {
  const z = zrodloZ({ kolumny: ['lat', 'lon'], wiersze: [{ lat: '52.100000', lon: '21.000000' }, { lat: '52.1', lon: '21.0' }], meta: {} });
  const w = M.zastosuj(z, M.podpowiedz(z));
  assert.strictEqual(w.rekordy[0]._precyzja, 6);
  const pod = function (r) { return W.walidujRekord(r, { dzis: DZIS }).some(function (p) { return p.kod === 'PODEJRZANY' && p.pole === 'szerokosc_geograficzna'; }); };
  assert.ok(!pod(w.rekordy[0]), '52.100000 ma 6 miejsc po przecinku');
  assert.ok(pod(w.rekordy[1]));
  const prz = jest(problemy({ data_weryfikacji: '2027-01-01' }), 'data_weryfikacji', 'ZAKRES', 'blad');
  assert.ok(!('podpowiedz' in prz), 'bez podpowiedzi „dzisiaj”');
  assert.ok(!problemy({ instrukcja_dostepu: 'Klucz w portierni, budynek 12345, tel. 13 000 00 00' }).some(function (p) { return p.pole === 'instrukcja_dostepu'; }));
  const k = jest(problemy({ instrukcja_dostepu: 'Szyfr do szafki 1234, potem pociągnij' }), 'instrukcja_dostepu', 'PODEJRZANY', 'ostrzezenie');
  assert.ok(k.podpowiedz.indexOf('1234') < 0);
  jest(problemy({ instrukcja_dostepu: 'PIN: 998877' }), 'instrukcja_dostepu', 'PODEJRZANY');
});

test('przegląd: nazwa z kolumny „Lokalizacja” (Marki), numer AED z nazwy (Przemyśl)', async function () {
  const mk = M.podpowiedz(zrodloZ(await wczytajPlik('marki_dgp4955.csv')));
  assert.strictEqual(mk.nazwa.kolumna, 'Lokalizacja');
  assert.strictEqual(mk.opis_lokalizacji.pewnosc, 'niska');
  const zp = zrodloZ(await wczytajPlik('przemysl_dgp4581.csv'));
  const w = M.zastosuj(zp, M.podpowiedz(zp));
  assert.strictEqual(w.rekordy[0].id_lokalne, 'AED-9485');
  assert.strictEqual(w.rekordy[0].zrodlo_id_rekordu, '744');
  assert.ok(w.rekordy.find(function (r) { return /AED7639/.test(r.nazwa); }).id_lokalne === 'AED-7639', 'także bez spacji');
});

test('przegląd: ID i ręczne poprawki przypięte do treści wiersza; usunięcie źródła czyści pamięć', function () {
  const wiersze = [{ lat: '52.1', lon: '21.1', n: 'A' }, { lat: '52.2', lon: '21.2', n: 'B' }];
  const z = store.dodajZrodlo({ typ: 'PLIK', nazwa: 'odcisk', licencja: 'CC0-1.0', kolumny: ['lat', 'lon', 'n'], wiersze: wiersze, meta: {} });
  store.przelicz();
  const r0 = store.rekordy.find(function (r) { return r._zrodlo === z.id && r._wiersz === 2; });
  const id0 = r0.id_aed;
  store.aktualizujRekord(r0._id, { uwagi: 'poprawka dla A' });
  // podmiana wierszy (np. inny arkusz) – w wierszu 2 jest teraz inna treść
  store.aktualizujZrodlo(z.id, { wiersze: [{ lat: '50.0', lon: '19.9', n: 'C' }, wiersze[1]] });
  store.przelicz();
  const r1 = store.rekord(r0._id);
  assert.notStrictEqual(r1.id_aed, id0, 'inna treść wiersza = nowe ID');
  assert.strictEqual(r1.uwagi, null, 'poprawka nie przechodzi na obcy wiersz');
  const rB = store.rekordy.find(function (r) { return r._zrodlo === z.id && r._wiersz === 3; });
  assert.ok(rB.id_aed, 'wiersz bez zmian');
  // ten sam wiersz wraca – ID i poprawka wracają
  store.aktualizujZrodlo(z.id, { wiersze: wiersze });
  store.przelicz();
  assert.strictEqual(store.rekord(r0._id).id_aed, id0);
  assert.strictEqual(store.rekord(r0._id).uwagi, 'poprawka dla A');
  assert.strictEqual(store.liczbaRekordowWynik, store.rekordy.length);
  store.usunZrodlo(z.id);
  assert.ok(!Array.from(M._test.idPamiec.keys()).some(function (k) { return k.indexOf(z.id + '|') === 0; }), 'idPamiec wyczyszczona');
});

test('przegląd: walidujUnikalnosc z indeksem, naprawy adresu tylko dla pól z regułą adres, mieszane reguły współrzędnych', function () {
  const a = rekordWzorcowy(), b = Object.assign(rekordWzorcowy(), { _id: 'T:3', _wiersz: 3, id_aed: M.nowyUuid(), id_lokalne: 'B1' });
  const ix = W.indeksUnikalnosci([a, b]);
  assert.strictEqual(W.walidujUnikalnosc(ix, b).length, 0);
  b.id_aed = a.id_aed;   // edycja w miejscu
  assert.deepStrictEqual(zwykly(W.walidujUnikalnosc(ix, b).map(function (p) { return p.pole; })), ['id_aed']);
  b.id_aed = M.nowyUuid();
  assert.strictEqual(W.walidujUnikalnosc(ix, b).length, 0);
  // naprawa cechy z adresu tylko, gdy cecha_ulicy bierze wartość z adresu
  const z = zrodloZ({ kolumny: ['Adres', 'wsp', 'dl'], wiersze: [{ Adres: 'Al.. Piłsudskiego 95, 05-270 Marki', wsp: '52.326697, 21.107557', dl: '21.2' }], meta: {} });
  const m = M.podpowiedz(z);
  m.cecha_ulicy = { regula: 'brak', pewnosc: 'niska', powod: 'test' };
  const r = M.zastosuj(z, m).rekordy[0];
  assert.ok(!r._naprawy.some(function (n) { return n.pole === 'cecha_ulicy' && /Al\.\./.test(n.opis); }));
  // szerokość z pary, długość z osobnej kolumny
  m.szerokosc_geograficzna = { regula: 'wspolrzedne_tekst', kolumna: 'wsp', pewnosc: 'wysoka', powod: 't' };
  m.dlugosc_geograficzna = { regula: 'kolumna', kolumna: 'dl', pewnosc: 'wysoka', powod: 't' };
  const r2 = M.zastosuj(z, m).rekordy[0];
  assert.deepStrictEqual([r2.szerokosc_geograficzna, r2.dlugosc_geograficzna], [52.326697, 21.2]);
});

// ================================================================ wydajność
test('wydajność: 50 000 rekordów (szeroki plik, ~60 kolumn) – podpowiedź, zastosowanie, walidacja', function () {
  const n = 50000;
  const tagi = ['nazwa', 'opis lokalizacji', 'dostepnosc', 'godziny', 'wewnatrz', 'pietro', 'zabezpieczenie', 'dysponent', 'telefon',
    'miejscowosc', 'ulica', 'numer budynku', 'kod pocztowy', 'data weryfikacji', 'uwagi', 'producent', 'model', 'instrukcja'];
  for (let i = 0; i < 40; i++) tagi.push('kolumna dodatkowa ' + i);
  const wiersze = new Array(n);
  const godz = ['24/7', 'Mo-Fr 07:00-17:00', '', 'pn-pt 8-16'];
  for (let i = 0; i < n; i++) {
    const o = { id: String(1000000 + i), lat: (49.1 + (i % 5000) / 1000).toFixed(7), lon: (14.2 + (i % 9000) / 1000).toFixed(7) };
    tagi.forEach(function (t, k) { o[t] = (i + k) % 3 ? '' : t + ' ' + i; });
    o.dostepnosc = ['publiczna 24/7', 'dla klientów', 'tylko personel', ''][i % 4];
    o.godziny = godz[i % 4];
    o.wewnatrz = i % 2 ? 'tak' : 'nie';
    o.pietro = String(i % 3);
    o.telefon = i % 5 ? '' : '+48 600 100 ' + String(100 + i % 900);
    o['kod pocztowy'] = i % 2 ? '00-' + String(100 + i % 900) : '';
    o['data weryfikacji'] = i % 3 ? '' : '2025-0' + (1 + i % 9) + '-15';
    wiersze[i] = o;
  }
  const z = zrodloZ({ kolumny: ['id', 'lat', 'lon'].concat(tagi), wiersze: wiersze, meta: { dataDanych: '2026-11-21T12:00:00Z' } },
    { typ: 'PLIK', kod: 'PLIK-50K', licencja: 'CC0-1.0' });
  let t0 = Date.now();
  const m = M.podpowiedz(z);
  const tP = Date.now() - t0;
  t0 = Date.now();
  const w = M.zastosuj(z, m);
  const tZ = Date.now() - t0;
  t0 = Date.now();
  const wal = W.waliduj(w.rekordy, { dzis: DZIS });
  const tW = Date.now() - t0;
  assert.strictEqual(w.rekordy.length, n);
  assert.strictEqual(m.dostepnosc.kolumna, 'dostepnosc');
  assert.strictEqual(new Set(w.rekordy.map(function (r) { return r.id_aed; })).size, n, 'unikalne UUID');
  statystyki.push({ zbior: 'WYDAJNOŚĆ 50k', rekordy: n, polaZKolumn: zKolumny(m).length, polaStale: zStalych(m).length, polaBrak: '-',
    naprawy: w.podsumowanie.naprawy, bledy: wal.podsumowanie.bledy, ostrzezenia: wal.podsumowanie.ostrzezenia,
    rekordyZBledami: wal.podsumowanie.rekordyZBledami, kody: 'podpowiedz ' + tP + ' ms, zastosuj ' + tZ + ' ms, waliduj ' + tW + ' ms' });
  assert.ok(tP < 3000, 'podpowiedz ' + tP + ' ms');
  assert.ok(tZ + tW < 15000, 'zastosuj+waliduj ' + (tZ + tW) + ' ms');
});

test('wczytywanie: wiersze ze źródłem współrzędnych „osm” lub licencją ODbL są po cichu pomijane', async function () {
  const csv = ['nazwa,zrodlo_wspolrzednych,licencja_rekordu', 'A,pomiar_gps,CC0-1.0', 'B,osm,ODbL-1.0', 'C,wskazanie_na_mapie,CC-BY-4.0', 'D,pomiar_gps,ODbL-1.0'].join('\n');
  const w = await AED.zrodla.plik.wczytaj(new File([csv], 'stare.csv'));
  assert.strictEqual(JSON.stringify(w.wiersze.map(function (r) { return r.nazwa; })), '["A","C"]');
  assert.ok(!(w.meta.naprawy || []).some(function (n) { return /osm|odbl|openstreetmap/i.test(n); }), 'brak komunikatu w interfejsie');
});

// ------------------------------------------------------------ uruchomienie
(async function () {
  let ok = 0, zle = 0;
  for (const t of testy) {
    try { await t.fn(); ok++; console.log('  ok   ' + t.nazwa); } catch (e) { zle++; console.log('  BŁĄD ' + t.nazwa + '\n       ' + (e && e.stack || e)); }
  }
  console.log('\nStatystyki (pola wzorca: z kolumn / stałe / brak; walidacja na dzień ' + DZIS + '):');
  console.table(statystyki);
  console.log('\n' + ok + ' zaliczonych, ' + zle + ' niezaliczonych');
  process.exit(zle ? 1 : 0);
})();
