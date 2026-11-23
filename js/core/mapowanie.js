/* Mapowanie kolumn źródła na pola wzorca i budowa rekordów.
   podpowiedz(zrodlo) – automatyczne dopasowanie nagłówków (nazwy pól, tytuły, synonimy)
                         sprawdzone zawartością kolumny (próbka wierszy);
   zastosuj(zrodlo, mapowanie) – rekordy w formacie wzorca (typy JS) z listą automatycznych napraw.
   Reguły mapowania:
     kolumna            { kolumna, wartosc? (gdy komórka pusta), zapas? (druga kolumna, gdy pusta), szablon? ('{a}/{b}'), wzorzec? (RegExp jako tekst – wyciąga część wartości, grupy łączone „-”) }
     stala              { wartosc, zZrodla? ('kod'|'licencja'|'dysponent' – wartość brana z bieżących danych źródła) }
     adres              { kolumna } – jedna kolumna z pełnym adresem zasila miejscowość, ulicę, numer i kod pocztowy
     wspolrzedne_tekst  { kolumna } – jedna kolumna z parą współrzędnych zasila szerokość i długość
     brak               – pole puste */
(function (AED) {
  'use strict';

  const N = AED.normalizacja;
  const REGULY = ['kolumna', 'stala', 'adres', 'wspolrzedne_tekst', 'brak'];
  const POLA = AED.wzorzec.schema.fields;
  const POLE = {};
  POLA.forEach(function (f) { POLE[f.name] = f; });

  const ADRES_POLA = ['miejscowosc', 'cecha_ulicy', 'ulica', 'numer_budynku', 'kod_pocztowy'];
  const WSP_POLA = ['szerokosc_geograficzna', 'dlugosc_geograficzna'];
  const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const PROBKA = 200;

  // ------------------------------------------------------------ synonimy nagłówków
  // [tekst, slaby?] – słaby synonim daje pewność „średnią”. Porównanie po N.klucz (bez ogonków i znaków).
  const SYNONIMY = {
    id_aed: ['id aed', 'uuid', 'guid', 'identyfikator aed', 'ref aed', 'globalny identyfikator'],
    id_lokalne: ['id', 'numer id', 'nr id', 'identyfikator', 'numer inwentarzowy', 'nr inwentarzowy', 'id lokalne', 'numer aed', 'nr aed',
      'objectid', 'object id', 'fid', 'ref', 'kod aed', 'oznaczenie', ['lp', 1], ['l p', 1], ['nr', 1], ['numer', 1], ['kod', 1]],
    nazwa: ['nazwa', 'name', 'nazwa miejsca', 'nazwa obiektu', 'obiekt', 'miejsce', 'nazwa placowki', 'placowka', 'nazwa lokalizacji', 'title', 'tytul',
      ['instytucja', 1], ['jednostka', 1]],
    status: ['status', 'stan', 'status urzadzenia', 'stan urzadzenia', 'aktywny'],
    szerokosc_geograficzna: ['szerokosc', 'szerokosc geograficzna', 'szer', 'szer geogr', 'szer geo', 'lat', 'latitude', 'wsp y', 'wspolrzedna y',
      'wspolrzedne y', 'n', 'szerokosc n', 'geometria szerokosc', 'geo lat', ['y', 1]],
    dlugosc_geograficzna: ['dlugosc', 'dlugosc geograficzna', 'dl', 'dlug', 'dl geogr', 'dlug geogr', 'lon', 'lng', 'long', 'longitude', 'wsp x',
      'wspolrzedna x', 'wspolrzedne x', 'e', 'dlugosc e', 'geometria dlugosc', 'geo lon', ['x', 1]],
    lokalizacja_przyblizona: ['przyblizona', 'lokalizacja przyblizona', 'przyblizone'],
    zrodlo_wspolrzednych: ['zrodlo wspolrzednych', 'zrodlo lokalizacji', 'metoda lokalizacji'],
    kod_terc_gminy: ['terc', 'teryt', 'kod teryt', 'kod terc', 'teryt terc', 'kod gminy', 'teryt gminy'],
    wojewodztwo: ['wojewodztwo', 'woj', 'region', 'voivodeship'],
    miejscowosc: ['miejscowosc', 'miasto', 'city', 'town', 'miejscowosc poczta', 'nazwa miejscowosci', ['gmina', 1], ['poczta', 1]],
    kod_simc: ['simc', 'kod simc', 'teryt simc', 'sym'],
    cecha_ulicy: ['cecha', 'cecha ulicy', 'typ ulicy', 'rodzaj ulicy'],
    ulica: ['ulica', 'ul', 'street', 'nazwa ulicy', 'ulica nazwa'],
    kod_ulic: ['ulic', 'kod ulic', 'sym ul', 'kod ulicy'],
    numer_budynku: ['numer budynku', 'nr budynku', 'nr domu', 'numer domu', 'home number', 'house number', 'housenumber',
      'nr posesji', 'numer posesji', 'nr bud', 'numer porzadkowy', ['budynek', 1]],
    kod_pocztowy: ['kod pocztowy', 'postcode', 'post code', 'zip', 'zip code', 'kod poczt', 'pna', 'kod pocz'],
    opis_lokalizacji: ['opis lokalizacji', 'lokalizacja', 'opis', 'opis miejsca', 'umiejscowienie', 'miejsce zawieszenia', 'miejsce montazu',
      'lokalizacja urzadzenia', 'dokladna lokalizacja', 'opis dojscia', 'lokalizacja aed', 'gdzie', 'miejsce instalacji',
      'lokalizacja w budynku', ['description', 1]],
    opis_lokalizacji_en: ['opis en', 'opis lokalizacji en', 'location description'],
    wewnatrz_budynku: ['wewnatrz', 'wewnatrz budynku', 'indoor', 'w budynku', 'wewnetrzny', 'zewnetrzny wewnetrzny', 'wewn zewn'],
    kondygnacja: ['kondygnacja', 'pietro', 'level', 'poziom', 'nr kondygnacji'],
    dostepnosc: ['dostepnosc', 'dostep', 'access', 'dostepny', 'ogolnodostepny', 'dostepnosc publiczna', 'rodzaj dostepu', 'dla kogo'],
    godziny_dostepnosci: ['godziny', 'godziny dostepnosci', 'godziny otwarcia', 'opening hours', 'czynne', 'godziny pracy', 'dostepny w godzinach',
      'dni i godziny', 'godziny dostepu'],
    sposob_dostepu: ['sposob dostepu', 'zabezpieczenie', 'szafka', 'locked', 'zamkniecie', 'rodzaj szafki', 'typ szafki', 'zamek'],
    instrukcja_dostepu: ['instrukcja', 'instrukcja dostepu', 'klucz', 'kto wydaje', 'gdzie klucz'],
    typ_urzadzenia: ['typ urzadzenia', 'rodzaj urzadzenia', 'typ aed', 'rodzaj aed', ['typ', 1], ['rodzaj', 1]],
    producent: ['producent', 'manufacturer', 'marka', 'wytworca'],
    model: ['model', 'model urzadzenia', 'typ modelu'],
    tryb_pediatryczny: ['pediatryczny', 'tryb pediatryczny', 'elektrody pediatryczne', 'dla dzieci', 'pediatric'],
    data_waznosci_elektrod: ['elektrody', 'waznosc elektrod', 'data waznosci elektrod', 'termin waznosci elektrod', 'elektrody waznosc', 'elektrody do'],
    data_waznosci_baterii: ['bateria', 'waznosc baterii', 'data waznosci baterii', 'termin waznosci baterii', 'akumulator', 'bateria do'],
    data_przegladu: ['przeglad', 'data przegladu', 'ostatni przeglad', 'serwis', 'data serwisu', 'data ostatniego przegladu'],
    dysponent_nazwa: ['dysponent', 'wlasciciel', 'operator', 'zarzadca', 'podmiot', 'nazwa dysponenta', 'dysponent nazwa', 'wlasciciel urzadzenia',
      'instytucja odpowiedzialna', 'jednostka odpowiedzialna'],
    dysponent_typ: ['typ dysponenta', 'rodzaj dysponenta', 'rodzaj podmiotu', 'typ podmiotu'],
    dysponent_regon: ['regon', 'regon dysponenta'],
    telefon_kontaktowy: ['telefon', 'tel', 'phone', 'nr telefonu', 'numer telefonu', 'contact phone', 'telefon kontaktowy', 'kontakt telefon', ['kontakt', 1]],
    email_kontaktowy: ['email', 'e mail', 'mail', 'adres e mail', 'adres email', 'contact email', 'poczta elektroniczna'],
    data_weryfikacji: ['data weryfikacji', 'zweryfikowano', 'check date', 'data sprawdzenia', 'weryfikacja', 'data kontroli', 'sprawdzono'],
    sposob_weryfikacji: ['sposob weryfikacji', 'metoda weryfikacji'],
    zrodlo_danych: ['zrodlo danych', 'zrodlo'],
    zrodlo_id_rekordu: ['id w zrodle', 'zrodlo id', 'id zrodlowe'],
    licencja_rekordu: ['licencja', 'license', 'licence'],
    data_aktualizacji_rekordu: ['data aktualizacji', 'aktualizacja', 'zaktualizowano', 'updated', 'last update', 'data modyfikacji', 'modified',
      'ostatnia aktualizacja', 'data zmiany'],
    uwagi: ['uwagi', 'note', 'notatka', 'komentarz', 'informacje dodatkowe', 'dodatkowe informacje', 'remarks', 'notes', 'inne informacje']
  };
  // Złożone: jedna kolumna -> kilka pól
  const SYN_ADRES = ['adres', 'address', 'adres aed', 'adres obiektu', 'adres pocztowy', 'adres lokalizacji', 'pelny adres', 'adres miejsca',
    'ulica i numer', 'ulica nr', 'adres instalacji', 'lokalizacja adres', 'adres urzadzenia'];
  const SYN_WSP = ['wspolrzedne', 'wspolrzedne geograficzne', 'geometria', 'geometry', 'geom', 'the geom', 'wkt', 'polozenie', 'gps',
    'wspolrzedne gps', 'coordinates', 'coords', 'lokalizacja gps', 'punkt', 'wsp', 'lat lon', 'lat lng', 'szerokosc dlugosc', ['lokalizacja', 1], ['location', 1]];

  // Indeks dopasowań: klucz nagłówka -> [{pole, wynik, pewnosc, powod}]
  const DOKLADNE = {};
  const ZAWIERA = []; // {k, pole, dl}
  function dodajDokladne(k, pole, wynik, pewnosc, rodzaj) {
    if (!k) return;
    (DOKLADNE[k] = DOKLADNE[k] || []).push({ pole: pole, wynik: wynik, pewnosc: pewnosc, rodzaj: rodzaj });
  }
  POLA.forEach(function (f) {
    dodajDokladne(N.klucz(f.name.replace(/_/g, ' ')), f.name, 100, 'wysoka', 'nazwa');
    dodajDokladne(N.klucz(f.title), f.name, 96, 'wysoka', 'tytul');
  });
  function dodajSynonimy(pole, lista) {
    lista.forEach(function (s) {
      const slaby = Array.isArray(s);
      const k = N.klucz(slaby ? s[0] : s);
      dodajDokladne(k, pole, slaby ? 62 : 88, slaby ? 'srednia' : 'wysoka', 'synonim');
      if (!slaby && (k.length >= 4 || / /.test(k))) ZAWIERA.push({ k: ' ' + k + ' ', pole: pole, dl: k.length });
    });
  }
  // nagłówki prostego formularza dysponenta (wzorzec/formularz_dysponenta_AED.xlsx) – zawsze pewne dopasowanie
  const FORM_DYSP = AED.wzorzec.formularzDysponenta || null;
  if (FORM_DYSP) FORM_DYSP.kolumny.forEach(function (k) { if (POLE[k.pole]) dodajDokladne(N.klucz(k.naglowek), k.pole, 99, 'wysoka', 'formularz'); });
  Object.keys(SYNONIMY).forEach(function (p) { dodajSynonimy(p, SYNONIMY[p]); });
  dodajSynonimy('_adres', SYN_ADRES);
  dodajSynonimy('_wsp', SYN_WSP);
  ZAWIERA.sort(function (a, b) { return b.dl - a.dl; });

  function tytul(pole) {
    if (pole === '_adres') return 'adres (miejscowość, ulica, numer, kod)';
    if (pole === '_wsp') return 'współrzędne (szerokość i długość)';
    return POLE[pole] ? POLE[pole].title : pole;
  }

  // ------------------------------------------------------------ profil kolumny
  /** Próbka niepustych wartości: równomiernie z całego zbioru (maks. PROBKA). */
  function probkaWartosci(wiersze, kolumna) {
    const n = wiersze.length, wynik = [];
    if (n <= PROBKA * 2) {
      for (let i = 0; i < n; i++) { const v = wiersze[i][kolumna]; if (!N.pusta(v)) wynik.push(v); }
      return wynik;
    }
    const krok = n / PROBKA;
    for (let j = 0; j < PROBKA; j++) {
      // od wybranego wiersza szukamy niepustej wartości w obrębie kroku
      const start = Math.floor(j * krok), koniec = Math.min(n, Math.floor((j + 1) * krok));
      for (let i = start; i < koniec; i++) { const v = wiersze[i][kolumna]; if (!N.pusta(v)) { wynik.push(v); break; } }
    }
    return wynik;
  }

  function ulamek(wartosci, test) {
    if (!wartosci.length) return 0;
    let ok = 0;
    for (let i = 0; i < wartosci.length; i++) if (test(wartosci[i])) ok++;
    return ok / wartosci.length;
  }

  function profil(zrodlo, kolumna) {
    const w = probkaWartosci(zrodlo.wiersze || [], kolumna);
    const czest = {};
    let suma = 0;
    w.forEach(function (v) { const t = N.tekst(v); czest[t] = (czest[t] || 0) + 1; suma += t.length; });
    const klucze = Object.keys(czest);
    let najcz = null;
    klucze.forEach(function (k) { if (najcz === null || czest[k] > czest[najcz]) najcz = k; });
    const p = {
      kolumna: kolumna,
      wartosci: w,
      n: w.length,
      rozne: klucze.length,
      najczestsza: najcz,
      najczestszaUdzial: w.length ? czest[najcz] / w.length : 0,
      srDlugosc: w.length ? suma / w.length : 0,
      _z: {}
    };
    const st = w.map(function (v) { return N.stopnie(v); });
    p.liczbowe = ulamek(w, function (v) { return N.liczba(v) !== null; });
    p.lat = st.length ? st.filter(function (s) { return s && s.wartosc >= 49 && s.wartosc <= 55; }).length / st.length : 0;
    p.lon = st.length ? st.filter(function (s) { return s && s.wartosc >= 14 && s.wartosc <= 24.3; }).length / st.length : 0;
    p.wsp = ulamek(w, function (v) {
      const s = N.tekst(v);
      if ((s.match(/\d+/g) || []).length < 2) return false;
      const r = N.wspolrzedneZTekstu(s);
      return !r.blad;
    });
    p.adres = ulamek(w, function (v) {
      const s = N.tekst(v);
      return /[A-Za-zĄ-Żą-ż]{3}/.test(s) && /\d/.test(s) && (/\d{2}-\d{3}/.test(s) || /^(ul|al|pl|os|ulica|aleja|plac|osiedle)\.*\s/i.test(s) ||
        (/,/.test(s) && /[A-Za-zĄ-Żą-ż]{3,}\s+\d+[a-zA-Z]?\b/.test(s)));
    });
    p.uuid = ulamek(w, function (v) { return RE_UUID.test(N.tekst(v)); });
    p.email = ulamek(w, function (v) { return N.email(v) !== null; });
    p.telefon = ulamek(w, function (v) { return /^[\s\d+()'\/.-]{9,}$/.test(N.tekst(v)) && N.telefon(v) !== null; });
    p.kodPocztowy = ulamek(w, function (v) { return /^\d{2}-\d{3}$/.test(N.tekst(v)); });
    return p;
  }

  /** Jaka część próbki ma format oczekiwany przez pole (1 = wszystkie; null = nie sprawdzamy). */
  function zgodnosc(pole, p) {
    if (Object.prototype.hasOwnProperty.call(p._z, pole)) return p._z[pole];
    let f = null;
    const w = p.wartosci;
    const def = POLE[pole];
    if (!w.length) f = 0;
    else if (pole === '_adres') f = p.adres;
    else if (pole === '_wsp') f = p.wsp;
    else if (pole === 'szerokosc_geograficzna' || pole === 'dlugosc_geograficzna') f = ulamek(w, function (v) { return N.stopnie(v) !== null; });
    else if (pole === 'id_aed') f = p.uuid;
    else if (pole === 'kod_pocztowy') f = ulamek(w, function (v) { return N.kodPocztowy(v) !== null; });
    else if (pole === 'telefon_kontaktowy') f = ulamek(w, function (v) { return N.telefon(v) !== null; });
    else if (pole === 'email_kontaktowy') f = p.email;
    else if (pole === 'kondygnacja') f = ulamek(w, function (v) { return N.kondygnacja(v) !== null; });
    else if (pole === 'godziny_dostepnosci') f = ulamek(w, function (v) { return N.godziny(v) !== null || /\d/.test(N.tekst(v)); });
    else if (pole === 'kod_terc_gminy' || pole === 'kod_simc') f = ulamek(w, function (v) { return /^\d{6,7}$/.test(N.tekst(v)); });
    else if (pole === 'dysponent_regon') f = ulamek(w, function (v) { return /^(\d{9}|\d{14})$/.test(N.tekst(v).replace(/[\s-]/g, '')); });
    else if (def && def.aed.slownik) f = ulamek(w, function (v) { return N.slownik(def.aed.slownik, v).wartosc !== null; });
    else if (def && def.type === 'date') f = ulamek(w, function (v) { return N.data(v) !== null; });
    else if (def && def.type === 'datetime') f = ulamek(w, function (v) { return N.dataCzas(v) !== null; });
    else if (def && def.type === 'boolean') f = ulamek(w, function (v) { return N.bool(v) !== null; });
    p._z[pole] = f;
    return f;
  }

  const TEKSTOWE = { nazwa: 1, opis_lokalizacji: 1, opis_lokalizacji_en: 1, miejscowosc: 1, ulica: 1, dysponent_nazwa: 1, uwagi: 1,
    instrukcja_dostepu: 1, producent: 1, model: 1 };
  const NIZEJ = { wysoka: 'srednia', srednia: 'niska', niska: 'niska' };
  function proc(f) { return Math.round(f * 100) + '%'; }

  // ------------------------------------------------------------ kandydaci
  function kandydaciNaglowka(kolumna) {
    const k = N.klucz(kolumna);
    const wynik = {};
    (DOKLADNE[k] || []).forEach(function (d) {
      if (!wynik[d.pole] || wynik[d.pole].wynik < d.wynik) {
        let powod;
        if (d.rodzaj === 'nazwa') powod = 'Nagłówek „' + kolumna + '” to nazwa pola we wzorcu.';
        else if (d.rodzaj === 'tytul') powod = 'Nagłówek „' + kolumna + '” to tytuł pola „' + tytul(d.pole) + '”.';
        else if (d.rodzaj === 'formularz') powod = 'Nagłówek „' + kolumna + '” pochodzi z formularza dysponenta – pole „' + tytul(d.pole) + '”.';
        else powod = 'Nagłówek „' + kolumna + '” oznacza zwykle pole „' + tytul(d.pole) + '”.';
        wynik[d.pole] = { pole: d.pole, kolumna: kolumna, wynik: d.wynik, pewnosc: d.pewnosc, powod: powod };
      }
    });
    if (!Object.keys(wynik).length && k) {
      const kk = ' ' + k + ' ';
      for (let i = 0; i < ZAWIERA.length; i++) {
        const z = ZAWIERA[i];
        if (!wynik[z.pole] && kk.indexOf(z.k) >= 0) {
          wynik[z.pole] = { pole: z.pole, kolumna: kolumna, wynik: 50 + Math.min(12, z.dl / 2), pewnosc: 'srednia',
            powod: 'Nagłówek „' + kolumna + '” zawiera „' + z.k.trim() + '” – prawdopodobnie pole „' + tytul(z.pole) + '”.' };
        }
      }
    }
    return Object.keys(wynik).map(function (p) { return wynik[p]; });
  }

  /** Sprawdzenie kandydata zawartością kolumny. Zwraca kandydata (zmienionego) albo null (odrzucony; powód w odrzucone). */
  function sprawdzZawartoscia(c, p, odrzucone) {
    if (!p.n) {
      c.pewnosc = 'niska'; c.wynik -= 30;
      c.powod += ' Kolumna jest pusta.';
      return c;
    }
    const f = zgodnosc(c.pole, p);
    if (f !== null) {
      if (f === 0 && c.wynik < 90) {
        odrzucone[c.pole] = odrzucone[c.pole] || ('Kolumna „' + c.kolumna + '” pasuje nazwą, ale żadna wartość nie ma formatu tego pola.');
        return null;
      }
      if (f < 0.5) {
        c.pewnosc = f === 0 ? 'niska' : NIZEJ[c.pewnosc]; c.wynik -= 20;
        c.powod += ' Uwaga: tylko ' + proc(f) + ' wartości ma oczekiwany format.';
      } else if (f < 0.9 && c.pole[0] !== '_') {
        c.powod += ' Format ma ' + proc(f) + ' wartości – resztę popraw lub sprawdź.';
      }
    }
    if (TEKSTOWE[c.pole]) {
      if (p.liczbowe >= 0.9 || p.wsp >= 0.8) {
        c.wynik -= 30; c.pewnosc = 'niska';
        c.powod += ' Kolumna zawiera głównie liczby/współrzędne, a nie tekst.';
      }
      if (p.n >= 5 && p.najczestszaUdzial >= 0.8 && p.srDlugosc > 80) {
        odrzucone[c.pole] = 'Kolumna „' + c.kolumna + '” ma ten sam długi tekst prawie we wszystkich wierszach (ogólny opis), więc nie opisuje konkretnego miejsca – pominięto.';
        return null;
      }
    }
    if ((c.pole === 'nazwa' || c.pole === 'opis_lokalizacji' || c.pole === 'id_lokalne') && p.n >= 3 && p.rozne === 1) {
      c.pewnosc = 'niska';
      c.powod += ' Uwaga: kolumna ma we wszystkich wierszach tę samą wartość („' + String(p.najczestsza).slice(0, 40) + '”) – sprawdź, czy to właściwe pole.';
    }
    return c;
  }

  /** Kandydaci wyłącznie z zawartości (nagłówek nic nie mówi). */
  function kandydaciZawartosci(kolumna, p) {
    const lista = [];
    if (p.n < 1) return lista;
    const dodaj = function (pole, wynik, powod) { lista.push({ pole: pole, kolumna: kolumna, wynik: wynik, pewnosc: 'srednia', powod: powod }); };
    if (p.liczbowe >= 0.9 && p.lat >= 0.9) dodaj('szerokosc_geograficzna', 45, 'Kolumna „' + kolumna + '” zawiera liczby z zakresu 49–55 – wygląda na szerokość geograficzną.');
    else if (p.liczbowe >= 0.9 && p.lon >= 0.9) dodaj('dlugosc_geograficzna', 45, 'Kolumna „' + kolumna + '” zawiera liczby z zakresu 14–24 – wygląda na długość geograficzną.');
    if (p.wsp >= 0.8 && p.liczbowe < 0.5) dodaj('_wsp', 48, 'Kolumna „' + kolumna + '” zawiera pary współrzędnych.');
    if (p.uuid >= 0.9) dodaj('id_aed', 48, 'Kolumna „' + kolumna + '” zawiera identyfikatory UUID.');
    if (p.email >= 0.8) dodaj('email_kontaktowy', 44, 'Kolumna „' + kolumna + '” zawiera adresy e-mail.');
    if (p.kodPocztowy >= 0.9) dodaj('kod_pocztowy', 44, 'Kolumna „' + kolumna + '” zawiera kody pocztowe.');
    if (p.telefon >= 0.8 && p.liczbowe < 0.9) dodaj('telefon_kontaktowy', 40, 'Kolumna „' + kolumna + '” zawiera numery telefonów.');
    if (p.adres >= 0.7) dodaj('_adres', 40, 'Kolumna „' + kolumna + '” zawiera adresy (ulica, numer, kod pocztowy).');
    return lista;
  }

  // ------------------------------------------------------------ podpowiedź
  function stala(wartosc, pewnosc, powod, dodatki) {
    return Object.assign({ regula: 'stala', wartosc: wartosc, pewnosc: pewnosc, powod: powod }, dodatki || {});
  }

  /**
   * Automatyczne mapowanie kolumn źródła na pola wzorca.
   * @returns {Object<string, {regula, kolumna?, wartosc?, pewnosc, powod}>} – wpis dla każdego pola wzorca
   */
  function podpowiedz(zrodlo) {
    const kolumny = (zrodlo.kolumny || []).slice();
    const profile = {};
    const odrzucone = {};
    let kandydaci = [];
    kolumny.forEach(function (kol) {
      const p = profile[kol] = profil(zrodlo, kol);
      const zNaglowka = kandydaciNaglowka(kol);
      zNaglowka.forEach(function (c) {
        const s = sprawdzZawartoscia(c, p, odrzucone);
        if (s) kandydaci.push(s);
      });
      const juz = {};
      zNaglowka.forEach(function (c) { juz[c.pole] = 1; });
      kandydaciZawartosci(kol, p).forEach(function (c) { if (!juz[c.pole]) kandydaci.push(c); });
    });
    // kolejność: wynik malejąco, potem kolejność kolumn (stabilnie)
    kandydaci = kandydaci.map(function (c, i) { c._i = i; return c; })
      .sort(function (a, b) { return (b.wynik - a.wynik) || (a._i - b._i); });

    const m = {};
    const zajete = {};
    kandydaci.forEach(function (c) {
      if (m[c.pole] || zajete[c.kolumna]) return;
      m[c.pole] = { regula: 'kolumna', kolumna: c.kolumna, pewnosc: c.pewnosc, powod: c.powod };
      zajete[c.kolumna] = c.pole;
    });

    nazwaZInnejKolumny(m, profile, kolumny, zajete);
    numerAedZNazwy(m, profile, zajete);

    // Współrzędne: zamienione nagłówki (np. Marki: „Długość” zawiera 52,3)
    const sz = m.szerokosc_geograficzna, dl = m.dlugosc_geograficzna;
    if (sz && dl && sz.regula === 'kolumna' && dl.regula === 'kolumna') {
      const ps = profile[sz.kolumna], pd = profile[dl.kolumna];
      if (ps.lon > 0.5 && pd.lat > 0.5 && ps.lat < 0.5 && pd.lon < 0.5) {
        m.szerokosc_geograficzna = { regula: 'kolumna', kolumna: dl.kolumna, pewnosc: 'wysoka',
          powod: 'Nagłówki są zamienione: kolumna „' + dl.kolumna + '” zawiera wartości ok. ' + Math.round(N.liczba(pd.najczestsza) || 0) +
            ' – to szerokość geograficzna (w Polsce 49–55).' };
        m.dlugosc_geograficzna = { regula: 'kolumna', kolumna: sz.kolumna, pewnosc: 'wysoka',
          powod: 'Nagłówki są zamienione: kolumna „' + sz.kolumna + '” zawiera wartości ok. ' + Math.round(N.liczba(ps.najczestsza) || 0) +
            ' – to długość geograficzna (w Polsce 14–24).' };
      }
    }
    // Współrzędne w jednej kolumnie
    if (m._wsp) {
      const w = m._wsp;
      if (!(m.szerokosc_geograficzna && m.dlugosc_geograficzna)) {
        WSP_POLA.forEach(function (p) {
          m[p] = { regula: 'wspolrzedne_tekst', kolumna: w.kolumna, pewnosc: w.pewnosc,
            powod: w.powod + ' Szerokość i długość zostaną odczytane z jednej kolumny.' };
        });
      } else delete zajete[w.kolumna];
      delete m._wsp;
    }
    // Adres w jednej kolumnie
    if (m._adres) {
      const a = m._adres;
      ADRES_POLA.forEach(function (p) {
        if (!m[p]) m[p] = { regula: 'adres', kolumna: a.kolumna, pewnosc: a.pewnosc, powod: a.powod + ' Pole zostanie wydzielone z adresu.' };
      });
      delete m._adres;
    }

    domyslne(zrodlo, m, kolumny);

    const wynik = {};
    POLA.forEach(function (f) {
      if (m[f.name]) { wynik[f.name] = m[f.name]; return; }
      const ob = f.aed.obowiazkowosc === 'O';
      wynik[f.name] = { regula: 'brak', pewnosc: 'niska',
        powod: (odrzucone[f.name] || 'Nie znaleziono kolumny pasującej do tego pola.') +
          (ob ? ' Pole jest obowiązkowe – wybierz kolumnę albo wpisz wartość stałą.' : '') };
    });
    return wynik;
  }

  /** Krótka, zróżnicowana kolumna tekstowa (np. „Lokalizacja” w Krośnie) – kandydat na nazwę miejsca. */
  function tekstRozny(p) {
    return p && p.n >= 3 && p.rozne >= Math.max(2, p.n * 0.5) && p.srDlugosc <= 80 && p.liczbowe < 0.5 && p.wsp < 0.5 && p.adres < 0.5 && p.email < 0.5;
  }
  /** Kolumna „Nazwa” ma we wszystkich wierszach to samo („Defibrylator”) – nazwą miejsca jest inna kolumna. */
  function nazwaZInnejKolumny(m, profile, kolumny, zajete) {
    const n = m.nazwa;
    if (!n || n.regula !== 'kolumna') return;
    const p = profile[n.kolumna];
    if (!(p && p.n >= 3 && p.rozne === 1)) return;
    let cel = null;
    if (m.opis_lokalizacji && m.opis_lokalizacji.regula === 'kolumna' && tekstRozny(profile[m.opis_lokalizacji.kolumna])) cel = m.opis_lokalizacji.kolumna;
    if (!cel) cel = kolumny.find(function (k) { return !zajete[k] && tekstRozny(profile[k]); }) || null;
    if (!cel) return;
    const stara = n.kolumna;
    delete zajete[stara];
    m.nazwa = { regula: 'kolumna', kolumna: cel, pewnosc: 'srednia',
      powod: 'Kolumna „' + stara + '” ma we wszystkich wierszach tę samą wartość („' + String(p.najczestsza).slice(0, 40) +
        '”), więc nazwą miejsca jest prawdopodobnie kolumna „' + cel + '” (różne, krótkie wartości).' };
    if (m.opis_lokalizacji && m.opis_lokalizacji.kolumna === cel) {
      m.opis_lokalizacji.pewnosc = 'niska';
      m.opis_lokalizacji.powod += ' Ta sama kolumna jest też nazwą miejsca – opis dojścia warto uzupełnić osobno.';
    } else zajete[cel] = 'nazwa';
  }

  const WZORZEC_AED = '(AED)\\s*[-:.]?\\s*(\\d{3,})';
  /** Numer urządzenia wpisany w nazwę („Defibrylator (AED 9485) w …”) -> id_lokalne „AED-9485”;
      techniczna kolumna „id” -> zrodlo_id_rekordu. */
  function numerAedZNazwy(m, profile, zajete) {
    const n = m.nazwa;
    if (!n || n.regula !== 'kolumna') return;
    const p = profile[n.kolumna];
    const re = new RegExp(WZORZEC_AED, 'i');
    if (!p || p.n < 3 || ulamek(p.wartosci, function (v) { return re.test(N.tekst(v)); }) < 0.8) return;
    const il = m.id_lokalne;
    if (il && il.regula === 'kolumna' && /^(id|objectid|object id|fid|gid|lp|l p)$/.test(N.klucz(il.kolumna)) && !m.zrodlo_id_rekordu) {
      m.zrodlo_id_rekordu = { regula: 'kolumna', kolumna: il.kolumna, pewnosc: 'srednia',
        powod: 'Kolumna „' + il.kolumna + '” to techniczny identyfikator wiersza w źródle.' };
    } else if (il) return; // jest już prawdziwy identyfikator u dysponenta
    m.id_lokalne = { regula: 'kolumna', kolumna: n.kolumna, wzorzec: WZORZEC_AED, pewnosc: 'srednia',
      powod: 'Numer urządzenia jest wpisany w nazwę (np. „AED 9485”) – zostanie z niej wyciągnięty jako AED-9485.' };
  }

  /** Wartości domyślne dla pól bez kolumny (zależne od rodzaju źródła). */
  function domyslne(zrodlo, m, kolumny) {
    const meta = zrodlo.meta || {};
    const brak = function (p) { return !m[p]; };
    if (brak('zrodlo_danych')) m.zrodlo_danych = stala(zrodlo.kod || null, 'wysoka', 'Kod źródła w rejestrze źródeł (' + (zrodlo.kod || '?') + ').', { zZrodla: 'kod' });
    if (brak('licencja_rekordu')) {
      m.licencja_rekordu = zrodlo.licencja
        ? stala(zrodlo.licencja, 'wysoka', 'Licencja wskazana dla źródła w rejestrze źródeł.', { zZrodla: 'licencja' })
        : stala(null, 'niska', 'Źródło nie ma jeszcze licencji – wskaż ją w rejestrze źródeł, trafi do każdego rekordu.', { zZrodla: 'licencja' });
    }
    if (brak('dysponent_nazwa')) {
      m.dysponent_nazwa = zrodlo.dysponent
        ? stala(zrodlo.dysponent, 'srednia', 'Brak kolumny z dysponentem – przyjęto dysponenta źródła („' + zrodlo.dysponent + '”).', { zZrodla: 'dysponent' })
        : stala(null, 'niska', 'Brak kolumny z dysponentem – wpisz nazwę dysponenta (urzędu, szkoły…) jako wartość stałą.', { zZrodla: 'dysponent' });
    }
    if (brak('status')) {
      m.status = stala('aktywny', 'srednia', 'Źródło nie podaje statusu – przyjęto, że urządzenia ze zbioru dysponenta są aktywne.');
    }
    if (brak('lokalizacja_przyblizona')) {
      m.lokalizacja_przyblizona = stala(false, 'srednia', 'Brak informacji – przyjęto, że współrzędne wskazują miejsce urządzenia, a nie tylko adres.');
    }
    if (brak('zrodlo_wspolrzednych')) {
      m.zrodlo_wspolrzednych = stala('nieznane', 'srednia', 'Źródło nie podaje, jak ustalono współrzędne.');
    }
    if (brak('sposob_dostepu')) m.sposob_dostepu = stala('nieznany', 'srednia', 'Źródło nie opisuje zabezpieczenia urządzenia – „nieznany”.');
    if (brak('sposob_weryfikacji')) m.sposob_weryfikacji = stala('import_bez_weryfikacji', 'wysoka', 'Dane przejęte automatycznie ze źródła – „import bez weryfikacji”.');
    if (brak('data_aktualizacji_rekordu')) {
      const d = N.dataCzas(meta.dataDanych) || N.dataCzas(zrodlo.dataPobrania);
      m.data_aktualizacji_rekordu = stala(d, meta.dataDanych ? 'wysoka' : 'srednia', meta.dataDanych
        ? 'Data danych w źródle (ostatnia modyfikacja zbioru).'
        : 'Brak daty w źródle – przyjęto datę pobrania danych.');
    }
    if (brak('data_weryfikacji') && meta.dataDanych && N.data(meta.dataDanych)) {
      m.data_weryfikacji = stala(N.data(meta.dataDanych), 'niska',
        'Brak daty weryfikacji w źródle – przyjęto datę ostatniej aktualizacji zbioru. Sprawdź i popraw, jeśli znasz datę sprawdzenia urządzeń.');
    }
    if (brak('wojewodztwo') && meta.obszar && N.wojewodztwo(meta.obszar)) {
      m.wojewodztwo = stala(N.wojewodztwo(meta.obszar), 'wysoka', 'Dane pobrano dla województwa ' + N.wojewodztwo(meta.obszar) + '.');
    }
  }

  // ------------------------------------------------------------ zastosowanie
  const idPamiec = new Map(); // (_zrodlo|_wiersz) -> UUID nadany w tej sesji

  function nowyUuid() {
    const c = (typeof crypto !== 'undefined') ? crypto : null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // Stałe rodzaje napraw (do grupowania w UI) i ich opisy bez konkretnych wartości
  const RODZAJE_NAPRAW = {
    zamiana_wspolrzednych: 'Zamieniono miejscami szerokość i długość geograficzną',
    dms: 'Zamieniono stopnie-minuty-sekundy na stopnie dziesiętne',
    przecinek_dziesietny: 'Zamieniono przecinek dziesiętny na kropkę we współrzędnych',
    brak_kropki: 'Wstawiono brakującą kropkę dziesiętną we współrzędnych',
    wspolrzedne_z_tekstu: 'Odczytano współrzędne z zapisu WKT / GeoJSON',
    wspolrzedne: 'Poprawiono zapis współrzędnych',
    cecha_ulicy: 'Ustalono lub poprawiono cechę ulicy (ul., al., pl. …)',
    kod_pocztowy: 'Ujednolicono zapis kodu pocztowego (NN-NNN)',
    telefon: 'Ujednolicono zapis telefonu (same cyfry)',
    email: 'Ujednolicono zapis adresu e-mail',
    godziny: 'Zapisano godziny w formacie opening_hours',
    slownik: 'Rozpoznano wartość słownikową',
    zero_wiodace: 'Dodano zero wiodące zgubione przez arkusz kalkulacyjny',
    regon: 'Ujednolicono zapis numeru REGON',
    identyfikator: 'Zamieniono litery identyfikatora UUID na małe',
    nowy_identyfikator: 'Nadano nowy identyfikator UUID (w źródle nie było poprawnego)',
    liczba: 'Zamieniono tekst na liczbę',
    kondygnacja: 'Zamieniono opis kondygnacji na liczbę',
    tak_nie: 'Zamieniono tekst na wartość tak/nie',
    format_daty: 'Zapisano datę w formacie ISO (RRRR-MM-DD)',
    dostepnosc_24_7: 'Dostęp publiczny i godziny 24/7 – ustawiono „publiczna 24/7”',
    wojewodztwo_z_terc: 'Uzupełniono województwo z kodu TERC gminy',
    typ_dysponenta: 'Ustalono typ dysponenta na podstawie jego nazwy',
    format: 'Ujednolicono zapis wartości'
  };
  const RODZAJ_POLA = { kod_pocztowy: 'kod_pocztowy', telefon_kontaktowy: 'telefon', email_kontaktowy: 'email', godziny_dostepnosci: 'godziny',
    kod_terc_gminy: 'zero_wiodace', kod_simc: 'zero_wiodace', kod_ulic: 'zero_wiodace', dysponent_regon: 'regon', id_aed: 'identyfikator',
    kondygnacja: 'kondygnacja' };
  const RODZAJ_TYPU = { number: 'liczba', boolean: 'tak_nie', date: 'format_daty', datetime: 'format_daty' };

  function napraw(r, pole, z, na, opis, rodzaj) {
    rodzaj = RODZAJE_NAPRAW[rodzaj] ? rodzaj : 'format';
    r._naprawy.push({ pole: pole, z: z, na: na, opis: opis, rodzaj: rodzaj, opisRodzaju: RODZAJE_NAPRAW[rodzaj] });
  }
  /** Rodzaj naprawy współrzędnych na podstawie komunikatu z normalizacji. */
  function rodzajWspolrzednych(opis) {
    if (/Zamieniono szerokość/.test(opis)) return 'zamiana_wspolrzednych';
    if (/stopnie-minuty-sekundy/.test(opis)) return 'dms';
    if (/przecinek/.test(opis)) return 'przecinek_dziesietny';
    if (/kropkę dziesiętną/.test(opis)) return 'brak_kropki';
    if (/WKT|GeoJSON/.test(opis)) return 'wspolrzedne_z_tekstu';
    return 'wspolrzedne';
  }

  function pokaz(v) { return v === null || v === undefined ? '' : String(v); }

  // Pamięć podręczna wyników normalizacji w obrębie jednego zastosuj() (adresy, słowniki, godziny powtarzają się)
  let pamiecNorm = new Map();
  function zPamieci(rodzaj, t, fn) {
    const k = rodzaj + '\u0001' + t;
    let v = pamiecNorm.get(k);
    if (v === undefined) { v = fn(t); pamiecNorm.set(k, v); }
    return v;
  }
  const wzorce = new Map();
  /** Reguła „kolumna” z polem wzorzec: wyrażenie regularne; grupy łączone myślnikiem („AED 9485” -> „AED-9485”). */
  function wyciagnij(wzorzec, t) {
    let re = wzorce.get(wzorzec);
    if (!re) { try { re = new RegExp(wzorzec, 'i'); } catch (e) { re = /$^/; } wzorce.set(wzorzec, re); }
    const m = re.exec(t);
    if (!m) return null;
    return m.length > 1 ? m.slice(1).filter(function (x) { return x !== undefined && x !== ''; }).join('-') : m[0];
  }
  const imul = Math.imul;
  /** Odcisk wiersza źródłowego (FNV-1a) – ID i ręczne poprawki są przypięte do numeru wiersza ORAZ jego treści. */
  function odcisk(w) {
    // tylko wartości (kolejność kolumn jest stała w obrębie źródła) – bez sklejania napisów, bo to 50 tys. × kilkadziesiąt kolumn
    let h = 0x811c9dc5;
    const kl = Object.keys(w);
    for (let j = 0; j < kl.length; j++) {
      const v = w[kl[j]];
      if (v !== null && v !== undefined && v !== '') {
        const s = typeof v === 'string' ? v : String(v);
        for (let i = 0; i < s.length; i++) h = imul(h ^ s.charCodeAt(i), 0x01000193);
      }
      h = imul(h ^ (j + 1), 0x01000193); // separator z numerem kolumny
    }
    return (h >>> 0).toString(36);
  }

  /** Wartość surowa (przed konwersją) wg reguły. */
  function surowa(pole, reg, w, zrodlo, pamiec) {
    if (!reg || reg.regula === 'brak') return null;
    if (reg.regula === 'stala') {
      if (reg.zZrodla && zrodlo[reg.zZrodla]) return zrodlo[reg.zZrodla];
      return reg.wartosc === undefined ? null : reg.wartosc;
    }
    if (reg.regula === 'kolumna') {
      if (reg.szablon) {
        let pusto = false;
        const t = reg.szablon.replace(/\{([^}]+)\}/g, function (_, k) { const v = N.tekst(w[k]); if (!v) pusto = true; return v; });
        return pusto ? null : t;
      }
      let v = w[reg.kolumna];
      if (N.pusta(v) && reg.zapas) v = w[reg.zapas];
      if (reg.wzorzec && !N.pusta(v)) v = wyciagnij(reg.wzorzec, N.tekst(v));
      if (N.pusta(v) && reg.wartosc !== undefined && reg.wartosc !== null && reg.wartosc !== '') return reg.wartosc;
      return v === undefined ? null : v;
    }
    if (reg.regula === 'adres') {
      const kl = 'a:' + reg.kolumna;
      if (!pamiec[kl]) pamiec[kl] = zPamieci('adres', N.tekst(w[reg.kolumna]), N.adres);
      return pamiec[kl][pole];
    }
    return null; // wspolrzedne_tekst – obsługa łączna w zastosuj
  }

  /** Konwersja do typu pola; zapisuje naprawę, gdy wartość została zmieniona. */
  function konwertuj(pole, raw, r, zapisz) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'boolean' || typeof raw === 'number') {
      if (POLE[pole].type === 'boolean' && typeof raw === 'boolean') return raw;
      if ((POLE[pole].type === 'number' || POLE[pole].type === 'integer') && typeof raw === 'number') return raw;
    }
    const t = N.tekst(raw);
    if (N.pusta(t)) return null;
    const f = POLE[pole];
    let v = t, opis = null;
    if (f.aed.slownik) {
      const s = zPamieci('s:' + f.aed.slownik, t, function (x) { return N.slownik(f.aed.slownik, x); });
      if (s.wartosc !== null) {
        v = s.wartosc;
        opis = 'Rozpoznano wartość „' + t + '” jako „' + v + '”' + (s.pewnosc === 'wysoka' ? '.' : ' (dopasowanie przybliżone – sprawdź).');
      }
    } else if (pole === 'kod_pocztowy') {
      const k = N.kodPocztowy(t); if (k) { v = k; opis = 'Ujednolicono zapis kodu pocztowego.'; }
    } else if (pole === 'telefon_kontaktowy') {
      const k = N.telefon(t); if (k) { v = k; opis = 'Ujednolicono zapis telefonu (same cyfry' + (/,|;| lub | oraz /.test(t) ? ', pierwszy z kilku numerów' : '') + ').'; }
    } else if (pole === 'email_kontaktowy') {
      const k = N.email(t); if (k) { v = k; opis = 'Ujednolicono zapis adresu e-mail.'; }
    } else if (pole === 'godziny_dostepnosci') {
      const k = zPamieci('godziny', t, N.godziny); if (k) { v = k; opis = 'Zapisano godziny w formacie opening_hours.'; }
    } else if (pole === 'kod_terc_gminy' || pole === 'kod_simc') {
      const c = t.replace(/[\s-]/g, '');
      if (/^\d{6}$/.test(c)) { v = '0' + c; opis = 'Dodano zero wiodące (zgubione przez arkusz kalkulacyjny).'; } else if (/^\d{7}$/.test(c)) v = c;
    } else if (pole === 'kod_ulic') {
      const c = t.replace(/\s/g, '');
      if (/^\d{4}$/.test(c)) { v = '0' + c; opis = 'Dodano zero wiodące.'; }
    } else if (pole === 'dysponent_regon') {
      const c = t.replace(/[\s-]/g, '');
      if (/^\d{8}$/.test(c)) { v = '0' + c; opis = 'Dodano zero wiodące.'; } else if (/^(\d{9}|\d{14})$/.test(c)) { v = c; opis = 'Usunięto spacje i myślniki.'; }
    } else if (pole === 'id_aed') {
      if (RE_UUID.test(t)) { v = t.toLowerCase(); opis = 'Zamieniono litery identyfikatora na małe.'; }
    } else if (f.type === 'number') {
      const n = N.liczba(t); if (n !== null) { v = n; opis = 'Zamieniono tekst na liczbę.'; }
    } else if (f.type === 'integer') {
      const n = N.kondygnacja(t); if (n !== null) { v = n; opis = 'Zamieniono opis kondygnacji na liczbę (0 = parter).'; }
    } else if (f.type === 'boolean') {
      const b = N.bool(t); if (b !== null) { v = b; opis = 'Zamieniono „' + t + '” na ' + (b ? 'tak (true)' : 'nie (false)') + '.'; }
    } else if (f.type === 'date') {
      const d = N.data(t); if (d) { v = d; opis = 'Zapisano datę w formacie RRRR-MM-DD.'; }
    } else if (f.type === 'datetime') {
      const d = N.dataCzas(t); if (d) { v = d; opis = 'Zapisano datę i czas w formacie RRRR-MM-DDThh:mm:ss.'; }
    }
    if (zapisz && opis && String(v) !== t) napraw(r, pole, t, v, opis, f.aed.slownik ? 'slownik' : RODZAJ_POLA[pole] || RODZAJ_TYPU[f.type] || 'format');
    return v;
  }

  /**
   * Zastosowanie mapowania do wszystkich wierszy źródła.
   * @returns {{rekordy: Object[], podsumowanie: {rekordy:number, naprawy:number, puste:Object<string,number>}}}
   */
  function zastosuj(zrodlo, mapowanie) {
    mapowanie = mapowanie || podpowiedz(zrodlo);
    const wiersze = zrodlo.wiersze || [];
    const meta = zrodlo.meta || {};
    const idZr = zrodlo.id || zrodlo.kod;
    const przesuniecie = zrodlo.typ === 'FORMULARZ' ? 1 : (Number(meta.wierszNaglowka) || 1) + 1;
    const regLat = mapowanie.szerokosc_geograficzna, regLon = mapowanie.dlugosc_geograficzna;
    const puste = {};
    POLA.forEach(function (f) { puste[f.name] = 0; });
    let naprawy = 0;
    const rekordy = new Array(wiersze.length);
    pamiecNorm = new Map();

    for (let i = 0; i < wiersze.length; i++) {
      const w = wiersze[i] || {};
      const nr = i + przesuniecie;
      const r = { _id: idZr + ':' + nr, _zrodlo: idZr, _kodZrodla: zrodlo.kod, _wiersz: nr, _odcisk: odcisk(w), _surowy: w, _naprawy: [] };
      const pamiec = {};

      for (let j = 0; j < POLA.length; j++) {
        const pole = POLA[j].name;
        if (pole === 'szerokosc_geograficzna' || pole === 'dlugosc_geograficzna') { r[pole] = null; continue; }
        const reg = mapowanie[pole];
        const raw = surowa(pole, reg, w, zrodlo, pamiec);
        r[pole] = konwertuj(pole, raw, r, reg && reg.regula !== 'stala');
      }
      // naprawy z rozbioru adresu – tylko dla pól, które faktycznie biorą wartość z tej kolumny adresu
      Object.keys(pamiec).forEach(function (k) {
        const kolumna = k.slice(2);
        pamiec[k].naprawy.forEach(function (opis) {
          const pole = /kod pocztowy/i.test(opis) ? 'kod_pocztowy' : 'cecha_ulicy';
          const reg = mapowanie[pole];
          if (!reg || reg.regula !== 'adres' || reg.kolumna !== kolumna) return;
          napraw(r, pole, N.tekst(w[kolumna]), r[pole], opis, pole);
        });
      });
      if (pamiecNorm.size > 200000) pamiecNorm = new Map(); // ochrona pamięci przy bardzo różnorodnych danych

      uzupelnijAutomatyczne(r, mapowanie, zrodlo, meta);
      wspolrzedneRekordu(r, w, regLat, regLon, zrodlo);
      idRekordu(r, mapowanie.id_aed, w, idZr, nr + '|' + r._odcisk);
      poprawkiPoMapowaniu(r);

      for (let j = 0; j < POLA.length; j++) if (r[POLA[j].name] === null) puste[POLA[j].name]++;
      naprawy += r._naprawy.length;
      rekordy[i] = r;
    }
    return { rekordy: rekordy, podsumowanie: { rekordy: rekordy.length, naprawy: naprawy, puste: puste } };
  }

  /** Pola uzupełniane automatycznie, gdy nie mają mapowania (reguła „brak” lub brak wpisu) – id_aed w idRekordu. */
  function uzupelnijAutomatyczne(r, mapowanie, zrodlo, meta) {
    const bez = function (p) { return !mapowanie[p] || mapowanie[p].regula === 'brak'; };
    if (bez('zrodlo_danych') && r.zrodlo_danych === null) r.zrodlo_danych = zrodlo.kod || null;
    if (bez('licencja_rekordu') && r.licencja_rekordu === null && zrodlo.licencja) r.licencja_rekordu = zrodlo.licencja;
    if (bez('data_aktualizacji_rekordu') && r.data_aktualizacji_rekordu === null) {
      r.data_aktualizacji_rekordu = N.dataCzas(meta.dataDanych) || N.dataCzas(zrodlo.dataPobrania) || null;
    }
  }

  function wspolrzedneRekordu(r, w, regLat, regLon, zrodlo) {
    let wynik = null, opisZ = '';
    const tekstowa = function (reg) { return reg && reg.regula === 'wspolrzedne_tekst'; };
    if (tekstowa(regLat) && tekstowa(regLon) && regLat.kolumna === regLon.kolumna) {
      const t = N.tekst(w[regLat.kolumna]);
      if (!t) return;
      wynik = N.wspolrzedneZTekstu(t);
      opisZ = t;
    } else {
      // reguły mieszane: współrzędna z kolumny „para” bierze swoją część, druga – zwykłą wartość
      const czesc = function (reg, ktora, pole) {
        if (!tekstowa(reg)) return surowa(pole, reg, w, zrodlo, {});
        const t = N.tekst(w[reg.kolumna]);
        if (!t) return null;
        const p = N.wspolrzedneZTekstu(t);
        return p[ktora] !== null ? p[ktora] : t;
      };
      const a = czesc(regLat, 'lat', 'szerokosc_geograficzna');
      const b = czesc(regLon, 'lon', 'dlugosc_geograficzna');
      if (N.pusta(a) && N.pusta(b)) return;
      if (N.pusta(a) || N.pusta(b)) {
        // jedna współrzędna – bez par nie naprawiamy, tylko konwersja
        r.szerokosc_geograficzna = N.pusta(a) ? null : (N.stopnie(a) ? N.stopnie(a).wartosc : N.tekst(a));
        r.dlugosc_geograficzna = N.pusta(b) ? null : (N.stopnie(b) ? N.stopnie(b).wartosc : N.tekst(b));
        return;
      }
      wynik = N.wspolrzedne(a, b);
      opisZ = N.tekst(a) + ', ' + N.tekst(b);
    }
    if (wynik.lat === null || wynik.lon === null) {
      // nie rozpoznano – zostawiamy tekst, walidacja zgłosi błąd typu
      r.szerokosc_geograficzna = wynik.lat !== null ? wynik.lat : (regLat && regLat.regula === 'kolumna' ? N.tekst(w[regLat.kolumna]) || null : opisZ || null);
      r.dlugosc_geograficzna = wynik.lon !== null ? wynik.lon : (regLon && regLon.regula === 'kolumna' ? N.tekst(w[regLon.kolumna]) || null : opisZ || null);
      return;
    }
    r.szerokosc_geograficzna = wynik.lat;
    r.dlugosc_geograficzna = wynik.lon;
    // precyzja z TEKSTU źródła („52.100000” ma 6 miejsc, choć liczba to 52.1) – używa jej walidacja
    if (typeof wynik.precyzja === 'number') r._precyzja = wynik.precyzja;
    // jedna naprawa na każdy rodzaj zmiany (np. przecinek + zamiana kolejności)
    wynik.naprawy.forEach(function (opis) {
      napraw(r, 'szerokosc_geograficzna', opisZ, wynik.lat + ', ' + wynik.lon, opis, rodzajWspolrzednych(opis));
    });
  }

  function idRekordu(r, reg, w, idZr, nr) {
    const kluczId = idZr + '|' + nr;
    const v = r.id_aed;
    if (typeof v === 'string' && RE_UUID.test(v)) { idPamiec.set(kluczId, v); return; }
    let id = idPamiec.get(kluczId);
    if (!id) { id = nowyUuid(); idPamiec.set(kluczId, id); }
    if (v !== null && v !== undefined && v !== '') {
      napraw(r, 'id_aed', pokaz(v), id, 'Identyfikator „' + pokaz(v) + '” nie jest UUID – nadano nowy. Dotychczasowy numer warto zachować w polu „Identyfikator u dysponenta”.', 'nowy_identyfikator');
    }
    r.id_aed = id;
  }

  /** Uzupełnienia wynikające z kilku pól naraz. */
  function poprawkiPoMapowaniu(r) {
    // cecha w nazwie ulicy („Aleja Jana Pawła II”, „ul. Lwowska”)
    if (typeof r.ulica === 'string' && r.ulica) {
      const rc = N.rozdzielCeche(r.ulica);
      if (rc.cecha && rc.cecha !== 'inne' && rc.nazwa) {
        const z = r.ulica;
        r.ulica = rc.nazwa;
        if (!r.cecha_ulicy) r.cecha_ulicy = rc.cecha;
        napraw(r, 'ulica', z, r.ulica, 'Oddzielono cechę „' + rc.cecha + '” od nazwy ulicy.', 'cecha_ulicy');
      } else if (!r.cecha_ulicy) {
        r.cecha_ulicy = rc.cecha === 'inne' ? 'inne' : 'ul.';
        napraw(r, 'cecha_ulicy', '', r.cecha_ulicy, 'Brak cechy ulicy przy „' + r.ulica + '” – przyjęto „' + r.cecha_ulicy + '”. Sprawdź w TERYT ULIC.', 'cecha_ulicy');
      }
    }
    // dostęp publiczny + 24/7
    if (r.dostepnosc === 'publiczna_w_godzinach' && r.godziny_dostepnosci === '24/7') {
      r.dostepnosc = 'publiczna_24_7';
      napraw(r, 'dostepnosc', 'publiczna_w_godzinach', 'publiczna_24_7', 'Dostęp publiczny i godziny 24/7 – ustawiono „publiczna 24/7”.', 'dostepnosc_24_7');
    }
    // województwo z kodu TERC
    if (!r.wojewodztwo && typeof r.kod_terc_gminy === 'string' && /^\d{7}$/.test(r.kod_terc_gminy)) {
      const w = N.wojewodztwo(r.kod_terc_gminy.slice(0, 2));
      if (w) { r.wojewodztwo = w; napraw(r, 'wojewodztwo', '', w, 'Uzupełniono województwo z kodu TERC gminy.', 'wojewodztwo_z_terc'); }
    }
    // typ dysponenta z nazwy
    if (!r.dysponent_typ && typeof r.dysponent_nazwa === 'string' && r.dysponent_nazwa) {
      const s = N.slownik('dysponent_typ', r.dysponent_nazwa);
      if (s.wartosc && s.pewnosc !== 'niska') {
        r.dysponent_typ = s.wartosc;
        napraw(r, 'dysponent_typ', '', s.wartosc, 'Ustalono typ dysponenta na podstawie nazwy „' + r.dysponent_nazwa + '” – sprawdź.', 'typ_dysponenta');
      }
    }
  }

  /** Lista pól wzorca z grupą i obowiązkowością (dla UI). */
  function pola() {
    return POLA.map(function (f) {
      const c = f.constraints || {};
      return {
        name: f.name, title: f.title, opis: f.description, type: f.type, grupa: f.aed.grupa,
        obowiazkowosc: f.aed.obowiazkowosc, wymagane: !!c.required, slownik: f.aed.slownik || null,
        enum: c.enum || null, format: f.aed.format, przyklad: f.aed.przyklad,
        adresowe: ADRES_POLA.indexOf(f.name) >= 0, wspolrzedne: WSP_POLA.indexOf(f.name) >= 0
      };
    });
  }

  AED.mapowanie = {
    REGULY: REGULY,
    // pola uzupełniane zawsze, gdy nie mają mapowania (id_aed: UUID; pozostałe z danych źródła)
    POLA_AUTOMATYCZNE: ['id_aed', 'zrodlo_danych', 'licencja_rekordu', 'data_aktualizacji_rekordu'],
    // pola, które zastosuj może uzupełnić z innych pól rekordu (zawsze z wpisem w _naprawy)
    POLA_POCHODNE: ['cecha_ulicy', 'wojewodztwo', 'dysponent_typ', 'dostepnosc'],
    RODZAJE_NAPRAW: RODZAJE_NAPRAW,
    ADRES_POLA: ADRES_POLA,
    WSP_POLA: WSP_POLA,
    podpowiedz: podpowiedz,
    zastosuj: zastosuj,
    pola: pola,
    nowyUuid: nowyUuid,
    /** Zapomina ID nadane wierszom źródła (np. po usunięciu źródła). */
    zapomnij: function (idZrodla) {
      const pref = idZrodla + '|';
      Array.from(idPamiec.keys()).forEach(function (k) { if (k.indexOf(pref) === 0) idPamiec.delete(k); });
    },
    odcisk: odcisk,
    _test: { profil: profil, kandydaciNaglowka: kandydaciNaglowka, idPamiec: idPamiec }
  };
})(window.AED);
