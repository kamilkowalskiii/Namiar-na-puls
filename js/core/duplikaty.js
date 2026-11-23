/* Wykrywanie duplikatów, punktów odstających i scalanie rekordów.
   Wejście: rekordy po mapowaniu (AED.store.rekordy). Funkcje nie zmieniają rekordów wejściowych.

   Kryteria pary (krawędzi) – zgodnie z arkuszem „informacje” wzorca, progi do kalibracji:
     1) ten sam id_aed,
     2) ten sam dysponent i id_lokalne (bez dysponenta: to samo źródło),
     3) odległość < promienM (domyślnie 30 m),
     4) odległość < promienMaksM (domyślnie 150 m) ORAZ podobny adres lub nazwa.
   Pary łączone w grupy (union-find). Sprzeczności (różne kondygnacje, różne numery u tego samego dysponenta,
   różne miejscowości, różny opis w tym samym źródle) obniżają pewność do „niska” – takich grup nie scalamy automatycznie.
   Sąsiedzi szukani w siatce o boku promienMaksM (bez porównywania każdej pary). */
(function (AED) {
  'use strict';

  const N = AED.normalizacja;
  const POLA = AED.wzorzec.schema.fields.map(function (f) { return f.name; });
  const POLE_WSP = 'wspolrzedne'; // pseudo-pole konfliktu: szerokość i długość wybierane razem
  // pola, w których różnice nie są konfliktem (wynikają ze scalenia albo są techniczne)
  const BEZ_KONFLIKTU = { id_aed: 1, zrodlo_danych: 1, zrodlo_id_rekordu: 1, licencja_rekordu: 1, data_aktualizacji_rekordu: 1,
    szerokosc_geograficzna: 1, dlugosc_geograficzna: 1 };
  const PRIORYTET_TYPU = { PLIK: 1, DGP: 1, FORMULARZ: 2 };
  const POZIOM = { niska: 0, srednia: 1, wysoka: 2 };
  const NAZWA_POZIOMU = ['niska', 'srednia', 'wysoka'];
  const LICENCJA_RANGA = { 'CC0-1.0': 0, 'CC-BY-4.0': 1 };
  const MAKS_GRUPA = 12; // większa grupa to raczej „łańcuch” w gęstej zabudowie – do ręcznego przeglądu
  const MAKS_KUBELEK = 10; // tyle rekordów z tym samym id_aed / dysponentem+id_lokalne = identyfikator nie odróżnia urządzeń
  const TE_SAME_M = 0.5;   // „identyczne” współrzędne (m)
  const noweIdPamiec = new Map(); // stary id_aed + _id -> nowy UUID (stały w obrębie sesji)

  // słowa, które nie odróżniają miejsc („Defibrylator AED w …”)
  const STOP = {};
  ('defibrylator defibrylatora defibrylatory aed automatyczny zewnetrzny ul al pl os w we na przy z ze do i oraz nr im ' +
    'imienia obok kolo budynek budynku przyklad').split(' ').forEach(function (s) { STOP[s] = 1; });

  // Przybliżone prostokąty województw (szer. min, maks, dł. min, maks) – do ostrzeżenia, nie do rozstrzygania
  const WOJ_BBOX = {
    'dolnośląskie': [50.09, 51.81, 14.81, 17.80], 'kujawsko-pomorskie': [52.33, 53.79, 17.24, 19.78],
    'lubelskie': [50.24, 52.30, 21.61, 24.15], 'lubuskie': [51.36, 53.13, 14.53, 16.42], 'łódzkie': [50.84, 52.40, 18.07, 20.67],
    'małopolskie': [49.17, 50.53, 19.08, 21.43], 'mazowieckie': [51.01, 53.49, 19.25, 23.13], 'opolskie': [49.97, 51.20, 16.90, 18.72],
    'podkarpackie': [49.00, 50.83, 21.14, 23.55], 'podlaskie': [52.28, 54.42, 21.59, 23.95], 'pomorskie': [53.49, 54.84, 16.70, 19.65],
    'śląskie': [49.39, 51.10, 18.03, 19.98], 'świętokrzyskie': [50.17, 51.35, 19.70, 21.88], 'warmińsko-mazurskie': [53.13, 54.46, 19.12, 22.90],
    'wielkopolskie': [51.10, 53.66, 15.78, 19.08], 'zachodniopomorskie': [52.62, 54.60, 14.12, 16.98]
  };

  // ------------------------------------------------------------ pomocnicze
  function pusta(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
  function liczbaOk(v) { return typeof v === 'number' && isFinite(v); }

  const M_NA_STOPIEN = 111320;
  /** Odległość w metrach (przybliżenie równoprostokątne – dokładne do kilku km). */
  function odlegloscM(a, b) {
    const x = (b.lon - a.lon) * Math.cos((a.lat + b.lat) * Math.PI / 360);
    const y = b.lat - a.lat;
    return Math.sqrt(x * x + y * y) * M_NA_STOPIEN;
  }
  /** Odległość po kole wielkim w km (dla dużych odległości). */
  function haversineKm(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function mediana(t) {
    if (!t.length) return 0;
    const s = t.slice().sort(function (a, b) { return a - b; });
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(36);
  }
  function liczbaTekst(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  /** Klucz nazwy do szybkiego porównania (bez słów typu „defibrylator”, „AED”). */
  function kluczNazwy(t) {
    if (pusta(t)) return '';
    return N.klucz(t).split(' ').filter(function (x) { return x && !STOP[x]; }).join(' ');
  }
  function kluczPary(a, b) { return a < b ? a + '\u0001' + b : b + '\u0001' + a; }
  function dwie(n) { return (n < 10 ? '0' : '') + n; }
  function teraz() {
    const d = new Date();
    return d.getFullYear() + '-' + dwie(d.getMonth() + 1) + '-' + dwie(d.getDate()) + 'T' + dwie(d.getHours()) + ':' + dwie(d.getMinutes()) + ':' + dwie(d.getSeconds());
  }
  function nowyUuid() {
    if (AED.mapowanie && AED.mapowanie.nowyUuid) return AED.mapowanie.nowyUuid();
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    const h = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)];
    return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-' + h[8 + Math.floor(Math.random() * 4)] + s.slice(17, 20) + '-' + s.slice(20);
  }
  function metry(d) { return d < 1000 ? Math.round(d) + ' m' : (Math.round(d / 100) / 10).toString().replace('.', ',') + ' km'; }

  /** Jaro-Winkler (0–1). */
  function jaroWinkler(a, b) {
    if (a === b) return a ? 1 : 0;
    const la = a.length, lb = b.length;
    if (!la || !lb) return 0;
    const zakres = Math.max(0, (Math.max(la, lb) >> 1) - 1);
    const ma = new Array(la), mb = new Array(lb);
    let zgodne = 0;
    for (let i = 0; i < la; i++) {
      const od = Math.max(0, i - zakres), doo = Math.min(i + zakres + 1, lb);
      for (let j = od; j < doo; j++) {
        if (mb[j] || a[i] !== b[j]) continue;
        ma[i] = mb[j] = true; zgodne++; break;
      }
    }
    if (!zgodne) return 0;
    let t = 0, k = 0;
    for (let i = 0; i < la; i++) {
      if (!ma[i]) continue;
      while (!mb[k]) k++;
      if (a[i] !== b[k]) t++;
      k++;
    }
    const jaro = (zgodne / la + zgodne / lb + (zgodne - t / 2) / zgodne) / 3;
    let p = 0;
    while (p < 4 && p < la && p < lb && a[p] === b[p]) p++;
    return jaro + p * 0.1 * (1 - jaro);
  }
  /** Zbiór trigramów tekstu (z dopełnieniem spacjami). */
  function trigramy(s) {
    const t = '  ' + s + ' ', z = new Set();
    for (let i = 0; i < t.length - 2; i++) z.add(t.substr(i, 3));
    return z;
  }
  /** Współczynnik Dice’a na trigramach (0–1). */
  function dice(za, zb) {
    if (!za || !zb || !za.size || !zb.size) return 0;
    let w = 0;
    za.forEach(function (g) { if (zb.has(g)) w++; });
    return 2 * w / (za.size + zb.size);
  }
  /** Podobieństwo nazw: max(trigramy, zawieranie słów). */
  function podobienstwoTekstu(a, b) {
    if (!a.tekst || !b.tekst) return null;
    if (a.tekst === b.tekst) return 1;
    const d = dice(a.tri, b.tri);
    // „Zespół Krytych Pływalni” vs „Krytej Pływalni Zespół” – słowa krótszej nazwy zawarte w dłuższej
    const [k, dl] = a.slowa.length <= b.slowa.length ? [a, b] : [b, a];
    let traf = 0;
    k.slowa.forEach(function (s) {
      if (dl.slowa.some(function (x) { return x === s || (s.length > 4 && x.length > 4 && jaroWinkler(s, x) > 0.92); })) traf++;
    });
    const zaw = k.slowa.length ? traf / k.slowa.length : 0;
    return Math.max(d, k.slowa.length >= 2 ? zaw * 0.95 : zaw * 0.8);
  }
  function opisTekstu(t) {
    const slowa = N.klucz(t).split(' ').filter(function (s) { return s && !STOP[s]; });
    const tekst = slowa.join(' ');
    return { tekst: tekst, slowa: slowa, tri: tekst ? trigramy(tekst) : null };
  }
  function numer(t) { return pusta(t) ? '' : String(t).toLowerCase().replace(/\s+/g, ''); }

  // ------------------------------------------------- priorytet i kolejność
  function priorytetyZrodel(opcje) {
    const pamiec = new Map();
    const lista = opcje && opcje.zrodla;
    return function (r) {
      if (pamiec.has(r._zrodlo)) return pamiec.get(r._zrodlo);
      let z = null;
      if (lista) z = lista.find(function (x) { return x.id === r._zrodlo || x.kod === r._zrodlo; }) || null;
      else if (AED.store && AED.store.zrodlo) z = AED.store.zrodlo(r._zrodlo);
      let p = z && Number(z.priorytet);
      if (!p) p = PRIORYTET_TYPU[String(r._kodZrodla || '').split('-')[0]] || 2;
      pamiec.set(r._zrodlo, p);
      return p;
    };
  }
  function kompletnosc(r) {
    let n = 0;
    for (let i = 0; i < POLA.length; i++) if (!pusta(r[POLA[i]])) n++;
    return n;
  }
  /** Porównanie „kto lepszy na główny”: priorytet źródła, pełność, nowsza data_weryfikacji, _id. */
  function porownywacz(priorytet) {
    const kompl = new Map();
    const k = function (r) { if (!kompl.has(r)) kompl.set(r, kompletnosc(r)); return kompl.get(r); };
    return function (a, b) {
      const pa = priorytet(a), pb = priorytet(b);
      if (pa !== pb) return pa - pb;
      const ka = k(a), kb = k(b);
      if (ka !== kb) return kb - ka;
      const da = a.data_weryfikacji || '', db = b.data_weryfikacji || '';
      if (da !== db) return da < db ? 1 : -1;
      return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
    };
  }

  /** Wartość do porównań (konflikt jest tylko przy różnicy merytorycznej, nie w wielkości liter czy spacjach). */
  function kluczWartosci(v) {
    if (typeof v === 'string') return 's:' + N.klucz(v);
    return typeof v + ':' + String(v);
  }
  function maWsp(r) { return liczbaOk(r.szerokosc_geograficzna) && liczbaOk(r.dlugosc_geograficzna); }

  /** Reguła wzorca (arkusz „informacje”): wartość z rekordu z najnowszą data_weryfikacji, przy remisie – wyższy priorytet źródła.
      lista musi być posortowana porównywaczem (priorytet, pełność, …) – wtedy przy remisie wygrywa pierwszy. Brak daty = najstarsza. */
  function wybierzRekord(lista, maWartosc) {
    let naj = null;
    for (let i = 0; i < lista.length; i++) {
      const r = lista[i];
      if (!maWartosc(r)) continue;
      if (!naj || (r.data_weryfikacji || '') > (naj.data_weryfikacji || '')) naj = r;
    }
    return naj;
  }
  const maPole = function (pole) { return function (r) { return !pusta(r[pole]); }; };

  /** Konflikty pól w grupie (lista posortowana porównywaczem); proponowana wg reguły wybierzRekord. */
  function konfliktyGrupy(lista) {
    const wynik = [];
    // współrzędne razem – konflikt, gdy różnią się o więcej niż 1 m
    const zWsp = lista.filter(maWsp);
    if (zWsp.length > 1) {
      const p = { lat: zWsp[0].szerokosc_geograficzna, lon: zWsp[0].dlugosc_geograficzna };
      if (zWsp.some(function (r) { return odlegloscM(p, { lat: r.szerokosc_geograficzna, lon: r.dlugosc_geograficzna }) > 1; })) {
        wynik.push({ pole: POLE_WSP, wartosci: zWsp.map(function (r) {
          return { rekordId: r._id, wartosc: r.szerokosc_geograficzna + ', ' + r.dlugosc_geograficzna,
            lat: r.szerokosc_geograficzna, lon: r.dlugosc_geograficzna };
        }), proponowana: wybierzRekord(zWsp, maWsp)._id });
      }
    }
    POLA.forEach(function (pole) {
      if (BEZ_KONFLIKTU[pole]) return;
      const wart = [], klucze = new Set();
      lista.forEach(function (r) {
        const v = r[pole];
        if (pusta(v)) return;
        wart.push({ rekordId: r._id, wartosc: v });
        klucze.add(kluczWartosci(v));
      });
      if (klucze.size > 1) wynik.push({ pole: pole, wartosci: wart, proponowana: wybierzRekord(lista, maPole(pole))._id });
    });
    return wynik;
  }

  // ------------------------------------------------------------ znajdź
  /**
   * @param {Object[]} rekordy
   * @param {{promienM?:number, promienMaksM?:number, zrodla?:Object[], postep?:function(number)}} [opcje]
   *        postep(ulamek 0–1) – wywoływane co kilka procent pracy
   * @returns {{grupy:Object[], odstajace:Object[], podsumowanie:Object}}
   */
  function znajdz(rekordy, opcje) {
    const g = przebieg(rekordy, opcje);
    let s = g.next();
    while (!s.done) { zglos(opcje, s.value); s = g.next(); }
    zglos(opcje, 1);
    return s.value;
  }
  /** Jak znajdz, ale oddaje sterowanie przeglądarce co ok. 50 ms (pasek postępu może się odświeżyć). @returns {Promise} */
  async function znajdzAsync(rekordy, opcje) {
    const g = przebieg(rekordy, opcje);
    let s = g.next(), t = Date.now();
    while (!s.done) {
      zglos(opcje, s.value);
      if (Date.now() - t > 50) { await new Promise(function (ok) { setTimeout(ok, 0); }); t = Date.now(); }
      s = g.next();
    }
    zglos(opcje, 1);
    return s.value;
  }
  function zglos(opcje, u) {
    if (opcje && typeof opcje.postep === 'function') { try { opcje.postep(u); } catch (e) { console.error(e); } }
  }

  /** Właściwe wyszukiwanie jako generator: zwraca (yield) postęp 0–1, na końcu wynik. */
  function* przebieg(rekordy, opcje) {
    const t0 = Date.now();
    opcje = opcje || {};
    const R = Number(opcje.promienM) > 0 ? Number(opcje.promienM) : 30;
    const RMAX = Math.max(R, Number(opcje.promienMaksM) > 0 ? Number(opcje.promienMaksM) : 150);
    const lista = (rekordy || []).filter(function (r) { return r && r._id; });
    const n = lista.length;
    const priorytet = priorytetyZrodel(opcje);
    const ostrzezenia = [];
    // pary oznaczone wcześniej jako różne urządzenia (decyzja „rozdziel”) – nie łączymy ich krawędzią
    const rozdzielone = new Set();
    (opcje.rozdzielone || []).forEach(function (para) { if (para && para.length === 2) rozdzielone.add(kluczPary(para[0], para[1])); });

    // dane pomocnicze liczone raz na rekord
    const P = new Array(n);
    for (let i = 0; i < n; i++) {
      const r = lista[i];
      P[i] = {
        wsp: maWsp(r) ? { lat: r.szerokosc_geograficzna, lon: r.dlugosc_geograficzna } : null,
        dysp: N.klucz(r.dysponent_nazwa) || ('zr:' + r._zrodlo),
        idl: pusta(r.id_lokalne) ? '' : N.klucz(r.id_lokalne),
        miejsc: N.klucz(r.miejscowosc),
        ulica: N.klucz(r.ulica),
        nr: numer(r.numer_budynku),
        kond: Number.isInteger(r.kondygnacja) ? r.kondygnacja : null,
        _nazwa: null, _opis: null
      };
    }
    yield 0.05;
    const nazwa = function (i) { return P[i]._nazwa || (P[i]._nazwa = opisTekstu(lista[i].nazwa)); };
    const opis = function (i) { return P[i]._opis || (P[i]._opis = opisTekstu(lista[i].opis_lokalizacji)); };

    const krawedzie = new Map(); // "i|j" -> { i, j, d, poziom, powody[] }
    function dodajKrawedz(i, j, poziom, powody, d) {
      if (i > j) { const t = i; i = j; j = t; }
      const k = i * n + j;
      const e = krawedzie.get(k);
      if (!e) { krawedzie.set(k, { i: i, j: j, d: d, poziom: poziom, powody: powody.slice() }); return; }
      if (poziom > e.poziom) e.poziom = poziom;
      powody.forEach(function (p) { if (e.powody.indexOf(p) < 0) e.powody.push(p); });
    }
    const dystans = function (i, j) { return P[i].wsp && P[j].wsp ? odlegloscM(P[i].wsp, P[j].wsp) : null; };

    // podobieństwo nazw ulic – wartości powtarzają się, więc liczymy raz na parę nazw
    const pamiecUlic = new Map();
    function podobUlic(i, j) {
      const a = P[i].ulica, b = P[j].ulica;
      if (a === b) return 1;
      const k = a < b ? a + '\u0001' + b : b + '\u0001' + a;
      let v = pamiecUlic.get(k);
      if (v === undefined) {
        v = Math.max(jaroWinkler(a, b), podobienstwoTekstu(opisTekstu(lista[i].ulica), opisTekstu(lista[j].ulica)) || 0);
        if (pamiecUlic.size < 200000) pamiecUlic.set(k, v);
      }
      return v;
    }
    /** Sprzeczności sugerujące dwa różne urządzenia. */
    function sprzecznosci(i, j) {
      const a = P[i], b = P[j], ra = lista[i], rb = lista[j], s = [];
      if (a.miejsc && b.miejsc && a.miejsc !== b.miejsc && a.miejsc.indexOf(b.miejsc) < 0 && b.miejsc.indexOf(a.miejsc) < 0) {
        s.push('różne miejscowości (' + ra.miejscowosc + ', ' + rb.miejscowosc + ')');
      }
      if (a.kond !== null && b.kond !== null && a.kond !== b.kond) s.push('różne kondygnacje (' + a.kond + ' i ' + b.kond + ')');
      if (a.dysp === b.dysp && a.idl && b.idl && a.idl !== b.idl) {
        s.push('różne numery u dysponenta (' + ra.id_lokalne + ', ' + rb.id_lokalne + ') – to raczej dwa urządzenia; sprawdź współrzędne');
      }
      if (ra._zrodlo === rb._zrodlo) {
        const oa = opis(i), ob = opis(j);
        const po = podobienstwoTekstu(oa, ob);
        if (po !== null && po < 0.5) s.push('różny opis lokalizacji w tym samym źródle');
      }
      if (a.ulica && b.ulica && a.nr && b.nr && a.nr !== b.nr && podobUlic(i, j) >= 0.9) {
        s.push('inny numer budynku (' + lista[i].numer_budynku + ' i ' + lista[j].numer_budynku + ')');
      }
      return s;
    }
    /** Podobieństwo adresu: { rowny, podobny, opis } */
    function adres(i, j) {
      const a = P[i], b = P[j];
      if (!a.ulica || !b.ulica) return { info: false };
      const su = podobUlic(i, j);
      const tekst = (lista[i].cecha_ulicy ? lista[i].cecha_ulicy + ' ' : '') + lista[i].ulica + (a.nr ? ' ' + lista[i].numer_budynku : '');
      if (su < 0.9) return { info: true, rozny: su < 0.7 };
      if (a.nr && b.nr) return { info: true, rowny: a.nr === b.nr, tekst: tekst };
      return { info: true, podobny: true, tekst: tekst };
    }

    /** Kubełki rekordów o tym samym kluczu; kubełek większy niż MAKS_KUBELEK nie tworzy krawędzi (ostrzeżenie). */
    function kubelki(klucz, opisKlucza, krawedz) {
      const m = new Map();
      for (let i = 0; i < n; i++) {
        const k = klucz(i);
        if (!k) continue;
        const t = m.get(k);
        if (t) t.push(i); else m.set(k, [i]);
      }
      m.forEach(function (idx) {
        if (idx.length < 2) return;
        if (idx.length > MAKS_KUBELEK) {
          ostrzezenia.push({ kod: 'NIEIDENTYFIKUJACY', komunikat: opisKlucza(idx[0]) + ' ma ' + idx.length +
            ' rekordów – nie odróżnia urządzeń, więc nie używamy go do wykrywania duplikatów.', liczba: idx.length });
          return;
        }
        for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) krawedz(idx[a], idx[b]);
      });
    }
    // 1) ten sam id_aed – daleko od siebie albo ze sprzecznościami: raczej skopiowany identyfikator
    kubelki(function (i) { return pusta(lista[i].id_aed) ? '' : String(lista[i].id_aed).toLowerCase(); },
      function (i) { return 'Identyfikator id_aed „' + lista[i].id_aed + '”'; },
      function (i, j) {
        const d = dystans(i, j);
        const spr = sprzecznosci(i, j);
        if ((d !== null && d > RMAX) || spr.length) {
          dodajKrawedz(i, j, 0, ['ten sam id_aed, ale ' + (d !== null ? metry(d) + ' od siebie' : 'inne dane') +
            ' – możliwe skopiowanie identyfikatora'].concat(spr), d);
        } else dodajKrawedz(i, j, 2, ['ten sam id_aed'].concat(d !== null ? [metry(d) + ' od siebie'] : []), d);
      });
    // 2) dysponent + id_lokalne
    kubelki(function (i) { return P[i].idl ? P[i].dysp + '\u0001' + P[i].idl : ''; },
      function (i) { return 'Numer „' + lista[i].id_lokalne + '” u dysponenta ' + (lista[i].dysponent_nazwa || lista[i]._kodZrodla || ''); },
      function (i, j) {
        const d = dystans(i, j);
        if (d !== null && d > RMAX) {
          dodajKrawedz(i, j, 0, ['ten sam numer „' + lista[i].id_lokalne + '”, ale ' + metry(d) + ' od siebie' +
            (P[i].ulica && P[i].ulica !== P[j].ulica ? ' i inny adres' : '') + ' – możliwa pomyłka w numerze'], d);
        } else {
          dodajKrawedz(i, j, 2, ['ten sam dysponent i id_lokalne („' + lista[i].id_lokalne + '”)'].concat(d !== null ? [metry(d) + ' od siebie'] : []), d);
        }
      });
    // 3) i 4) sąsiedzi. Współrzędne rzutowane lokalnie na metry (x = dł.·cos(szer.), y = szer.).
    //  – bliżej niż promienM: siatka o boku promienM, każda para oceniana w pełni;
    //  – promienM…promienMaksM: tylko pary z tym samym kluczem (ulica+numer, ulica bez numeru, nazwa) w siatce o boku promienMaksM.
    //  Dzięki temu gęsta zabudowa (tysiące punktów na km²) nie oznacza porównywania tysięcy par na punkt.
    const X = new Float64Array(n), Y = new Float64Array(n);
    const drobna = new Map(), klucze = new Map();
    const dodajDo = function (m, k, i) { const t = m.get(k); if (t) t.push(i); else m.set(k, [i]); };
    for (let i = 0; i < n; i++) {
      const w = P[i].wsp;
      if (!w) continue;
      X[i] = w.lon * M_NA_STOPIEN * Math.cos(w.lat * Math.PI / 180);
      Y[i] = w.lat * M_NA_STOPIEN;
      P[i].fx = Math.floor(X[i] / R); P[i].fy = Math.floor(Y[i] / R);
      dodajDo(drobna, P[i].fx * 1e7 + P[i].fy, i);
      const wx = Math.floor(X[i] / RMAX), wy = Math.floor(Y[i] / RMAX);
      P[i].wx = wx; P[i].wy = wy;
      P[i].nk = kluczNazwy(lista[i].nazwa);
      const c = wx + ',' + wy + '|';
      if (P[i].ulica) {
        dodajDo(klucze, c + 'u|' + P[i].ulica, i);
        if (P[i].nr) dodajDo(klucze, c + 'a|' + P[i].ulica + '|' + P[i].nr, i);
        else dodajDo(klucze, c + 'b|' + P[i].ulica, i);
      }
      if (P[i].nk) dodajDo(klucze, c + 'n|' + P[i].nk, i);
    }
    const RMAX2 = RMAX * RMAX, R2 = R * R;
    yield 0.15;
    for (let i = 0; i < n; i++) {
      if (i % 2000 === 1999) yield 0.15 + 0.65 * i / n;
      if (!P[i].wsp) continue;
      const xi = X[i], yi = Y[i];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const kom = drobna.get((P[i].fx + dx) * 1e7 + P[i].fy + dy);
          if (!kom) continue;
          for (let q = 0; q < kom.length; q++) {
            const j = kom[q];
            if (j <= i) continue;
            const ex = X[j] - xi, ey = Y[j] - yi, d2 = ex * ex + ey * ey;
            if (d2 < R2) ocenPare(i, j, Math.sqrt(d2));
          }
        }
      }
      // dalsze pary – tylko z tym samym kluczem
      const listy = [];
      if (P[i].ulica) {
        if (P[i].nr) listy.push('a|' + P[i].ulica + '|' + P[i].nr, 'b|' + P[i].ulica); else listy.push('u|' + P[i].ulica);
      }
      if (P[i].nk) listy.push('n|' + P[i].nk);
      if (!listy.length) continue;
      const byly = listy.length > 1 ? new Set() : null;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const c = (P[i].wx + dx) + ',' + (P[i].wy + dy) + '|';
          for (let l = 0; l < listy.length; l++) {
            const kom = klucze.get(c + listy[l]);
            if (!kom) continue;
            for (let q = 0; q < kom.length; q++) {
              const j = kom[q];
              if (j <= i) continue;
              const ex = X[j] - xi, ey = Y[j] - yi, d2 = ex * ex + ey * ey;
              if (d2 < R2 || d2 >= RMAX2) continue;
              if (byly) { if (byly.has(j)) continue; byly.add(j); }
              ocenPare(i, j, Math.sqrt(d2));
            }
          }
        }
      }
    }
    function ocenPare(i, j, d) {
      // dalej niż promienM: najpierw tanie porównanie kluczy (ulica / nazwa) – trigramy tylko, gdy ulica pasuje
      if (d >= R) {
        const ulicaTa = P[i].ulica && P[i].ulica === P[j].ulica && (!P[i].nr || !P[j].nr || P[i].nr === P[j].nr);
        if (!ulicaTa && (!nazwa(i).tekst || nazwa(i).tekst !== nazwa(j).tekst)) return;
      }
      const ad = adres(i, j);
      const pn = podobienstwoTekstu(nazwa(i), nazwa(j));
      const nazwaPodobna = pn !== null && pn >= 0.8;
      const adresPodobny = !!(ad.rowny || ad.podobny);
      if (d >= R && !nazwaPodobna && !adresPodobny) return;
      const powody = [metry(d) + ' od siebie'];
      if (ad.rowny) powody.push('ten sam adres (' + ad.tekst + ')');
      else if (ad.podobny) powody.push('podobny adres (' + ad.tekst + ')');
      if (nazwaPodobna) powody.push(pn === 1 ? 'ta sama nazwa' : 'podobna nazwa');
      const spr = sprzecznosci(i, j);
      let poziom;
      if (spr.length) poziom = 0;
      else if (ad.rowny && (d < R || nazwaPodobna)) poziom = 2;
      else if (nazwaPodobna && d < R && !(ad.info && ad.rozny)) poziom = 2;
      else if (d <= R / 2 && (adresPodobny || (pn !== null && pn >= 0.5))) poziom = 2;
      else if (d < R) {
        // brak sprzeczności, ale i brak potwierdzenia; nazwy i ulice zupełnie różne -> niska
        const rozne = (pn !== null && pn < 0.3) && (ad.info ? ad.rozny : true);
        poziom = rozne ? 0 : 1;
        if (rozne) powody.push('różne nazwy' + (ad.info ? ' i adresy' : ''));
      } else poziom = 1;
      dodajKrawedz(i, j, poziom, powody.concat(spr), d);
    }

    yield 0.8;
    // union-find: najpierw krawędzie pewne (wysoka, srednia), potem niska tylko między rekordami bez grupy
    const rodzic = new Int32Array(n);
    for (let i = 0; i < n; i++) rodzic[i] = i;
    const korzen = function (x) { while (rodzic[x] !== x) { rodzic[x] = rodzic[rodzic[x]]; x = rodzic[x]; } return x; };
    const polacz = function (a, b) { a = korzen(a); b = korzen(b); if (a !== b) rodzic[b] = a; };
    const lk = Array.from(krawedzie.values()).filter(function (e) { return !rozdzielone.has(kluczPary(lista[e.i]._id, lista[e.j]._id)); });
    const wGrupie = new Uint8Array(n);
    lk.forEach(function (e) { if (e.poziom > 0) { polacz(e.i, e.j); wGrupie[e.i] = wGrupie[e.j] = 1; } });
    const pominiete = []; // krawędzie „niska” między rekordami z innych grup – nie łączymy, ale nie gubimy
    lk.forEach(function (e) {
      if (e.poziom !== 0) return;
      if (!wGrupie[e.i] && !wGrupie[e.j]) polacz(e.i, e.j); else if (korzen(e.i) !== korzen(e.j)) pominiete.push(e);
    });
    // identyczne współrzędne przy krawędzi „niska” = możliwe skopiowanie punktu
    const teSame = lk.filter(function (e) { return e.poziom === 0 && e.d !== null && e.d < TE_SAME_M; });
    // składowe (komponenty) grafu
    const wgKorzenia = new Map();
    lk.forEach(function (e) {
      [e.i, e.j].forEach(function (x) {
        const k = korzen(x);
        let c = wgKorzenia.get(k);
        if (!c) { c = { idx: new Set(), krawedzie: [] }; wgKorzenia.set(k, c); }
        c.idx.add(x);
      });
    });
    lk.forEach(function (e) {
      const k = korzen(e.i);
      if (k === korzen(e.j)) wgKorzenia.get(k).krawedzie.push(e);
    });
    // bardzo duża składowa = łańcuch bliskich punktów (gęsta zabudowa) – zostawiamy tylko pary pewne
    const komponenty = [];
    const kompIdx = new Map(); // indeks rekordu -> komponent
    wgKorzenia.forEach(function (c) {
      if (c.idx.size <= MAKS_GRUPA * 4) { komponenty.push(c); return; }
      const pod = new Map();
      c.idx.forEach(function (x) { rodzic[x] = x; }); // ponowne użycie tablicy union-find tylko dla tej składowej
      const k2 = korzen;
      c.krawedzie.forEach(function (e) { if (e.poziom === 2) polacz(e.i, e.j); });
      c.krawedzie.forEach(function (e) {
        if (e.poziom < 2) return;
        const k = k2(e.i);
        let t = pod.get(k);
        if (!t) { t = { idx: new Set(), krawedzie: [] }; pod.set(k, t); }
        t.idx.add(e.i); t.idx.add(e.j); t.krawedzie.push(e);
      });
      // nadal ogromna podgrupa (łańcuch pewnych par) – pomijamy, zostaje ostrzeżenie
      pod.forEach(function (t) { if (t.idx.size <= MAKS_GRUPA * 4) komponenty.push(t); });
      ostrzezenia.push({ kod: 'GESTA_ZABUDOWA', liczba: c.idx.size, komunikat: liczbaTekst(c.idx.size) +
        ' rekordów leży łańcuchem blisko siebie (gęsta zabudowa) – pokazujemy tylko pewne pary duplikatów z tego obszaru.' });
    });
    komponenty.forEach(function (c) { c.idx.forEach(function (x) { kompIdx.set(x, c); }); });

    const cmp = porownywacz(priorytet);
    const grupy = [];
    komponenty.forEach(function (c) {
      if (c.idx.size < 2) return;
      const rek = Array.from(c.idx).map(function (x) { return lista[x]; }).sort(cmp);
      const ks = c.krawedzie.slice().sort(function (a, b) { return b.poziom - a.poziom || a.d - b.d; });
      let poziom = 2;
      ks.forEach(function (e) { if (e.poziom < poziom) poziom = e.poziom; });
      const powody = [];
      ks.forEach(function (e) { e.powody.forEach(function (p) { if (powody.indexOf(p) < 0) powody.push(p); }); });
      // dwa rekordy z tego samego źródła z różnymi numerami u dysponenta w jednej grupie -> to nie jeden AED
      const numery = {};
      rek.forEach(function (r) {
        if (pusta(r.id_lokalne)) return;
        const k = r._zrodlo;
        (numery[k] = numery[k] || new Set()).add(N.klucz(r.id_lokalne));
      });
      if (Object.keys(numery).some(function (k) { return numery[k].size > 1; }) && poziom > 0) {
        poziom = 0;
        powody.push('w grupie są różne numery urządzeń z tego samego źródła');
      }
      if (rek.length > MAKS_GRUPA && poziom > 0) { poziom = 0; powody.push('duża grupa (' + rek.length + ' rekordów) – sprawdź ręcznie'); }
      // para oznaczona wcześniej jako różne urządzenia połączona przez inny rekord – bez automatycznego scalenia
      let zawieraRozdzielone = false;
      if (rozdzielone.size) {
        const idy = rek.map(function (r) { return r._id; });
        for (let a = 0; a < idy.length && !zawieraRozdzielone; a++) {
          for (let b = a + 1; b < idy.length; b++) if (rozdzielone.has(kluczPary(idy[a], idy[b]))) { zawieraRozdzielone = true; break; }
        }
        if (zawieraRozdzielone) {
          if (poziom > 1) poziom = 1;
          powody.push('zawiera rekordy oznaczone wcześniej jako różne urządzenia');
        }
      }
      const zw = rek.filter(maWsp);
      let maks = null;
      if (zw.length <= MAKS_GRUPA) {
        for (let a = 0; a < zw.length; a++) {
          for (let b = a + 1; b < zw.length; b++) {
            const d = odlegloscM({ lat: zw[a].szerokosc_geograficzna, lon: zw[a].dlugosc_geograficzna },
              { lat: zw[b].szerokosc_geograficzna, lon: zw[b].dlugosc_geograficzna });
            if (maks === null || d > maks) maks = d;
          }
        }
      } else {
        // duża grupa: przekątna prostokąta otaczającego (bez porównywania każdej pary)
        let a = Infinity, b = -Infinity, c = Infinity, e = -Infinity;
        zw.forEach(function (r) {
          a = Math.min(a, r.szerokosc_geograficzna); b = Math.max(b, r.szerokosc_geograficzna);
          c = Math.min(c, r.dlugosc_geograficzna); e = Math.max(e, r.dlugosc_geograficzna);
        });
        maks = odlegloscM({ lat: a, lon: c }, { lat: b, lon: e });
      }
      const ids = rek.map(function (r) { return r._id; });
      const posort = ids.slice().sort();
      grupy.push({
        id: 'g' + fnv(posort.join('\n')) + '-' + ids.length,
        rekordy: ids,
        pewnosc: NAZWA_POZIOMU[poziom],
        powody: powody.slice(0, 8),
        odlegloscM: maks === null ? null : Math.round(maks),
        glowny: ids[0],
        konflikty: konfliktyGrupy(rek),
        zawieraRozdzielone: zawieraRozdzielone,
        powiazane: []
      });
      c.grupa = grupy[grupy.length - 1];
    });
    // pominięte krawędzie „niska” między grupami – informacja w obu grupach (pole powiazane i powód)
    pominiete.forEach(function (e) {
      const ga = kompIdx.get(e.i), gb = kompIdx.get(e.j);
      [[ga, gb, e.j], [gb, ga, e.i]].forEach(function (t) {
        const g = t[0] && t[0].grupa, inna = t[1] && t[1].grupa, r = lista[t[2]];
        if (!g) return;
        if (inna && g.powiazane.indexOf(inna.id) < 0) g.powiazane.push(inna.id);
        const opis = 'blisko rekordu ' + r._kodZrodla + ' wiersz ' + r._wiersz + (inna ? ' z innej grupy' : '') + ' (' + e.powody[0] + ')';
        if (g.powody.length < 10 && g.powody.indexOf(opis) < 0) g.powody.push(opis);
      });
    });
    grupy.sort(function (a, b) { return POZIOM[b.pewnosc] - POZIOM[a.pewnosc] || (a.odlegloscM || 0) - (b.odlegloscM || 0) || (a.id < b.id ? -1 : 1); });

    yield 0.9;
    const odstajace = znajdzOdstajace(lista, teSame.map(function (e) { return [lista[e.i], lista[e.j]]; }));
    const ile = { wysoka: 0, srednia: 0, niska: 0 };
    let wGrupach = 0;
    grupy.forEach(function (g) { ile[g.pewnosc]++; wGrupach += g.rekordy.length; });
    return {
      grupy: grupy,
      odstajace: odstajace,
      podsumowanie: {
        rekordy: n, zWspolrzednymi: P.filter(function (p) { return p.wsp; }).length,
        grupy: grupy.length, wysoka: ile.wysoka, srednia: ile.srednia, niska: ile.niska,
        rekordowWGrupach: wGrupach, doUsunieciaAutomatycznie: grupy.reduce(function (s, g) { return s + (g.pewnosc === 'wysoka' ? g.rekordy.length - 1 : 0); }, 0),
        odstajace: odstajace.length, promienM: R, promienMaksM: RMAX, czasMs: Date.now() - t0,
        ostrzezenia: ostrzezenia
      }
    };
  }

  // ------------------------------------------------- punkty odstające
  /** Mediana współrzędnych + MAD odległości. Zwraca { lat, lon, prog } albo null. */
  function srodek(punkty, minProgKm) {
    const lat = mediana(punkty.map(function (p) { return p.lat; }));
    const lon = mediana(punkty.map(function (p) { return p.lon; }));
    const d = punkty.map(function (p) { return haversineKm(lat, lon, p.lat, p.lon); });
    const med = mediana(d);
    const mad = mediana(d.map(function (x) { return Math.abs(x - med); }));
    return { lat: lat, lon: lon, med: med, prog: Math.max(med + 5 * 1.4826 * mad, 3 * med, minProgKm) };
  }
  function znajdzOdstajace(lista, teSame) {
    // jeden wpis na rekord (najważniejszy kod); kolejne kody tego rekordu w polu dodatkowe[]
    const wynik = new Map();
    const dodaj = function (r, kod, komunikat, km) {
      const w = { kod: kod, komunikat: komunikat, odlegloscKm: Math.round(km * 10) / 10 };
      const juz = wynik.get(r._id);
      if (juz) { if (juz.kod !== kod && !juz.dodatkowe.some(function (x) { return x.kod === kod && x.komunikat === komunikat; })) juz.dodatkowe.push(w); return; }
      wynik.set(r._id, Object.assign({ rekordId: r._id }, w, { dodatkowe: [] }));
    };
    const fmt = function (km) { return String(Math.round(km * 10) / 10).replace('.', ','); };

    // 1) zgodność z województwem (pole wojewodztwo albo dwie pierwsze cyfry kodu TERC)
    lista.forEach(function (r) {
      if (!maWsp(r)) return;
      let woj = r.wojewodztwo && WOJ_BBOX[r.wojewodztwo] ? r.wojewodztwo : null;
      if (!woj && typeof r.kod_terc_gminy === 'string' && /^\d{7}$/.test(r.kod_terc_gminy)) woj = N.wojewodztwo(r.kod_terc_gminy.slice(0, 2));
      const b = woj && WOJ_BBOX[woj];
      if (!b) return;
      const lat = r.szerokosc_geograficzna, lon = r.dlugosc_geograficzna, m = 0.15;
      if (lat >= b[0] - m && lat <= b[1] + m && lon >= b[2] - m && lon <= b[3] + m) return;
      const sLat = Math.min(Math.max(lat, b[0]), b[1]), sLon = Math.min(Math.max(lon, b[2]), b[3]);
      const km = haversineKm(lat, lon, sLat, sLon);
      dodaj(r, 'POZA_WOJEWODZTWEM', 'Punkt leży ok. ' + fmt(km) + ' km poza województwem ' + woj +
        ' (wpisanym w rekordzie). Sprawdź współrzędne – mogą być zamienione albo skopiowane z innego rekordu.', km);
    });
    // 2) daleko od reszty punktów tego samego źródła
    const poZrodle = new Map();
    lista.forEach(function (r) {
      if (!maWsp(r)) return;
      const t = poZrodle.get(r._zrodlo);
      if (t) t.push(r); else poZrodle.set(r._zrodlo, [r]);
    });
    poZrodle.forEach(function (rek) {
      if (rek.length < 5) return;
      const s = srodek(rek.map(function (r) { return { lat: r.szerokosc_geograficzna, lon: r.dlugosc_geograficzna }; }), 5);
      rek.forEach(function (r) {
        const km = haversineKm(s.lat, s.lon, r.szerokosc_geograficzna, r.dlugosc_geograficzna);
        if (km > s.prog) {
          dodaj(r, 'DALEKO_OD_ZBIORU', 'Punkt leży ok. ' + fmt(km) + ' km od pozostałych punktów źródła ' + (r._kodZrodla || '') +
            ' (typowo do ' + fmt(Math.max(s.med * 2, 1)) + ' km). Sprawdź współrzędne – mogą pochodzić z innej miejscowości.', km);
        }
      });
    });
    // 3) daleko od innych punktów z tą samą miejscowością (w obrębie województwa, gdy jest podane)
    const poMiejsc = new Map();
    lista.forEach(function (r) {
      if (!maWsp(r) || pusta(r.miejscowosc)) return;
      const k = N.klucz(r.miejscowosc) + '|' + (r.wojewodztwo || '');
      const t = poMiejsc.get(k);
      if (t) t.push(r); else poMiejsc.set(k, [r]);
    });
    poMiejsc.forEach(function (rek) {
      if (rek.length < 3) return;
      const s = srodek(rek.map(function (r) { return { lat: r.szerokosc_geograficzna, lon: r.dlugosc_geograficzna }; }), 10);
      if (s.med > 20) return; // ta sama nazwa wielu różnych miejscowości („Nowa Wieś”) – nie oceniamy
      rek.forEach(function (r) {
        const km = haversineKm(s.lat, s.lon, r.szerokosc_geograficzna, r.dlugosc_geograficzna);
        if (km > s.prog) {
          dodaj(r, 'DALEKO_OD_MIEJSCOWOSCI', 'Punkt leży ok. ' + fmt(km) + ' km od innych punktów w miejscowości ' + r.miejscowosc +
            '. Sprawdź współrzędne albo nazwę miejscowości.', km);
        }
      });
    });
    // 4) identyczne współrzędne jak inny rekord, który nie jest jego duplikatem (krawędź „niska”)
    (teSame || []).forEach(function (para) {
      const a = para[0], b = para[1];
      dodaj(a, 'TE_SAME_WSPOLRZEDNE', 'Identyczne współrzędne jak ' + b._kodZrodla + ' wiersz ' + b._wiersz +
        ' – możliwe skopiowanie punktu. Sprawdź współrzędne obu rekordów.', 0);
      dodaj(b, 'TE_SAME_WSPOLRZEDNE', 'Identyczne współrzędne jak ' + a._kodZrodla + ' wiersz ' + a._wiersz +
        ' – możliwe skopiowanie punktu. Sprawdź współrzędne obu rekordów.', 0);
    });
    return Array.from(wynik.values());
  }

  // ------------------------------------------------------------- scal
  /**
   * @param {Object[]} rekordy
   * @param {Object[]} grupy – z znajdz()
   * @param {Object<string,{status:'scal'|'rozdziel', glowny?:string, wartosci?:Object<string,string>}>} [decyzje]
   * @param {{zrodla?:Object[]}} [opcje]
   */
  function scal(rekordy, grupy, decyzje, opcje) {
    decyzje = decyzje || {};
    const lista = rekordy || [];
    const indeks = new Map();
    lista.forEach(function (r) { indeks.set(r._id, r); });
    const priorytet = priorytetyZrodel(opcje);
    const cmp = porownywacz(priorytet);
    const zastap = new Map();   // _id główny -> rekord wynikowy
    const usun = new Set();
    const raport = { grupy: (grupy || []).length, scalone: 0, rozdzielone: 0, usuniete: 0, pominiete: 0, automatycznie: 0 };
    const uzyte = new Set();

    (grupy || []).forEach(function (g) {
      // każdy rekord tylko w jednej grupie; grupy z nieistniejącymi rekordami pomijamy
      const rek = g.rekordy.map(function (id) { return indeks.get(id); }).filter(function (r) { return r && !uzyte.has(r._id); });
      if (rek.length < 2) { raport.pominiete++; return; }
      const d = decyzje[g.id];
      const status = d && (d.status === 'scal' || d.status === 'rozdziel') ? d.status
        : (g.pewnosc === 'wysoka' && !g.zawieraRozdzielone ? 'scal' : 'rozdziel');
      if (status !== 'scal') { raport.rozdzielone++; return; }
      if (!d) raport.automatycznie++;
      rek.forEach(function (r) { uzyte.add(r._id); });
      let glowny = rek.find(function (r) { return r._id === (d && d.glowny); }) ||
        rek.find(function (r) { return r._id === g.glowny; }) || rek.slice().sort(cmp)[0];
      const pozostale = rek.filter(function (r) { return r !== glowny; }).sort(cmp);
      const wynik = scalRekordy(glowny, pozostale, rek.slice().sort(cmp), (d && d.wartosci) || {}, (opcje && opcje.teraz) || teraz());
      zastap.set(glowny._id, wynik);
      pozostale.forEach(function (r) { usun.add(r._id); });
      raport.scalone++;
      raport.usuniete += pozostale.length;
    });

    const wynik = [];
    lista.forEach(function (r) {
      if (usun.has(r._id)) return;
      wynik.push(zastap.get(r._id) || r);
    });
    raport.noweId = unikalneId(wynik, cmp);
    return { rekordy: wynik, raport: raport };
  }

  /** Rekord wynikowy: każde pole wg reguły wzorca (najnowsza data_weryfikacji, potem priorytet źródła), potem wybory z decyzji.
      Z głównego zawsze: id_aed (i jego miejsce w zbiorze). */
  /** Czy id_aed rekordu pochodzi z danych źródła (jest w surowym wierszu), a nie zostało nadane przy mapowaniu. */
  function idZeZrodla(r) {
    if (pusta(r.id_aed) || !r._surowy || typeof r._surowy !== 'object') return false;
    const id = String(r.id_aed).toLowerCase();
    return Object.keys(r._surowy).some(function (k) { const v = r._surowy[k]; return typeof v === 'string' && v.trim().toLowerCase() === id; });
  }

  /** id_aed musi być unikalny w wyniku (np. po „rozdziel” dwóch rekordów z tym samym id). Zostaje przy rekordzie, którego id
      pochodzi ze źródła, potem wg priorytetu; pozostałe dostają nowy UUID v4 (kopia rekordu – wejście bez zmian). */
  function unikalneId(wynik, cmp) {
    const poId = new Map();
    wynik.forEach(function (r, i) {
      if (pusta(r.id_aed)) return;
      const k = String(r.id_aed).toLowerCase();
      const t = poId.get(k);
      if (t) t.push(i); else poId.set(k, [i]);
    });
    const zmiany = [];
    poId.forEach(function (idx) {
      if (idx.length < 2) return;
      const kol = idx.slice().sort(function (a, b) {
        const za = idZeZrodla(wynik[a]) ? 0 : 1, zb = idZeZrodla(wynik[b]) ? 0 : 1;
        return za - zb || cmp(wynik[a], wynik[b]);
      });
      const zostaje = wynik[kol[0]];
      kol.slice(1).forEach(function (i) {
        const r = wynik[i], stare = r.id_aed, k = stare + '|' + r._id;
        let nowe = noweIdPamiec.get(k);
        if (!nowe) { nowe = nowyUuid(); noweIdPamiec.set(k, nowe); }
        wynik[i] = Object.assign({}, r, { id_aed: nowe });
        zmiany.push({ rekordId: r._id, stare: stare, nowe: nowe,
          powod: 'Ten sam id_aed ma rekord ' + zostaje._kodZrodla + ' wiersz ' + zostaje._wiersz + ', a rekordy nie zostały scalone – nadano nowy identyfikator.' });
      });
    });
    return zmiany;
  }

  function scalRekordy(glowny, pozostale, kolejnosc, wartosci, czas) {
    const wszystkie = [glowny].concat(pozostale);
    const wg = new Map(wszystkie.map(function (r) { return [r._id, r]; }));
    const w = Object.assign({}, glowny);
    const wklad = new Map(wszystkie.map(function (r) { return [r._id, []]; })); // _id -> pola wzięte z rekordu
    const wez = function (z, pola) {
      pola.forEach(function (p) { w[p] = z[p]; });
      // pole wzięte drugi raz (decyzja) – usuń z poprzedniego rekordu
      wklad.forEach(function (lista) { pola.forEach(function (p) { const k = lista.indexOf(p); if (k >= 0) lista.splice(k, 1); }); });
      Array.prototype.push.apply(wklad.get(z._id), pola);
    };
    // id_aed: z głównego, chyba że jego UUID nadała aplikacja, a inny rekord ma identyfikator wczytany ze źródła
    // (np. wcześniej opublikowany zbiór) – wtedy zachowujemy ten istniejący, żeby id_aed się nie zmieniał
    const zId = idZeZrodla(glowny) ? glowny : (kolejnosc.find(idZeZrodla) || glowny);
    w.id_aed = zId.id_aed;
    wklad.get(zId._id).push('id_aed');
    POLA.forEach(function (pole) {
      if (BEZ_KONFLIKTU[pole]) return;
      const z = wybierzRekord(kolejnosc, maPole(pole));
      if (z) wez(z, [pole]); else w[pole] = glowny[pole] === undefined ? null : glowny[pole];
    });
    const zw = wybierzRekord(kolejnosc, maWsp);
    if (zw) wez(zw, ['szerokosc_geograficzna', 'dlugosc_geograficzna']);
    // wybory z decyzji
    Object.keys(wartosci).forEach(function (pole) {
      const z = wg.get(wartosci[pole]);
      if (!z) return;
      if (pole === POLE_WSP || pole === 'szerokosc_geograficzna' || pole === 'dlugosc_geograficzna') {
        wez(z, ['szerokosc_geograficzna', 'dlugosc_geograficzna'].concat(['lokalizacja_przyblizona', 'zrodlo_wspolrzednych'].filter(function (p) { return !pusta(z[p]); })));
      } else if (POLA.indexOf(pole) >= 0 && !BEZ_KONFLIKTU[pole]) {
        wez(z, [pole]);
      }
    });
    // pochodzenie i licencja
    const kody = [], idy = [];
    wszystkie.forEach(function (r) {
      const k = r.zrodlo_danych || r._kodZrodla;
      if (k) String(k).split(';').forEach(function (x) { if (x && kody.indexOf(x) < 0) kody.push(x); });
      if (!pusta(r.zrodlo_id_rekordu)) String(r.zrodlo_id_rekordu).split(';').forEach(function (x) { if (x && idy.indexOf(x) < 0) idy.push(x); });
    });
    w.zrodlo_danych = kody.join(';') || null;
    w.zrodlo_id_rekordu = idy.join(';') || null;
    let lic = null;
    wszystkie.forEach(function (r) {
      if (!wklad.get(r._id).length) return;
      const l = r.licencja_rekordu;
      if (LICENCJA_RANGA[l] !== undefined && (lic === null || LICENCJA_RANGA[l] > LICENCJA_RANGA[lic])) lic = l;
    });
    w.licencja_rekordu = lic || glowny.licencja_rekordu || null;
    w.data_aktualizacji_rekordu = czas; // rekord scalony powstał teraz
    w._scalonoZ = wszystkie.map(function (r) {
      return { _id: r._id, kodZrodla: r._kodZrodla, wiersz: r._wiersz, zrodloIdRekordu: r.zrodlo_id_rekordu || null,
        licencja: r.licencja_rekordu || null, rola: r === glowny ? 'nadrzedne' : 'duplikat_scalony', wklad: wklad.get(r._id) };
    });
    w._scalony = true;
    return w;
  }

  AED.duplikaty = {
    POLE_WSPOLRZEDNE: POLE_WSP,
    MAKS_KUBELEK: MAKS_KUBELEK,
    kluczPary: kluczPary,
    znajdz: znajdz,
    znajdzAsync: znajdzAsync,
    scal: scal,
    _test: { jaroWinkler: jaroWinkler, dice: dice, trigramy: trigramy, podobienstwoTekstu: podobienstwoTekstu, opisTekstu: opisTekstu,
      odlegloscM: odlegloscM, haversineKm: haversineKm, WOJ_BBOX: WOJ_BBOX }
  };
})(window.AED);
