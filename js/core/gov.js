/* „Wyślij do zatwierdzenia przez bazę gov.pl (Symulacja)” – zgłoszenie z 4 kroków zapisywane jako NOWY rekord w bazie SQLite „wyniki.gov”.
   To jest SYMULACJA: dane nigdy nie opuszczają komputera.
   - tryb 'serwer'       – aplikacja uruchomiona przez `python serwer.py`: zapis przez API (/api/zgloszenia) do pliku wyniki.gov,
   - tryb 'przegladarka' – GitHub Pages / inny serwer statyczny: ta sama baza w sql.js (SQLite w WebAssembly, vendor/sqljs),
                           zawartość trwała w IndexedDB tej przeglądarki (może zniknąć po wyczyszczeniu danych witryny,
                           w trybie prywatnym; nie jest wspólna dla innych przeglądarek ani komputerów).
   Schemat bazy: js/core/gov_schemat.sql (wspólny z serwer.py). sql.js ładowany leniwie – dopiero przy pierwszym zapisie/odczycie
   w trybie przeglądarkowym. Pod file:// tryb przeglądarkowy nie działa (WebAssembly i fetch są blokowane) – czytelny błąd. */
(function (AED) {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const NAZWA_BAZY = 'wyniki.gov';
  const STATUS = 'zatwierdzono_gov';
  const NAZWA_APLIKACJI = 'Namiar na puls';
  const WERSJA_FORMATU = 1;
  const MAKS_PROBLEMOW = 5000;      // problemy walidacji zapisywane w zgłoszeniu (pełna liczba jest w podsumowaniu)
  const ETAPY_SYMULACJI = ['Łączenie z systemem gov.pl…', 'Autoryzacja…', 'Trwa weryfikacja i wysyłka danych do systemu gov.pl...'];

  const konf = {
    adresApi: 'api/',                              // względem strony (działa też w podkatalogu)
    adresStrony: null,                             // dokument sprawdzany żądaniem HEAD (domyślnie location.href)
    sciezkaSchematu: 'js/core/gov_schemat.sql',
    sciezkaSqlJs: 'vendor/sqljs/',                 // sql-wasm.js + sql-wasm.wasm
    timeoutStatusuMs: 1500,
    magazyn: null,                                 // { wczytaj(): Promise<Uint8Array|null>, zapisz(Uint8Array): Promise } – domyślnie IndexedDB
    schemat: null,                                 // tekst SQL (testy) – domyślnie pobierany z sciezkaSchematu
    tryb: null                                     // wymuszenie trybu (testy): 'serwer' | 'przegladarka'
  };
  let trybPamiec = null;            // { tryb, czas }
  let sqlJsObietnica = null;
  let kolejka = Promise.resolve();  // zapisy w trybie przeglądarkowym po kolei

  function blad(komunikat, kod) { const e = new Error(komunikat); e.kod = kod || 'GOV'; return e; }
  function pusta(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
  function dwie(n) { return (n < 10 ? '0' : '') + n; }
  function teraz(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + dwie(d.getMonth() + 1) + '-' + dwie(d.getDate()) + 'T' + dwie(d.getHours()) + ':' + dwie(d.getMinutes()) + ':' + dwie(d.getSeconds());
  }
  function plikLokalny() { return !!(root.location && root.location.protocol === 'file:'); }
  const KOMUNIKAT_FILE = 'Zapis do bazy ' + NAZWA_BAZY + ' wymaga uruchomienia aplikacji przez serwer, a nie z pliku (file://). ' +
    'W katalogu aplikacji wpisz: python serwer.py  i otwórz http://127.0.0.1:8000';

  // ------------------------------------------------------------ JSON kanoniczny i suma kontrolna
  /** Klucze posortowane, bez spacji – zgodny z kanoniczny_json w serwer.py (json.dumps sort_keys, separators). */
  function kanoniczny(v) {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'number' && !isFinite(v)) throw blad('Liczba spoza zakresu JSON (NaN/Infinity) w zgłoszeniu.', 'FORMAT');
      return v === undefined ? 'null' : JSON.stringify(v);
    }
    if (Array.isArray(v)) return '[' + v.map(function (x) { return x === undefined || typeof x === 'function' ? 'null' : kanoniczny(x); }).join(',') + ']';
    return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined && typeof v[k] !== 'function'; }).sort()
      .map(function (k) { return JSON.stringify(k) + ':' + kanoniczny(v[k]); }).join(',') + '}';
  }
  async function sha256(tekst) {
    const c = root.crypto;
    if (!c || !c.subtle) throw blad('Przeglądarka nie udostępnia funkcji SHA-256 (wymagane https:// lub localhost).', 'SHA');
    const b = await c.subtle.digest('SHA-256', new TextEncoder().encode(tekst));
    return Array.from(new Uint8Array(b), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
  }
  /** Kopia JSON (bez funkcji, Map, cykli przez odwołania do rekordów) – tylko pola proste i tablice/obiekty prostych pól. */
  function proste(o, glebokosc) {
    glebokosc = glebokosc === undefined ? 4 : glebokosc;
    if (o === null || o === undefined) return null;
    if (typeof o === 'number') return isFinite(o) ? o : null;
    if (typeof o === 'string' || typeof o === 'boolean') return o;
    if (Object.prototype.toString.call(o) === '[object Date]') return isNaN(o) ? null : teraz(o);
    if (glebokosc <= 0 || typeof o !== 'object') return null;
    if (Array.isArray(o)) return o.map(function (x) { return proste(x, glebokosc - 1); });
    if (o instanceof Map || o instanceof Set || (root.Blob && o instanceof root.Blob)) return null;
    const w = {};
    Object.keys(o).forEach(function (k) {
      const v = proste(o[k], glebokosc - 1);
      if (v !== null || o[k] === null) w[k] = v;
    });
    return w;
  }

  // ------------------------------------------------------------ zebranie zgłoszenia
  function pola() { return AED.wzorzec.schema.fields.map(function (f) { return f.name; }); }

  /** Rekord wynikowy: pola wzorca + krótka informacja o pochodzeniu (bez surowych wierszy). */
  function rekordWynikowy(r, nazwy) {
    const o = {};
    nazwy.forEach(function (n) { o[n] = r[n] === undefined ? null : proste(r[n], 1); });
    const poch = { kodZrodla: r._kodZrodla || null, wiersz: r._wiersz === undefined ? null : r._wiersz };
    if (Array.isArray(r._scalonoZ)) poch.scalonoZ = r._scalonoZ.map(function (s) { return s.kodZrodla || null; });
    if (Array.isArray(r._poprawione) && r._poprawione.length) poch.poprawioneRecznie = r._poprawione.slice();
    o._pochodzenie = poch;
    return o;
  }

  function zrodloEtap1(z) {
    const meta = Object.assign({}, z.meta || {});
    delete meta.skoroszyt;
    return {
      kod: z.kod, nazwa: z.nazwa || '', typ: z.typ, dysponent: z.dysponent || '', licencja: z.licencja || '', priorytet: z.priorytet,
      dataPobrania: z.dataPobrania || null, liczba_wierszy: (z.wiersze || []).length, kolumny: (z.kolumny || []).slice(), meta: proste(meta, 4)
    };
  }
  function mapowanieEtap2(z) {
    const auto = !z.mapowanie;
    let m = z.mapowanie;
    if (!m && AED.mapowanie) { try { m = AED.mapowanie.podpowiedz(z); } catch (e) { m = null; } }
    const pola = {};
    Object.keys(m || {}).forEach(function (p) {
      const r = m[p] || {};
      const w = { regula: r.regula || 'brak' };
      ['kolumna', 'wartosc', 'zapas', 'szablon', 'wzorzec', 'zZrodla', 'pewnosc'].forEach(function (k) { if (r[k] !== undefined && r[k] !== null) w[k] = proste(r[k], 1); });
      pola[p] = w;
    });
    return { kod: z.kod, automatyczne: auto, pola: pola };
  }
  function jakMapa(x) { return !!x && !Array.isArray(x) && typeof x.forEach === 'function' && typeof x.get === 'function'; }
  /** Czy stan kroku 3 (AED.ui.walidacja.stan) jest aktualnym wynikiem walidacji. */
  function stanAktualny(s) { return !!(s && s.gotowe && !s.nieaktualne && jakMapa(s.problemy)); }
  /**
   * Wynik walidacji w formacie AED.walidacja.waliduj ({problemy[], podsumowanie}) ze stanu kroku 3 (AED.ui.walidacja.stan:
   * { gotowe, nieaktualne, problemy: Map(rekordId -> Problem[]) }) – bez liczenia walidacji drugi raz. null, gdy stan nieaktualny.
   */
  function walidacjaZeStanu(s) {
    if (!stanAktualny(s)) return null;
    const problemy = [];
    const wgZrodla = {}, bledne = {};
    let bledy = 0, ostrz = 0;
    const pusteZr = function () { return { rekordy: 0, bledy: 0, ostrzezenia: 0, rekordyZBledami: 0 }; };
    s.problemy.forEach(function (lista) {
      (lista || []).forEach(function (p) {
        problemy.push(p);
        const z = wgZrodla[p.kodZrodla] || (wgZrodla[p.kodZrodla] = pusteZr());
        if (p.poziom === 'blad') {
          bledy++; z.bledy++;
          if (!bledne[p.rekordId]) { bledne[p.rekordId] = 1; z.rekordyZBledami++; }
        } else { ostrz++; z.ostrzezenia++; }
      });
    });
    AED.store.zrodla.forEach(function (z) {
      const n = (z.wiersze || []).length;
      if (n) (wgZrodla[z.kod] = wgZrodla[z.kod] || pusteZr()).rekordy = n;
    });
    return { problemy: problemy, podsumowanie: { rekordy: AED.store.liczbaRekordowWynik, bledy: bledy, ostrzezenia: ostrz,
      rekordyZBledami: Object.keys(bledne).length, wgZrodla: wgZrodla } };
  }

  function walidacjaRekordow(opcje) {
    const w = opcje && opcje.walidacja;
    if (w && Array.isArray(w.problemy) && w.podsumowanie) return w;
    if (w && jakMapa(w.problemy)) { const z = walidacjaZeStanu(w); if (z) return z; }
    if (!AED.walidacja) return { problemy: [], podsumowanie: { rekordy: AED.store.liczbaRekordowWynik, bledy: 0, ostrzezenia: 0, rekordyZBledami: 0 } };
    return AED.walidacja.waliduj(AED.store.rekordy, opcje && opcje.dzis ? { dzis: opcje.dzis } : undefined);
  }
  function obszarRekordow(rekordy) {
    const m = new Map(), w = new Set();
    rekordy.forEach(function (r) {
      if (r.miejscowosc) m.set(String(r.miejscowosc), (m.get(String(r.miejscowosc)) || 0) + 1);
      if (r.wojewodztwo) w.add(String(r.wojewodztwo));
    });
    const miejsca = Array.from(m.keys()).sort(function (a, b) { return m.get(b) - m.get(a); });
    if (miejsca.length === 1) return miejsca[0];
    if (miejsca.length > 1 && miejsca.length <= 3) return miejsca.join(', ');
    if (w.size === 1) return 'województwo ' + Array.from(w)[0];
    if (miejsca.length > 3) return miejsca.slice(0, 3).join(', ') + ' i inne';
    return 'Polska';
  }

  /**
   * Zgłoszenie z 4 kroków (obiekt JSON gotowy do wysłania).
   * @param {Object} [metadane] – metadane zbioru z kroku 4 (np. AED.ui.wynik.stan.metadane; tytul, opis, kategorie…)
   * @param {{rekordy?:Object[], walidacja?:Object, dzis?:string, pominieteBledne?:number}} [opcje]
   *        rekordy – rekordy wynikowe do zgłoszenia (domyślnie AED.store.wynik); walidacja – wynik AED.walidacja.waliduj
   *        ({problemy[], podsumowanie}) ALBO stan kroku 3 AED.ui.walidacja.stan (gotowe, nieaktualne, problemy: Map);
   *        stan nieaktualny albo brak – walidacja liczona od nowa
   */
  function zbierzZgloszenie(metadane, opcje) {
    opcje = opcje || {};
    const store = AED.store;
    const zrodla = store.zrodla;
    const wynikRek = opcje.rekordy || store.wynik;
    const raport = store.raportScalenia || null;
    const wal = walidacjaRekordow(opcje);
    const dup = store.duplikaty;
    const nazwy = pola();
    const lic = AED.eksport && AED.eksport.licencjaZbioru ? AED.eksport.licencjaZbioru(wynikRek, zrodla) : null;
    const problemy = (wal.problemy || []).slice(0, MAKS_PROBLEMOW).map(function (p) {
      return { kodZrodla: p.kodZrodla || null, wiersz: p.wiersz === undefined ? null : p.wiersz, rekordId: p.rekordId || null, pole: p.pole || null,
        poziom: p.poziom, kod: p.kod, komunikat: p.komunikat };
    });
    const m = proste(Object.assign({}, metadane || {}), 3) || {};
    delete m.zrodla; delete m.licencja;
    const obszar = obszarRekordow(wynikRek);
    const decyzje = store.decyzje;
    return {
      format: 'namiar-na-puls/zgloszenie-gov',
      wersja_formatu: WERSJA_FORMATU,
      symulacja: true,
      aplikacja: { nazwa: NAZWA_APLIKACJI, wersja: AED.version || null },
      utworzono: teraz(),
      tytul: m.tytul || ('Defibrylatory AED – ' + obszar),
      obszar: obszar,
      etap1_zrodla: zrodla.map(zrodloEtap1),
      etap2_mapowanie: zrodla.map(mapowanieEtap2),
      etap3_walidacja: {
        podsumowanie: {
          rekordy: wal.podsumowanie.rekordy, bledy: wal.podsumowanie.bledy, ostrzezenia: wal.podsumowanie.ostrzezenia,
          rekordyZBledami: wal.podsumowanie.rekordyZBledami, wgZrodla: proste(wal.podsumowanie.wgZrodla, 3) || {}
        },
        problemy: problemy,
        problemyPominiete: Math.max(0, (wal.problemy || []).length - problemy.length),
        duplikaty: dup ? {
          wyszukano: true,
          podsumowanie: proste(dup.podsumowanie, 2),
          grupy: dup.grupy.map(function (g) { return { id: g.id, rekordy: g.rekordy.slice(), pewnosc: g.pewnosc, odlegloscM: g.odlegloscM, powody: (g.powody || []).slice(0, 5) }; }),
          decyzje: proste(decyzje, 3)
        } : { wyszukano: false, decyzje: proste(decyzje, 3) },
        odstajace: dup ? (dup.odstajace || []).map(function (o) { return proste(o, 2); }) : []
      },
      etap4_wynik: {
        metadane: m,
        licencja: lic ? { kod: lic.kod, nazwa: lic.nazwa, url: lic.url, uzasadnienie: lic.uzasadnienie, atrybucje: lic.atrybucje, liczby: lic.liczby } : null,
        raport_scalenia: raport ? { grupy: raport.grupy, scalone: raport.scalone, rozdzielone: raport.rozdzielone, usuniete: raport.usuniete,
          pominiete: raport.pominiete, automatycznie: raport.automatycznie, noweId: (raport.noweId || []).length } : null,
        pominieteBledne: opcje.pominieteBledne || 0,
        rekordy: wynikRek.map(function (r) { return rekordWynikowy(r, nazwy); })
      }
    };
  }

  /**
   * Zgłoszenie z prostego formularza dysponenta (bez kroków 1–4 scalania): jedno źródło „FORMULARZ”, mapowanie 1:1,
   * walidacja przeprowadzona w formularzu (podsumowanie bez błędów), rekordy = urządzenia z formularza.
   * @param {Object[]} rekordy – urządzenia (pola wzorca)
   * @param {{dysponent?:string, licencja?:string, tytul?:string}} [opcje]
   */
  function zbierzZgloszenieFormularza(rekordy, opcje) {
    opcje = opcje || {};
    const lista = (rekordy || []).map(function (r, i) {
      const x = Object.assign({}, r);
      x._kodZrodla = 'FORMULARZ'; x._wiersz = i + 1;
      return x;
    });
    const nazwy = pola();
    const dysp = String(opcje.dysponent || '').trim();
    const tytul = opcje.tytul || ('Defibrylatory AED – ' + (dysp || 'formularz dysponenta'));
    return {
      format: 'namiar-na-puls/zgloszenie-gov',
      wersja_formatu: WERSJA_FORMATU,
      symulacja: true,
      zrodlo_zgloszenia: 'formularz_dysponenta',
      aplikacja: { nazwa: NAZWA_APLIKACJI, wersja: AED.version || null },
      utworzono: teraz(),
      tytul: tytul,
      obszar: dysp || 'formularz dysponenta',
      etap1_zrodla: [{ kod: 'FORMULARZ', nazwa: 'Formularz dysponenta na stronie', typ: 'FORMULARZ', dysponent: dysp, licencja: opcje.licencja || '',
        priorytet: 1, dataPobrania: teraz(), liczba_wierszy: lista.length, kolumny: nazwy.slice(), meta: {} }],
      etap2_mapowanie: [{ kod: 'FORMULARZ', automatyczne: true, pola: {} }],
      etap3_walidacja: {
        podsumowanie: { rekordy: lista.length, bledy: 0, ostrzezenia: 0, rekordyZBledami: 0, wgZrodla: {} },
        problemy: [], problemyPominiete: 0, duplikaty: { wyszukano: false, decyzje: {} }, odstajace: []
      },
      etap4_wynik: {
        metadane: { tytul: tytul, dysponent: dysp },
        licencja: opcje.licencja ? { kod: opcje.licencja } : null,
        raport_scalenia: null, pominieteBledne: 0,
        rekordy: lista.map(function (r) { return rekordWynikowy(r, nazwy); })
      }
    };
  }

  /** Kolumny podsumowania wyliczane z treści (te same reguły co kolumny_zgloszenia w serwer.py). */
  function kolumnyZgloszenia(zgl) {
    const e3 = zgl.etap3_walidacja || {}, e4 = zgl.etap4_wynik || {};
    const pods = e3.podsumowanie || {}, meta = e4.metadane || {}, lic = e4.licencja || {}, raport = e4.raport_scalenia || {};
    const int = function (v) { const n = parseInt(v, 10); return isFinite(n) ? n : 0; };
    const txt = function (v, maks) { return v === null || v === undefined ? null : String(v).slice(0, maks); };
    return {
      tytul: txt(meta.tytul || zgl.tytul, 300), obszar: txt(zgl.obszar, 300), liczba_zrodel: (zgl.etap1_zrodla || []).length,
      liczba_rekordow_wejsciowych: int(pods.rekordy), liczba_rekordow: (e4.rekordy || []).length, liczba_bledow: int(pods.bledy),
      liczba_ostrzezen: int(pods.ostrzezenia), liczba_scalonych: int(raport.scalone),
      licencja: txt(lic && typeof lic === 'object' ? lic.kod : lic, 40), wersja_aplikacji: txt((zgl.aplikacja || {}).wersja, 40)
    };
  }

  /** Sprawdzenie struktury (jak sprawdz_zgloszenie w serwer.py) – błąd przed zapisem. */
  function sprawdzStrukture(zgl) {
    if (!zgl || typeof zgl !== 'object' || Array.isArray(zgl)) throw blad('Zgłoszenie musi być obiektem.', 'STRUKTURA');
    if (!Array.isArray(zgl.etap1_zrodla) || !zgl.etap1_zrodla.length) throw blad('Zgłoszenie nie ma żadnego źródła danych (krok 1).', 'STRUKTURA');
    if (!Array.isArray(zgl.etap2_mapowanie)) throw blad('Brak mapowania (krok 2).', 'STRUKTURA');
    if (!zgl.etap3_walidacja || !zgl.etap3_walidacja.podsumowanie) throw blad('Brak podsumowania walidacji (krok 3).', 'STRUKTURA');
    const e4 = zgl.etap4_wynik;
    if (!e4 || !e4.metadane || typeof e4.metadane !== 'object') throw blad('Brak metadanych zbioru (krok 4).', 'STRUKTURA');
    if (!Array.isArray(e4.rekordy) || !e4.rekordy.length) throw blad('Zgłoszenie nie zawiera rekordów wynikowych (krok 4).', 'STRUKTURA');
  }

  // ------------------------------------------------------------ gotowość (blokada przycisku)
  /**
   * Czy wszystkie 4 kroki są ukończone.
   * @param {{metadane?:Object, zwalidowano?:boolean, walidacja?:Object, rekordy?:Object[]}} [stanUI] – metadane z kroku 4 (wymagane);
   *        zwalidowano: czy krok 3 ma aktualny wynik walidacji; zamiast niego można podać walidacja = AED.ui.walidacja.stan.
   *        Bez obu – walidacja liczy się przy zbieraniu zgłoszenia.
   * @returns {{gotowe:boolean, braki:{etap:number, komunikat:string, pole?:string}[]}} – pole (etap 4): klucz metadanych z walidujMetadane
   */
  function gotowosc(stanUI) {
    stanUI = stanUI || {};
    const store = AED.store;
    const braki = [];
    const dodaj = function (etap, komunikat, pole) { const b = { etap: etap, komunikat: komunikat }; if (pole) b.pole = pole; braki.push(b); };
    const zrodla = store.zrodla;
    // krok 1
    if (!zrodla.length) dodaj(1, 'Dodaj co najmniej jedno źródło danych.');
    zrodla.forEach(function (z) { if (!(z.wiersze || []).length) dodaj(1, 'Źródło ' + z.kod + ' nie ma żadnych wierszy.'); });
    // krok 2
    zrodla.forEach(function (z) {
      let m = z.mapowanie;
      if (!m && AED.mapowanie) { try { m = AED.mapowanie.podpowiedz(z); } catch (e) { m = null; } }
      const brak = function (p) { return !m || !m[p] || m[p].regula === 'brak'; };
      if (brak('szerokosc_geograficzna') || brak('dlugosc_geograficzna')) {
        dodaj(2, 'Źródło ' + z.kod + ': wskaż kolumny ze współrzędnymi (szerokość i długość geograficzna).');
      }
    });
    // krok 3
    const wiersze = zrodla.reduce(function (s, z) { return s + (z.wiersze || []).length; }, 0);
    if (zrodla.length && !store.liczbaRekordowWynik) dodaj(3, 'Przelicz rekordy i uruchom walidację (krok 3).');
    else if (zrodla.length && store.liczbaRekordowWynik !== wiersze) dodaj(3, 'Dane źródeł się zmieniły – przelicz rekordy i walidację ponownie (krok 3).');
    let zwal = stanUI.zwalidowano;
    if (zwal === undefined && stanUI.walidacja && jakMapa(stanUI.walidacja.problemy)) zwal = stanAktualny(stanUI.walidacja);
    if (zwal === false) dodaj(3, 'Uruchom walidację rekordów (krok 3).');
    if (store.liczbaRekordowWynik && !store.duplikaty) dodaj(3, 'Wyszukaj duplikaty i punkty odstające (krok 3).');
    // krok 4
    let wynik = [];
    if (store.liczbaRekordowWynik) { try { wynik = stanUI.rekordy || store.wynik; } catch (e) { wynik = []; } }
    if (store.liczbaRekordowWynik && !wynik.length) dodaj(4, 'Zbiór wynikowy jest pusty.');
    if (!stanUI.metadane) dodaj(4, 'Uzupełnij metadane zbioru (krok 4).');
    else if (AED.eksport && AED.eksport.walidujMetadane) {
      const m = Object.assign({}, stanUI.metadane);
      delete m.zasoby;
      const bledy = AED.eksport.walidujMetadane(m).filter(function (p) { return p.poziom === 'blad'; });
      bledy.forEach(function (p) { dodaj(4, 'Metadane: ' + p.komunikat, p.pole); });
    }
    return { gotowe: !braki.length, braki: braki };
  }

  // ------------------------------------------------------------ tryb i HTTP
  function url(sciezka) { return konf.adresApi + sciezka; }

  async function pobierzJson(adres, init, timeoutMs) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let t = null;
    if (ctrl && timeoutMs) t = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    if (ctrl && init && init.signal) {
      if (init.signal.aborted) ctrl.abort();
      else init.signal.addEventListener('abort', function () { ctrl.abort(); });
    }
    try {
      const odp = await root.fetch(adres, Object.assign({}, init || {}, ctrl ? { signal: ctrl.signal } : {}));
      let dane = null;
      try { dane = await odp.json(); } catch (e) { dane = null; }
      return { ok: odp.ok, status: odp.status, dane: dane };
    } finally { if (t) clearTimeout(t); }
  }

  /** Czy stronę podaje serwer.py: żądanie HEAD na bieżący dokument i nagłówek X-Namiar-Serwer – bez zapytania kończącego
      się 404 (i błędem w konsoli) na GitHub Pages / serwerze statycznym. Bez adresu dokumentu (Node) – GET api/status. */
  async function wykryjSerwer() {
    const strona = konf.adresStrony || (root.location && root.location.href ? String(root.location.href).split('#')[0] : null);
    if (strona) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = ctrl ? setTimeout(function () { ctrl.abort(); }, konf.timeoutStatusuMs) : null;
      try {
        const odp = await root.fetch(strona, Object.assign({ method: 'HEAD', cache: 'no-store' }, ctrl ? { signal: ctrl.signal } : {}));
        return odp.headers.get('X-Namiar-Serwer') === '1';
      } finally { if (t) clearTimeout(t); }
    }
    const o = await pobierzJson(url('status'), { cache: 'no-store' }, konf.timeoutStatusuMs);
    return !!(o.ok && o.dane && o.dane.tryb === 'serwer');
  }

  /** 'serwer', gdy stronę podaje lokalny serwer.py (nagłówek X-Namiar-Serwer), inaczej 'przegladarka'. Wynik pamiętany 30 s. */
  async function tryb(opcje) {
    if (konf.tryb) return konf.tryb;
    if (trybPamiec && !(opcje && opcje.odswiez) && Date.now() - trybPamiec.czas < 30000) return trybPamiec.tryb;
    let t = 'przegladarka';
    if (!plikLokalny() && typeof root.fetch === 'function') {
      try { if (await wykryjSerwer()) t = 'serwer'; } catch (e) { /* brak serwera – tryb przeglądarkowy */ }
    }
    trybPamiec = { tryb: t, czas: Date.now() };
    return t;
  }

  function czekaj(ms, signal) {
    return new Promise(function (ok, nie) {
      if (signal && signal.aborted) { nie(blad('Wysyłkę przerwano.', 'PRZERWANO')); return; }
      const t = setTimeout(ok, ms);
      if (signal) signal.addEventListener('abort', function () { clearTimeout(t); nie(blad('Wysyłkę przerwano.', 'PRZERWANO')); });
    });
  }

  /**
   * Symulacja wysyłki do gov.pl i zapis zgłoszenia jako NOWEGO rekordu w bazie wyniki.gov.
   * @param {Object} zgloszenie – wynik zbierzZgloszenie
   * @param {{onPostep?:function(string), opoznienieMs?:number, signal?:AbortSignal}} [opcje]
   * @returns {Promise<{id, numer, status, data_wyslania, liczba, statystyki, tryb}>}
   */
  async function wyslij(zgloszenie, opcje) {
    opcje = opcje || {};
    sprawdzStrukture(zgloszenie);
    const opozn = Math.max(0, opcje.opoznienieMs === undefined ? 1500 : Number(opcje.opoznienieMs) || 0);
    const postep = typeof opcje.onPostep === 'function' ? opcje.onPostep : function () {};
    const t = await tryb();
    if (t === 'przegladarka' && plikLokalny()) throw blad(KOMUNIKAT_FILE, 'FILE');
    // etapy symulacji: 25% / 25% / 50% czasu
    const czasy = [0.25, 0.25, 0.5];
    for (let i = 0; i < ETAPY_SYMULACJI.length; i++) {
      postep(ETAPY_SYMULACJI[i]);
      await czekaj(Math.round(opozn * czasy[i]), opcje.signal);
    }
    if (opcje.signal && opcje.signal.aborted) throw blad('Wysyłkę przerwano.', 'PRZERWANO');
    let wynik;
    if (t === 'serwer') {
      let o;
      try {
        o = await pobierzJson(url('zgloszenia'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(zgloszenie) }, 120000);
      } catch (e) {
        throw blad('Nie udało się połączyć z lokalnym serwerem (serwer.py). Sprawdź, czy nadal działa.', 'SIEC');
      }
      if (!o.ok) throw blad((o.dane && o.dane.blad) || ('Serwer odrzucił zgłoszenie (HTTP ' + o.status + ').'), 'SERWER');
      wynik = o.dane;
    } else {
      wynik = await zapiszWPrzegladarce(zgloszenie);
    }
    wynik.tryb = t;
    postep('Zgłoszenie ' + wynik.numer + ' zapisano w bazie ' + NAZWA_BAZY + '.');
    return wynik;
  }

  // ------------------------------------------------------------ zrzut SQL (plik wyniki_gov.txt)
  function sqlTekst(v) { return v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'"; }
  function sqlLiczba(v) { return typeof v === 'number' && isFinite(v) ? String(v) : 'NULL'; }
  function sqlWartosc(v, typ) {
    if (v === null || v === undefined || v === '') return 'NULL';
    if (typ === 'boolean') return v === true || v === 'true' ? '1' : (v === false || v === 'false' ? '0' : 'NULL');
    if (typ === 'number' || typ === 'integer') { const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.')); return isFinite(n) ? String(n) : sqlTekst(v); }
    return sqlTekst(typeof v === 'object' ? JSON.stringify(v) : v);
  }
  function typSql(typ) { return typ === 'number' ? 'REAL' : (typ === 'integer' || typ === 'boolean' ? 'INTEGER' : 'TEXT'); }

  /**
   * Plik SQL z danymi wpisanymi i wysłanymi przyciskiem: tabela `zgloszenie` (kto i kiedy wysłał) oraz tabela `urzadzenia_aed`
   * z KAŻDYM polem wzorca jako osobną kolumną (jeden wiersz = jedno urządzenie). Wykonanie w SQLite tworzy tabele i wstawia dane:
   * `sqlite3 wyniki.db < wyniki_gov.txt`.
   * @param {Object} zgl – zgłoszenie wysłane przez wyslij()
   * @param {{id?:number, numer?:string, data_wyslania?:string}} wynik – odpowiedź wyslij()
   */
  async function zrzutSql(zgl, wynik) {
    wynik = wynik || {};
    const k = kolumnyZgloszenia(zgl);
    const data = wynik.data_wyslania || teraz();
    const numer = wynik.numer || ('GOV-' + data.slice(0, 4) + '-' + String(wynik.id || 1).padStart(6, '0'));
    const rekordy = zgl.etap4_wynik.rekordy;
    const pola = AED.wzorzec.schema.fields;
    const zr = (zgl.etap1_zrodla || [])[0] || {};
    const L = [];
    L.push('-- wyniki_gov.txt – dane wpisane w formularzu i wysłane przyciskiem „Wyślij do zatwierdzenia przez bazę gov.pl” (aplikacja „' + NAZWA_APLIKACJI + '”).');
    L.push('-- Zgłoszenie ' + numer + ', ' + data + ', urządzeń AED: ' + rekordy.length + '.');
    L.push('-- Użycie: sqlite3 wyniki.db < wyniki_gov.txt   (to zwykły tekst z poleceniami SQL – możesz go też otworzyć w Notatniku albo wkleić do „Execute SQL” w DB Browser for SQLite).');
    L.push('');
    L.push('CREATE TABLE IF NOT EXISTS zgloszenie (');
    L.push('  numer TEXT PRIMARY KEY,            -- numer zgłoszenia');
    L.push('  data_wyslania TEXT NOT NULL,       -- data i czas wysłania (czas lokalny)');
    L.push('  tytul TEXT,                        -- tytuł zbioru');
    L.push('  dysponent TEXT,                    -- instytucja, która wysłała dane');
    L.push('  licencja TEXT,                     -- licencja zbioru');
    L.push('  liczba_urzadzen INTEGER NOT NULL   -- ile urządzeń AED w zgłoszeniu');
    L.push(');');
    L.push('');
    L.push('CREATE TABLE IF NOT EXISTS urzadzenia_aed (');
    L.push('  zgloszenie_numer TEXT NOT NULL REFERENCES zgloszenie(numer),');
    pola.forEach(function (f, i) {
      L.push('  ' + f.name + ' ' + typSql(f.type) + (i < pola.length - 1 ? ',' : '') + '  -- ' + String(f.title || f.name).replace(/\s+/g, ' '));
    });
    L.push(');');
    L.push('');
    L.push('BEGIN;');
    L.push('INSERT INTO zgloszenie (numer, data_wyslania, tytul, dysponent, licencja, liczba_urzadzen) VALUES (' + [
      sqlTekst(numer), sqlTekst(data), sqlTekst(k.tytul), sqlTekst(zr.dysponent || null), sqlTekst(k.licencja || zr.licencja || null), String(rekordy.length)].join(', ') + ');');
    const kolumny = ['zgloszenie_numer'].concat(pola.map(function (f) { return f.name; })).join(', ');
    rekordy.forEach(function (r) {
      L.push('INSERT INTO urzadzenia_aed (' + kolumny + ') VALUES (' + [sqlTekst(numer)].concat(pola.map(function (f) { return sqlWartosc(r[f.name], f.type); })).join(', ') + ');');
    });
    L.push('COMMIT;');
    L.push('');
    return L.join('\n');
  }

  const KOL_LISTY = 'numer, data_wyslania, status, tytul, obszar, liczba_zrodel, liczba_rekordow, liczba_bledow, liczba_ostrzezen, licencja';
  /** Imitacja portalu dane.gov.pl: lista zatwierdzonych zbiorów (zgłoszeń) z bazy wyniki.gov. */
  async function lista() {
    const t = await tryb();
    if (t === 'serwer') {
      const o = await pobierzJson(url('zgloszenia'), { cache: 'no-store' }, 10000);
      if (!o.ok || !o.dane) throw blad('Nie udało się odczytać listy zbiorów (HTTP ' + o.status + ').', 'SERWER');
      return o.dane.zbiory || [];
    }
    if (plikLokalny()) throw blad(KOMUNIKAT_FILE, 'FILE');
    return zKolejki(async function () {
      const db = await otworzBaze();
      try { return wiersze(db, 'SELECT ' + KOL_LISTY + ' FROM zgloszenia ORDER BY id DESC LIMIT 200'); } finally { db.close(); }
    });
  }
  /** Jeden zbiór wraz z urządzeniami (do 1000). */
  async function zbior(numer) {
    const t = await tryb();
    if (t === 'serwer') {
      const o = await pobierzJson(url('zgloszenia/' + encodeURIComponent(numer)), { cache: 'no-store' }, 10000);
      if (!o.ok || !o.dane) throw blad((o.dane && o.dane.blad) || ('Nie udało się odczytać zbioru (HTTP ' + o.status + ').'), 'SERWER');
      return o.dane;
    }
    if (plikLokalny()) throw blad(KOMUNIKAT_FILE, 'FILE');
    return zKolejki(async function () {
      const db = await otworzBaze();
      try {
        const z = wiersz(db, 'SELECT id, ' + KOL_LISTY + ' FROM zgloszenia WHERE numer = ?', [numer]);
        if (!z) throw blad('Nie ma takiego zgłoszenia.', 'BRAK');
        const id = z.id; delete z.id;
        z.rekordy = wiersze(db, 'SELECT id_aed, nazwa, miejscowosc, szerokosc, dlugosc, status FROM rekordy_aed WHERE zgloszenie_id = ? ORDER BY id LIMIT 1000', [id]);
        return z;
      } finally { db.close(); }
    });
  }

  async function statystyki() {
    const t = await tryb();
    if (t === 'serwer') {
      const o = await pobierzJson(url('statystyki'), { cache: 'no-store' }, 10000);
      if (!o.ok || !o.dane) throw blad('Nie udało się odczytać statystyk bazy (HTTP ' + o.status + ').', 'SERWER');
      o.dane.tryb = 'serwer';
      return o.dane;
    }
    if (plikLokalny()) throw blad(KOMUNIKAT_FILE, 'FILE');
    return zKolejki(async function () {
      const db = await otworzBaze();
      try { const s = statystykiSql(db); s.tryb = 'przegladarka'; return s; } finally { db.close(); }
    });
  }

  /** Plik bazy wyniki.gov jako Blob (application/vnd.sqlite3) – do zapisania pod nazwą AED.gov.NAZWA_BAZY. */
  async function pobierzBaze() {
    const t = await tryb();
    if (t === 'serwer') {
      const odp = await root.fetch(url('baza'), { cache: 'no-store' });
      if (!odp.ok) throw blad('Nie udało się pobrać pliku bazy (HTTP ' + odp.status + ').', 'SERWER');
      const b = await odp.blob();
      return b.type ? b : new Blob([b], { type: 'application/vnd.sqlite3' });
    }
    if (plikLokalny()) throw blad(KOMUNIKAT_FILE, 'FILE');
    return zKolejki(async function () {
      const db = await otworzBaze();
      try { return new Blob([db.export()], { type: 'application/vnd.sqlite3' }); } finally { db.close(); }
    });
  }

  // ------------------------------------------------------------ tryb przeglądarkowy (sql.js + IndexedDB)
  function zKolejki(fn) {
    const zLock = function () {
      const nl = root.navigator && root.navigator.locks;
      return nl && nl.request ? nl.request('namiar-na-puls-' + NAZWA_BAZY, fn) : fn();  // kilka kart naraz
    };
    const p = kolejka.then(zLock, zLock);
    kolejka = p.catch(function () {});
    return p;
  }

  function wczytajSkrypt(src) {
    return new Promise(function (ok, nie) {
      const d = root.document;
      if (!d) { nie(blad('Brak dokumentu – nie można wczytać ' + src, 'SQLJS')); return; }
      const s = d.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { nie(blad('Nie udało się wczytać biblioteki SQLite (' + src + ').', 'SQLJS')); };
      d.head.appendChild(s);
    });
  }

  /** sql.js ładowany leniwie (vendor/sqljs/sql-wasm.js ~50 kB + sql-wasm.wasm ~650 kB). */
  function sqlJs() {
    if (sqlJsObietnica) return sqlJsObietnica;
    sqlJsObietnica = (async function () {
      if (plikLokalny()) throw blad(KOMUNIKAT_FILE, 'FILE');
      if (typeof root.initSqlJs !== 'function') await wczytajSkrypt(konf.sciezkaSqlJs + 'sql-wasm.js');
      if (typeof root.initSqlJs !== 'function') throw blad('Biblioteka sql.js nie udostępniła funkcji initSqlJs.', 'SQLJS');
      try {
        return await root.initSqlJs({ locateFile: function (f) { return konf.sciezkaSqlJs + f; } });
      } catch (e) {
        throw blad('Nie udało się uruchomić SQLite w przeglądarce (WebAssembly): ' + (e && e.message || e) +
          '. Uruchom aplikację przez: python serwer.py', 'SQLJS');
      }
    })();
    sqlJsObietnica.catch(function () { sqlJsObietnica = null; });   // kolejna próba po błędzie
    return sqlJsObietnica;
  }

  async function tekstSchematu() {
    if (konf.schemat) return konf.schemat;
    const odp = await root.fetch(konf.sciezkaSchematu, { cache: 'no-cache' });
    if (!odp.ok) throw blad('Nie udało się wczytać schematu bazy (' + konf.sciezkaSchematu + ').', 'SCHEMAT');
    konf.schemat = await odp.text();
    return konf.schemat;
  }

  // Magazyn domyślny: IndexedDB „namiar-na-puls”, magazyn obiektów „bazy”, klucz „wyniki.gov” -> Uint8Array
  const IDB = { nazwa: 'namiar-na-puls', magazyn: 'bazy' };
  function idbOtworz() {
    return new Promise(function (ok, nie) {
      let req;
      try { req = root.indexedDB.open(IDB.nazwa, 1); } catch (e) { nie(e); return; }
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB.magazyn); };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { nie(req.error); };
      req.onblocked = function () { nie(blad('Baza IndexedDB jest zablokowana przez inną kartę.', 'IDB')); };
    });
  }
  const magazynIdb = {
    wczytaj: async function () {
      if (!root.indexedDB) return null;
      try {
        const db = await idbOtworz();
        return await new Promise(function (ok, nie) {
          const tx = db.transaction(IDB.magazyn, 'readonly');
          const r = tx.objectStore(IDB.magazyn).get(NAZWA_BAZY);
          r.onsuccess = function () { const v = r.result; ok(v ? new Uint8Array(v) : null); };
          r.onerror = function () { nie(r.error); };
          tx.oncomplete = function () { db.close(); };
        });
      } catch (e) {
        console.warn('[AED.gov] IndexedDB niedostępne – baza tylko w pamięci tej karty.', e);
        return pamiecBazy;
      }
    },
    zapisz: async function (bajty) {
      pamiecBazy = bajty;
      if (!root.indexedDB) return false;
      try {
        const db = await idbOtworz();
        await new Promise(function (ok, nie) {
          const tx = db.transaction(IDB.magazyn, 'readwrite');
          tx.objectStore(IDB.magazyn).put(bajty, NAZWA_BAZY);
          tx.oncomplete = function () { db.close(); ok(); };
          tx.onerror = function () { nie(tx.error); };
          tx.onabort = function () { nie(tx.error || blad('Przerwano zapis do IndexedDB.', 'IDB')); };
        });
        return true;
      } catch (e) {
        console.warn('[AED.gov] Nie udało się zapisać bazy w IndexedDB (brak miejsca lub tryb prywatny).', e);
        return false;
      }
    }
  };
  let pamiecBazy = null;   // zapas, gdy IndexedDB nie działa (tylko do zamknięcia karty)
  function magazyn() { return konf.magazyn || magazynIdb; }

  async function otworzBaze() {
    const SQL = await sqlJs();
    const schemat = await tekstSchematu();
    const bajty = await magazyn().wczytaj();
    const db = bajty && bajty.length ? new SQL.Database(bajty) : new SQL.Database();
    db.exec(schemat);
    return db;
  }

  function wiersz(db, sql, param) {
    const st = db.prepare(sql);
    try { if (param) st.bind(param); return st.step() ? st.getAsObject() : null; } finally { st.free(); }
  }
  function wiersze(db, sql, param) {
    const st = db.prepare(sql);
    const w = [];
    try { if (param) st.bind(param); while (st.step()) w.push(st.getAsObject()); } finally { st.free(); }
    return w;
  }

  /** Te same zapytania co statystyki() w serwer.py. */
  function statystykiSql(db) {
    const p = wiersz(db, 'SELECT * FROM podsumowanie');
    const wg = {};
    wiersze(db, 'SELECT status, liczba FROM zgloszenia_wg_statusu').forEach(function (r) { wg[r.status] = r.liczba; });
    return {
      liczba: wiersz(db, 'SELECT COUNT(*) AS n FROM zgloszenia').n,
      sumaRekordow: p.suma_rekordow, sumaBledow: p.suma_bledow, sumaOstrzezen: p.suma_ostrzezen,
      pierwsze: p.pierwsze_zgloszenie, ostatnieData: p.ostatnie_zgloszenie, wgStatusu: wg,
      dzienne: wiersze(db, 'SELECT * FROM statystyki_dzienne ORDER BY dzien DESC LIMIT 30').map(function (r) {
        return { dzien: r.dzien, liczba: r.liczba_zgloszen, rekordy: r.suma_rekordow };
      }),
      ostatnie: wiersze(db, 'SELECT numer, data_wyslania, tytul, liczba_rekordow FROM zgloszenia ORDER BY id DESC LIMIT 5'),
      baza: NAZWA_BAZY
    };
  }

  function liczbaLubNull(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function tekstLubNull(v, maks) { return v === null || v === undefined ? null : String(v).slice(0, maks); }

  function zapiszWPrzegladarce(zgl) {
    return zKolejki(async function () {
      const suma = await sha256(kanoniczny(zgl));
      const db = await otworzBaze();
      try {
        const k = kolumnyZgloszenia(zgl);
        const data = teraz();
        db.exec('BEGIN');
        try {
          db.run('INSERT INTO zgloszenia (data_wyslania, status, tytul, obszar, liczba_zrodel, liczba_rekordow_wejsciowych, liczba_rekordow,' +
            ' liczba_bledow, liczba_ostrzezen, liczba_scalonych, licencja, etap1_zrodla, etap2_mapowanie, etap3_walidacja, etap4_wynik,' +
            ' suma_kontrolna, tryb, wersja_aplikacji) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [data, STATUS, k.tytul, k.obszar, k.liczba_zrodel, k.liczba_rekordow_wejsciowych, k.liczba_rekordow, k.liczba_bledow,
            k.liczba_ostrzezen, k.liczba_scalonych, k.licencja, JSON.stringify(zgl.etap1_zrodla), JSON.stringify(zgl.etap2_mapowanie),
            JSON.stringify(zgl.etap3_walidacja), JSON.stringify(zgl.etap4_wynik), suma, 'przegladarka', k.wersja_aplikacji]);
          const id = wiersz(db, 'SELECT last_insert_rowid() AS id').id;
          const numer = 'GOV-' + data.slice(0, 4) + '-' + String(id).padStart(6, '0');
          db.run('UPDATE zgloszenia SET numer = ? WHERE id = ?', [numer, id]);
          const st = db.prepare('INSERT INTO rekordy_aed (zgloszenie_id, id_aed, nazwa, miejscowosc, szerokosc, dlugosc, status, dane) VALUES (?,?,?,?,?,?,?,?)');
          try {
            zgl.etap4_wynik.rekordy.forEach(function (r) {
              st.run([id, tekstLubNull(r.id_aed, 64), tekstLubNull(r.nazwa, 300), tekstLubNull(r.miejscowosc, 200),
                liczbaLubNull(r.szerokosc_geograficzna), liczbaLubNull(r.dlugosc_geograficzna), tekstLubNull(r.status, 40), JSON.stringify(r)]);
            });
          } finally { st.free(); }
          db.exec('COMMIT');
          const wynik = { id: id, numer: numer, status: STATUS, data_wyslania: data, suma_kontrolna: suma };
          await magazyn().zapisz(db.export());
          const s = statystykiSql(db);
          wynik.liczba = s.liczba;
          wynik.statystyki = s;
          return wynik;
        } catch (e) {
          try { db.exec('ROLLBACK'); } catch (e2) { /* transakcja już zamknięta */ }
          throw e;
        }
      } finally { db.close(); }
    });
  }

  AED.gov = {
    NAZWA_BAZY: NAZWA_BAZY,
    STATUS: STATUS,
    ETAPY_SYMULACJI: ETAPY_SYMULACJI.slice(),
    tryb: tryb,
    zbierzZgloszenie: zbierzZgloszenie,
    zbierzZgloszenieFormularza: zbierzZgloszenieFormularza,
    gotowosc: gotowosc,
    wyslij: wyslij,
    statystyki: statystyki,
    lista: lista,
    zbior: zbior,
    pobierzBaze: pobierzBaze,
    zrzutSql: zrzutSql,
    kanoniczny: kanoniczny,
    sumaKontrolna: function (zgl) { return sha256(kanoniczny(zgl)); },
    kolumnyZgloszenia: kolumnyZgloszenia,
    walidacjaZeStanu: walidacjaZeStanu,
    /** Ustawienia (testy, inna ścieżka): adresApi, adresStrony, sciezkaSchematu, sciezkaSqlJs, timeoutStatusuMs, magazyn, schemat, tryb. */
    konfiguruj: function (o) { Object.assign(konf, o || {}); trybPamiec = null; return Object.assign({}, konf); }
  };
})(window.AED);
