/* Formularz dysponenta – logika (bez DOM).
   Dysponent (gmina, szkoła, firma) wpisuje swoje AED; rekordy są walidowane regułami wzorca i mogą:
   - trafić do zbioru jako źródło typu 'FORMULARZ' (kolumny = pola wzorca, mapowanie 1:1 rozpoznawane automatycznie),
   - zostać pobrane jako CSV zgodny ze wzorcem (dysponent publikuje go sam w dane.gov.pl).
   Szkic formularza zapisujemy tylko w localStorage tej przeglądarki – nic nie jest wysyłane. */
(function (AED) {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const N = AED.normalizacja;
  const SCHEMA = AED.wzorzec.schema;
  const POLE = {};
  SCHEMA.fields.forEach(function (f) { POLE[f.name] = f; });
  const KLUCZ_SZKICU = 'aed.formularz.szkic.v1';
  const MAKS_DLUGOSC = { nazwa: 150, opis_lokalizacji: 300, opis_lokalizacji_en: 300, instrukcja_dostepu: 300, uwagi: 500 };

  function dwie(n) { return (n < 10 ? '0' : '') + n; }
  function dzis(d) { d = d || new Date(); return d.getFullYear() + '-' + dwie(d.getMonth() + 1) + '-' + dwie(d.getDate()); }
  function teraz(d) { d = d || new Date(); return dzis(d) + 'T' + dwie(d.getHours()) + ':' + dwie(d.getMinutes()) + ':' + dwie(d.getSeconds()); }
  function pusta(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
  function slownik(nazwa) {
    return ((AED.wzorzec.slowniki || {})[nazwa] || []).map(function (s) { return { kod: s.kod, etykieta: s.etykieta, opis: s.opis || '' }; });
  }

  // ------------------------------------------------------------ pola formularza
  // typ: tekst | tekst_dlugi | liczba | wspolrzedna | tak_nie | data | slownik | godziny | telefon | email | kod_pocztowy
  // wymagane: true = formularz nie przejdzie bez wartości; zalecane: warto wypełnić; warunek: kiedy pole staje się wymagane (tekst dla UI)
  const GRUPY = [
    { id: 'miejsce', nazwa: 'Gdzie jest urządzenie', opis: 'Wskaż punkt na mapie albo wyszukaj adres. Opisz, gdzie dokładnie wisi AED.' },
    { id: 'dostep', nazwa: 'Kto i kiedy może z niego skorzystać', opis: 'Najważniejsze dla świadka zdarzenia: czy AED jest dostępny i jak go wyjąć.' },
    { id: 'urzadzenie', nazwa: 'Urządzenie', opis: 'Stan i terminy serwisowe. Pomagają przypominać o wymianie elektrod i baterii.' },
    { id: 'dysponent', nazwa: 'Dysponent i kontakt', opis: 'Instytucja odpowiedzialna za urządzenie. Podaj kontakt służbowy, nie prywatny.' },
    { id: 'weryfikacja', nazwa: 'Sprawdzenie danych', opis: 'Kiedy ostatnio ktoś potwierdził, że urządzenie jest na miejscu.' }
  ];
  function p(grupa, pole, etykieta, typ, pomoc, o) {
    const f = POLE[pole];
    const d = Object.assign({ grupa: grupa, pole: pole, etykieta: etykieta, typ: typ, pomoc: pomoc || '', wymagane: false, zalecane: false,
      warunek: null, przyklad: f && f.aed ? f.aed.przyklad : '' }, o || {});
    if (typ === 'slownik') d.slownik = slownik(f.aed.slownik);
    if (MAKS_DLUGOSC[pole]) d.maks = MAKS_DLUGOSC[pole];
    return d;
  }
  const POLA_FORMULARZA = [
    p('miejsce', 'nazwa', 'Nazwa miejsca', 'tekst', 'Nazwa budynku lub obiektu, np. „Szkoła Podstawowa nr 1 – hol główny”.', { wymagane: true }),
    p('miejsce', 'szerokosc_geograficzna', 'Szerokość geograficzna', 'wspolrzedna', 'Uzupełnia się po wskazaniu punktu na mapie. Stopnie dziesiętne, np. 50.061430.', { wymagane: true }),
    p('miejsce', 'dlugosc_geograficzna', 'Długość geograficzna', 'wspolrzedna', 'Uzupełnia się po wskazaniu punktu na mapie. Stopnie dziesiętne, np. 19.936580.', { wymagane: true }),
    p('miejsce', 'miejscowosc', 'Miejscowość', 'tekst', '', { wymagane: true }),
    p('miejsce', 'cecha_ulicy', 'Rodzaj ulicy', 'slownik', 'ul., al., pl. …', { warunek: 'gdy podano ulicę' }),
    p('miejsce', 'ulica', 'Ulica', 'tekst', 'Sama nazwa, bez „ul.”. W miejscowości bez ulic zostaw puste.', { zalecane: true, warunek: 'gdy miejscowość ma ulice' }),
    p('miejsce', 'numer_budynku', 'Numer budynku', 'tekst', 'np. 5A', { zalecane: true, warunek: 'gdy budynek ma numer' }),
    p('miejsce', 'kod_pocztowy', 'Kod pocztowy', 'kod_pocztowy', 'np. 38-400', { zalecane: true }),
    p('miejsce', 'opis_lokalizacji', 'Gdzie dokładnie wisi AED', 'tekst_dlugi', 'np. „hol główny, na lewo od wejścia, obok portierni”.', { wymagane: true }),
    p('miejsce', 'opis_lokalizacji_en', 'Opis po angielsku', 'tekst_dlugi', 'Dla turystów (nieobowiązkowe).'),
    p('miejsce', 'wewnatrz_budynku', 'Urządzenie jest wewnątrz budynku', 'tak_nie', 'Nie = na zewnątrz, np. w kapsule na ścianie.', { zalecane: true }),
    p('miejsce', 'kondygnacja', 'Piętro', 'liczba', '0 = parter, -1 = piwnica.'),

    p('dostep', 'dostepnosc', 'Kto i kiedy może skorzystać', 'slownik', '', { wymagane: true }),
    p('dostep', 'godziny_dostepnosci', 'Godziny dostępności', 'godziny', 'np. „pn–pt 7:00–17:00” albo „całodobowo”. Zapiszemy je w formacie opening_hours.',
      { warunek: 'gdy dostępność „w godzinach” lub „dla klientów”' }),
    p('dostep', 'sposob_dostepu', 'Zabezpieczenie urządzenia', 'slownik', '', { wymagane: true }),
    p('dostep', 'instrukcja_dostepu', 'Gdzie jest klucz / kto podaje kod', 'tekst_dlugi', 'NIE wpisuj samego kodu do szafki.', { warunek: 'gdy szafka na kod lub na klucz' }),

    p('urzadzenie', 'status', 'Stan urządzenia', 'slownik', '', { wymagane: true }),
    p('urzadzenie', 'typ_urzadzenia', 'Typ urządzenia', 'slownik', ''),
    p('urzadzenie', 'producent', 'Producent', 'tekst', ''),
    p('urzadzenie', 'model', 'Model', 'tekst', ''),
    p('urzadzenie', 'tryb_pediatryczny', 'Są elektrody lub tryb dla dzieci', 'tak_nie', ''),
    p('urzadzenie', 'data_waznosci_elektrod', 'Elektrody ważne do', 'data', '', { zalecane: true }),
    p('urzadzenie', 'data_waznosci_baterii', 'Bateria ważna do', 'data', '', { zalecane: true }),
    p('urzadzenie', 'data_przegladu', 'Data ostatniego przeglądu', 'data', '', { zalecane: true }),

    p('dysponent', 'dysponent_nazwa', 'Nazwa instytucji', 'tekst', 'Pełna nazwa, np. „Urząd Miasta Krosna”.', { wymagane: true }),
    p('dysponent', 'dysponent_typ', 'Rodzaj instytucji', 'slownik', '', { zalecane: true }),
    p('dysponent', 'dysponent_regon', 'REGON', 'tekst', '9 lub 14 cyfr. Nie podawaj dla osoby fizycznej.'),
    p('dysponent', 'telefon_kontaktowy', 'Telefon (portiernia, recepcja)', 'telefon', 'Numer instytucji, nie prywatny.'),
    p('dysponent', 'email_kontaktowy', 'E-mail do zgłaszania zmian', 'email', 'Adres funkcyjny, np. sekretariat@…, nie imienny.'),
    p('dysponent', 'id_lokalne', 'Twój numer urządzenia', 'tekst', 'Numer inwentarzowy lub oznaczenie AED w Twojej instytucji.', { zalecane: true }),

    p('weryfikacja', 'data_weryfikacji', 'Kiedy sprawdzono, że AED jest na miejscu', 'data', '', { wymagane: true }),
    p('weryfikacja', 'sposob_weryfikacji', 'Jak sprawdzono', 'slownik', '', { zalecane: true }),
    p('weryfikacja', 'uwagi', 'Uwagi', 'tekst_dlugi', 'np. „urządzenie w serwisie do 15 grudnia”.')
  ];
  // Pola techniczne: uzupełniane automatycznie, nie pokazujemy ich w formularzu
  const POLA_TECHNICZNE = ['id_aed', 'lokalizacja_przyblizona', 'zrodlo_wspolrzednych', 'kod_terc_gminy', 'wojewodztwo', 'kod_simc', 'kod_ulic',
    'zrodlo_danych', 'zrodlo_id_rekordu', 'licencja_rekordu', 'data_aktualizacji_rekordu'];

  // ------------------------------------------------------------ rekord
  function nowyUuid() {
    if (AED.mapowanie && AED.mapowanie.nowyUuid) return AED.mapowanie.nowyUuid();
    const c = root.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    const b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /**
   * Pusty rekord formularza (wszystkie pola wzorca) z wartościami domyślnymi dla zgłoszenia dysponenta.
   * @param {string|{nazwa?, typ?, regon?, telefon?, email?}} [dysponent] – dane dysponenta wpisywane do każdego rekordu
   * @param {{teraz?:Date}} [opcje] – zrodlo_wspolrzednych zostaje null do chwili ustawienia punktu (ustawPunkt)
   */
  function pusty(dysponent, opcje) {
    opcje = opcje || {};
    const d = opcje.teraz || new Date();
    const r = {};
    SCHEMA.fields.forEach(function (f) { r[f.name] = null; });
    r.id_aed = nowyUuid();
    r.status = 'aktywny';
    r.lokalizacja_przyblizona = false;
    r.zrodlo_wspolrzednych = null;   // ustawia je ustawPunkt (mapa / GPS / adres)
    r.sposob_dostepu = null;
    r.sposob_weryfikacji = 'potwierdzenie_dysponenta';
    r.data_weryfikacji = dzis(d);
    r.data_aktualizacji_rekordu = teraz(d);
    r.licencja_rekordu = 'CC0-1.0';
    r.zrodlo_danych = 'FORMULARZ';   // kod z rejestru źródeł wzorca; po dodaniu do zbioru – kod nadanego źródła (np. FORMULARZ-01)
    const dys = typeof dysponent === 'string' ? { nazwa: dysponent } : (dysponent || {});
    if (!pusta(dys.nazwa)) r.dysponent_nazwa = String(dys.nazwa).trim();
    if (!pusta(dys.typ)) r.dysponent_typ = dys.typ;
    if (!pusta(dys.regon)) r.dysponent_regon = String(dys.regon).replace(/[\s-]/g, '');
    if (!pusta(dys.telefon)) r.telefon_kontaktowy = N.telefon(dys.telefon) || String(dys.telefon);
    if (!pusta(dys.email)) r.email_kontaktowy = N.email(dys.email) || String(dys.email);
    if (r.dysponent_nazwa && !r.dysponent_typ) {
      const t = N.slownik('dysponent_typ', r.dysponent_nazwa);
      if (t.wartosc && t.pewnosc !== 'niska') r.dysponent_typ = t.wartosc;
    }
    return r;
  }

  /**
   * Ustawia punkt rekordu i pola z nim związane. skad: 'mapa' (domyślnie) | 'gps' | 'adres' (geokodowanie – lokalizacja przybliżona).
   * Zwraca ten sam rekord (zmieniony).
   */
  function ustawPunkt(r, lat, lon, skad) {
    r.szerokosc_geograficzna = typeof lat === 'number' ? Math.round(lat * 1e6) / 1e6 : null;
    r.dlugosc_geograficzna = typeof lon === 'number' ? Math.round(lon * 1e6) / 1e6 : null;
    r.zrodlo_wspolrzednych = skad === 'gps' ? 'pomiar_gps' : skad === 'adres' ? 'geokodowanie_adresu' : 'wskazanie_na_mapie';
    r.lokalizacja_przyblizona = skad === 'adres';
    r.data_aktualizacji_rekordu = teraz();
    return r;
  }

  /**
   * Uzupełnia adres rekordu wynikiem AED.geokoder (szukaj / odwrotne). Pola już wpisane przez użytkownika nadpisuje tylko z opcją nadpisz.
   * Gdy opcje.punkt (domyślnie true dla wyniku szukaj z dokładnością „adres”), ustawia też współrzędne jako geokodowanie adresu.
   */
  function zGeokodera(r, w, opcje) {
    if (!w) return r;
    opcje = opcje || {};
    const nad = !!opcje.nadpisz;
    // nadpisz + wynik z adresem (adres / ulica / miejscowość): pola, których wynik nie ma, są czyszczone – inaczej zostałaby
    // np. ulica i kod pocztowy poprzedniego adresu przy wybraniu samej miejscowości. Wynik „gmina” (odwrotne bez adresu) niczego nie czyści.
    const zastap = nad && ['adres', 'ulica', 'miejscowosc'].indexOf(w.dokladnosc) >= 0;
    const ustaw = function (pole, v) {
      const jest = v !== null && v !== undefined && v !== '';
      if (jest && (nad || pusta(r[pole]))) r[pole] = v;
      else if (!jest && zastap) r[pole] = null;
    };
    ustaw('miejscowosc', w.miejscowosc);
    ustaw('cecha_ulicy', w.ulica ? w.cecha_ulicy : null);
    ustaw('ulica', w.ulica);
    ustaw('numer_budynku', w.numer);
    ustaw('kod_pocztowy', w.kod_pocztowy);
    ustaw('kod_terc_gminy', w.kod_terc_gminy);
    ustaw('wojewodztwo', w.wojewodztwo);
    ustaw('kod_simc', w.kod_simc);
    ustaw('kod_ulic', w.ulica ? w.kod_ulic : null);
    const punkt = opcje.punkt !== undefined ? opcje.punkt : w.dokladnosc === 'adres' && w.adres_lat === undefined;
    if (punkt && typeof w.lat === 'number') ustawPunkt(r, w.lat, w.lon, 'adres');
    return r;
  }

  // ------------------------------------------------------------ normalizacja wpisu
  /**
   * Tekst wpisany w pole formularza -> wartość w formacie wzorca.
   * @returns {{wartosc:*, problem?:string}} wartosc = null dla pustego pola; problem – komunikat dla użytkownika (wartość nierozpoznana)
   */
  function normalizujWpis(pole, tekst) {
    const f = POLE[pole];
    if (!f) return { wartosc: null, problem: 'Nieznane pole „' + pole + '”.' };
    if (typeof tekst === 'boolean' || typeof tekst === 'number') tekst = String(tekst);
    const t = N.tekst(tekst);
    if (!t) return { wartosc: null };
    const tytul = '„' + f.title + '”';
    const sl = f.aed && f.aed.slownik;
    if (sl) {
      const s = N.slownik(sl, t);
      if (s.wartosc === null) return { wartosc: t, problem: 'Nie rozpoznano wartości „' + t + '” w polu ' + tytul + '. Wybierz jedną z listy.' };
      return { wartosc: s.wartosc };
    }
    if (pole === 'szerokosc_geograficzna' || pole === 'dlugosc_geograficzna') {
      const s = N.stopnie(t);
      if (!s) return { wartosc: t, problem: 'Wpisz ' + (pole === 'szerokosc_geograficzna' ? 'szerokość' : 'długość') + ' w stopniach dziesiętnych, np. ' + f.aed.przyklad + '.' };
      return { wartosc: Math.round(s.wartosc * 1e6) / 1e6 };
    }
    if (pole === 'kod_pocztowy') { const k = N.kodPocztowy(t); return k ? { wartosc: k } : { wartosc: t, problem: 'Kod pocztowy ma postać 00-000.' }; }
    if (pole === 'telefon_kontaktowy') { const k = N.telefon(t); return k ? { wartosc: k } : { wartosc: t, problem: 'Wpisz 9 cyfr numeru (opcjonalnie z +48).' }; }
    if (pole === 'email_kontaktowy') { const k = N.email(t); return k ? { wartosc: k } : { wartosc: t, problem: 'To nie wygląda na adres e-mail.' }; }
    if (pole === 'godziny_dostepnosci') {
      const g = N.godziny(t);
      return g ? { wartosc: g } : { wartosc: t, problem: 'Nie udało się odczytać godzin. Wpisz np. „pn–pt 7:00–17:00; sob 8:00–14:00” albo „całodobowo”.' };
    }
    if (pole === 'dysponent_regon') {
      const c = t.replace(/[\s-]/g, '');
      return /^(\d{9}|\d{14})$/.test(c) ? { wartosc: c } : { wartosc: t, problem: 'REGON ma 9 lub 14 cyfr.' };
    }
    if (pole === 'kod_terc_gminy' || pole === 'kod_simc') {
      const c = t.replace(/[\s-]/g, '');
      return /^\d{7}$/.test(c) ? { wartosc: c } : /^\d{6}$/.test(c) ? { wartosc: '0' + c } : { wartosc: t, problem: tytul + ' ma 7 cyfr.' };
    }
    if (pole === 'kod_ulic') { const c = t.replace(/\s/g, ''); return /^\d{5}$/.test(c) ? { wartosc: c } : { wartosc: t, problem: tytul + ' ma 5 cyfr.' }; }
    if (pole === 'id_aed') {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t) ? { wartosc: t.toLowerCase() } : { wartosc: t, problem: 'Identyfikator AED musi być UUID.' };
    }
    if (f.type === 'integer') { const k = N.kondygnacja(t); return k !== null ? { wartosc: k } : { wartosc: t, problem: 'Wpisz numer piętra, np. 0 (parter), 1, -1.' }; }
    if (f.type === 'number') { const k = N.liczba(t); return k !== null ? { wartosc: k } : { wartosc: t, problem: tytul + ' musi być liczbą.' }; }
    if (f.type === 'boolean') { const b = N.bool(t); return b !== null ? { wartosc: b } : { wartosc: t, problem: 'Wybierz „tak” albo „nie”.' }; }
    if (f.type === 'date') { const d = N.data(t); return d ? { wartosc: d } : { wartosc: t, problem: 'Wpisz datę, np. 2026-11-21 albo 21.11.2026.' }; }
    if (f.type === 'datetime') { const d = N.dataCzas(t); return d ? { wartosc: d } : { wartosc: t, problem: 'Wpisz datę i godzinę, np. 2026-11-21T10:00:00.' }; }
    if (pole === 'ulica') {
      // „ul. Lwowska” -> ulica bez cechy; cechę zwracamy osobno, by UI mogło ją ustawić
      const c = N.rozdzielCeche ? N.rozdzielCeche(t) : null;
      if (c && c.cecha && c.cecha !== 'inne' && c.nazwa) return { wartosc: c.nazwa, cecha_ulicy: c.cecha };
    }
    if (MAKS_DLUGOSC[pole] && t.length > MAKS_DLUGOSC[pole]) return { wartosc: t, problem: tytul + ' może mieć najwyżej ' + MAKS_DLUGOSC[pole] + ' znaków (jest ' + t.length + ').' };
    return { wartosc: t };
  }

  // ------------------------------------------------------------ walidacja
  /**
   * Problemy rekordu formularza: reguły wzorca (AED.walidacja.walidujRekord) + pola wymagane w formularzu.
   * Rekord nie musi mieć pól technicznych (_id itp.). @returns {Object[]} Problem jak w AED.walidacja (pole, poziom, kod, komunikat, podpowiedz?)
   */
  function waliduj(rekord, opcje) {
    const r = Object.assign({ _id: 'formularz:' + (rekord && rekord.id_aed || '?'), _kodZrodla: 'FORMULARZ' }, rekord || {});
    const lista = AED.walidacja.walidujRekord(r, opcje);
    const juz = {};
    lista.forEach(function (x) { if (x.kod === 'WYMAGANE') juz[x.pole] = true; });
    POLA_FORMULARZA.forEach(function (f) {
      if (!f.wymagane || juz[f.pole] || !pusta(r[f.pole])) return;
      lista.push({ id: r._id + ':' + f.pole + ':WYMAGANE', rekordId: r._id, kodZrodla: r._kodZrodla, wiersz: r._wiersz, pole: f.pole,
        poziom: 'blad', kod: 'WYMAGANE', komunikat: 'Uzupełnij pole „' + f.etykieta + '”.', wartosc: null });
    });
    return lista;
  }
  /** Czy rekord można dodać (brak błędów)? */
  function gotowy(rekord, opcje) { return !waliduj(rekord, opcje).some(function (x) { return x.poziom === 'blad'; }); }

  // ------------------------------------------------------------ zbiór i CSV
  function tekstPola(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return isFinite(v) ? String(v) : '';
    return String(v);
  }
  /** Kopia rekordu bez pól technicznych (zaczynających się od „_”), z kompletem pól wzorca. */
  function czysty(r) {
    const o = {};
    SCHEMA.fields.forEach(function (f) { o[f.name] = r[f.name] === undefined ? null : r[f.name]; });
    return o;
  }

  /**
   * Dodaje rekordy formularza do zbioru jako nowe źródło typu 'FORMULARZ' (kolumny = pola wzorca, wiersze tekstowe).
   * Mapowanie jest rozpoznawane automatycznie 1:1 (AED.mapowanie.podpowiedz). Po dodaniu wywołaj AED.store.przelicz().
   * @param {Object[]} rekordy
   * @param {{dysponent?:string, licencja?:'CC0-1.0'|'CC-BY-4.0', nazwa?:string}} [opcje] – licencja nadpisuje licencja_rekordu każdego rekordu
   * @returns {Object} źródło (AED.store.zrodlo)
   */
  function dodajDoZbioru(rekordy, opcje) {
    opcje = opcje || {};
    const lista = (rekordy || []).map(czysty);
    if (!lista.length) throw new Error('Formularz nie zawiera żadnego urządzenia.');
    const licencja = opcje.licencja || lista[0].licencja_rekordu || 'CC0-1.0';
    const dozwolone = slownik('licencja_rekordu').map(function (s) { return s.kod; });
    if (dozwolone.indexOf(licencja) < 0) throw new Error('Licencja „' + licencja + '” nie należy do licencji wzorca (' + dozwolone.join(', ') + ').');
    const dysponent = opcje.dysponent || lista[0].dysponent_nazwa || '';
    const kolumny = SCHEMA.fields.map(function (f) { return f.name; });
    const kod = AED.store.przewidzKod('FORMULARZ');   // kod nadawany przez store – trafia do kolumny zrodlo_danych
    const t = teraz();
    const wiersze = lista.map(function (r) {
      const w = {};
      kolumny.forEach(function (k) { w[k] = tekstPola(r[k]); });
      w.zrodlo_danych = kod;
      w.licencja_rekordu = licencja;
      if (!w.dysponent_nazwa && dysponent) w.dysponent_nazwa = dysponent;
      if (!w.data_aktualizacji_rekordu) w.data_aktualizacji_rekordu = t;   // datę ustawioną przez UI zostawiamy
      return w;
    });
    // jedno zdarzenie 'zrodla:zmiana' – źródło od razu z wierszami
    return AED.store.dodajZrodlo({
      typ: 'FORMULARZ',
      kod: kod,
      nazwa: opcje.nazwa || ('Formularz dysponenta' + (dysponent ? ' – ' + dysponent : '')),
      dysponent: dysponent,
      licencja: licencja,
      kolumny: kolumny,
      wiersze: wiersze,
      meta: { formularz: true, format: 'formularz dysponenta', dataDanych: t, liczbaUrzadzen: lista.length }
    });
  }

  /**
   * CSV zgodny ze wzorcem (AED.eksport.csv: UTF-8, przecinek, CRLF, nagłówek = nazwy pól) – dla dysponenta, który sam publikuje dane.
   * @param {Object[]} rekordy
   * @param {Object} [opcje] – jak w AED.eksport.csv (np. { bom: true } dla Excela)
   */
  function csv(rekordy, opcje) {
    const t = teraz();
    return AED.eksport.csv((rekordy || []).map(function (r) {
      const x = czysty(r);
      if (pusta(x.data_aktualizacji_rekordu)) x.data_aktualizacji_rekordu = t;   // datę ustawioną przez UI zostawiamy
      return x;
    }), opcje);
  }

  // ------------------------------------------------------------ szkic (localStorage)
  function magazyn() { try { return root.localStorage || null; } catch (e) { return null; } }
  /** Zapisuje listę rekordów (i opcjonalnie stan interfejsu – dowolny obiekt JSON, np. dysponent, licencja, otwarty edytor)
      w localStorage tej przeglądarki, w jednym wpisie (zapis atomowy). @returns {boolean} czy się udało */
  function zapiszSzkic(lista, stan) {
    const m = magazyn();
    if (!m) return false;
    try {
      const d = { wersja: 1, zapisano: teraz(), rekordy: (lista || []).map(czysty) };
      if (stan !== undefined && stan !== null) d.stan = JSON.parse(JSON.stringify(stan));
      m.setItem(KLUCZ_SZKICU, JSON.stringify(d));
      return true;
    } catch (e) { return false; }
  }
  /** Odczytuje szkic: lista rekordów ([] gdy brak lub błąd). */
  function wczytajSzkic() {
    const m = magazyn();
    if (!m) return [];
    try {
      const d = JSON.parse(m.getItem(KLUCZ_SZKICU) || 'null');
      if (!d || !Array.isArray(d.rekordy)) return [];
      return d.rekordy.filter(function (r) { return r && typeof r === 'object'; }).map(czysty);
    } catch (e) { return []; }
  }
  /** Stan interfejsu zapisany razem ze szkicem (drugi argument zapiszSzkic) albo null. */
  function wczytajStanSzkicu() {
    const m = magazyn();
    if (!m) return null;
    try {
      const d = JSON.parse(m.getItem(KLUCZ_SZKICU) || 'null');
      return d && d.stan && typeof d.stan === 'object' ? d.stan : null;
    } catch (e) { return null; }
  }
  /** Usuwa szkic. @returns {boolean} */
  function usunSzkic() {
    const m = magazyn();
    if (!m) return false;
    try { m.removeItem(KLUCZ_SZKICU); return true; } catch (e) { return false; }
  }

  AED.formularz = {
    GRUPY: GRUPY,
    POLA_FORMULARZA: POLA_FORMULARZA,
    POLA_TECHNICZNE: POLA_TECHNICZNE,
    KLUCZ_SZKICU: KLUCZ_SZKICU,
    pusty: pusty,
    ustawPunkt: ustawPunkt,
    zGeokodera: zGeokodera,
    normalizujWpis: normalizujWpis,
    waliduj: waliduj,
    gotowy: gotowy,
    dodajDoZbioru: dodajDoZbioru,
    csv: csv,
    zapiszSzkic: zapiszSzkic,
    wczytajSzkic: wczytajSzkic,
    wczytajStanSzkicu: wczytajStanSzkicu,
    usunSzkic: usunSzkic
  };
})(window.AED);
