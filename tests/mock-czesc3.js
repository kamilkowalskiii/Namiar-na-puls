/* Atrapa (mock) kontraktu części 3: AED.normalizacja, AED.mapowanie, AED.walidacja i rozszerzenia AED.store.
   Służy WYŁĄCZNIE do testów interfejsu, zanim powstaną prawdziwe moduły (js/core/*.js).
   Każda część wczytuje się tylko, gdy prawdziwej nie ma. Nie dołączaj na stałe do index.html. */
(function (AED) {
  'use strict';
  const POLA = AED.wzorzec.schema.fields;
  const POLE = {};
  POLA.forEach(function (p) { POLE[p.name] = p; });
  const SL = AED.wzorzec.slowniki;

  function bezOgonkow(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // ------------------------------------------------------------ normalizacja
  const N = {
    liczba: function (t) {
      if (typeof t === 'number') return t;
      const s = String(t || '').trim().replace(/\s/g, '').replace(',', '.');
      if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
      return Number(s);
    },
    bool: function (t) {
      const s = bezOgonkow(t);
      if (/^(tak|true|1|yes|t)$/.test(s)) return true;
      if (/^(nie|false|0|no|n)$/.test(s)) return false;
      return null;
    },
    data: function (t) {
      const s = String(t || '').trim();
      let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return m[1] + '-' + m[2] + '-' + m[3];
      m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
      if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
      return null;
    },
    slownik: function (nazwa, t) {
      const s = bezOgonkow(t);
      const lista = SL[nazwa] || [];
      const traf = lista.find(function (x) { return bezOgonkow(x.kod) === s || bezOgonkow(x.etykieta) === s; });
      if (traf) return { wartosc: traf.kod, pewnosc: 'wysoka' };
      const cz = lista.find(function (x) { return s && (bezOgonkow(x.etykieta).indexOf(s) === 0 || bezOgonkow(x.kod).indexOf(s) === 0); });
      return cz ? { wartosc: cz.kod, pewnosc: 'srednia' } : { wartosc: null, pewnosc: 'niska' };
    }
  };
  if (!AED.normalizacja) AED.normalizacja = N;

  // ------------------------------------------------------------ mapowanie
  const SYNONIMY = {
    nazwa: ['nazwa', 'name', 'miejsce'],
    id_lokalne: ['numer id', 'id', 'lp'],
    szerokosc_geograficzna: ['szerokosc geograficzna', 'szer', 'lat', 'latitude'],
    dlugosc_geograficzna: ['dlugosc geograficzna', 'dl', 'lon', 'lng', 'longitude'],
    miejscowosc: ['miejscowosc', 'city', 'miasto'],
    ulica: ['ulica', 'street'],
    numer_budynku: ['numer budynku', 'home number', 'nr'],
    kod_pocztowy: ['kod pocztowy', 'postcode'],
    opis_lokalizacji: ['lokalizacja', 'opis lokalizacji', 'description', 'uwagi'],
    godziny_dostepnosci: ['godziny', 'godziny dostepnosci', 'opening hours'],
    telefon_kontaktowy: ['phone', 'telefon'],
    email_kontaktowy: ['email', 'e mail'],
    dostepnosc: ['dostep', 'dostepnosc']
  };

  function podpowiedz(z) {
    const m = {};
    const kol = z.kolumny.map(function (k) { return { k: k, n: bezOgonkow(k) }; });
    POLA.forEach(function (p) {
      const dokl = kol.find(function (c) { return c.n === bezOgonkow(p.name) || c.n === bezOgonkow(p.title); });
      if (dokl) { m[p.name] = { regula: 'kolumna', kolumna: dokl.k, pewnosc: 'wysoka', powod: 'Nazwa kolumny zgodna z polem wzorca.' }; return; }
      const syn = (SYNONIMY[p.name] || []).map(bezOgonkow);
      const s = kol.find(function (c) { return syn.indexOf(c.n) >= 0; });
      if (s) m[p.name] = { regula: 'kolumna', kolumna: s.k, pewnosc: 'srednia', powod: 'Podobna nazwa kolumny („' + s.k + '”).' };
    });
    const adres = kol.find(function (c) { return c.n === 'adres'; });
    if (adres) ['cecha_ulicy', 'ulica', 'numer_budynku', 'kod_pocztowy', 'miejscowosc'].forEach(function (p) {
      if (!m[p]) m[p] = { regula: 'adres', kolumna: adres.k, pewnosc: 'srednia', powod: 'Kolumna „' + adres.k + '” zawiera pełny adres.' };
    });
    const geom = kol.find(function (c) { return c.n === 'geometry' || c.n === 'wspolrzedne'; });
    if (geom && !m.szerokosc_geograficzna) ['szerokosc_geograficzna', 'dlugosc_geograficzna'].forEach(function (p) {
      m[p] = { regula: 'wspolrzedne_tekst', kolumna: geom.k, pewnosc: 'niska', powod: 'Kolumna „' + geom.k + '” wygląda na współrzędne.' };
    });
    if (!m.status) m.status = { regula: 'stala', wartosc: 'do_weryfikacji', pewnosc: 'srednia', powod: 'Rekordy z importu wymagają potwierdzenia.' };
    if (!m.lokalizacja_przyblizona) m.lokalizacja_przyblizona = { regula: 'stala', wartosc: false, pewnosc: 'niska', powod: 'Zakładamy dokładne współrzędne.' };
    if (!m.dysponent_nazwa && z.dysponent) m.dysponent_nazwa = { regula: 'stala', wartosc: z.dysponent, pewnosc: 'srednia', powod: 'Dysponent z rejestru źródeł.' };
    if (!m.data_weryfikacji) m.data_weryfikacji = { regula: 'stala', wartosc: String(z.dataPobrania || '').slice(0, 10), pewnosc: 'niska', powod: 'Data pobrania danych.' };
    if (!m.opis_lokalizacji) m.opis_lokalizacji = { regula: 'brak', pewnosc: 'niska', powod: 'Nie znaleziono kolumny z opisem miejsca.' };
    return m;
  }

  function rozbijAdres(t) {
    const s = String(t || '');
    const out = {};
    const kod = s.match(/(\d{2}-\d{3})\s*([^,]+)?/);
    if (kod) { out.kod_pocztowy = kod[1]; if (kod[2]) out.miejscowosc = kod[2].trim(); }
    const ul = s.match(/(ul\.|al\.|pl\.|os\.)\s*([^,\d]+?)\s*(\d+\w*)?\s*(,|$)/i);
    if (ul) { out.cecha_ulicy = ul[1].toLowerCase(); out.ulica = ul[2].trim(); if (ul[3]) out.numer_budynku = ul[3]; }
    return out;
  }
  function rozbijWsp(t) {
    const s = String(t || '');
    const gj = s.match(/coordinates"?\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
    if (gj) return { szerokosc_geograficzna: Number(gj[2]), dlugosc_geograficzna: Number(gj[1]) };
    const m = s.match(/(-?\d+[.,]\d+)\s*[,; ]\s*(-?\d+[.,]\d+)/);
    if (!m) return {};
    return { szerokosc_geograficzna: N.liczba(m[1]), dlugosc_geograficzna: N.liczba(m[2]) };
  }

  function wartoscPola(p, surowa, naprawy) {
    if (surowa === undefined || surowa === null || String(surowa).trim() === '') return null;
    const t = String(surowa).trim().replace(/\s+/g, ' ');
    if (t !== String(surowa)) naprawy.push({ pole: p.name, z: surowa, na: t, opis: 'Usunięto zbędne spacje.' });
    if (p.aed.slownik) { const r = N.slownik(p.aed.slownik, t); return r.wartosc || t; }
    if (p.type === 'number' || p.type === 'integer') {
      const v = N.liczba(t);
      if (v !== null && /,/.test(t)) naprawy.push({ pole: p.name, z: t, na: v, opis: 'Zamieniono przecinek dziesiętny na kropkę.' });
      return v === null ? t : v;
    }
    if (p.type === 'boolean') { const b = N.bool(t); return b === null ? t : b; }
    if (p.type === 'date') { const d = N.data(t); return d || t; }
    return t;
  }

  function zastosuj(z, mapowanie) {
    const rekordy = [];
    const puste = {};
    let naprawyN = 0;
    z.wiersze.forEach(function (w, i) {
      const naprawy = [];
      const r = { _id: z.kod + '-' + (i + 1), _zrodlo: z.id, _kodZrodla: z.kod, _wiersz: i + 1, _surowy: w, _naprawy: naprawy };
      POLA.forEach(function (p) {
        const reg = mapowanie[p.name] || { regula: 'brak' };
        let v = null;
        if (reg.regula === 'kolumna') v = wartoscPola(p, w[reg.kolumna], naprawy);
        else if (reg.regula === 'stala') v = reg.wartosc === undefined ? null : reg.wartosc;
        else if (reg.regula === 'adres') { const a = rozbijAdres(w[reg.kolumna]); v = a[p.name] === undefined ? null : a[p.name]; }
        else if (reg.regula === 'wspolrzedne_tekst') { const a = rozbijWsp(w[reg.kolumna]); v = a[p.name] === undefined ? null : a[p.name]; }
        r[p.name] = v;
      });
      // automatyczne pola
      r.id_aed = r.id_aed || ('00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
      r.zrodlo_danych = z.kod;
      r.licencja_rekordu = r.licencja_rekordu || z.licencja || null;
      r.data_aktualizacji_rekordu = new Date().toISOString().slice(0, 19);
      // zamiana szerokości z długością
      const la = r.szerokosc_geograficzna, lo = r.dlugosc_geograficzna;
      if (typeof la === 'number' && typeof lo === 'number' && la >= 14.1 && la <= 24.2 && lo >= 49 && lo <= 54.9) {
        r.szerokosc_geograficzna = lo; r.dlugosc_geograficzna = la;
        naprawy.push({ pole: 'szerokosc_geograficzna', z: la, na: lo, opis: 'Zamieniono szerokość z długością.' });
      }
      naprawyN += naprawy.length;
      POLA.forEach(function (p) { if (r[p.name] === null) puste[p.name] = (puste[p.name] || 0) + 1; });
      rekordy.push(r);
    });
    return { rekordy: rekordy, podsumowanie: { rekordy: rekordy.length, naprawy: naprawyN, puste: puste } };
  }

  if (!AED.mapowanie) AED.mapowanie = {
    REGULY: ['kolumna', 'stala', 'adres', 'wspolrzedne_tekst', 'brak'],
    podpowiedz: podpowiedz,
    zastosuj: zastosuj,
    pola: function () { return POLA; }
  };

  // ------------------------------------------------------------ walidacja
  let nr = 0;
  function walidujRekord(r) {
    const out = [];
    const dodaj = function (pole, poziom, kod, komunikat, podp) {
      const p = { id: 'p' + (++nr), rekordId: r._id, kodZrodla: r._kodZrodla, wiersz: r._wiersz, pole: pole, poziom: poziom,
        kod: kod, komunikat: komunikat, wartosc: r[pole] };
      if (podp !== undefined) p.podpowiedz = podp;
      out.push(p);
    };
    POLA.forEach(function (p) {
      const v = r[p.name];
      const c = p.constraints || {};
      if (v === null || v === undefined || v === '') {
        if (p.aed.obowiazkowosc === 'O') dodaj(p.name, 'blad', 'BRAK_WYMAGANEGO', 'Brak wartości w polu obowiązkowym.',
          p.name === 'dostepnosc' ? { wartosc: 'publiczna_w_godzinach', opis: 'Najczęstsza wartość w tym źródle: publiczna w godzinach.' } : undefined);
        return;
      }
      if (c.enum && c.enum.indexOf(v) < 0) {
        const s = N.slownik(p.aed.slownik, v);
        dodaj(p.name, 'blad', 'SPOZA_SLOWNIKA', 'Wartości „' + v + '” nie ma w słowniku.', s.wartosc ? s.wartosc : undefined);
      }
      if ((p.type === 'number' || p.type === 'integer') && typeof v !== 'number') dodaj(p.name, 'blad', 'NIE_LICZBA', 'To nie jest liczba.');
      else if (typeof v === 'number' && ((c.minimum !== undefined && v < c.minimum) || (c.maximum !== undefined && v > c.maximum))) {
        dodaj(p.name, 'blad', 'POZA_ZAKRESEM', 'Wartość spoza zakresu ' + c.minimum + '–' + c.maximum + '.');
      }
      if (c.pattern && typeof v === 'string' && !new RegExp(c.pattern).test(v)) {
        let podp;
        if (p.name === 'kod_pocztowy' && /^\d{5}$/.test(v)) podp = v.slice(0, 2) + '-' + v.slice(2);
        dodaj(p.name, p.aed.obowiazkowosc === 'O' ? 'blad' : 'ostrzezenie', 'ZLY_FORMAT', 'Niepoprawny format.', podp);
      }
      if (c.maxLength && typeof v === 'string' && v.length > c.maxLength) {
        dodaj(p.name, 'ostrzezenie', 'ZA_DLUGIE', 'Tekst dłuższy niż ' + c.maxLength + ' znaków.',
          { wartosc: v.slice(0, c.maxLength), opis: 'Skróć do ' + c.maxLength + ' znaków.' });
      }
    });
    if (r.nazwa && /^defibrylator$/i.test(r.nazwa)) dodaj('nazwa', 'ostrzezenie', 'NAZWA_OGOLNA', 'Nazwa nie mówi, gdzie jest urządzenie.');
    if (!r.kod_pocztowy && r.miejscowosc) dodaj('kod_pocztowy', 'ostrzezenie', 'BRAK_ZALECANEGO', 'Brak kodu pocztowego (pole zalecane).');
    return out;
  }

  if (!AED.walidacja) AED.walidacja = {
    walidujRekord: walidujRekord,
    waliduj: function (rekordy) {
      const problemy = [];
      rekordy.forEach(function (r) { walidujRekord(r).forEach(function (p) { problemy.push(p); }); });
      const bledy = problemy.filter(function (p) { return p.poziom === 'blad'; });
      return { problemy: problemy, podsumowanie: { rekordy: rekordy.length, bledy: bledy.length, ostrzezenia: problemy.length - bledy.length,
        rekordyZBledami: new Set(bledy.map(function (p) { return p.rekordId; })).size, wgPola: {}, wgZrodla: {} } };
    }
  };

  // ------------------------------------------------------------ magazyn
  const S = AED.store;
  if (!S.ustawMapowanie) {
    let rekordy = [];
    const poprawki = {}; // _id -> {pole: wartosc}
    S.ustawMapowanie = function (id, m) {
      const z = S.zrodlo(id); if (!z) return null;
      z.mapowanie = m;
      AED.emit('zrodla:zmiana', { akcja: 'zmieniono', zrodlo: z, pola: ['mapowanie'] });
      return z;
    };
    Object.defineProperty(S, 'rekordy', { get: function () { return rekordy.slice(); } });
    S.ustawRekordy = function (r) { rekordy = r; AED.emit('rekordy:zmiana', { akcja: 'ustawiono', liczba: r.length }); };
    S.aktualizujRekord = function (id, zmiany) {
      const r = rekordy.find(function (x) { return x._id === id; }); if (!r) return null;
      Object.assign(r, zmiany);
      poprawki[id] = Object.assign(poprawki[id] || {}, zmiany);
      AED.emit('rekordy:zmiana', { akcja: 'zmieniono', rekord: r });
      return r;
    };
    S.przelicz = function () {
      const wszystkie = [];
      S.zrodla.forEach(function (z) {
        AED.mapowanie.zastosuj(z, z.mapowanie || {}).rekordy.forEach(function (r) {
          if (poprawki[r._id]) Object.assign(r, poprawki[r._id]);
          wszystkie.push(r);
        });
      });
      S.ustawRekordy(wszystkie);
      return wszystkie;
    };
  }
})(window.AED);
