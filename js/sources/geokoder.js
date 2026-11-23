/* Geokodowanie adresów i odwrotne geokodowanie – wyłącznie publiczne usługi GUGiK, bez kluczy API.
   - Usługa Geokodowania UUG (https://services.gugik.gov.pl/uug/): adres -> punkt adresowy z PRG (TERYT: SIMC, ULIC, gmina 6 cyfr);
     punkt -> najbliższy adres (GetAddressReverse, promień 100 m). Nagłówek CORS: Access-Control-Allow-Origin: *.
     Parametr srid=4326 zwraca WGS84; bez niego – PUWG 1992 (EPSG:2180), który przeliczamy funkcją zPuwg92.
     Przy wielu zapytaniach w krótkim czasie (zwłaszcza powtórzonych) usługa odpowiada {"notice":"blocked for abuse"} -> kod 'LIMIT'.
   - ULDK (https://uldk.gugik.gov.pl/): punkt (EPSG:2180) -> gmina z 7-cyfrowym kodem TERC (z cyfrą rodzaju gminy). CORS: *.
     Ustalone 2026-11-21 (curl, seria zapytań): ok. 30–50% żądań – niezależnie od User-Agenta, nagłówka Origin, odstępu
     między zapytaniami i układu współrzędnych – dostaje losowo „302 Found” na https://integracja01.gugik.gov.pl/resp/uldk.php
     (pułapka ochrony przed botami: brak CORS, Content-Length 4 GB, ciasteczka WAF). Przeglądarka po przekierowaniu zgłasza
     błąd CORS. Dlatego ULDK pytamy z redirect: 'manual' (przekierowanie = odpowiedź „opaqueredirect”, bez pobierania pułapki)
     i ponawiamy najwyżej 2 razy; gdy się nie uda – kod gminy zostaje pusty, a reszta wyniku działa.
   - Rodzaju gminy (7. cyfra TERC) UUG nie podaje: GetAddress, GetAddressReverse i GetCity zwracają tylko 6 cyfr (sprawdzone).
     Bez ULDK ustalamy go tylko dla miast na prawach powiatu (powiat 61–99 -> „1”); dla pozostałych gmin TERC = null,
     a 6 cyfr jest w polu teryt_gminy6.
   Usługa services.gugik.gov.pl/gugik-geocoding/ nie istnieje (404, sprawdzone 2026-11-21).
   Błędy mają pole `kod` jak w dgp.js: SIEC, TIMEOUT, PRZERWANO, LIMIT, FORMAT, BRAK_DANYCH. */
(function (AED) {
  'use strict';

  const UUG = 'https://services.gugik.gov.pl/uug/';
  const ULDK = 'https://uldk.gugik.gov.pl/';
  const LIMIT_MS = 15000;
  const ODSTEP_MS = 700;           // minimalny odstęp między zapytaniami do jednej usługi (ochrona przed blokadą)
  const MAKS_PAMIEC = 200;         // odpowiedzi zapamiętane w sesji (te same zapytania nie idą drugi raz do usługi)
  const MAKS_WYNIKOW = 10;

  // ------------------------------------------------------------ PUWG 1992 (EPSG:2180) <-> WGS84 (EPSG:4326)
  // Odwzorowanie Gaussa-Krügera na elipsoidzie GRS80: południk 19°E, k0 = 0,9993, FE = 500 000 m, FN = -5 300 000 m.
  // Szeregi Krügera 6. rzędu (Karney 2011) – dokładność rzędu milimetrów w całym pasie. ETRS89 ≈ WGS84 (różnica < 1 m).
  const A_ELIPS = 6378137, F_ELIPS = 1 / 298.257222101;
  const K0 = 0.9993, LON0 = 19 * Math.PI / 180, FE = 500000, FN = -5300000;
  const N_ = F_ELIPS / (2 - F_ELIPS);
  const E_ = Math.sqrt(F_ELIPS * (2 - F_ELIPS));
  const n2 = N_ * N_, n3 = n2 * N_, n4 = n3 * N_, n5 = n4 * N_, n6 = n5 * N_;
  const A_ = A_ELIPS / (1 + N_) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const ALFA = [
    N_ / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
    13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
    61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
    49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
    34729 * n5 / 80640 - 3418889 * n6 / 1995840,
    212378941 * n6 / 319334400
  ];
  const BETA = [
    N_ / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
    n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
    17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
    4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600,
    4583 * n5 / 161280 - 108847 * n6 / 3991680,
    20648693 * n6 / 638668800
  ];
  const atanh = Math.atanh || function (x) { return 0.5 * Math.log((1 + x) / (1 - x)); };
  const asinh = Math.asinh || function (x) { return Math.log(x + Math.sqrt(x * x + 1)); };
  const sinh = Math.sinh || function (x) { return (Math.exp(x) - Math.exp(-x)) / 2; };
  const cosh = Math.cosh || function (x) { return (Math.exp(x) + Math.exp(-x)) / 2; };

  /** tan(szerokość geograficzna) -> tan(szerokość konforemna) */
  function tauPrim(tau) {
    const sigma = sinh(E_ * atanh(E_ * tau / Math.sqrt(1 + tau * tau)));
    return tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
  }

  /** WGS84 -> PUWG 1992. @returns {{x:number, y:number}} x = współrzędna wschodnia (E), y = północna (N) – jak w odpowiedziach UUG i w WKT. */
  function doPuwg92(lat, lon) {
    const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180 - LON0;
    const tp = tauPrim(Math.tan(phi));
    const xiP = Math.atan2(tp, Math.cos(lam));
    const etaP = asinh(Math.sin(lam) / Math.sqrt(tp * tp + Math.cos(lam) * Math.cos(lam)));
    let xi = xiP, eta = etaP;
    for (let j = 1; j <= 6; j++) {
      xi += ALFA[j - 1] * Math.sin(2 * j * xiP) * cosh(2 * j * etaP);
      eta += ALFA[j - 1] * Math.cos(2 * j * xiP) * sinh(2 * j * etaP);
    }
    return { x: FE + K0 * A_ * eta, y: FN + K0 * A_ * xi };
  }

  /** PUWG 1992 -> WGS84. x = E (wschodnia), y = N (północna). @returns {{lat:number, lon:number}} */
  function zPuwg92(x, y) {
    const xi = (y - FN) / (K0 * A_), eta = (x - FE) / (K0 * A_);
    let xiP = xi, etaP = eta;
    for (let j = 1; j <= 6; j++) {
      xiP -= BETA[j - 1] * Math.sin(2 * j * xi) * cosh(2 * j * eta);
      etaP -= BETA[j - 1] * Math.cos(2 * j * xi) * sinh(2 * j * eta);
    }
    const sEta = sinh(etaP), cXi = Math.cos(xiP);
    const tp = Math.sin(xiP) / Math.sqrt(sEta * sEta + cXi * cXi);
    let tau = tp;
    for (let i = 0; i < 10; i++) {   // metoda Newtona (zbieżność w 2–3 krokach)
      const tpi = tauPrim(tau);
      const d = (tp - tpi) / Math.sqrt(1 + tpi * tpi) * (1 + (1 - E_ * E_) * tau * tau) / ((1 - E_ * E_) * Math.sqrt(1 + tau * tau));
      tau += d;
      if (Math.abs(d) < 1e-14) break;
    }
    return { lat: Math.atan(tau) * 180 / Math.PI, lon: (LON0 + Math.atan2(sEta, cXi)) * 180 / Math.PI };
  }

  // ------------------------------------------------------------ pomocnicze
  function blad(komunikat, kod, dodatki) {
    const e = new Error(komunikat);
    e.kod = kod;
    if (dodatki) Object.assign(e, dodatki);
    return e;
  }
  const zaokr6 = function (v) { return Math.round(v * 1e6) / 1e6; };

  const WOJ = { '02': 'dolnośląskie', '04': 'kujawsko-pomorskie', '06': 'lubelskie', '08': 'lubuskie', '10': 'łódzkie', '12': 'małopolskie',
    '14': 'mazowieckie', '16': 'opolskie', '18': 'podkarpackie', '20': 'podlaskie', '22': 'pomorskie', '24': 'śląskie',
    '26': 'świętokrzyskie', '28': 'warmińsko-mazurskie', '30': 'wielkopolskie', '32': 'zachodniopomorskie' };
  const NAZWY_WOJ = Object.keys(WOJ).map(function (k) { return WOJ[k]; });

  // Cecha ulicy zapisana w nazwie (UUG zwraca np. „ulica Marszałkowska”, ale też samo „Lwowska”)
  const CECHY = [[/^(ulica|ul\.?)\s+/i, 'ul.'], [/^(aleja|aleje|al\.?)\s+/i, 'al.'], [/^(plac|pl\.?)\s+/i, 'pl.'], [/^(osiedle|os\.?)\s+/i, 'os.'],
    [/^rondo\s+/i, 'rondo'], [/^skwer\s+/i, 'skwer'], [/^(bulwar|bulw\.?)\s+/i, 'bulw.']];
  // Nazwy, których pierwszy wyraz to cecha z rejestru TERYT ULIC spoza słownika wzorca (rynek, park, szosa, droga, wybrzeże, wyspa,
  // ogród…) – we wzorcu cecha „inne” („Zgodnie z rejestrem TERYT ULIC”), a wyraz zostaje w nazwie (np. „Rynek”, „Park Miejski”).
  const CECHY_INNE = /^(rynek|park|szosa|droga|trakt|wybrzeże|wyspa|ogród|ogrody|zaułek|pasaż|ścieżka|wał)\b/i;
  /** „ulica Marszałkowska” -> { cecha: 'ul.', nazwa: 'Marszałkowska' }; „Aleja Jana Pawła II” -> al.; „Rynek” -> inne (nazwa „Rynek”).
      UUG pomija w nazwie cechę „ul.” (np. „Lwowska”, „Adama Asnyka” w Krośnie), a inne cechy zapisuje wyrazem – stąd domyślne „ul.”. */
  function rozdzielUlice(t) {
    const s = String(t || '').trim();
    if (!s) return { cecha: null, nazwa: null };
    for (let i = 0; i < CECHY.length; i++) {
      if (CECHY[i][0].test(s)) return { cecha: CECHY[i][1], nazwa: s.replace(CECHY[i][0], '').trim() };
    }
    if (CECHY_INNE.test(s)) return { cecha: 'inne', nazwa: s };
    if (/^(plac|aleja|aleje|osiedle|skwer|rondo|bulwar)$/i.test(s)) return { cecha: null, nazwa: s };
    return { cecha: 'ul.', nazwa: s };
  }

  /** Kod TERC 7 cyfr z 6-cyfrowego kodu gminy (UUG). Rodzaj gminy da się ustalić tylko dla miast na prawach powiatu (powiat 61–99 -> „1”);
      UUG nie zwraca rodzaju, a gmina 6-cyfrowa może być miejska (1), wiejska (2) albo miejsko-wiejska (3, części 4/5) – resztę daje ULDK. */
  function tercZ6(t6) {
    const t = String(t6 || '').replace(/\D/g, '');
    if (/^\d{7}$/.test(t)) return t;
    if (!/^\d{6}$/.test(t)) return null;
    return Number(t.slice(2, 4)) >= 61 ? t + '1' : null;
  }
  function wojewodztwoZ(o) {
    const v = String(o.voivodeship || '').toLowerCase();
    if (NAZWY_WOJ.indexOf(v) >= 0) return v;
    const j = /^\{([^}]*)\}$/.exec(String(o.jednostka || ''));
    if (j) {
      const cz = j[1].split(',').map(function (x) { return x.trim().toLowerCase(); });
      for (let i = 0; i < cz.length; i++) if (NAZWY_WOJ.indexOf(cz[i]) >= 0) return cz[i];
    }
    const t = String(o.teryt || '');
    return /^\d{2}/.test(t) ? (WOJ[t.slice(0, 2)] || null) : null;
  }
  function liczba(v) { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; }

  /** Punkt z obiektu UUG (x, y; WGS84 albo PUWG 1992) -> { lat, lon } albo null. */
  function punkt(o) {
    const x = liczba(o.x), y = liczba(o.y);
    if (x === null || y === null) return null;
    if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return { lat: zaokr6(y), lon: zaokr6(x) };   // srid=4326: x = długość, y = szerokość
    const p = zPuwg92(x, y);
    return { lat: zaokr6(p.lat), lon: zaokr6(p.lon) };
  }

  function opisAdresu(w) {
    const ul = w.ulica ? (w.cecha_ulicy ? w.cecha_ulicy + ' ' : '') + w.ulica + (w.numer ? ' ' + w.numer : '') : (w.numer ? w.miejscowosc + ' ' + w.numer : '');
    const msc = (w.kod_pocztowy ? w.kod_pocztowy + ' ' : '') + (w.miejscowosc || '');
    return [ul, msc.trim()].filter(Boolean).join(', ') + (w.wojewodztwo && !ul ? ' (woj. ' + w.wojewodztwo + ')' : '');
  }

  /** Jeden wynik UUG -> obiekt geokodera. typ: 'address' | 'street' | 'city' (pole `type` odpowiedzi). */
  function wynikZ(o, typ) {
    const p = punkt(o);
    if (!p) return null;
    const ul = rozdzielUlice(o.street);
    const w = {
      lat: p.lat, lon: p.lon,
      opis: '',
      miejscowosc: o.city || null,
      czesc_miejscowosci: o.citypart || null,
      cecha_ulicy: ul.cecha,
      ulica: ul.nazwa,
      numer: typ === 'address' ? (o.number || null) : null,
      kod_pocztowy: o.code && /^\d{2}-\d{3}$/.test(o.code) ? o.code : null,
      kod_terc_gminy: tercZ6(o.teryt),
      kod_simc: /^\d{7}$/.test(String(o.simc || '')) ? String(o.simc) : null,
      kod_ulic: /^\d{5}$/.test(String(o.ulic || '')) ? String(o.ulic) : null,
      wojewodztwo: wojewodztwoZ(o),
      teryt_gminy6: /^\d{6}$/.test(String(o.teryt || '')) ? String(o.teryt) : null,
      dokladnosc: typ === 'address' ? 'adres' : typ === 'street' ? 'ulica' : 'miejscowosc',
      trafnosc: liczba(o.accuracy),
      odleglosc_m: o.distance !== undefined ? Math.round(liczba(o.distance) * 10) / 10 : null
    };
    w.opis = opisAdresu(w);
    return w;
  }

  // ------------------------------------------------------------ sieć
  const pamiec = new Map();
  const ostatnie = {};   // host -> czas ostatniego zapytania

  function czekaj(ms, signal) {
    if (ms <= 0) return Promise.resolve();
    return new Promise(function (ok, odrzuc) {
      const z = setTimeout(function () { if (signal) signal.removeEventListener('abort', przerwij); ok(); }, ms);
      function przerwij() { clearTimeout(z); odrzuc(blad('Przerwano wyszukiwanie.', 'PRZERWANO')); }
      if (signal) signal.addEventListener('abort', przerwij);
    });
  }

  /** GET z limitem czasu, przerwaniem, odstępem między zapytaniami i pamięcią odpowiedzi. Zwraca tekst odpowiedzi. */
  async function pobierz(url, signal, nazwa, bezPrzekierowan) {
    if (signal && signal.aborted) throw blad('Przerwano wyszukiwanie.', 'PRZERWANO');
    if (pamiec.has(url)) return pamiec.get(url);
    const host = new URL(url).host;
    const teraz = Date.now();
    const start = Math.max(teraz, (ostatnie[host] || 0) + AED.geokoder.odstepMs);
    ostatnie[host] = start;
    await czekaj(start - teraz, signal);
    const ctrl = new AbortController();
    let przekroczono = false;
    const zegar = setTimeout(function () { przekroczono = true; ctrl.abort(); }, LIMIT_MS);
    const przerwij = function () { ctrl.abort(); };
    if (signal) signal.addEventListener('abort', przerwij);
    try {
      const odp = await fetch(url, bezPrzekierowan ? { signal: ctrl.signal, redirect: 'manual' } : { signal: ctrl.signal });
      if (odp.type === 'opaqueredirect' || (odp.status >= 300 && odp.status < 400)) {
        throw blad('Usługa ' + nazwa + ' przekierowała zapytanie na stronę zastępczą (ochrona przed nadmiarem zapytań).', 'PRZEKIEROWANIE');
      }
      if (odp.status === 429) throw blad('Usługa ' + nazwa + ' ogranicza liczbę zapytań. Odczekaj chwilę i spróbuj ponownie.', 'LIMIT');
      if (odp.status >= 500) throw blad('Usługa ' + nazwa + ' ma chwilowe problemy (błąd ' + odp.status + '). Spróbuj później.', 'SIEC');
      if (!odp.ok) throw blad('Usługa ' + nazwa + ' zwróciła błąd ' + odp.status + '.', 'FORMAT');
      const tekst = await odp.text();
      return tekst;
    } catch (e) {
      if (przekroczono) throw blad('Usługa ' + nazwa + ' nie odpowiedziała w ciągu ' + Math.round(LIMIT_MS / 1000) + ' s.', 'TIMEOUT');
      if ((signal && signal.aborted) || (e && e.name === 'AbortError')) throw blad('Przerwano wyszukiwanie.', 'PRZERWANO');
      if (e && e.kod) throw e;
      throw blad('Brak połączenia z usługą ' + nazwa + ' (' + host + '). Sprawdź połączenie z internetem albo wpisz współrzędne ręcznie / wskaż punkt na mapie.',
        'SIEC', { typeError: true, przyczyna: e });
    } finally {
      clearTimeout(zegar);
      if (signal) signal.removeEventListener('abort', przerwij);
    }
  }
  function zapamietaj(url, tekst) {
    if (pamiec.size >= MAKS_PAMIEC) pamiec.delete(pamiec.keys().next().value);
    pamiec.set(url, tekst);
  }

  /** Odpowiedź UUG -> obiekt JSON (z kontrolą blokady i formatu). */
  function jsonUug(tekst) {
    let d;
    try { d = JSON.parse(tekst); } catch (e) {
      throw blad('Usługa geokodowania GUGiK zwróciła odpowiedź, której nie da się odczytać (np. stronę błędu). Spróbuj inaczej zapisać adres.', 'FORMAT');
    }
    if (!d || typeof d !== 'object') throw blad('Usługa geokodowania GUGiK zwróciła nieoczekiwaną odpowiedź.', 'FORMAT');
    if (d.notice && /abuse|blocked/i.test(String(d.notice))) {
      throw blad('Usługa geokodowania GUGiK chwilowo zablokowała zapytania (zbyt wiele w krótkim czasie). Odczekaj minutę i spróbuj ponownie.', 'LIMIT');
    }
    if (d.notice || d.error) throw blad('Usługa geokodowania GUGiK: ' + String(d.notice || d.error), 'FORMAT');
    return d;
  }
  function wynikiUug(d) {
    const typ = d.type || 'address';
    const r = d.results && typeof d.results === 'object' ? d.results : {};
    return Object.keys(r).sort(function (a, b) { return Number(a) - Number(b); })
      .map(function (k) { return wynikZ(r[k] || {}, typ); }).filter(Boolean);
  }

  // ------------------------------------------------------------ API
  /**
   * Adres -> lista dopasowań (najlepsze pierwsze). Pusta lista = nic nie znaleziono.
   * Przykłady: „Krosno, Rynek 1”, „Warszawa, Marszałkowska 140”, „Rymanów” (sama miejscowość), „Krosno, Lwowska” (ulica).
   * @param {string} adres
   * @param {{signal?:AbortSignal, limit?:number}} [opcje]
   * @returns {Promise<Array<{lat, lon, opis, miejscowosc, cecha_ulicy, ulica, numer, kod_pocztowy, kod_terc_gminy, kod_simc, kod_ulic,
   *   wojewodztwo, dokladnosc:'adres'|'ulica'|'miejscowosc', trafnosc:number|null}>>}
   *   kod_terc_gminy jest null, gdy rodzaju gminy nie da się ustalić z adresu – wtedy użyj gmina(lat, lon).
   */
  async function szukaj(adres, opcje) {
    opcje = opcje || {};
    const a = String(adres || '').replace(/\s+/g, ' ').trim();
    if (a.length < 3) throw blad('Wpisz adres (co najmniej miejscowość), np. „Krosno, Rynek 1”.', 'FORMAT');
    if (a.length > 200) throw blad('Adres jest za długi (maks. 200 znaków).', 'FORMAT');
    const limit = Math.max(1, Math.min(opcje.limit || MAKS_WYNIKOW, 15));
    // „Iwonicz, 100” -> „Iwonicz 100” (format UUG dla miejscowości bez ulic: „Miejscowość Numer”)
    const zapytanie = a.replace(/^([^,]+),\s*(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)$/, '$1 $2');
    const d = await zapytajUug(zapytanie, opcje.signal);
    let wyniki = wynikiUug(d);
    // Brak wyniku, choć usługa znalazła kandydatów (found > 0): numeru nie ma w PRG pod tą nazwą (np. wieś ma jednak ulice
    // albo numer jest inny). Jedna dodatkowa próba bez numeru -> punkt ulicy lub miejscowości, z podpowiedzią dla użytkownika.
    const numer = /^(.*?)[\s,]+(?:nr\.?\s*)?(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)$/.exec(zapytanie);
    if (!wyniki.length && numer && Number(d['found objects']) > 0 && numer[1].trim().length >= 2) {
      const d2 = await zapytajUug(numer[1].trim(), opcje.signal);
      wyniki = wynikiUug(d2).map(function (w) {
        w.przyblizony = true;
        w.wskazowka = 'Nie znaleziono numeru „' + numer[2] + '” pod adresem „' + numer[1].trim() + '”. Pokazujemy ' +
          (w.dokladnosc === 'ulica' ? 'ulicę' : 'miejscowość') + ' – wskaż dokładne miejsce na mapie albo podaj adres z ulicą.';
        return w;
      });
    }
    return wyniki.slice(0, limit);
  }
  async function zapytajUug(adres, signal) {
    const url = UUG + '?request=GetAddress&address=' + encodeURIComponent(adres) + '&srid=4326';
    const tekst = await pobierz(url, signal, 'geokodowania GUGiK');
    const d = jsonUug(tekst);
    zapamietaj(url, tekst);
    return d;
  }

  /**
   * Gmina dla punktu (ULDK GUGiK): { kod_terc_gminy (7 cyfr), gmina, powiat, wojewodztwo } albo null (punkt poza Polską).
   * Losowe przekierowania ULDK (zob. nagłówek pliku) ponawiamy najwyżej 2 razy; potem błąd 'SIEC' z przyjaznym komunikatem.
   * @returns {Promise<Object|null>}
   */
  async function gmina(lat, lon, opcje) {
    opcje = opcje || {};
    if (!poprawnyPunkt(lat, lon)) throw blad('Niepoprawne współrzędne.', 'FORMAT');
    const p = doPuwg92(lat, lon);
    const url = ULDK + '?request=GetCommuneByXY&xy=' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + '&result=teryt,commune,county,voivodeship';
    let tekst = null;
    for (let proba = 0; tekst === null; proba++) {
      try {
        tekst = await pobierz(url, opcje.signal, 'ULDK GUGiK', true);
      } catch (e) {
        if (e.kod !== 'PRZEKIEROWANIE' && e.kod !== 'SIEC') throw e;
        if (proba >= 2) {
          throw blad('Nie udało się ustalić kodu gminy (TERC): usługa ULDK GUGiK chwilowo nie odpowiada. ' +
            'Kod gminy nie jest obowiązkowy – możesz go uzupełnić później.', 'SIEC', { przyczyna: e });
        }
        await czekaj(AED.geokoder.ponowienieUldkMs, opcje.signal);
      }
    }
    const w = gminaZTekstu(tekst);
    zapamietaj(url, tekst);
    return w;
  }
  /** Odpowiedź ULDK: „0\n186101_1|Krosno (miasto)|powiat Krosno|podkarpackie”; „-1 …” = błąd; pusta = brak. */
  function gminaZTekstu(tekst) {
    const linie = String(tekst || '').trim().split(/\r?\n/);
    if (!linie[0]) return null;
    if (/^\s*</.test(linie[0])) throw blad('Usługa ULDK GUGiK zwróciła stronę zamiast danych.', 'FORMAT');
    if (linie[0].trim() !== '0') {
      if (/nie znaleziono|brak/i.test(linie.join(' '))) return null;
      throw blad('Usługa ULDK GUGiK: ' + linie.join(' ').slice(0, 200), 'FORMAT');
    }
    const cz = (linie[1] || '').split('|');
    const m = /^(\d{6})_(\d)$/.exec((cz[0] || '').trim());
    if (!m) return null;
    const woj = String(cz[3] || '').trim().toLowerCase();
    return { kod_terc_gminy: m[1] + m[2], gmina: (cz[1] || '').trim() || null, powiat: (cz[2] || '').trim() || null,
      wojewodztwo: NAZWY_WOJ.indexOf(woj) >= 0 ? woj : (WOJ[m[1].slice(0, 2)] || null) };
  }
  function poprawnyPunkt(lat, lon) {
    return typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  /**
   * Punkt (np. kliknięty na mapie) -> najbliższy adres (do 100 m) i gmina. Współrzędne wyniku = podany punkt (nie punkt adresowy);
   * adres_lat/adres_lon i odleglosc_m opisują znaleziony punkt adresowy. null, gdy nie ma ani adresu, ani gminy (np. poza Polską).
   * Zapytania idą po kolei: najpierw UUG; ULDK tylko wtedy, gdy kodu TERC nie da się ustalić z wyniku UUG.
   * Błąd ULDK nie przerywa wyniku (kod TERC = null, komunikat w polu ostrzezenie); błąd UUG – tak, chyba że ULDK znalazło gminę.
   * @returns {Promise<Object|null>} pola jak w szukaj() + gmina, powiat, adres_lat, adres_lon, odleglosc_m, ostrzezenie?
   */
  async function odwrotne(lat, lon, opcje) {
    opcje = opcje || {};
    if (!poprawnyPunkt(lat, lon)) throw blad('Niepoprawne współrzędne.', 'FORMAT');
    const url = UUG + '?request=GetAddressReverse&location=' + encodeURIComponent('POINT(' + lon + ' ' + lat + ')') + '&srid=4326';
    let adres = null, bladA = null, gm = null, bladG = null;
    try {
      const t = await pobierz(url, opcje.signal, 'geokodowania GUGiK');
      const d = jsonUug(t);
      zapamietaj(url, t);
      adres = wynikiUug(d)[0] || null;
    } catch (e) {
      if (e.kod === 'PRZERWANO') throw e;
      bladA = e;
    }
    if (!adres || !adres.kod_terc_gminy) {
      try { gm = await gmina(lat, lon, { signal: opcje.signal }); } catch (e) {
        if (e.kod === 'PRZERWANO') throw e;
        bladG = e;
      }
    }
    if (opcje.signal && opcje.signal.aborted) throw blad('Przerwano wyszukiwanie.', 'PRZERWANO');
    if (bladA && !gm) throw bladA;
    if (!adres && !gm) return null;
    const w = adres ? Object.assign({}, adres) : { opis: '', miejscowosc: null, czesc_miejscowosci: null, cecha_ulicy: null, ulica: null, numer: null,
      kod_pocztowy: null, kod_terc_gminy: null, kod_simc: null, kod_ulic: null, wojewodztwo: null, teryt_gminy6: null,
      dokladnosc: 'gmina', trafnosc: null, odleglosc_m: null };
    w.adres_lat = adres ? adres.lat : null;
    w.adres_lon = adres ? adres.lon : null;
    w.lat = zaokr6(lat); w.lon = zaokr6(lon);
    if (gm) {
      w.kod_terc_gminy = gm.kod_terc_gminy;
      w.gmina = gm.gmina; w.powiat = gm.powiat;
      w.wojewodztwo = w.wojewodztwo || gm.wojewodztwo;
    } else { w.gmina = null; w.powiat = null; }
    if (!w.opis) w.opis = gm ? 'gmina ' + gm.gmina + (gm.wojewodztwo ? ', woj. ' + gm.wojewodztwo : '') : '';
    if (bladA) w.ostrzezenie = 'Nie udało się ustalić adresu: ' + bladA.message;
    else if (bladG) w.ostrzezenie = bladG.message;
    return w;
  }

  AED.geokoder = {
    USLUGI: { uug: UUG, uldk: ULDK },
    /** Minimalny odstęp między zapytaniami do jednej usługi (ms); w testach 0. */
    odstepMs: ODSTEP_MS,
    /** Odstęp przed ponowieniem zapytania ULDK po przekierowaniu (ms); w testach 0. */
    ponowienieUldkMs: 1000,
    szukaj: szukaj,
    odwrotne: odwrotne,
    gmina: gmina,
    doPuwg92: doPuwg92,
    zPuwg92: zPuwg92,
    /** Czyści pamięć odpowiedzi i odstępy (testy). */
    _reset: function () { pamiec.clear(); Object.keys(ostatnie).forEach(function (k) { delete ostatnie[k]; }); },
    _test: { rozdzielUlice: rozdzielUlice, tercZ6: tercZ6, gminaZTekstu: gminaZTekstu, wynikiUug: wynikiUug, jsonUug: jsonUug }
  };
})(window.AED);
