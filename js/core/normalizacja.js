/* Normalizacja wartości z „brudnych” źródeł do formatów wzorca.
   Każda funkcja przyjmuje tekst (albo liczbę) i zwraca wartość w formacie wzorca lub null,
   gdy nie da się jej rozpoznać. Funkcje nie rzucają wyjątków.
   Zwykły skrypt (nie moduł ES) – działa także po otwarciu index.html z dysku. */
(function (AED) {
  'use strict';

  // Granice Polski (jak w schemacie: constraints minimum/maximum)
  const PL = { latMin: 49.0, latMax: 54.9, lonMin: 14.1, lonMax: 24.2 };
  const PUSTE = { '': 1, '-': 1, '--': 1, '—': 1, '–': 1, 'brak': 1, 'brak danych': 1, 'b.d.': 1, 'b/d': 1, 'bd': 1,
    'n/a': 1, 'na': 1, 'null': 1, 'none': 1, 'undefined': 1, 'nan': 1, '?': 1, 'x': 0 };

  // ------------------------------------------------------------ pomocnicze
  function tekst(t) {
    if (t === null || t === undefined) return '';
    if (Object.prototype.toString.call(t) === "[object Date]") return isNaN(t) ? '' : dataLokalna(t);
    return String(t).replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /** Czy wartość oznacza brak danych („-”, „brak”, „b.d.” …). */
  function pusta(t) {
    const s = tekst(t).toLowerCase();
    return s === '' || PUSTE[s] === 1;
  }
  const OGONKI = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z' };
  /** małe litery, bez polskich znaków i diakrytyków */
  function bezOgonkow(t) {
    return tekst(t).toLowerCase().replace(/[ąćęłńóśźż]/g, function (c) { return OGONKI[c]; })
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  /** klucz do porównań: bez ogonków, tylko litery/cyfry/„/” rozdzielone pojedynczą spacją */
  function klucz(t) {
    return bezOgonkow(t).replace(/[^a-z0-9/]+/g, ' ').trim();
  }
  function dwie(n) { return (n < 10 ? '0' : '') + n; }
  /** Data z obiektu Date w czasie lokalnym (arkusze podają daty o północy czasu lokalnego, nie UTC). */
  function dataLokalna(d) { return d.getFullYear() + '-' + dwie(d.getMonth() + 1) + '-' + dwie(d.getDate()); }

  // ---------------------------------------------------------------- liczby
  /** „52,2297” / „ 1 234,5 ” / „1.234,5” / 52.2 -> number; null gdy to nie liczba. */
  function liczba(t) {
    if (typeof t === 'number') return isFinite(t) ? t : null;
    let s = tekst(t).replace(/\s+/g, '').replace(/^'/, '').replace(/[−–]/g, '-');
    if (!s) return null;
    const przecinki = (s.match(/,/g) || []).length, kropki = (s.match(/\./g) || []).length;
    if (przecinki === 1 && kropki === 0) s = s.replace(',', '.');
    else if (przecinki === 1 && kropki >= 1 && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (przecinki >= 1 && kropki === 1 && s.lastIndexOf('.') > s.lastIndexOf(',')) s = s.replace(/,/g, '');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  /** Liczba miejsc po przecinku zapisana w tekście (lub w liczbie). */
  function miejscaPoPrzecinku(t) {
    const s = typeof t === 'number' ? String(t) : tekst(t).replace(',', '.');
    if (/e/i.test(s)) return 10;
    const m = /\.(\d+)/.exec(s);
    return m ? m[1].length : 0;
  }

  // ---------------------------------------------------------- współrzędne
  /** Jedna współrzędna: liczba dziesiętna albo DMS (50°41'12"N, 50 41 12.5 N, N50°41.2').
      Zwraca { wartosc, os: 'NS'|'EW'|null, dms: bool, miejsca } albo null. */
  function stopnie(t) {
    if (typeof t === 'number') return isFinite(t) ? { wartosc: t, os: null, dms: false, miejsca: miejscaPoPrzecinku(t) } : null;
    let s = tekst(t).toUpperCase().replace(/^'/, '');
    if (!s) return null;
    // najpierw przedrostek („szer. 50.1”, „dł.: 21”), dopiero potem litera półkuli
    s = s.replace(/^(SZEROKOŚĆ|SZEROKOSC|SZER|DŁUGOŚĆ|DLUGOSC|DŁUG|DLUG|DŁ|DL|LATITUDE|LONGITUDE|LAT|LON|LNG)\.?(\s*(GEOGRAFICZNA|GEOGR\.?|GEO\.?))?\s*[:=]?\s*/, '');
    let litera = null;
    // litera półkuli tylko samodzielna: na początku przed cyfrą/spacją albo na końcu po cyfrze, symbolu lub spacji
    const mL = /^([NSEW])(?=[\s\d+-])|(?:^|[\s\d°º˚'′’"″”.])([NSEW])$/.exec(s);
    if (mL) {
      litera = mL[1] || mL[2];
      s = mL[1] ? s.slice(1).trim() : s.slice(0, s.length - 1).trim();
    }
    const znak = (litera === 'S' || litera === 'W') ? -1 : 1;
    const os = litera ? (litera === 'N' || litera === 'S' ? 'NS' : 'EW') : null;
    const n = /\d\s+\d/.test(s) ? null : liczba(s); // „50 41 12” to stopnie-minuty-sekundy, nie liczba z separatorem tysięcy
    if (n !== null) return { wartosc: znak * n, os: os, dms: false, miejsca: miejscaPoPrzecinku(s) };
    // DMS: stopnie, minuty, sekundy rozdzielone symbolami lub spacjami
    const m = /^([+-]?\d{1,3}(?:[.,]\d+)?)\s*(?:°|º|˚|ST\.?|STOPNI|\s|:)\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:'|′|’|`|MIN\.?|\s|:)?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|″|”|''|SEK\.?)?)?)?$/.exec(s);
    if (!m) return null;
    const d = liczba(m[1]), mi = m[2] ? liczba(m[2]) : 0, se = m[3] ? liczba(m[3]) : 0;
    if (d === null || mi >= 60 || se >= 60) return null;
    const w = (Math.abs(d) + mi / 60 + se / 3600) * (d < 0 ? -1 : 1) * znak;
    return { wartosc: Math.round(w * 1e7) / 1e7, os: os, dms: !!(m[2] || /[°º˚]/.test(s)), miejsca: m[3] ? 6 : m[2] ? 4 : 0 };
  }

  function wPolsceLat(v) { return v >= PL.latMin && v <= PL.latMax; }
  function wPolsceLon(v) { return v >= PL.lonMin && v <= PL.lonMax; }

  /** Liczba bez kropki dziesiętnej (np. 52229676) – próba wstawienia kropki po 2 cyfrach. */
  function bezKropki(v, wZakresie) {
    if (Math.abs(v) < 1000 || v % 1 !== 0) return null;
    const s = String(Math.abs(v));
    const k = Number(s.slice(0, 2) + '.' + s.slice(2));
    return wZakresie(k) ? k : null;
  }

  /**
   * Para współrzędnych (szerokość, długość) z dowolnych tekstów.
   * @returns {{lat:number|null, lon:number|null, naprawy:string[], ostrzezenia:string[], blad?:string}}
   */
  function wspolrzedne(latT, lonT) {
    const wynik = { lat: null, lon: null, naprawy: [], ostrzezenia: [] };
    if (pusta(latT) && pusta(lonT)) { wynik.blad = 'Brak współrzędnych.'; return wynik; }
    let a = stopnie(latT), b = stopnie(lonT);
    if (!a || !b) {
      wynik.blad = 'Nie rozpoznano ' + (!a && !b ? 'współrzędnych' : !a ? 'szerokości geograficznej' : 'długości geograficznej') +
        ' („' + tekst(!a ? latT : lonT) + '”). Wpisz stopnie dziesiętne z kropką, np. 52.229676.';
      if (a) wynik.lat = a.wartosc;
      if (b) wynik.lon = b.wartosc;
      return wynik;
    }
    if (a.dms || b.dms) wynik.naprawy.push('Zamieniono zapis stopnie-minuty-sekundy na stopnie dziesiętne.');
    if (typeof latT === 'string' && /,/.test(latT) && !a.dms) wynik.naprawy.push('Zamieniono przecinek dziesiętny na kropkę.');
    else if (typeof lonT === 'string' && /,/.test(lonT) && !b.dms) wynik.naprawy.push('Zamieniono przecinek dziesiętny na kropkę.');
    let lat = a.wartosc, lon = b.wartosc;

    // Litery N/E wskazują zamianę kolejności
    if (a.os === 'EW' && b.os === 'NS') {
      const t = lat; lat = lon; lon = t;
      wynik.naprawy.push('Zamieniono szerokość z długością (wskazują na to litery N/E).');
    }
    // Brak kropki dziesiętnej
    const lat2 = wPolsceLat(lat) || wPolsceLon(lat) ? null : bezKropki(lat, function (v) { return wPolsceLat(v) || wPolsceLon(v); });
    const lon2 = wPolsceLat(lon) || wPolsceLon(lon) ? null : bezKropki(lon, function (v) { return wPolsceLat(v) || wPolsceLon(v); });
    if (lat2 !== null || lon2 !== null) {
      if (lat2 !== null) lat = lat2;
      if (lon2 !== null) lon = lon2;
      wynik.naprawy.push('Wstawiono brakującą kropkę dziesiętną we współrzędnych.');
    }
    if (!(wPolsceLat(lat) && wPolsceLon(lon)) && wPolsceLat(lon) && wPolsceLon(lat)) {
      const t = lat; lat = lon; lon = t;
      wynik.naprawy.push('Zamieniono szerokość z długością geograficzną (wartości były w odwrotnej kolejności).');
    }
    wynik.lat = lat; wynik.lon = lon;
    if (!(wPolsceLat(lat) && wPolsceLon(lon))) {
      if (Math.abs(lat) > 1000 && Math.abs(lon) > 1000) {
        wynik.blad = 'Współrzędne wyglądają na układ PL-1992 lub PL-2000 (metry), a nie stopnie WGS84. Przelicz je do WGS84 (np. w QGIS lub na epsg.io).';
      } else if (lat === 0 && lon === 0) {
        wynik.blad = 'Współrzędne 0, 0 oznaczają brak położenia. Wpisz prawdziwe współrzędne punktu.';
      } else {
        wynik.blad = 'Punkt (' + lat + ', ' + lon + ') leży poza Polską. Sprawdź, czy to stopnie dziesiętne WGS84 i czy nie brakuje cyfr.';
      }
    }
    const miejsca = (lat2 !== null || lon2 !== null) ? Math.min(miejscaPoPrzecinku(lat), miejscaPoPrzecinku(lon)) : Math.min(a.miejsca, b.miejsca);
    wynik.precyzja = miejsca;
    if (miejsca < 4) {
      wynik.ostrzezenia.push('Współrzędne mają tylko ' + miejsca + ' ' + (miejsca === 1 ? 'miejsce' : miejsca >= 2 && miejsca <= 4 ? 'miejsca' : 'miejsc') +
        ' po przecinku (dokładność gorsza niż ok. 10 m). Zalecane jest 6 miejsc.');
    }
    return wynik;
  }

  /** Współrzędne w jednej kolumnie: „50.1, 21.7”, „50,1 21,7”, „POINT(21.7 50.1)”, GeoJSON, „50°41'12"N 21°45'E”. */
  function wspolrzedneZTekstu(t) {
    const s = tekst(t);
    if (!s) return wspolrzedne('', '');
    // WKT: POINT(dł szer)
    let m = /^(?:SRID=\d+;)?\s*POINT\s*Z?\s*\(\s*([-+\d.,]+)\s+([-+\d.,]+)/i.exec(s);
    if (m) return dodaj(wspolrzedne(m[2], m[1]), 'Odczytano punkt WKT (kolejność: długość, szerokość).');
    // GeoJSON
    if (/^\{/.test(s)) {
      try {
        const g = JSON.parse(s);
        let c = g && (g.coordinates || (g.geometry && g.geometry.coordinates));
        while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
        if (Array.isArray(c) && c.length >= 2) return dodaj(wspolrzedne(c[1], c[0]), 'Odczytano punkt GeoJSON (kolejność: długość, szerokość).');
      } catch (e) { /* nie GeoJSON */ }
      const r = wspolrzedne('', ''); r.blad = 'Nie rozpoznano współrzędnych w zapisie „' + s.slice(0, 60) + '”.'; return r;
    }
    // Dwie części z literami półkul
    const pol = s.toUpperCase().match(/[^NSEW]*\d[^NSEW]*[NSEW]/g);
    if (pol && pol.length === 2) return wspolrzedne(pol[0].replace(/^[\s,;]+/, ''), pol[1].replace(/^[\s,;]+/, ''));
    const polP = s.toUpperCase().match(/[NSEW][^NSEW]*\d[^NSEW]*/g);
    if (polP && polP.length === 2) return wspolrzedne(polP[0].replace(/[\s,;]+$/, ''), polP[1].replace(/[\s,;]+$/, ''));
    // Średnik / tabulator / pionowa kreska
    let cz = s.split(/\s*[;|\t]\s*/).filter(Boolean);
    if (cz.length !== 2) {
      // liczby z przecinkiem dziesiętnym rozdzielone spacją albo „, ”
      cz = s.match(/[-+]?\d+(?:[.,]\d+)?/g) || [];
      if (cz.length !== 2) {
        // DMS rozdzielone przecinkiem
        cz = s.split(/\s*,\s*/);
      }
    }
    if (cz.length === 2) return wspolrzedne(cz[0], cz[1]);
    const r = wspolrzedne('', '');
    r.blad = 'Nie rozpoznano pary współrzędnych w „' + s.slice(0, 60) + '”. Oczekiwano np. „52.229676, 21.012229”.';
    return r;
  }
  function dodaj(w, naprawa) { w.naprawy.unshift(naprawa); return w; }

  // ---------------------------------------------------------------- adres
  const CECHY = [
    [/^(ul\.?|ulica)$/i, 'ul.'], [/^(al\.*|aleja|aleje|alei)$/i, 'al.'], [/^(pl\.?|plac|placu)$/i, 'pl.'],
    [/^(os\.?|osiedle|osiedla)$/i, 'os.'], [/^rondo$/i, 'rondo'], [/^(skwer|skw\.?)$/i, 'skwer'],
    [/^(bulw\.?|bulwar)$/i, 'bulw.'], [/^(wybrzeże|wyb\.?|droga|trakt|park|ogród|ogrody|wyspa|szosa|zaułek|ścieżka|pasaż|wał|bulwary|rynek)$/i, 'inne']
  ];
  // „inne” tylko z jawnym wyrazem – nie usuwamy go z nazwy (Rynek, Wybrzeże … są częścią nazwy)
  function cechaZWyrazu(w) {
    for (let i = 0; i < CECHY.length; i++) if (CECHY[i][0].test(w)) return CECHY[i][1];
    return null;
  }
  /** „ul. Jasna” / „Aleja Jana Pawła II” / „Al.. Piłsudskiego” -> { cecha, nazwa } (cecha null, gdy brak). */
  function rozdzielCeche(t) {
    const s = tekst(t);
    const m = /^([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+\.*)\s*(.*)$/.exec(s);
    if (!m || !m[2]) return { cecha: null, nazwa: s };
    const c = cechaZWyrazu(m[1].replace(/\.+$/, '') + (/\./.test(m[1]) ? '.' : ''));
    if (!c) return { cecha: null, nazwa: s };
    if (c === 'inne') return { cecha: 'inne', nazwa: s }; // wyraz zostaje w nazwie
    return { cecha: c, nazwa: m[2].trim() };
  }

  const RE_NUMER = /^(?:nr\.?\s*)?(\d+(?:\s?[A-Za-z])?(?:\s*[/-]\s*\d+[A-Za-z]?)?)(?:\s*(?:m\.?|lok\.?|lokal)\s*\d+[A-Za-z]?)?$/i;
  /** „Lwowska 28a” -> { nazwa:'Lwowska', numer:'28a' }; „Konstytucji 3 Maja 1” -> numer 1. */
  function oddzielNumer(s) {
    const slowa = tekst(s).split(' ');
    for (let k = Math.min(3, slowa.length - 1); k >= 1; k--) {
      const ogon = slowa.slice(slowa.length - k).join(' ');
      const m = RE_NUMER.exec(ogon);
      if (m) {
        const nazwa = slowa.slice(0, slowa.length - k).join(' ').replace(/[,\s]+$/, '');
        // „3 Maja” – numer, po którym nie ma nic, a przed nim jest „Konstytucji” -> to część nazwy tylko wtedy, gdy liczba jest w środku
        return { nazwa: nazwa, numer: m[1].replace(/\s+/g, '') };
      }
    }
    return { nazwa: tekst(s), numer: null };
  }

  /**
   * Adres w jednym polu -> części wzorca.
   * Przykłady: „ul. Lwowska 28a, 38-400 Krosno”, „38-400 Krosno, ul. Lwowska 28a”, „Al. Jana Pawła II 4/6”,
   * „pl. Konstytucji 3 Maja 1”, „Łąkiewka 12” (wieś bez ulic), „Krosno, Lwowska 28”.
   */
  function adres(t) {
    const w = { cecha_ulicy: null, ulica: null, numer_budynku: null, kod_pocztowy: null, miejscowosc: null, naprawy: [] };
    let s = tekst(t);
    if (!s) return w;
    s = s.replace(/^adres\s*:\s*/i, '')
      // „Krosno ul. Lwowska 28” – brak przecinka przed cechą ulicy
      .replace(/([^,;\s])\s+(?=(?:ul|al|pl|os)\.+\s*[A-Za-zĄ-Żą-ż0-9]|(?:ulica|aleja|aleje|plac|osiedle)\s)/gi, '$1, ');
    // kod pocztowy (także bez myślnika) + miejscowość po nim
    // z myślnikiem – gdziekolwiek; bez myślnika („12 345”, „12345”) tylko na początku części i przed nazwą miejscowości,
    // inaczej to zwykle numer domu
    const kp = /(^|[\s,;])(\d{2})\s*[-–]\s*(\d{3})(?=$|[\s,;])/.exec(s) ||
      /(^|[,;]\s*)(\d{2})\s?(\d{3})(?=\s+[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż])/.exec(s);
    let reszta = s;
    if (kp) {
      w.kod_pocztowy = kp[2] + '-' + kp[3];
      if (!/\d{2}-\d{3}/.test(kp[0])) w.naprawy.push('Kod pocztowy „' + kp[0].replace(/^[\s,;]+/, '').trim() + '” zapisano jako ' + w.kod_pocztowy + '.');
      const przed = s.slice(0, kp.index + kp[1].length);
      const po = s.slice(kp.index + kp[0].length);
      const poCz = po.split(/[,;]/);
      const miasto = poCz[0].trim();
      if (miasto) w.miejscowosc = miasto;
      reszta = (przed + ',' + poCz.slice(1).join(',')).trim();
    }
    const czesci = reszta.split(/\s*[,;]\s*/).map(function (c) { return c.trim(); }).filter(Boolean);
    let ulicaCz = null;
    const pozostale = [];
    czesci.forEach(function (c) {
      const rc = rozdzielCeche(c);
      if (!ulicaCz && rc.cecha && rc.cecha !== 'inne') ulicaCz = c;
      else pozostale.push(c);
    });
    if (!ulicaCz) {
      // część z numerem na końcu = ulica (albo wieś z numerem)
      const i = pozostale.findIndex(function (c) { return oddzielNumer(c).numer && /[A-Za-zĄ-Żą-ż]/.test(c); });
      if (i >= 0) ulicaCz = pozostale.splice(i, 1)[0];
    }
    if (!w.miejscowosc && pozostale.length) {
      // pierwsza część bez cyfr = miejscowość
      const i = pozostale.findIndex(function (c) { return !/\d/.test(c); });
      if (i >= 0) w.miejscowosc = pozostale.splice(i, 1)[0];
    }
    if (ulicaCz) {
      const rc = rozdzielCeche(ulicaCz);
      const n = oddzielNumer(rc.nazwa);
      w.numer_budynku = n.numer;
      const nazwa = n.nazwa || null;
      if (!rc.cecha && nazwa && (!w.miejscowosc || klucz(nazwa) === klucz(w.miejscowosc))) {
        // „Łąkiewka 12” – miejscowość bez ulic
        if (!w.miejscowosc) w.miejscowosc = nazwa;
      } else if (nazwa) {
        w.ulica = nazwa;
        w.cecha_ulicy = rc.cecha;
        if (!rc.cecha) {
          w.cecha_ulicy = 'ul.';
          w.naprawy.push('Brak cechy ulicy przy „' + nazwa + '” – przyjęto „ul.”.');
        } else if (/\.\./.test(ulicaCz)) {
          w.naprawy.push('Poprawiono zapis cechy ulicy („' + ulicaCz.split(' ')[0] + '” -> „' + rc.cecha + '”).');
        }
      }
    }
    return w;
  }

  // ------------------------------------------------------- proste formaty
  function kodPocztowy(t) {
    const s = tekst(t);
    const m = /^(\d{2})\s*[-–]?\s*(\d{3})$/.exec(s);
    if (m) return m[1] + '-' + m[2];
    if (/^\d{4}$/.test(s)) return '0' + s[0] + '-' + s.slice(1); // Excel zgubił zero wiodące
    return null;
  }

  /** Telefon -> 9 cyfr (gdy bez kierunkowego kraju) albo '+48' + 9 cyfr. Kilka numerów -> pierwszy. */
  function telefon(t) {
    let s = tekst(t).replace(/^'/, '').replace(/^(tel\.?|telefon|tel\/fax|kom\.?|phone)\s*:?\s*/i, '');
    if (!s) return null;
    const pierwszy = s.split(/\s*(?:[,;]|\s\/\s|\soraz\s|\slub\s|\swew\.?)\s*/i)[0];
    const plus = /^\s*(\+|00)\s*48/.test(pierwszy);
    let cyfry = pierwszy.replace(/[^\d]/g, '');
    if (plus) cyfry = cyfry.replace(/^(00)?48/, '');
    else if (cyfry.length === 11 && /^48/.test(cyfry)) cyfry = cyfry.slice(2);
    else if (cyfry.length === 10 && cyfry[0] === '0') cyfry = cyfry.slice(1); // stary zapis „0 13 …”
    if (cyfry.length !== 9) return null;
    return (plus ? '+48' : '') + cyfry;
  }

  function email(t) {
    let s = tekst(t).replace(/^mailto:/i, '');
    if (!s) return null;
    s = s.split(/[\s,;]+/).filter(function (x) { return /@/.test(x); })[0] || '';
    s = s.replace(/^[<(]|[>).]$/g, '').toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null;
  }

  // ------------------------------------------------------------------ daty
  function poprawnaData(r, m, d) {
    if (r < 1900 || r > 2200 || m < 1 || m > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(r, m, 0)).getUTCDate();
  }
  function iso(r, m, d) { return r + '-' + dwie(m) + '-' + dwie(d); }
  function ostatniDzien(r, m) { return new Date(Date.UTC(r, m, 0)).getUTCDate(); }
  function rok2(r) { r = Number(r); return r < 100 ? (r < 70 ? 2000 + r : 1900 + r) : r; }
  const MIESIACE = { sty: 1, lut: 2, mar: 3, kwi: 4, maj: 5, cze: 6, lip: 7, sie: 8, wrz: 9, paz: 10, lis: 11, gru: 12,
    jan: 1, feb: 2, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /** Liczba seryjna Excela (dni od 1899-12-30) -> { data, czas } */
  function excel(n) {
    const ms = Math.round((n - 25569) * 86400000);
    const d = new Date(ms);
    return d.toISOString().slice(0, 19);
  }

  /** -> 'YYYY-MM-DD' albo null. Obsługuje ISO, dd.mm.yyyy, d.m.yy, dd/mm/yyyy, yyyy.mm.dd, mm/yyyy (koniec miesiąca),
      „15 marca 2026”, liczbę seryjną Excela i obiekt Date. */
  function data(t) {
    if (Object.prototype.toString.call(t) === "[object Date]") return isNaN(t) ? null : dataLokalna(t);
    if (typeof t === 'number') return t > 20000 && t < 80000 ? excel(t).slice(0, 10) : null;
    const s = tekst(t).replace(/\s*r\.?$/i, '');
    if (!s) return null;
    let m;
    if ((m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:$|[T\s])/.exec(s))) {
      return poprawnaData(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null;
    }
    if ((m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})(?:$|\s)/.exec(s))) {
      const r = rok2(m[3]);
      return poprawnaData(r, +m[2], +m[1]) ? iso(r, +m[2], +m[1]) : null;
    }
    if ((m = /^(\d{1,2})[-./](\d{4})$/.exec(s))) { // 06/2027 – data ważności: koniec miesiąca
      return poprawnaData(+m[2], +m[1], 1) ? iso(+m[2], +m[1], ostatniDzien(+m[2], +m[1])) : null;
    }
    if ((m = /^(\d{4})[-./](\d{1,2})$/.exec(s))) {
      return poprawnaData(+m[1], +m[2], 1) ? iso(+m[1], +m[2], ostatniDzien(+m[1], +m[2])) : null;
    }
    if ((m = /^(\d{1,2})\s+([a-ząćęłńóśźż]{3,})\.?\s+(\d{4})$/i.exec(s))) {
      const mies = MIESIACE[bezOgonkow(m[2]).slice(0, 3)];
      return mies && poprawnaData(+m[3], mies, +m[1]) ? iso(+m[3], mies, +m[1]) : null;
    }
    if (/^\d{5}(\.\d+)?$/.test(s)) { const n = Number(s); return n > 20000 && n < 80000 ? excel(n).slice(0, 10) : null; }
    return null;
  }

  /** -> 'YYYY-MM-DDThh:mm:ss' albo null (strefa czasowa jest pomijana). */
  function dataCzas(t) {
    if (Object.prototype.toString.call(t) === "[object Date]") return isNaN(t) ? null : dataLokalna(t) + 'T' + dwie(t.getHours()) + ':' + dwie(t.getMinutes()) + ':' + dwie(t.getSeconds());
    if (typeof t === 'number') return t > 20000 && t < 80000 ? excel(t) : null;
    const s = tekst(t);
    if (!s) return null;
    if (/^\d{5}\.\d+$/.test(s)) return dataCzas(Number(s));
    const d = data(s);
    if (!d) return null;
    const m = /[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
    if (!m) return d + 'T00:00:00';
    if (+m[1] > 23 || +m[2] > 59 || +(m[3] || 0) > 59) return null;
    return d + 'T' + dwie(+m[1]) + ':' + m[2] + ':' + (m[3] || '00');
  }

  // ----------------------------------------------------------------- bool
  const PRAWDA = ['tak', 't', 'yes', 'y', '1', 'true', 'x', 'prawda', 'v', '✓', '✔', 'jest', 'posiada',
    'wewnatrz', 'w budynku', 'wewnetrzny', 'wewnetrzna'];
  const FALSZ = ['nie', 'n', 'no', '0', 'false', 'falsz', 'brak', 'zewnatrz', 'na zewnatrz', 'zewnetrzny', 'zewnetrzna', 'outdoor', 'outside'];
  const BOOL = {};
  PRAWDA.forEach(function (k) { BOOL[k] = true; });
  FALSZ.forEach(function (k) { BOOL[k] = false; });
  function bool(t) {
    if (typeof t === 'boolean') return t;
    if (typeof t === 'number') return t === 1 ? true : t === 0 ? false : null;
    const k = klucz(t);
    if (!k) return null;
    return Object.prototype.hasOwnProperty.call(BOOL, k) ? BOOL[k] : null;
  }

  // ------------------------------------------------------------- słowniki
  // Synonimy: [tekst, pewnosc] – tekst porównywany po funkcji klucz(); pewność dla dokładnego trafienia.
  // Trafienie „zawiera” (synonim jako ciąg wyrazów w dłuższym tekście) ma pewność „srednia” (lub „niska”, gdy synonim słaby).
  const SYNONIMY = {
    status: {
      aktywny: [['aktywny'], ['aktywne'], ['czynny'], ['sprawny'], ['dziala'], ['active'], ['ok', 'srednia'], ['tak', 'srednia'], ['yes', 'srednia'], ['w uzyciu']],
      tymczasowo_niedostepny: [['niedostepny'], ['tymczasowo niedostepny'], ['serwis'], ['w serwisie'], ['naprawa'], ['w naprawie'], ['nieczynny'], ['awaria'], ['remont'], ['kradziez'], ['skradziony']],
      wycofany: [['wycofany'], ['usuniety'], ['zdemontowany'], ['zlikwidowany'], ['brak urzadzenia']],
      do_weryfikacji: [['do weryfikacji'], ['niepotwierdzony'], ['do sprawdzenia'], ['nieznany', 'srednia']]
    },
    dostepnosc: {
      publiczna_24_7: [['24/7'], ['24h'], ['24 h'], ['24 godziny'], ['calodobowo'], ['calodobowa'], ['calodobowy'], ['cala dobe'], ['cala doba'],
        ['non stop'], ['nonstop'], ['zawsze'], ['publiczna 24/7'], ['publiczny 24/7'], ['ogolnodostepny calodobowo'], ['ogolnodostepna calodobowo']],
      publiczna_w_godzinach: [['public', 'srednia'], ['publiczny', 'srednia'], ['publiczna', 'srednia'], ['ogolnodostepny', 'srednia'],
        ['ogolnodostepna', 'srednia'], ['tak', 'niska'], ['w godzinach'], ['w godzinach otwarcia'], ['w godzinach pracy'], ['godziny pracy'], ['godziny otwarcia']],
      dla_klientow: [['customers'], ['klienci'], ['dla klientow'], ['klientow'], ['uzytkownicy'], ['dla uzytkownikow'], ['pacjenci'], ['dla pacjentow'], ['uczniowie', 'srednia'], ['goscie'], ['members', 'srednia']],
      tylko_personel: [['private', 'srednia'], ['prywatny', 'srednia'], ['personel'], ['tylko personel'], ['dla personelu'], ['pracownicy'], ['dla pracownikow'], ['na wezwanie'],
        ['ochrona', 'srednia'], ['recepcja', 'srednia'], ['portiernia', 'srednia'], ['staff'], ['nie', 'niska'], ['niedostepny', 'niska']],
      mobilny: [['mobilny'], ['mobilna'], ['pojazd'], ['karetka'], ['radiowoz'], ['patrol'], ['samochod'], ['ambulans'], ['woz strazacki']]
    },
    sposob_dostepu: {
      otwarta_szafka: [['otwarta'], ['otwarta szafka'], ['uchwyt'], ['bez zabezpieczen'], ['bez zamka'], ['nie', 'niska'], ['ogolnodostepna szafka']],
      szafka_z_alarmem: [['alarm'], ['z alarmem'], ['szafka z alarmem'], ['alarmem'], ['syrena'], ['sygnalizacja']],
      szafka_na_kod: [['kod'], ['na kod'], ['szafka na kod'], ['zamek szyfrowy'], ['szyfr'], ['pin'], ['code']],
      szafka_na_klucz: [['klucz'], ['na klucz'], ['szafka na klucz'], ['zamknieta', 'srednia'], ['zamykana', 'srednia'], ['tak', 'niska'], ['key']],
      u_personelu: [['u personelu'], ['personel'], ['wydawany'], ['wydaje personel'], ['recepcja'], ['portiernia'], ['portier'], ['ochrona'], ['dyzurka'], ['sekretariat']],
      nieznany: [['nieznany'], ['brak danych', 'srednia'], ['nie wiadomo']]
    },
    zrodlo_wspolrzednych: {
      pomiar_gps: [['gps'], ['pomiar'], ['pomiar gps']],
      wskazanie_na_mapie: [['mapa'], ['z mapy'], ['wskazanie'], ['wskazanie na mapie']],
      geokodowanie_adresu: [['geokodowanie'], ['z adresu'], ['adres', 'srednia'], ['geocoding'], ['geokoder']],
      nieznane: [['nieznane'], ['nieznany'], ['brak']]
    },
    cecha_ulicy: {
      'ul.': [['ul'], ['ulica']], 'al.': [['al'], ['aleja'], ['aleje'], ['alei']], 'pl.': [['pl'], ['plac']],
      'os.': [['os'], ['osiedle']], rondo: [['rondo']], skwer: [['skwer']], 'bulw.': [['bulw'], ['bulwar']], inne: [['inne'], ['inna']]
    },
    typ_urzadzenia: {
      polautomatyczny: [['polautomatyczny'], ['pol automatyczny'], ['semi automatic'], ['semiautomatic'], ['semi'], ['polautomat']],
      automatyczny: [['automatyczny'], ['w pelni automatyczny'], ['fully automatic'], ['automatic'], ['automat']],
      nieznany: [['nieznany'], ['brak danych']]
    },
    dysponent_typ: {
      placowka_oswiatowa: [['szkola'], ['szkoly'], ['szkole'], ['przedszkole'], ['liceum'], ['technikum'], ['zespol szkol'], ['uczelnia'], ['uniwersytet'], ['politechnika'],
        ['akademia'], ['gimnazjum'], ['zlobek'], ['zsp'], ['zso'], ['sp nr'], ['kampus'], ['bursa'], ['internat'], ['wyzsza szkola']],
      sluzby: [['osp'], ['psp'], ['straz pozarna'], ['ochotnicza straz pozarna'], ['panstwowa straz pozarna'], ['policja'], ['komisariat'], ['komenda'], ['straz miejska'],
        ['straz gminna'], ['jednostka wojskowa'], ['wojsko'], ['straz graniczna'], ['wopr'], ['gopr'], ['topr'], ['remiza']],
      podmiot_leczniczy: [['szpital'], ['przychodnia'], ['zoz'], ['spzoz'], ['nzoz'], ['sp zoz'], ['klinika'], ['osrodek zdrowia'], ['pogotowie'], ['ratownictwo medyczne'],
        ['centrum medyczne'], ['healthcare'], ['poradnia']],
      transport: [['pkp'], ['kolej'], ['koleje'], ['dworzec'], ['lotnisko'], ['port lotniczy'], ['metro'], ['mpk'], ['komunikacja miejska'], ['przewozy'], ['tramwaje'],
        ['zarzad transportu'], ['ztm'], ['przystanek']],
      administracja_rzadowa: [['urzad wojewodzki'], ['ministerstwo'], ['sad'], ['prokuratura'], ['zus'], ['krus'], ['urzad skarbowy'], ['izba administracji skarbowej'],
        ['lasy panstwowe'], ['regionalna dyrekcja'], ['administracja rzadowa'], ['wojewoda']],
      organizacja_pozarzadowa: [['fundacja'], ['stowarzyszenie'], ['parafia'], ['kosciol'], ['klub sportowy'], ['zwiazek'], ['towarzystwo'], ['caritas'], ['pck']],
      firma: [['sp z o o'], ['sp z oo'], ['s a'], ['sa', 'niska'], ['spolka'], ['sklep'], ['centrum handlowe'], ['galeria'], ['hotel'], ['firma'], ['pgnig'], ['bank'],
        ['sp j'], ['sp k'], ['market'], ['restauracja'], ['stacja paliw'], ['orlen']],
      jst: [['urzad miasta'], ['urzad miejski'], ['urzad gminy'], ['urzad miasta i gminy'], ['starostwo'], ['starostwo powiatowe'], ['urzad marszalkowski'], ['gmina'], ['miasto'],
        ['powiat'], ['jst'], ['samorzad'], ['mosir'], ['osir'], ['posir'], ['gok'], ['mok'], ['dom kultury'], ['centrum kultury'], ['biblioteka'], ['muzeum'], ['mpgk'], ['zgk'],
        ['zaklad gospodarki komunalnej'], ['osrodek sportu'], ['osrodek pomocy spolecznej'], ['mops'], ['gops'], ['basen'], ['plywalnia'], ['hala sportowa'], ['urzad']]
    },
    sposob_weryfikacji: {
      wizja_lokalna: [['wizja'], ['wizja lokalna'], ['na miejscu'], ['kontrola'], ['sprawdzone na miejscu']],
      potwierdzenie_dysponenta: [['dysponent'], ['potwierdzenie'], ['potwierdzone'], ['potwierdzenie dysponenta']],
      zdjecie: [['zdjecie'], ['foto'], ['fotografia'], ['zdjecie z data']],
      import_bez_weryfikacji: [['import'], ['bez weryfikacji'], ['brak'], ['niezweryfikowane']]
    },
    licencja_rekordu: {
      'CC0-1.0': [['cc0'], ['cc0 1 0'], ['cc 0'], ['domena publiczna'], ['public domain'], ['cc zero']],
      'CC-BY-4.0': [['cc by'], ['cc by 4 0'], ['ccby'], ['uznanie autorstwa'], ['cc by 4 0 international'], ['attribution']]
    }
  };

  const RE_24_7 = /24\s*\/\s*7|\b24\s*h\b|calodob|cala dobe|cala doba|non\s*-?\s*stop|24 godziny/;
  const indeksy = {};
  /** Indeks słownika: dokładne klucze -> {kod, pewnosc} oraz lista synonimów do dopasowania „zawiera” (od najdłuższych). */
  function indeks(nazwa) {
    if (indeksy[nazwa]) return indeksy[nazwa];
    const pozycje = (AED.wzorzec && AED.wzorzec.slowniki && AED.wzorzec.slowniki[nazwa]) || [];
    const dokladne = {}, zawiera = [];
    const dodajK = function (k, kod, p) { if (k && !dokladne[k]) dokladne[k] = { kod: kod, pewnosc: p }; };
    pozycje.forEach(function (p) {
      dodajK(klucz(p.kod), p.kod, 'wysoka');
      dodajK(klucz(p.etykieta), p.kod, 'wysoka');
    });
    // etykiety list rozwijanych z prostego formularza dysponenta (np. „Całodobowo, dla wszystkich”)
    const fd = AED.wzorzec && AED.wzorzec.formularzDysponenta;
    ((fd && fd.slowniki && fd.slowniki[nazwa]) || []).forEach(function (p) { dodajK(klucz(p.etykieta), p.kod, 'wysoka'); });
    const syn = SYNONIMY[nazwa] || {};
    Object.keys(syn).forEach(function (kod) {
      syn[kod].forEach(function (s) {
        const k = klucz(s[0]);
        dodajK(k, kod, s[1] || 'wysoka');
        if (k.length >= 2) zawiera.push({ k: ' ' + k + ' ', kod: kod, pewnosc: s[1] === 'niska' ? 'niska' : s[1] === 'srednia' ? 'niska' : 'srednia', dl: k.length });
      });
    });
    pozycje.forEach(function (p) {
      const k = klucz(p.etykieta);
      if (k.length >= 4) zawiera.push({ k: ' ' + k + ' ', kod: p.kod, pewnosc: 'srednia', dl: k.length });
    });
    zawiera.sort(function (a, b) { return b.dl - a.dl; });
    return (indeksy[nazwa] = { dokladne: dokladne, zawiera: zawiera, kody: pozycje.map(function (p) { return p.kod; }) });
  }

  /**
   * Wartość tekstowa -> kod ze słownika wzorca.
   * @returns {{wartosc: string|null, pewnosc: 'wysoka'|'srednia'|'niska'}}
   */
  function slownik(nazwa, t) {
    if (nazwa === 'wojewodztwo') {
      const w = wojewodztwo(t);
      return { wartosc: w, pewnosc: w ? 'wysoka' : 'niska' };
    }
    if (pusta(t)) return { wartosc: null, pewnosc: 'niska' };
    const ix = indeks(nazwa);
    const s = tekst(t);
    if (ix.kody.indexOf(s) >= 0) return { wartosc: s, pewnosc: 'wysoka' };
    const k = klucz(s);
    if (ix.dokladne[k]) return { wartosc: ix.dokladne[k].kod, pewnosc: ix.dokladne[k].pewnosc };
    // dostępność: znacznik całodobowości ma pierwszeństwo przed najdłuższym synonimem
    if (nazwa === 'dostepnosc' && RE_24_7.test(bezOgonkow(s))) return { wartosc: 'publiczna_24_7', pewnosc: 'srednia' };
    // kilka wartości rozdzielonych średnikiem – pierwsza
    if (/;/.test(s)) { const p = slownik(nazwa, s.split(';')[0]); if (p.wartosc) return p; }
    const kk = ' ' + k + ' ';
    for (let i = 0; i < ix.zawiera.length; i++) {
      if (kk.indexOf(ix.zawiera[i].k) >= 0) return { wartosc: ix.zawiera[i].kod, pewnosc: ix.zawiera[i].pewnosc };
    }
    return { wartosc: null, pewnosc: 'niska' };
  }

  // ---------------------------------------------------------- województwa
  const WOJ = [['02', 'DS', 'dolnośląskie'], ['04', 'KP', 'kujawsko-pomorskie'], ['06', 'LU', 'lubelskie'], ['08', 'LB', 'lubuskie'],
    ['10', 'LD', 'łódzkie'], ['12', 'MA', 'małopolskie'], ['14', 'MZ', 'mazowieckie'], ['16', 'OP', 'opolskie'], ['18', 'PK', 'podkarpackie'],
    ['20', 'PD', 'podlaskie'], ['22', 'PM', 'pomorskie'], ['24', 'SL', 'śląskie'], ['26', 'SK', 'świętokrzyskie'], ['28', 'WN', 'warmińsko-mazurskie'],
    ['30', 'WP', 'wielkopolskie'], ['32', 'ZP', 'zachodniopomorskie']];
  const WOJ_KLUCZ = {};
  WOJ.forEach(function (w) {
    WOJ_KLUCZ[w[0]] = w[2]; WOJ_KLUCZ[String(Number(w[0]))] = w[2]; WOJ_KLUCZ[w[1].toLowerCase()] = w[2];
    WOJ_KLUCZ[klucz(w[2])] = w[2]; WOJ_KLUCZ[klucz(w[2]).replace(/ /g, '')] = w[2];
  });
  /** „woj. Mazowieckie”, „MAZOWIECKIE”, „14”, „PL-14”, „PL-MZ” -> 'mazowieckie'; null gdy nie rozpoznano. */
  function wojewodztwo(t) {
    let k = klucz(t).replace(/^(wojewodztwo|woj)\s+/, '').replace(/^pl\s+/, '').replace(/\s+wojewodztwo$/, '');
    if (!k) return null;
    if (WOJ_KLUCZ[k]) return WOJ_KLUCZ[k];
    // przymiotnik w innej formie: „mazowieckiego”, „województwa śląskiego”
    k = k.replace(/^wojewodztwa\s+/, '').replace(/iego$/, 'ie').replace(/kiej$/, 'kie');
    if (WOJ_KLUCZ[k]) return WOJ_KLUCZ[k];
    if (WOJ_KLUCZ[k.replace(/ /g, '')]) return WOJ_KLUCZ[k.replace(/ /g, '')];
    return null;
  }
  /** Kod TERYT województwa (2 cyfry) dla nazwy ze słownika. */
  function kodWojewodztwa(nazwa) {
    const w = WOJ.find(function (x) { return x[2] === nazwa; });
    return w ? w[0] : null;
  }

  // ------------------------------------------------------- opening_hours
  const DNI = [[/^(pn|pon|poniedzialek|poniedzialku|mo|mon)$/, 'Mo'], [/^(wt|wto|wtorek|wtorku|tu|tue)$/, 'Tu'], [/^(sr|sro|sroda|srody|we|wed)$/, 'We'],
    [/^(cz|czw|czwartek|czwartku|th|thu)$/, 'Th'], [/^(pt|pi|pia|piatek|piatku|fr|fri)$/, 'Fr'], [/^(sb|sob|sobota|soboty|sa|sat)$/, 'Sa'],
    [/^(nd|nie|ndz|niedz|niedziela|niedzieli|su|sun)$/, 'Su'], [/^(sw|swieta|ph)$/, 'PH']];
  const D = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)';
  const DR = D + '(?:-' + D + ')?';
  const DNIRE = DR + '(?:,' + DR + ')*';
  const T = '\\d{2}:\\d{2}-\\d{2}:\\d{2}\\+?';
  const CZASY = T + '(?:,' + T + ')*';
  const REGULA = '(?:(?:' + DNIRE + ')\\s+)?(?:' + CZASY + ')|(?:' + DNIRE + ')\\s+(?:off|closed)|24/7';
  const RE_OH = new RegExp('^(?:' + REGULA + ')(?:\\s*[;,]\\s*(?:' + REGULA + '))*$');
  /** Czy tekst to (uproszczona) poprawna składnia opening_hours. */
  function poprawneGodziny(t) { return RE_OH.test(tekst(t)); }

  /** „pn-pt 7:30-15:30” -> „Mo-Fr 07:30-15:30”; „24h”, „całodobowo” -> „24/7”. Zwraca null, gdy nie da się przetłumaczyć. */
  function godziny(t) {
    const s = tekst(t);
    if (!s) return null;
    if (poprawneGodziny(s)) return s;
    const k = bezOgonkow(s);
    if (/24\s*\/\s*7|24\s*h\b|calodob|cala dobe|cala doba|non\s*-?\s*stop|^zawsze$|24 godziny/.test(k)) return '24/7';
    // tłumaczenie fragmentów
    let w = k.replace(/\s*[–—]\s*/g, '-').replace(/\bgodz\.?\s*/g, '').replace(/\bw godz(inach)?\.?\s*/g, '').replace(/\bod\s+/g, '').replace(/\s+do\s+/g, '-');
    w = w.replace(/[a-z]+\.?/g, function (slowo) {
      const sl = slowo.replace(/\.$/, '');
      for (let i = 0; i < DNI.length; i++) if (DNI[i][0].test(sl)) return DNI[i][1];
      if (sl === 'off' || sl === 'nieczynne' || sl === 'zamkniete') return 'off';
      return slowo;
    });
    w = w.replace(/(\d{1,2})(?:[:.](\d{2}))?\s*-\s*(\d{1,2})(?:[:.](\d{2}))?/g, function (_, h1, m1, h2, m2) {
      return dwie(+h1) + ':' + (m1 || '00') + '-' + dwie(+h2) + ':' + (m2 || '00');
    });
    w = w.replace(/(Mo|Tu|We|Th|Fr|Sa|Su|PH)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su|PH)/g, '$1-$2')
      .replace(/(Mo|Tu|We|Th|Fr|Sa|Su|PH)\s*:\s*/g, '$1 ')
      .replace(/(\d{2}:\d{2})\s*,\s*(?=Mo|Tu|We|Th|Fr|Sa|Su|PH)/g, '$1; ')
      .replace(/\s*;\s*/g, '; ').replace(/\s+/g, ' ').trim();
    return poprawneGodziny(w) ? w : null;
  }

  // ------------------------------------------------------------ kondygnacja
  /** „parter” -> 0, „piwnica” -> -1, „I piętro” / „1 p.” -> 1, „-1” -> -1. */
  function kondygnacja(t) {
    if (typeof t === 'number') return Number.isInteger(t) ? t : null;
    const k = bezOgonkow(t).replace(/\s+/g, ' ').trim();
    if (!k) return null;
    if (/piwnic|suteren|podziem/.test(k)) return -1;
    if (/^parter\b|^(poziom 0|ground|ground floor)$/.test(k)) return 0;   // samo „p” nie oznacza parteru
    let m = /^(?:pietro|pietra|poziom|kondygnacja|level)\.?\s*([+-]?\d+)$/.exec(k);   // „piętro 2”, „poziom 1”
    if (m) return Number(m[1]);
    m = /^([+-]?\d+)(?:[.,]0+)?\.?\s*(?:(?:p|pietro|pietra|kondygnacja|poziom)\.?)?$/.exec(k);   // „1”, „1. piętro”, „2 p.”
    if (m) return Number(m[1]);
    const rz = /^(i{1,3}|iv|v|vi{1,3}|ix|x)\.?\s*(?:(?:p|pietro|pietra)\.?)?$/.exec(k);   // „I piętro”
    if (rz) return { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 }[rz[1]];
    const m2 = /^([+-]?\d+)\s*;/.exec(k); // „0;1” – pierwsza wartość
    return m2 ? Number(m2[1]) : null;
  }

  AED.normalizacja = {
    PL: PL,
    tekst: tekst,
    pusta: pusta,
    klucz: klucz,
    bezOgonkow: bezOgonkow,
    liczba: liczba,
    miejscaPoPrzecinku: miejscaPoPrzecinku,
    stopnie: stopnie,
    wspolrzedne: wspolrzedne,
    wspolrzedneZTekstu: wspolrzedneZTekstu,
    adres: adres,
    rozdzielCeche: rozdzielCeche,
    kodPocztowy: kodPocztowy,
    telefon: telefon,
    email: email,
    data: data,
    dataCzas: dataCzas,
    bool: bool,
    slownik: slownik,
    wojewodztwo: wojewodztwo,
    kodWojewodztwa: kodWojewodztwa,
    godziny: godziny,
    poprawneGodziny: poprawneGodziny,
    kondygnacja: kondygnacja
  };
})(window.AED);
