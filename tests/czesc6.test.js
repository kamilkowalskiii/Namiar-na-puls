/* Testy części 6: baza zgłoszeń „wyniki.gov” (AED.gov, serwer.py, sql.js) i prosty formularz dysponenta (wzorzec/formularz_dysponenta_AED.*).
   Uruchomienie: node tests/czesc6.test.js   (Node 18+, Python 3 w PATH – test uruchamia serwer.py na wolnym porcie z bazą tymczasową)
   Symulacja gov.pl: nic nie jest wysyłane poza 127.0.0.1. */
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const assert = require('assert');

const KORZEN = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const czytaj = function (p) { return fs.readFileSync(path.join(KORZEN, p), 'utf8'); };
const DZIS = '2026-11-21';
const NAGLOWEK_SQLITE = 'SQLite format 3\u0000';

// ------------------------------------------------------------ środowisko (jak w czesc3/czesc4)
const ctx = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, TextDecoder, TextEncoder, AbortController, Blob, File, Response, Headers,
  ArrayBuffer, Uint8Array, ReadableStream, crypto: globalThis.crypto,
  fetch: function (url, init) { return fetch(url, init); }
};
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);
['vendor/papaparse/papaparse.min.js', 'vendor/sheetjs/xlsx.full.min.js', 'js/core/ns.js', 'js/schema/schema.js', 'js/ui/dom.js',
  'js/sources/file.js', 'js/core/store.js', 'js/core/normalizacja.js', 'js/core/mapowanie.js', 'js/core/walidacja.js',
  'js/core/duplikaty.js', 'js/core/eksport.js', 'js/core/gov.js'].forEach(function (p) {
  vm.runInContext(czytaj(p), ctx, { filename: p });
});
const AED = ctx.AED;
const N = AED.normalizacja, M = AED.mapowanie, W = AED.walidacja, store = AED.store, G = AED.gov;
const FD = AED.wzorzec.formularzDysponenta;
const initSqlJs = require(path.join(KORZEN, 'vendor', 'sqljs', 'sql-wasm.js'));
const SCIEZKA_SQLJS = path.join(KORZEN, 'vendor', 'sqljs') + path.sep;
const SCHEMAT = czytaj('js/core/gov_schemat.sql');

const testy = [];
const test = function (nazwa, fn) { testy.push({ nazwa, fn }); };

async function wczytajPlik(nazwa, katalog) {
  const bufor = fs.readFileSync(path.join(katalog || FIX, nazwa));
  return AED.zrodla.plik.wczytaj(new File([bufor], nazwa));
}
async function otworzSqlite(bajty) {
  const SQL = await initSqlJs({ locateFile: function (f) { return SCIEZKA_SQLJS + f; } });
  return new SQL.Database(bajty);
}
function wartosc(db, sql) { return db.exec(sql)[0].values[0][0]; }
function naglowek(bajty) { return Buffer.from(bajty.slice(0, 16)).toString('latin1'); }

/** Store z wypełnionym formularzem dysponenta: krok 1–3 ukończone. */
async function przygotujStore() {
  store.zrodla.forEach(function (z) { store.usunZrodlo(z.id); });
  const w = await wczytajPlik('formularz_dysponenta_przyklad.xlsx');
  store.dodajZrodlo({ typ: 'PLIK', nazwa: 'formularz_dysponenta_przyklad.xlsx', dysponent: 'Gmina Przykładowo', licencja: 'CC0-1.0',
    kolumny: w.kolumny, wiersze: w.wiersze, meta: w.meta, dataPobrania: '2026-11-21T10:00:00' });
  store.przelicz();
  store.znajdzDuplikaty();
}
const METADANE = {
  tytul: 'Defibrylatory AED – Przykładowo', tytulEn: 'AED defibrillators – Przykladowo',
  opis: 'Lokalizacje AED w gminie Przykładowo (dane fikcyjne do testów).', opisEn: 'Test data.',
  czestotliwosc: 'monthly', kategorie: ['HEAL'], slowaKluczowe: ['AED', 'wzorzec-aed'], extIdent: 'aed-przykladowo', url: ''
};

// ================================================================ formularz dysponenta (zadanie 2)
test('formularz: pliki szablonu istnieją, pełny wzorzec zachowany', function () {
  ['wzorzec/formularz_dysponenta_AED.xlsx', 'wzorzec/formularz_dysponenta_AED.csv', 'wzorzec/wzorcowy_zakres_danych_AED.xlsx',
    'wzorzec/szablon_aed.csv', 'tests/fixtures/formularz_dysponenta_przyklad.xlsx'].forEach(function (p) {
    assert.ok(fs.existsSync(path.join(KORZEN, p)), p);
  });
  assert.strictEqual(FD.plikXlsx, 'wzorzec/formularz_dysponenta_AED.xlsx');
  const tech = ['id_aed', 'zrodlo_danych', 'zrodlo_id_rekordu', 'licencja_rekordu', 'data_aktualizacji_rekordu', 'kod_terc_gminy', 'kod_simc', 'kod_ulic',
    'lokalizacja_przyblizona', 'zrodlo_wspolrzednych'];
  FD.kolumny.forEach(function (k) {
    assert.ok(tech.indexOf(k.pole) < 0, 'pole techniczne w formularzu: ' + k.pole);
    assert.ok(!/_/.test(k.naglowek), 'nagłówek dla ludzi: ' + k.naglowek);
  });
  // obowiązkowe pola wzorca, których formularz nie zbiera, aplikacja uzupełnia sama
  const wFormularzu = new Set(FD.kolumny.map(function (k) { return k.pole; }));
  const brakujace = AED.wzorzec.schema.fields.filter(function (f) { return f.constraints && f.constraints.required && !wFormularzu.has(f.name); })
    .map(function (f) { return f.name; }).sort();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(brakujace)), ['data_aktualizacji_rekordu', 'id_aed', 'licencja_rekordu', 'lokalizacja_przyblizona', 'zrodlo_danych']);
});

test('formularz: każda etykieta listy rozwijanej -> kod wzorca (100%), Tak/Nie -> true/false', function () {
  let n = 0;
  Object.keys(FD.slowniki).forEach(function (s) {
    FD.slowniki[s].forEach(function (p) {
      const w = N.slownik(s, p.etykieta);
      assert.strictEqual(w.wartosc, p.kod, s + ': „' + p.etykieta + '”');
      assert.strictEqual(w.pewnosc, 'wysoka', s + ': „' + p.etykieta + '”');
      // także wielkość liter / spacje zmienione przez użytkownika
      assert.strictEqual(N.slownik(s, '  ' + p.etykieta.toUpperCase() + ' ').wartosc, p.kod);
      n++;
    });
  });
  assert.ok(n >= 40, 'etykiet: ' + n);
  assert.strictEqual(N.bool('Tak'), true);
  assert.strictEqual(N.bool('Nie'), false);
});

test('formularz: wypełniony plik XLSX – wiersze pomocnicze pominięte, 100% pól z nagłówków, 0 błędów walidacji', async function () {
  const w = await wczytajPlik('formularz_dysponenta_przyklad.xlsx');
  assert.strictEqual(w.meta.arkusz, FD.arkusz, 'arkusz „Urządzenia”, nie instrukcja');
  assert.strictEqual(w.wiersze.length, 3, 'opis kolumn i przykład pominięte');
  assert.strictEqual(w.meta.wierszNaglowka, 3);
  assert.ok(w.meta.formularzDysponenta);
  assert.strictEqual(JSON.stringify(w.kolumny), JSON.stringify(FD.kolumny.map(function (k) { return k.naglowek; })));
  const z = { id: 'fd-1', kod: 'PLIK-01', typ: 'PLIK', nazwa: 'f', dysponent: '', licencja: 'CC0-1.0', meta: w.meta,
    dataPobrania: '2026-11-21T10:00:00', kolumny: w.kolumny, wiersze: w.wiersze };
  const m = M.podpowiedz(z);
  FD.kolumny.forEach(function (k) {
    assert.strictEqual(m[k.pole].regula, 'kolumna', k.pole);
    assert.strictEqual(m[k.pole].kolumna, k.naglowek, k.pole);
    // kolumna pusta we wszystkich wierszach (np. „Producent”) dostaje pewność niską – mapowanie i tak jest prawidłowe
    const pusta = w.wiersze.every(function (r) { return !String(r[k.naglowek]).trim(); });
    if (!pusta) assert.strictEqual(m[k.pole].pewnosc, 'wysoka', k.pole);
  });
  const wyn = M.zastosuj(z, m);
  const [a, b, c] = wyn.rekordy;
  assert.strictEqual(a._wiersz, 4, 'numer wiersza jak w arkuszu');
  assert.strictEqual(a.dostepnosc, 'publiczna_w_godzinach');
  assert.strictEqual(a.godziny_dostepnosci, 'Mo-Fr 07:30-15:30');
  assert.strictEqual(a.sposob_dostepu, 'szafka_z_alarmem');
  assert.strictEqual(a.status, 'aktywny');
  assert.strictEqual(a.cecha_ulicy, 'ul.');
  assert.strictEqual(a.ulica, 'Główna');
  assert.strictEqual(a.szerokosc_geograficzna, 49.693996);
  assert.strictEqual(a.wewnatrz_budynku, true);
  assert.strictEqual(a.data_waznosci_elektrod, '2027-05-31');
  assert.strictEqual(a.data_weryfikacji, '2026-11-02');
  assert.strictEqual(a.dysponent_typ, 'jst');
  assert.strictEqual(a.sposob_weryfikacji, 'potwierdzenie_dysponenta');
  assert.strictEqual(a.licencja_rekordu, 'CC0-1.0');
  assert.strictEqual(b.dostepnosc, 'publiczna_24_7');
  assert.strictEqual(b.sposob_dostepu, 'szafka_na_klucz');
  assert.strictEqual(b.wewnatrz_budynku, false);
  assert.strictEqual(b.dysponent_typ, 'sluzby');
  assert.strictEqual(c.status, 'tymczasowo_niedostepny');
  assert.strictEqual(c.dostepnosc, 'dla_klientow');
  assert.strictEqual(c.sposob_dostepu, 'u_personelu');
  assert.strictEqual(c.typ_urzadzenia, 'nieznany');
  assert.strictEqual(c.sposob_weryfikacji, 'zdjecie');
  assert.strictEqual(c.kondygnacja, 1);
  const wal = W.waliduj(wyn.rekordy, { dzis: DZIS });
  const bledy = wal.problemy.filter(function (p) { return p.poziom === 'blad'; });
  assert.strictEqual(bledy.length, 0, JSON.stringify(bledy));
});

test('formularz: pusty szablon CSV (nagłówek + przykład) – przykład pominięty, czytelny błąd „brak wierszy”', async function () {
  await assert.rejects(wczytajPlik('formularz_dysponenta_AED.csv', path.join(KORZEN, 'wzorzec')), /Nie znaleziono w pliku żadnych wierszy/);
  // ten sam szablon z dopisanym wierszem: przykład pominięty, wiersz danych zostaje
  const wiersz = { nazwa: 'Hala sportowa', miejscowosc: 'Przykładowo', numer_budynku: '3', szerokosc_geograficzna: '49.7', dlugosc_geograficzna: '21.7',
    opis_lokalizacji: 'Wejście główne', dostepnosc: 'Całodobowo, dla wszystkich', sposob_dostepu: 'Szafka z alarmem, bez zamka',
    status: 'Tak, działa i jest na miejscu', dysponent_nazwa: 'Gmina Przykładowo', data_weryfikacji: '2026-11-01' };
  const csv = fs.readFileSync(path.join(KORZEN, 'wzorzec', 'formularz_dysponenta_AED.csv'), 'utf8') +
    FD.kolumny.map(function (k) { return '"' + (wiersz[k.pole] || '') + '"'; }).join(',') + '\r\n';
  const w = await AED.zrodla.plik.wczytaj(new File([csv], 'f.csv'));
  assert.strictEqual(w.wiersze.length, 1);
  assert.strictEqual(w.meta.wierszNaglowka, 2);
});

// ================================================================ AED.gov – logika (zadanie 1)
test('gov: gotowosc – pusta sesja ma braki w krokach 1, 4; po krokach 1–3 i metadanych – gotowe', async function () {
  store.zrodla.forEach(function (z) { store.usunZrodlo(z.id); });
  let g = G.gotowosc();
  assert.strictEqual(g.gotowe, false);
  assert.ok(g.braki.some(function (b) { return b.etap === 1; }));
  assert.ok(g.braki.some(function (b) { return b.etap === 4; }));
  await przygotujStore();
  g = G.gotowosc({ metadane: METADANE });
  assert.strictEqual(g.gotowe, true, JSON.stringify(g.braki));
  g = G.gotowosc({ metadane: Object.assign({}, METADANE, { tytul: '' }), zwalidowano: false });
  assert.strictEqual(g.gotowe, false);
  assert.ok(g.braki.some(function (b) { return b.etap === 3; }), 'walidacja nieuruchomiona');
  assert.ok(g.braki.some(function (b) { return b.etap === 4 && /Tytuł/.test(b.komunikat) && b.pole === 'tytul'; }), JSON.stringify(g.braki));
  // stan kroku 3 z UI zamiast flagi zwalidowano
  const stan3 = { gotowe: true, nieaktualne: true, problemy: new Map() };
  g = G.gotowosc({ metadane: METADANE, walidacja: stan3 });
  assert.ok(g.braki.some(function (b) { return b.etap === 3; }), 'stan nieaktualny -> brak w kroku 3');
  stan3.nieaktualne = false;
  assert.strictEqual(G.gotowosc({ metadane: METADANE, walidacja: stan3 }).gotowe, true);
  // źródło bez kolumn współrzędnych -> brak w kroku 2
  const z = store.zrodla[0];
  store.ustawMapowanie(z.id, Object.assign({}, M.podpowiedz(z), { szerokosc_geograficzna: { regula: 'brak' } }));
  g = G.gotowosc({ metadane: METADANE });
  assert.ok(g.braki.some(function (b) { return b.etap === 2; }), JSON.stringify(g.braki));
  store.ustawMapowanie(z.id, null);
  // zmiana danych bez przeliczenia -> krok 3
  store.aktualizujZrodlo(z.id, { wiersze: z.wiersze.concat([Object.assign({}, z.wiersze[0])]) });
  g = G.gotowosc({ metadane: METADANE });
  assert.ok(g.braki.some(function (b) { return b.etap === 3 && /przelicz/.test(b.komunikat); }), JSON.stringify(g.braki));
});

test('gov: zbierzZgloszenie – 4 etapy, bez surowych wierszy, JSON kanoniczny stabilny', async function () {
  await przygotujStore();
  const zgl = G.zbierzZgloszenie(METADANE, { dzis: DZIS });
  assert.strictEqual(zgl.wersja_formatu, 1);
  assert.strictEqual(zgl.symulacja, true);
  assert.strictEqual(zgl.aplikacja.nazwa, 'Namiar na puls');
  assert.strictEqual(zgl.etap1_zrodla.length, 1);
  const z1 = zgl.etap1_zrodla[0];
  assert.strictEqual(z1.liczba_wierszy, 3);
  assert.ok(!('wiersze' in z1), 'bez surowych wierszy');
  assert.strictEqual(zgl.etap2_mapowanie[0].pola.dostepnosc.kolumna, 'Kto i kiedy może skorzystać?');
  assert.strictEqual(zgl.etap2_mapowanie[0].automatyczne, true);
  assert.strictEqual(zgl.etap3_walidacja.podsumowanie.rekordy, 3);
  assert.strictEqual(zgl.etap3_walidacja.podsumowanie.bledy, 0);
  assert.strictEqual(zgl.etap3_walidacja.duplikaty.wyszukano, true);
  assert.strictEqual(zgl.etap4_wynik.rekordy.length, 3);
  assert.strictEqual(zgl.etap4_wynik.licencja.kod, 'CC0-1.0');
  assert.strictEqual(zgl.etap4_wynik.metadane.tytul, METADANE.tytul);
  const r = zgl.etap4_wynik.rekordy[0];
  AED.wzorzec.schema.fields.forEach(function (f) { assert.ok(f.name in r, f.name); });
  assert.ok(!('_surowy' in r) && r._pochodzenie.kodZrodla);
  const tekst = JSON.stringify(zgl);
  assert.ok(tekst.indexOf('_surowy') < 0);
  const k = G.kanoniczny(zgl);
  assert.deepStrictEqual(JSON.parse(k), JSON.parse(tekst));
  assert.strictEqual(G.kanoniczny({ b: 1, a: [1, 'ż', null, { d: 2, c: 1.5 }] }), '{"a":[1,"ż",null,{"c":1.5,"d":2}],"b":1}');
  // walidacja ze stanu kroku 3 (Map rekordId -> problemy) daje to samo co waliduj(), bez liczenia drugi raz
  const wal = W.waliduj(store.rekordy, { dzis: DZIS });
  wal.problemy.push({ rekordId: store.rekordy[0]._id, kodZrodla: store.rekordy[0]._kodZrodla, wiersz: 4, pole: 'nazwa', poziom: 'blad', kod: 'TEST', komunikat: 'test' });
  const mapa = new Map();
  wal.problemy.forEach(function (p) { if (!mapa.has(p.rekordId)) mapa.set(p.rekordId, []); mapa.get(p.rekordId).push(p); });
  const zeStanu = G.walidacjaZeStanu({ gotowe: true, nieaktualne: false, problemy: mapa });
  assert.strictEqual(zeStanu.podsumowanie.rekordy, 3);
  assert.strictEqual(zeStanu.podsumowanie.bledy, 1);
  assert.strictEqual(zeStanu.podsumowanie.ostrzezenia, wal.podsumowanie.ostrzezenia);
  assert.strictEqual(zeStanu.podsumowanie.rekordyZBledami, 1);
  assert.strictEqual(G.walidacjaZeStanu({ gotowe: true, nieaktualne: true, problemy: mapa }), null);
  const zgl3 = G.zbierzZgloszenie(METADANE, { walidacja: { gotowe: true, nieaktualne: false, problemy: mapa } });
  assert.strictEqual(zgl3.etap3_walidacja.podsumowanie.bledy, 1);
  assert.strictEqual(zgl3.etap3_walidacja.problemy[zgl3.etap3_walidacja.problemy.length - 1].kod, 'TEST');
  const k2 = G.kolumnyZgloszenia(zgl);
  assert.strictEqual(k2.liczba_rekordow, 3);
  assert.strictEqual(k2.liczba_zrodel, 1);
  assert.strictEqual(k2.licencja, 'CC0-1.0');
});

test('gov: wyslij odrzuca niekompletne zgłoszenie przed zapisem', async function () {
  G.konfiguruj({ tryb: 'przegladarka', schemat: SCHEMAT, sciezkaSqlJs: SCIEZKA_SQLJS, magazyn: { wczytaj: async function () { return null; }, zapisz: async function () { throw new Error('nie powinno zapisać'); } } });
  await assert.rejects(G.wyslij({ etap1_zrodla: [] }, { opoznienieMs: 0 }), function (e) { return e.kod === 'STRUKTURA'; });
  const zgl = G.zbierzZgloszenie(METADANE);
  zgl.etap4_wynik.rekordy = [];
  await assert.rejects(G.wyslij(zgl, { opoznienieMs: 0 }), /rekordów wynikowych/);
});

// ================================================================ tryb przeglądarkowy (sql.js w Node)
test('gov/przeglądarka: 3 wysyłki -> 3 nowe rekordy, przerwanie nic nie zapisuje, plik wyniki.gov to SQLite', async function () {
  await przygotujStore();
  let bajty = null, zapisy = 0;
  const magazyn = { wczytaj: async function () { return bajty; }, zapisz: async function (b) { bajty = b; zapisy++; } };
  ctx.initSqlJs = initSqlJs;
  G.konfiguruj({ tryb: 'przegladarka', schemat: SCHEMAT, sciezkaSqlJs: SCIEZKA_SQLJS, magazyn: magazyn });
  assert.strictEqual(await G.tryb(), 'przegladarka');
  const postep = [];
  const numery = [];
  for (let i = 0; i < 3; i++) {
    const w = await G.wyslij(G.zbierzZgloszenie(METADANE), { opoznienieMs: 30, onPostep: function (t) { postep.push(t); } });
    assert.strictEqual(w.status, 'zatwierdzono_gov');
    assert.strictEqual(w.tryb, 'przegladarka');
    assert.strictEqual(w.liczba, i + 1);
    assert.strictEqual(w.id, i + 1);
    assert.ok(/^GOV-\d{4}-\d{6}$/.test(w.numer), w.numer);
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(w.data_wyslania), w.data_wyslania);
    assert.ok(/^[0-9a-f]{64}$/.test(w.suma_kontrolna));
    numery.push(w.numer);
  }
  assert.strictEqual(new Set(numery).size, 3);
  assert.strictEqual(JSON.stringify(postep.slice(0, 3)), JSON.stringify(G.ETAPY_SYMULACJI));
  assert.ok(/Trwa weryfikacja i wysyłka danych do systemu gov\.pl\.\.\./.test(postep[2]));
  // przerwanie w trakcie symulacji
  const ac = new AbortController();
  setTimeout(function () { ac.abort(); }, 10);
  await assert.rejects(G.wyslij(G.zbierzZgloszenie(METADANE), { opoznienieMs: 500, signal: ac.signal }), function (e) { return e.kod === 'PRZERWANO'; });
  const s = await G.statystyki();
  assert.strictEqual(s.liczba, 3);
  assert.strictEqual(s.sumaRekordow, 9);
  assert.strictEqual(s.wgStatusu.zatwierdzono_gov, 3);
  assert.strictEqual(s.ostatnie.length, 3);
  assert.strictEqual(s.ostatnie[0].numer, numery[2]);
  assert.strictEqual(zapisy, 3);
  const blob = await G.pobierzBaze();
  const b = new Uint8Array(await blob.arrayBuffer());
  assert.strictEqual(naglowek(b), NAGLOWEK_SQLITE);
  const db = await otworzSqlite(b);
  assert.strictEqual(wartosc(db, 'SELECT COUNT(*) FROM zgloszenia'), 3);
  assert.strictEqual(wartosc(db, 'SELECT COUNT(*) FROM rekordy_aed'), 9);
  assert.strictEqual(wartosc(db, 'SELECT liczba_zgloszen FROM podsumowanie'), 3);
  assert.strictEqual(wartosc(db, "SELECT COUNT(DISTINCT numer) FROM zgloszenia WHERE status = 'zatwierdzono_gov' AND tryb = 'przegladarka'"), 3);
  const e4 = JSON.parse(wartosc(db, 'SELECT etap4_wynik FROM zgloszenia WHERE id = 1'));
  assert.strictEqual(e4.rekordy.length, 3);
  db.close();
});

// ================================================================ serwer.py (Python, stdlib)
function wolnyPort() {
  return new Promise(function (ok, nie) {
    const s = net.createServer();
    s.once('error', nie);
    s.listen(0, '127.0.0.1', function () { const p = s.address().port; s.close(function () { ok(p); }); });
  });
}
async function startSerwera(port, baza) {
  const kandydaci = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const cmd of kandydaci) {
    const args = (cmd === 'py' ? ['-3'] : []).concat([path.join(KORZEN, 'serwer.py'), '--port', String(port), '--baza', baza]);
    const p = cp.spawn(cmd, args, { cwd: os.tmpdir(), stdio: ['ignore', 'ignore', 'pipe'], env: Object.assign({}, process.env, { NAMIAR_CICHO: '1' }) });
    let stderr = '';
    p.stderr.on('data', function (d) { stderr += d; });
    let blad = null;
    p.on('error', function (e) { blad = e; });
    for (let i = 0; i < 80 && !blad && p.exitCode === null; i++) {
      try { const o = await fetch('http://127.0.0.1:' + port + '/api/status'); if (o.ok) return p; } catch (e) { /* jeszcze nie */ }
      await new Promise(function (r) { setTimeout(r, 150); });
    }
    try { p.kill(); } catch (e) { /* nie wystartował */ }
    if (stderr) console.log('       stderr ' + cmd + ': ' + stderr.slice(0, 500));
  }
  throw new Error('Nie udało się uruchomić serwer.py (wymagany Python 3 w PATH).');
}
function zatrzymaj(p) {
  return new Promise(function (ok) {
    if (!p || p.exitCode !== null) { ok(); return; }
    p.once('exit', function () { ok(); });
    p.kill();
  });
}

test('serwer.py: API, 3 zgłoszenia bez nadpisywania, pliki chronione, kopia bazy, trwałość po restarcie', async function () {
  await przygotujStore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'namiar-gov-'));
  const baza = path.join(tmp, 'wyniki.gov');
  const port = await wolnyPort();
  const adres = 'http://127.0.0.1:' + port + '/';
  let srv = await startSerwera(port, baza);
  try {
    G.konfiguruj({ tryb: null, adresApi: adres + 'api/', magazyn: null });
    assert.strictEqual(await G.tryb({ odswiez: true }), 'serwer', 'bez adresu strony: GET api/status');
    // wykrywanie przez HEAD na dokument i nagłówek X-Namiar-Serwer (bez 404 na serwerach statycznych)
    G.konfiguruj({ adresStrony: adres + 'index.html' });
    assert.strictEqual(await G.tryb({ odswiez: true }), 'serwer', 'HEAD index.html -> X-Namiar-Serwer');
    const statyczny = require('http').createServer(function (req, res) { zadaniaStatyczne.push(req.method + ' ' + req.url); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.method === 'HEAD' ? undefined : '<p>'); });
    const zadaniaStatyczne = [];
    await new Promise(function (ok) { statyczny.listen(0, '127.0.0.1', ok); });
    try {
      G.konfiguruj({ adresStrony: 'http://127.0.0.1:' + statyczny.address().port + '/podkatalog/index.html' });
      assert.strictEqual(await G.tryb({ odswiez: true }), 'przegladarka');
      assert.deepStrictEqual(zadaniaStatyczne, ['HEAD /podkatalog/index.html'], 'tylko HEAD na stronę, bez api/status');
    } finally { statyczny.close(); }
    G.konfiguruj({ adresStrony: adres });
    assert.strictEqual(await G.tryb({ odswiez: true }), 'serwer');
    const st = await (await fetch(adres + 'api/status')).json();
    assert.deepStrictEqual([st.ok, st.tryb, st.baza, st.liczba], [true, 'serwer', 'wyniki.gov', 0]);
    assert.ok(fs.existsSync(baza), 'baza utworzona przy starcie');

    const numery = [];
    for (let i = 0; i < 3; i++) {
      const zgl = G.zbierzZgloszenie(METADANE);
      const postep = [];
      const w = await G.wyslij(zgl, { opoznienieMs: 0, onPostep: function (t) { postep.push(t); } });
      assert.strictEqual(w.tryb, 'serwer');
      assert.strictEqual(w.status, 'zatwierdzono_gov');
      assert.strictEqual(w.liczba, i + 1);
      assert.strictEqual(w.statystyki.liczba, i + 1);
      assert.ok(/^GOV-\d{4}-00000\d$/.test(w.numer), w.numer);
      assert.strictEqual(w.suma_kontrolna, await G.sumaKontrolna(zgl), 'SHA-256 kanonicznego JSON zgodna w JS i Pythonie');
      assert.strictEqual(JSON.stringify(postep.slice(0, 3)), JSON.stringify(G.ETAPY_SYMULACJI));
      numery.push(w.numer);
    }
    assert.strictEqual(new Set(numery).size, 3);
    const s = await G.statystyki();
    assert.strictEqual(s.liczba, 3);
    assert.strictEqual(s.sumaRekordow, 9);
    assert.strictEqual(s.ostatnie[0].numer, numery[2]);
    assert.strictEqual(s.dzienne[0].liczba, 3);

    // walidacja wejścia
    const kod = async function (obietnica) { const o = await obietnica; await o.arrayBuffer(); return o.status; };   // treść zawsze odczytana
    const post = function (tresc, naglowki) {
      return fetch(adres + 'api/zgloszenia', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, naglowki || {}), body: tresc });
    };
    let o = await post('{"etap1_zrodla": []}');
    assert.strictEqual(o.status, 400);
    assert.ok(/etap2_mapowanie/.test((await o.json()).blad));
    const bezZrodel = JSON.parse(JSON.stringify(G.zbierzZgloszenie(METADANE)));
    bezZrodel.etap1_zrodla = [];
    o = await post(JSON.stringify(bezZrodel));
    assert.strictEqual(o.status, 400);
    assert.ok(/źródła danych/.test((await o.json()).blad));
    assert.strictEqual(await kod(post('nie json')), 400);
    assert.strictEqual(await kod(post('{}', { 'Content-Type': 'text/plain' })), 415);
    assert.strictEqual(await kod(post(JSON.stringify(G.zbierzZgloszenie(METADANE)), { Origin: 'https://zla-strona.example' })), 403);
    assert.strictEqual(await kod(fetch(adres + 'api/nieznane')), 404);

    // pliki: aplikacja tak, baza / ukryte / listowanie – nie
    assert.strictEqual(await kod(fetch(adres + 'index.html')), 200);
    o = await fetch(adres + 'vendor/sqljs/sql-wasm.wasm');
    await o.arrayBuffer();
    assert.strictEqual(o.status, 200);
    assert.strictEqual(o.headers.get('content-type'), 'application/wasm');
    o = await fetch(adres + 'js/core/gov.js');
    await o.arrayBuffer();
    assert.ok(/javascript/.test(o.headers.get('content-type')));
    assert.strictEqual(await kod(fetch(adres + 'js/core/gov_schemat.sql')), 200);
    for (const p of ['wyniki.gov', '.git/HEAD', '.gitignore', 'js/', 'tests/', '%2egit/config']) {
      assert.strictEqual(await kod(fetch(adres + p)), 404, p);
    }

    // kopia bazy
    o = await fetch(adres + 'api/baza');
    assert.strictEqual(o.status, 200);
    assert.ok(/filename="wyniki\.gov"/.test(o.headers.get('content-disposition')));
    const bajty = new Uint8Array(await o.arrayBuffer());
    assert.strictEqual(naglowek(bajty), NAGLOWEK_SQLITE);
    const db = await otworzSqlite(bajty);
    assert.strictEqual(wartosc(db, 'SELECT COUNT(*) FROM zgloszenia'), 3);
    assert.strictEqual(wartosc(db, 'SELECT liczba_zgloszen FROM podsumowanie'), 3);
    assert.strictEqual(wartosc(db, 'SELECT suma_rekordow FROM podsumowanie'), 9);
    assert.strictEqual(wartosc(db, 'SELECT COUNT(*) FROM rekordy_aed WHERE zgloszenie_id = 2'), 3);
    assert.strictEqual(wartosc(db, "SELECT COUNT(*) FROM zgloszenia WHERE tryb = 'serwer' AND status = 'zatwierdzono_gov'"), 3);
    assert.strictEqual(wartosc(db, 'PRAGMA user_version'), 1);
    db.close();
    const blob = await G.pobierzBaze();
    assert.strictEqual(naglowek(new Uint8Array(await blob.arrayBuffer())), NAGLOWEK_SQLITE);

    // restart serwera na tym samym pliku: dane zostają, kolejny zapis to id 4
    await zatrzymaj(srv);
    const plik = fs.readFileSync(baza);
    assert.strictEqual(naglowek(plik), NAGLOWEK_SQLITE, 'plik na dysku kompletny (journal_mode=DELETE)');
    srv = await startSerwera(port, baza);
    G.konfiguruj({ adresApi: adres + 'api/' });
    const w4 = await G.wyslij(G.zbierzZgloszenie(METADANE), { opoznienieMs: 0 });
    assert.strictEqual(w4.id, 4);
    assert.strictEqual(w4.liczba, 4);
  } finally {
    await zatrzymaj(srv);
    G.konfiguruj({ tryb: null, adresApi: 'api/', adresStrony: null });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* zostanie w katalogu tymczasowym */ }
  }
});

test('gov: zrzutSql – wyniki_gov.txt zawiera dane z formularza w czytelnych kolumnach i wykonuje się w SQLite (apostrof, liczby, boole)', async function () {
  const zgl = G.zbierzZgloszenieFormularza([
    { id_aed: 'a-1', nazwa: "Szkoła im. O'Connora", miejscowosc: 'Krosno', szerokosc_geograficzna: 49.68, dlugosc_geograficzna: 21.77, status: 'aktywny',
      dysponent_nazwa: 'Gmina Przykładowo', wewnatrz_budynku: true, telefon_kontaktowy: '+48 13 000 00 00' },
    { id_aed: 'a-2', nazwa: 'Urząd', miejscowosc: 'Przemyśl', szerokosc_geograficzna: 49.78, dlugosc_geograficzna: 22.77, status: 'aktywny', dysponent_nazwa: 'Gmina Przykładowo' }
  ], { dysponent: 'Gmina Przykładowo', licencja: 'CC0-1.0' });
  const sql = await G.zrzutSql(zgl, { id: 7, numer: 'GOV-2026-000007', data_wyslania: '2026-11-22T10:00:00' });
  assert.ok(/^-- wyniki_gov.txt/.test(sql), 'nagłówek pliku');
  const db = await otworzSqlite();
  db.exec(sql);
  const z = db.exec('SELECT numer, tytul, dysponent, licencja, liczba_urzadzen FROM zgloszenie')[0].values;
  assert.strictEqual(JSON.stringify(z), JSON.stringify([['GOV-2026-000007', 'Defibrylatory AED – Gmina Przykładowo', 'Gmina Przykładowo', 'CC0-1.0', 2]]));
  const r = db.exec('SELECT nazwa, miejscowosc, szerokosc_geograficzna, wewnatrz_budynku, dysponent_nazwa, telefon_kontaktowy, zgloszenie_numer FROM urzadzenia_aed ORDER BY rowid')[0].values;
  assert.strictEqual(JSON.stringify(r), JSON.stringify([["Szkoła im. O'Connora", 'Krosno', 49.68, 1, 'Gmina Przykładowo', '+48 13 000 00 00', 'GOV-2026-000007'],
    ['Urząd', 'Przemyśl', 49.78, null, 'Gmina Przykładowo', null, 'GOV-2026-000007']]));
  db.close();
});

test('gov: pod file:// czytelny błąd z poleceniem python serwer.py', async function () {
  ctx.location = { protocol: 'file:' };
  try {
    G.konfiguruj({ tryb: null, magazyn: null });
    assert.strictEqual(await G.tryb({ odswiez: true }), 'przegladarka');
    await assert.rejects(G.wyslij(G.zbierzZgloszenie(METADANE), { opoznienieMs: 0 }), /python serwer\.py/);
    await assert.rejects(G.pobierzBaze(), /python serwer\.py/);
  } finally { delete ctx.location; G.konfiguruj({ tryb: null }); }
});

// ------------------------------------------------------------ uruchomienie
(async function () {
  let ok = 0, zle = 0;
  for (const t of testy) {
    try { await t.fn(); ok++; console.log('  ok   ' + t.nazwa); } catch (e) { zle++; console.log('  BŁĄD ' + t.nazwa + '\n       ' + (e && e.stack || e)); }
  }
  console.log('\n' + ok + ' zaliczonych, ' + zle + ' niezaliczonych');
  process.exit(zle ? 1 : 0);
})();
