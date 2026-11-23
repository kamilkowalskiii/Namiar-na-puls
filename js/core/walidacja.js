/* Walidacja rekordów względem wzorca (constraints ze schematu + reguły warunkowe i spójności).
   Problem = { id, rekordId, kodZrodla, wiersz, pole, poziom: 'blad'|'ostrzezenie', kod, komunikat, wartosc, podpowiedz? }
   Kody: WYMAGANE, TYP, SLOWNIK, WZORZEC, ZAKRES, DLUGOSC, UNIKALNY, NIESPOJNY, PODEJRZANY.
   Komunikaty po polsku: co jest nie tak i jak to poprawić. */
(function (AED) {
  'use strict';

  const N = AED.normalizacja;
  const POLA = AED.wzorzec.schema.fields;
  const POLE = {};
  POLA.forEach(function (f) { POLE[f.name] = f; });
  const SLOWNIKI = AED.wzorzec.slowniki;
  // wyrażenia regularne ze schematu – kompilowane raz
  const WZORCE = {};
  POLA.forEach(function (f) { if (f.constraints && f.constraints.pattern) WZORCE[f.name] = new RegExp(f.constraints.pattern); });
  // ciąg 4–8 cyfr do 20 znaków od słowa kod / szyfr / PIN / hasło
  const RE_KOD_SZAFKI = /\b(kod\w*|szyfr\w*|pin|has[łl]o)\b[^\d]{0,20}\d{4,8}(?!\d)/i;
  const RE_KOD_SZAFKI_G = /\b(kod\w*|szyfr\w*|pin|has[łl]o)\b[^\d]{0,20}\d{4,8}(?!\d)/gi;

  const KODY = ['WYMAGANE', 'TYP', 'SLOWNIK', 'WZORZEC', 'ZAKRES', 'DLUGOSC', 'UNIKALNY', 'NIESPOJNY', 'PODEJRZANY'];
  const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
  const RE_DATACZAS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  const OGOLNE_NAZWY = /^(defibrylator|aed|defibrylator aed|aed defibrylator|automatyczny defibrylator zewnetrzny|defibrillator)( nr)?( \d+)?$/;

  let dzisOpcja = null;
  function dzis() {
    return dzisOpcja || new Date().toISOString().slice(0, 10);
  }
  function minusLata(d, lata) { return (Number(d.slice(0, 4)) - lata) + d.slice(4); }

  function pusta(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
  function t(pole) { return '„' + (POLE[pole] ? POLE[pole].title : pole) + '”'; }
  function pokaz(v) { return typeof v === 'string' ? '„' + (v.length > 60 ? v.slice(0, 57) + '…' : v) + '”' : String(v); }
  function etykiety(slownik) {
    return (SLOWNIKI[slownik] || []).map(function (p) { return p.kod; }).join(', ');
  }
  function poprawnaData(s) {
    if (!RE_DATA.test(s)) return false;
    const r = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(r, m, 0)).getUTCDate();
  }

  /** Problemy jednego rekordu (bez reguł wymagających całego zbioru, np. unikalności). */
  function walidujRekord(r) {
    const lista = [];
    const dodaj = function (pole, poziom, kod, komunikat, podpowiedz) {
      const p = { id: r._id + ':' + pole + ':' + kod, rekordId: r._id, kodZrodla: r._kodZrodla, wiersz: r._wiersz, pole: pole,
        poziom: poziom, kod: kod, komunikat: komunikat, wartosc: r[pole] === undefined ? null : r[pole] };
      if (podpowiedz !== undefined && podpowiedz !== null) p.podpowiedz = podpowiedz;
      lista.push(p);
    };

    for (let i = 0; i < POLA.length; i++) {
      const f = POLA[i], pole = f.name, v = r[pole], c = f.constraints || {};
      if (pusta(v)) {
        if (c.required) dodaj(pole, 'blad', 'WYMAGANE', 'Brak wartości w obowiązkowym polu ' + t(pole) + '. ' + jakUzupelnic(pole, r), podpowiedzWymagane(pole, r));
        continue;
      }
      // typ
      if (f.type === 'number' && (typeof v !== 'number' || !isFinite(v))) {
        const n = N.liczba(v);
        dodaj(pole, 'blad', 'TYP', 'Pole ' + t(pole) + ' musi być liczbą (stopnie dziesiętne z kropką, np. ' + f.aed.przyklad + '), jest ' + pokaz(v) + '.', n === null ? undefined : n);
        continue;
      }
      if (f.type === 'integer' && !(typeof v === 'number' && Number.isInteger(v))) {
        dodaj(pole, 'blad', 'TYP', 'Pole ' + t(pole) + ' musi być liczbą całkowitą (0 = parter, -1 = piwnica), jest ' + pokaz(v) + '.', N.kondygnacja(v));
        continue;
      }
      if (f.type === 'boolean' && typeof v !== 'boolean') {
        dodaj(pole, 'blad', 'TYP', 'Pole ' + t(pole) + ' przyjmuje tylko „tak” lub „nie” (true/false), jest ' + pokaz(v) + '.', N.bool(v));
        continue;
      }
      if (f.type === 'date' && !(typeof v === 'string' && poprawnaData(v))) {
        dodaj(pole, 'blad', 'TYP', 'Pole ' + t(pole) + ' musi być datą w formacie RRRR-MM-DD (np. ' + f.aed.przyklad + '), jest ' + pokaz(v) + '.', N.data(v));
        continue;
      }
      if (f.type === 'datetime' && !(typeof v === 'string' && RE_DATACZAS.test(v) && poprawnaData(v.slice(0, 10)))) {
        dodaj(pole, 'blad', 'TYP', 'Pole ' + t(pole) + ' musi mieć format RRRR-MM-DDThh:mm:ss (np. ' + f.aed.przyklad + '), jest ' + pokaz(v) + '.', N.dataCzas(v));
        continue;
      }
      if (f.type === 'string' && typeof v !== 'string') {
        dodaj(pole, 'blad', 'TYP', 'Pole ' + t(pole) + ' powinno być tekstem, jest ' + pokaz(v) + '.', String(v));
        continue;
      }
      // słownik
      if (c.enum && c.enum.indexOf(v) < 0) {
        const s = f.aed.slownik ? N.slownik(f.aed.slownik, v) : { wartosc: null };
        dodaj(pole, 'blad', 'SLOWNIK', 'Wartość ' + pokaz(v) + ' nie występuje w słowniku pola ' + t(pole) + '. Dozwolone: ' +
          (f.aed.slownik ? etykiety(f.aed.slownik) : c.enum.join(', ')) + '.', s.wartosc);
      }
      // wzorzec
      if (c.pattern && typeof v === 'string' && !WZORCE[pole].test(v)) {
        dodaj(pole, 'blad', 'WZORZEC', 'Wartość ' + pokaz(v) + ' w polu ' + t(pole) + ' ma zły format. Oczekiwano: ' + f.aed.format +
          ' (np. ' + f.aed.przyklad + ').', podpowiedzWzorca(pole, v));
      }
      // zakres
      if (typeof v === 'number' && ((c.minimum !== undefined && v < c.minimum) || (c.maximum !== undefined && v > c.maximum))) {
        let podp, kom = 'Wartość ' + v + ' w polu ' + t(pole) + ' jest poza zakresem ' + c.minimum + '–' + c.maximum + '.';
        if (pole === 'szerokosc_geograficzna' || pole === 'dlugosc_geograficzna') {
          const inne = pole === 'szerokosc_geograficzna' ? r.dlugosc_geograficzna : r.szerokosc_geograficzna;
          const dr = POLE[pole === 'szerokosc_geograficzna' ? 'dlugosc_geograficzna' : 'szerokosc_geograficzna'].constraints;
          if (typeof inne === 'number' && inne >= c.minimum && inne <= c.maximum && v >= dr.minimum && v <= dr.maximum) {
            // zamiana = jeden problem na rekord (na szerokości), podpowiedź zmienia oba pola naraz
            if (pole === 'dlugosc_geograficzna') continue;
            kom = 'Szerokość (' + v + ') i długość (' + inne + ') geograficzna są zamienione miejscami – zamień je.';
            podp = { wartosc: inne, zmiany: { szerokosc_geograficzna: inne, dlugosc_geograficzna: v }, opis: 'Zamień szerokość z długością' };
          } else kom += ' Punkt leży poza Polską – sprawdź, czy to stopnie dziesiętne WGS84.';
        }
        dodaj(pole, 'blad', 'ZAKRES', kom, podp);
      }
      // długość
      if (c.maxLength && typeof v === 'string' && v.length > c.maxLength) {
        dodaj(pole, 'blad', 'DLUGOSC', 'Pole ' + t(pole) + ' ma ' + v.length + ' znaków, a dozwolone jest ' + c.maxLength + '. Skróć tekst.',
          v.slice(0, c.maxLength - 1).replace(/\s+\S*$/, '') + '…');
      }
    }

    regulyWarunkowe(r, dodaj);
    regulySpojnosci(r, dodaj);
    return lista;
  }

  function jakUzupelnic(pole, r) {
    if (pole === 'licencja_rekordu') return 'Wskaż licencję źródła w rejestrze źródeł.';
    if (pole === 'szerokosc_geograficzna' || pole === 'dlugosc_geograficzna') return 'Bez współrzędnych punkt nie pojawi się na mapie – uzupełnij je (np. odczytaj z mapy).';
    if (pole === 'dostepnosc') return 'Określ, kto i kiedy może skorzystać z urządzenia (np. „publiczna 24/7”).';
    if (pole === 'opis_lokalizacji') return 'Opisz, gdzie dokładnie wisi urządzenie (np. „hol główny, przy portierni”).';
    if (pole === 'data_weryfikacji') return 'Wpisz datę, kiedy ostatnio sprawdzono, że urządzenie jest na miejscu.';
    if (pole === 'nazwa') return 'Wpisz nazwę miejsca (np. „Szkoła Podstawowa nr 1 – hol”).';
    return 'Wybierz kolumnę w mapowaniu, wpisz wartość stałą albo popraw rekord.';
  }
  function podpowiedzWymagane(pole, r) {
    if (pole === 'sposob_dostepu') return 'nieznany';
    if (pole === 'status') return 'aktywny';
    if (pole === 'lokalizacja_przyblizona') return false;
    if (pole === 'dostepnosc' && r.godziny_dostepnosci) return r.godziny_dostepnosci === '24/7' ? 'publiczna_24_7' : 'publiczna_w_godzinach';
    if (pole === 'nazwa' && typeof r.opis_lokalizacji === 'string' && r.opis_lokalizacji) return r.opis_lokalizacji.slice(0, 150);
    return undefined;
  }
  function podpowiedzWzorca(pole, v) {
    let p = null;
    if (pole === 'kod_pocztowy') p = N.kodPocztowy(v);
    else if (pole === 'telefon_kontaktowy') p = N.telefon(v);
    else if (pole === 'email_kontaktowy') p = N.email(v);
    else if (pole === 'id_aed') p = /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null;
    else if (pole === 'kod_terc_gminy' || pole === 'kod_simc') p = /^\d{6}$/.test(v) ? '0' + v : null;
    else if (pole === 'dysponent_regon') { const c = v.replace(/[\s-]/g, ''); p = /^(\d{9}|\d{14})$/.test(c) ? c : null; }
    return p && p !== v && WZORCE[pole].test(p) ? p : undefined;
  }

  // ------------------------------------------------ obowiązkowość warunkowa (W)
  function regulyWarunkowe(r, dodaj) {
    if (!pusta(r.ulica) && pusta(r.cecha_ulicy)) {
      const inne = /^(rynek|park|szosa|droga|trakt|wybrzeże|wyspa|ogród|ogrody|zaułek|pasaż|ścieżka|wał)\b/i.test(String(r.ulica).trim());
      dodaj('cecha_ulicy', 'ostrzezenie', 'WYMAGANE', 'Podano ulicę ' + pokaz(r.ulica) + ', ale brak cechy ulicy (ul., al., pl. …). Uzupełnij zgodnie z TERYT ULIC' +
        (inne ? ' – dla nazw typu „Rynek”, „Park …” w TERYT jest osobna cecha, we wzorcu „inne”.' : '.'), inne ? 'inne' : 'ul.');
    }
    if (!pusta(r.numer_budynku) && pusta(r.ulica)) {
      dodaj('ulica', 'ostrzezenie', 'WYMAGANE', 'Podano numer budynku ' + pokaz(r.numer_budynku) + ' bez nazwy ulicy. Jeśli ' +
        (pusta(r.miejscowosc) ? 'miejscowość' : pokaz(r.miejscowosc)) + ' ma ulice – wpisz ulicę; jeśli to wieś bez ulic, zostaw puste.');
    }
    if (!pusta(r.ulica) && pusta(r.numer_budynku)) {
      dodaj('numer_budynku', 'ostrzezenie', 'WYMAGANE', 'Podano ulicę ' + pokaz(r.ulica) + ' bez numeru budynku. Uzupełnij numer – ułatwi to dojazd i odnalezienie urządzenia.');
    }
    if (r.dostepnosc === 'publiczna_w_godzinach' && pusta(r.godziny_dostepnosci)) {
      dodaj('godziny_dostepnosci', 'blad', 'WYMAGANE', 'Dostępność „publiczna w godzinach” wymaga podania godzin (np. Mo-Fr 07:00-17:00).');
    }
    if (pusta(r.instrukcja_dostepu) && (r.sposob_dostepu === 'szafka_na_kod' || r.sposob_dostepu === 'szafka_na_klucz' || r.sposob_dostepu === 'u_personelu')) {
      dodaj('instrukcja_dostepu', 'ostrzezenie', 'WYMAGANE', 'Urządzenie jest zamknięte (' + r.sposob_dostepu.replace(/_/g, ' ') +
        ') – opisz, kto wydaje klucz lub podaje kod (bez publikowania samego kodu).');
    }
  }

  // ------------------------------------------------ spójność i wartości podejrzane
  function regulySpojnosci(r, dodaj) {
    const d = dzis();
    // godziny – składnia opening_hours
    if (typeof r.godziny_dostepnosci === 'string' && r.godziny_dostepnosci && !N.poprawneGodziny(r.godziny_dostepnosci)) {
      dodaj('godziny_dostepnosci', 'ostrzezenie', 'WZORZEC', 'Godziny ' + pokaz(r.godziny_dostepnosci) +
        ' nie są w formacie opening_hours (np. „Mo-Fr 07:00-17:00; Sa 08:00-14:00” lub „24/7”).', N.godziny(r.godziny_dostepnosci) || undefined);
    }
    if (r.dostepnosc === 'publiczna_24_7' && typeof r.godziny_dostepnosci === 'string' && r.godziny_dostepnosci && r.godziny_dostepnosci !== '24/7') {
      dodaj('godziny_dostepnosci', 'ostrzezenie', 'NIESPOJNY', 'Dostępność „publiczna 24/7”, ale godziny to ' + pokaz(r.godziny_dostepnosci) + '. Popraw godziny albo dostępność.', '24/7');
    }
    // przybliżona lokalizacja a źródło współrzędnych
    if (r.lokalizacja_przyblizona === false && r.zrodlo_wspolrzednych === 'geokodowanie_adresu') {
      dodaj('lokalizacja_przyblizona', 'ostrzezenie', 'NIESPOJNY', 'Współrzędne z geokodowania adresu wskazują budynek, a nie miejsce urządzenia – ustaw „lokalizacja przybliżona” na tak.', true);
    }
    if (r.lokalizacja_przyblizona === true && r.zrodlo_wspolrzednych === 'pomiar_gps') {
      dodaj('lokalizacja_przyblizona', 'ostrzezenie', 'NIESPOJNY', 'Współrzędne z pomiaru GPS' +
        ' zwykle wskazują miejsce urządzenia, a rekord ma „lokalizacja przybliżona” = tak. Sprawdź.', false);
    }
    // województwo a kod TERC
    if (typeof r.kod_terc_gminy === 'string' && /^\d{7}$/.test(r.kod_terc_gminy) && typeof r.wojewodztwo === 'string' && N.kodWojewodztwa(r.wojewodztwo)) {
      const wt = N.wojewodztwo(r.kod_terc_gminy.slice(0, 2));
      if (wt && wt !== r.wojewodztwo) {
        dodaj('wojewodztwo', 'ostrzezenie', 'NIESPOJNY', 'Kod TERC gminy ' + r.kod_terc_gminy + ' należy do województwa ' + wt + ', a w rekordzie jest ' + r.wojewodztwo + '. Sprawdź oba pola.', wt);
      }
    }
    // daty
    ['data_waznosci_elektrod', 'data_waznosci_baterii'].forEach(function (p) {
      if (typeof r[p] === 'string' && poprawnaData(r[p]) && r[p] < d) {
        dodaj(p, 'ostrzezenie', 'ZAKRES', 'Termin ' + (p === 'data_waznosci_elektrod' ? 'ważności elektrod' : 'ważności baterii') + ' minął (' + r[p] +
          '). Wymień ' + (p === 'data_waznosci_elektrod' ? 'elektrody' : 'baterię') + ' i wpisz nową datę.');
      }
    });
    ['data_przegladu', 'data_weryfikacji'].forEach(function (p) {
      if (typeof r[p] === 'string' && poprawnaData(r[p]) && r[p] > d) {
        // bez podpowiedzi „dzisiaj” – prawdziwej daty nie znamy (może to zamienione dzień z miesiącem)
        dodaj(p, 'blad', 'ZAKRES', 'Data ' + r[p] + ' w polu ' + t(p) + ' jest w przyszłości. Wpisz datę, która już minęła (sprawdź, czy nie zamieniono dnia z miesiącem).');
      }
    });
    if (typeof r.data_weryfikacji === 'string' && poprawnaData(r.data_weryfikacji) && r.data_weryfikacji < minusLata(d, 2)) {
      dodaj('data_weryfikacji', 'ostrzezenie', 'ZAKRES', 'Ostatnia weryfikacja (' + r.data_weryfikacji + ') była ponad 2 lata temu. Sprawdź, czy urządzenie nadal jest na miejscu.');
    }
    // współrzędne – precyzja i 0,0
    if (typeof r.szerokosc_geograficzna === 'number' && typeof r.dlugosc_geograficzna === 'number') {
      // precyzja z tekstu źródła (_precyzja z mapowania), bo liczba gubi zera na końcu („52.100000” -> 52.1)
      const m = typeof r._precyzja === 'number' ? r._precyzja
        : Math.min(N.miejscaPoPrzecinku(r.szerokosc_geograficzna), N.miejscaPoPrzecinku(r.dlugosc_geograficzna));
      if (m < 4) {
        dodaj('szerokosc_geograficzna', 'ostrzezenie', 'PODEJRZANY', 'Współrzędne mają tylko ' + m + ' miejsc' + (m === 1 ? 'e' : m >= 2 ? 'a' : '') +
          ' po przecinku – dokładność gorsza niż ok. 10 m (przy 2 miejscach ok. 1 km). Podaj 6 miejsc po przecinku.');
      }
    }
    // nazwa ogólna („Defibrylator”)
    if (typeof r.nazwa === 'string' && OGOLNE_NAZWY.test(N.klucz(r.nazwa))) {
      dodaj('nazwa', 'ostrzezenie', 'PODEJRZANY', 'Nazwa ' + pokaz(r.nazwa) + ' nie mówi, gdzie jest urządzenie. Wpisz nazwę miejsca (np. szkoły, urzędu).',
        typeof r.opis_lokalizacji === 'string' && r.opis_lokalizacji ? r.opis_lokalizacji.slice(0, 150) : undefined);
    }
    // kod do szafki w instrukcji – tylko ciąg cyfr w pobliżu słów kod / szyfr / PIN / hasło
    if (typeof r.instrukcja_dostepu === 'string' && RE_KOD_SZAFKI.test(r.instrukcja_dostepu)) {
      dodaj('instrukcja_dostepu', 'ostrzezenie', 'PODEJRZANY', 'Instrukcja dostępu wygląda, jakby zawierała kod do szafki. Kodu nie publikuje się – opisz, kto go podaje (np. „kod u portiera”).',
        r.instrukcja_dostepu.replace(RE_KOD_SZAFKI_G, function (m, slowo) { return slowo + ' [u dysponenta]'; }));
    }
    // opis lokalizacji identyczny z nazwą
    if (typeof r.opis_lokalizacji === 'string' && typeof r.nazwa === 'string' && r.opis_lokalizacji && N.klucz(r.opis_lokalizacji) === N.klucz(r.nazwa)) {
      dodaj('opis_lokalizacji', 'ostrzezenie', 'PODEJRZANY', 'Opis dojścia jest taki sam jak nazwa miejsca. Opisz, gdzie dokładnie w budynku wisi urządzenie.');
    }
  }

  // ------------------------------------------------ cały zbiór
  function kluczLokalny(r) { return (r._kodZrodla || '') + '|' + (r.dysponent_nazwa || '') + '|' + String(r.id_lokalne); }

  /** Problem UNIKALNY dla rekordu r, którego wartość pola powtarza wartość z rekordu p1. */
  function problemUnikalny(r, pole, p1) {
    const gdzie = (p1._kodZrodla || '') + (p1._wiersz ? ', wiersz ' + p1._wiersz : '');
    const p = {
      id: r._id + ':' + pole + ':UNIKALNY', rekordId: r._id, kodZrodla: r._kodZrodla, wiersz: r._wiersz, pole: pole,
      poziom: pole === 'id_aed' ? 'blad' : 'ostrzezenie', kod: 'UNIKALNY', wartosc: r[pole],
      komunikat: pole === 'id_aed'
        ? 'Identyfikator AED ' + r.id_aed + ' występuje już w innym rekordzie (' + gdzie + '). Każde urządzenie musi mieć własny identyfikator – nadaj nowy.'
        : 'Identyfikator u dysponenta ' + pokaz(String(r.id_lokalne)) + ' powtarza się (' + gdzie + '). Sprawdź, czy to nie duplikat urządzenia.'
    };
    if (pole === 'id_aed') p.podpowiedz = AED.mapowanie.nowyUuid();
    return p;
  }

  /** Indeks do sprawdzania unikalności po edycjach: zbuduj raz (O(n)), potem każde sprawdzenie jest O(1).
      Rekordy zmieniają się w miejscu, więc kandydatów z indeksu weryfikujemy po bieżącej wartości,
      a sprawdzany rekord dopisujemy pod jego bieżącymi wartościami. */
  function indeksUnikalnosci(rekordy) {
    const aed = new Map(), lok = new Map();
    const dopisz = function (r) {
      if (typeof r.id_aed === 'string' && r.id_aed) { const a = aed.get(r.id_aed); if (!a) aed.set(r.id_aed, [r]); else if (a.indexOf(r) < 0) a.push(r); }
      if (!pusta(r.id_lokalne)) { const k = kluczLokalny(r); const a = lok.get(k); if (!a) lok.set(k, [r]); else if (a.indexOf(r) < 0) a.push(r); }
    };
    (rekordy || []).forEach(dopisz);
    return { _indeksUnikalnosci: true, aed: aed, lok: lok, dopisz: dopisz };
  }

  /** Reguły między rekordami dla jednego rekordu (np. po ręcznej edycji): powtórzone id_aed i id_lokalne.
      Pierwszy argument: tablica rekordów (O(n)) albo indeks z indeksUnikalnosci (O(1) – do poprawek zbiorczych).
      Zwraca problemy tylko dla wskazanego rekordu. */
  function walidujUnikalnosc(rekordyLubIndeks, rekord) {
    const ix = rekordyLubIndeks && rekordyLubIndeks._indeksUnikalnosci ? rekordyLubIndeks : indeksUnikalnosci(rekordyLubIndeks);
    ix.dopisz(rekord);
    const wynik = [];
    const inny = function (lista, test) {
      return (lista || []).find(function (x) { return x !== rekord && x._id !== rekord._id && test(x); }) || null;
    };
    if (typeof rekord.id_aed === 'string' && rekord.id_aed) {
      const a = inny(ix.aed.get(rekord.id_aed), function (x) { return x.id_aed === rekord.id_aed; });
      if (a) wynik.push(problemUnikalny(rekord, 'id_aed', a));
    }
    if (!pusta(rekord.id_lokalne)) {
      const k = kluczLokalny(rekord);
      const l = inny(ix.lok.get(k), function (x) { return !pusta(x.id_lokalne) && kluczLokalny(x) === k; });
      if (l) wynik.push(problemUnikalny(rekord, 'id_lokalne', l));
    }
    return wynik;
  }

  function pustePodsumowanie() { return { rekordy: 0, bledy: 0, ostrzezenia: 0, rekordyZBledami: 0 }; }

  /**
   * @param {Object[]} rekordy
   * @param {{dzis?: string}} [opcje] – dzis: data odniesienia 'YYYY-MM-DD' (testy)
   */
  function waliduj(rekordy, opcje) {
    opcje = opcje || {};
    dzisOpcja = opcje.dzis || null;
    try {
      const problemy = [];
      const wgPola = {}, wgZrodla = {};
      POLA.forEach(function (f) { wgPola[f.name] = { bledy: 0, ostrzezenia: 0 }; });
      const bledneRekordy = {};

      // unikalność id_aed (cały zbiór) i id_lokalne (w obrębie dysponenta)
      const ids = new Map(), lokalne = new Map();
      const duplikaty = [];
      rekordy.forEach(function (r) {
        if (typeof r.id_aed === 'string' && r.id_aed) {
          if (ids.has(r.id_aed)) duplikaty.push({ r: r, pole: 'id_aed', pierwszy: ids.get(r.id_aed) });
          else ids.set(r.id_aed, r);
        }
        if (!pusta(r.id_lokalne)) {
          const k = kluczLokalny(r);
          if (lokalne.has(k)) duplikaty.push({ r: r, pole: 'id_lokalne', pierwszy: lokalne.get(k) });
          else lokalne.set(k, r);
        }
      });

      const dodaj = function (p) {
        problemy.push(p);
        const s = wgZrodla[p.kodZrodla] || (wgZrodla[p.kodZrodla] = pustePodsumowanie());
        if (p.poziom === 'blad') { wgPola[p.pole].bledy++; s.bledy++; bledneRekordy[p.rekordId] = p.kodZrodla; } else { wgPola[p.pole].ostrzezenia++; s.ostrzezenia++; }
      };

      rekordy.forEach(function (r) {
        const s = wgZrodla[r._kodZrodla] || (wgZrodla[r._kodZrodla] = pustePodsumowanie());
        s.rekordy++;
        walidujRekord(r).forEach(dodaj);
      });
      duplikaty.forEach(function (d) { dodaj(problemUnikalny(d.r, d.pole, d.pierwszy)); });

      Object.keys(bledneRekordy).forEach(function (id) { wgZrodla[bledneRekordy[id]].rekordyZBledami++; });
      let bledy = 0, ostrz = 0;
      problemy.forEach(function (p) { if (p.poziom === 'blad') bledy++; else ostrz++; });
      return {
        problemy: problemy,
        podsumowanie: {
          rekordy: rekordy.length, bledy: bledy, ostrzezenia: ostrz,
          rekordyZBledami: Object.keys(bledneRekordy).length, wgPola: wgPola, wgZrodla: wgZrodla
        }
      };
    } finally {
      dzisOpcja = null;
    }
  }

  AED.walidacja = {
    KODY: KODY,
    walidujRekord: function (r, opcje) {
      dzisOpcja = (opcje && opcje.dzis) || null;
      try { return walidujRekord(r); } finally { dzisOpcja = null; }
    },
    waliduj: waliduj,
    walidujUnikalnosc: walidujUnikalnosc,
    indeksUnikalnosci: indeksUnikalnosci
  };
})(window.AED);
