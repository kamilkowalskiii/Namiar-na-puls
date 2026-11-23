/* Atrapa (mock) kontraktu części 4: AED.duplikaty, AED.eksport i rozszerzenia AED.store
   (decyzje, duplikaty, wynik). Służy WYŁĄCZNIE do testów interfejsu, zanim powstaną prawdziwe moduły
   (js/core/duplikaty.js, js/core/eksport.js). Każda część wczytuje się tylko, gdy prawdziwej nie ma.
   Nie dołączaj na stałe do index.html. */
(function (AED) {
  'use strict';
  const POLA = AED.wzorzec.schema.fields.map(function (p) { return p.name; });
  const POMIJANE = { id_aed: 1, zrodlo_danych: 1, data_aktualizacji_rekordu: 1, zrodlo_id_rekordu: 1, licencja_rekordu: 1 };

  function klucz(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function odl(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.szerokosc_geograficzna - a.szerokosc_geograficzna) * r;
    const dLon = (b.dlugosc_geograficzna - a.dlugosc_geograficzna) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.szerokosc_geograficzna * r) * Math.cos(b.szerokosc_geograficzna * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function maWsp(r) { return typeof r.szerokosc_geograficzna === 'number' && typeof r.dlugosc_geograficzna === 'number'; }
  function pusta(v) { return v === null || v === undefined || v === ''; }

  // ------------------------------------------------------------ duplikaty
  function znajdz(rekordy, opcje) {
    const promien = (opcje && opcje.promienM) || 30;
    const zW = rekordy.filter(maWsp);
    const siatka = new Map();
    const kom = promien / 111000;
    const kl = function (la, lo) { return Math.floor(la / kom) + ':' + Math.floor(lo / kom); };
    zW.forEach(function (r) {
      const k = kl(r.szerokosc_geograficzna, r.dlugosc_geograficzna);
      if (!siatka.has(k)) siatka.set(k, []);
      siatka.get(k).push(r);
    });
    const rodzic = new Map();
    const znajdzR = function (x) { while (rodzic.get(x) !== x) x = rodzic.get(x); return x; };
    zW.forEach(function (r) { rodzic.set(r._id, r._id); });
    const pary = [];
    zW.forEach(function (r) {
      const i = Math.floor(r.szerokosc_geograficzna / kom), j = Math.floor(r.dlugosc_geograficzna / kom);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        (siatka.get((i + a) + ':' + (j + b)) || []).forEach(function (s) {
          if (s._id <= r._id) return;
          const d = odl(r, s);
          if (d <= promien) { pary.push([r, s, d]); rodzic.set(znajdzR(s._id), znajdzR(r._id)); }
        });
      }
    });
    const grupyM = new Map();
    pary.forEach(function (p) {
      const k = znajdzR(p[0]._id);
      if (!grupyM.has(k)) grupyM.set(k, { rek: new Map(), d: 0, powody: new Set(), nazwa: true });
      const g = grupyM.get(k);
      g.rek.set(p[0]._id, p[0]); g.rek.set(p[1]._id, p[1]);
      g.d = Math.max(g.d, p[2]);
      g.powody.add('Odległość ' + Math.round(p[2]) + ' m (próg ' + promien + ' m).');
      if (klucz(p[0].nazwa) === klucz(p[1].nazwa)) g.powody.add('Ta sama nazwa miejsca.');
      else g.nazwa = false;
      if (p[0].ulica && klucz(p[0].ulica) === klucz(p[1].ulica) && klucz(p[0].numer_budynku) === klucz(p[1].numer_budynku)) g.powody.add('Ten sam adres.');
    });
    let n = 0;
    const grupy = [];
    grupyM.forEach(function (g) {
      const rek = Array.from(g.rek.values());
      const pewnosc = g.d < 10 && g.nazwa ? 'wysoka' : g.d < 20 ? 'srednia' : 'niska';
      const glowny = rek.slice().sort(function (a, b) { return String(a._kodZrodla).localeCompare(String(b._kodZrodla)); })[0]._id;
      const konflikty = [];
      POLA.forEach(function (pole) {
        if (POMIJANE[pole]) return;
        const wart = rek.filter(function (r) { return !pusta(r[pole]); }).map(function (r) { return { rekordId: r._id, wartosc: r[pole] }; });
        const rozne = new Set(wart.map(function (w) { return JSON.stringify(w.wartosc); }));
        if (rozne.size > 1) konflikty.push({ pole: pole, wartosci: wart, proponowana: glowny });
      });
      grupy.push({ id: 'G' + (++n), rekordy: rek.map(function (r) { return r._id; }), pewnosc: pewnosc,
        powody: Array.from(g.powody), odlegloscM: Math.round(g.d * 10) / 10, glowny: glowny, konflikty: konflikty });
    });
    // odstające: daleko od mediany zbioru
    const odstajace = [];
    if (zW.length > 2) {
      const med = function (a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[a.length >> 1]; };
      const c = { szerokosc_geograficzna: med(zW.map(function (r) { return r.szerokosc_geograficzna; })),
        dlugosc_geograficzna: med(zW.map(function (r) { return r.dlugosc_geograficzna; })) };
      zW.forEach(function (r) {
        const km = odl(c, r) / 1000;
        if (km > 150) odstajace.push({ rekordId: r._id, kod: 'DALEKO_OD_ZBIORU', odlegloscKm: Math.round(km),
          komunikat: 'Punkt leży ' + Math.round(km) + ' km od środka zbioru. Sprawdź, czy współrzędne nie są zamienione lub błędne.' });
      });
    }
    const wg = { wysoka: 0, srednia: 0, niska: 0 };
    grupy.forEach(function (g) { wg[g.pewnosc]++; });
    return { grupy: grupy, odstajace: odstajace, podsumowanie: { grupy: grupy.length, wgPewnosci: wg, rekordyWGrupach: pary.length ? grupy.reduce(function (s, g) { return s + g.rekordy.length; }, 0) : 0, odstajace: odstajace.length } };
  }

  function scal(rekordy, grupy, decyzje) {
    decyzje = decyzje || {};
    const usun = new Set();
    const zamiana = new Map();
    let scalone = 0, rozdzielone = 0;
    const indeks = new Map(rekordy.map(function (r) { return [r._id, r]; }));
    (grupy || []).forEach(function (g) {
      const d = decyzje[g.id] || { status: g.pewnosc === 'wysoka' ? 'scal' : 'rozdziel' };
      if (d.status !== 'scal') { rozdzielone++; return; }
      scalone++;
      const glowny = d.glowny || g.glowny;
      const baza = Object.assign({}, indeks.get(glowny));
      (g.konflikty || []).forEach(function (k) {
        const zKtorego = (d.wartosci && d.wartosci[k.pole]) || k.proponowana || glowny;
        const w = k.wartosci.find(function (x) { return x.rekordId === zKtorego; });
        if (w) baza[k.pole] = w.wartosc;
      });
      g.rekordy.forEach(function (id) {
        const r = indeks.get(id);
        POLA.forEach(function (p) { if (pusta(baza[p]) && r && !pusta(r[p])) baza[p] = r[p]; });
        if (id !== glowny) usun.add(id);
      });
      baza._scalonoZ = g.rekordy.map(function (id) { const r = indeks.get(id); return { _id: id, kodZrodla: r._kodZrodla, wiersz: r._wiersz }; });
      zamiana.set(glowny, baza);
    });
    const wynik = rekordy.filter(function (r) { return !usun.has(r._id); }).map(function (r) { return zamiana.get(r._id) || r; });
    return { rekordy: wynik, raport: { grupy: (grupy || []).length, scalone: scalone, rozdzielone: rozdzielone, usuniete: usun.size } };
  }

  if (!AED.duplikaty) AED.duplikaty = { znajdz: znajdz, scal: scal };

  // ------------------------------------------------------------ eksport
  const SLOWNIKI_XML = {
    czestotliwosc: [
      { kod: 'daily', etykieta: 'Codziennie' }, { kod: 'weekly', etykieta: 'Co tydzień' }, { kod: 'monthly', etykieta: 'Co miesiąc' },
      { kod: 'quarterly', etykieta: 'Co kwartał' }, { kod: 'everyHalfYear', etykieta: 'Co pół roku' }, { kod: 'yearly', etykieta: 'Co rok' },
      { kod: 'irregular', etykieta: 'Nieregularnie' }, { kod: 'notPlanned', etykieta: 'Jednorazowe udostępnienie' }],
    kategorie: [
      { kod: 'HEAL', etykieta: 'Zdrowie' }, { kod: 'GOVE', etykieta: 'Rząd i sektor publiczny' }, { kod: 'REGI', etykieta: 'Regiony i miasta' },
      { kod: 'JUST', etykieta: 'Sprawiedliwość, ustrój sądów i bezpieczeństwo publiczne' }, { kod: 'SOCI', etykieta: 'Ludność i społeczeństwo' },
      { kod: 'TRAN', etykieta: 'Transport' }, { kod: 'EDUC', etykieta: 'Edukacja, kultura i sport' }]
  };
  function tekstPola(v) {
    if (v === null || v === undefined) return '';
    if (v === true) return 'true';
    if (v === false) return 'false';
    return String(v);
  }
  function csvPole(t) { t = tekstPola(t); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }
  function csvZ(kolumny, wiersze) {
    return [kolumny.map(csvPole).join(',')].concat(wiersze.map(function (w) { return w.map(csvPole).join(','); })).join('\r\n') + '\r\n';
  }
  function czyste(r) { const o = {}; POLA.forEach(function (p) { o[p] = r[p] === undefined ? null : r[p]; }); return o; }
  function xmlEsc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  const SPDX = { 'CC0-1.0': 'CC0 1.0', 'CC-BY-4.0': 'CC BY 4.0' };

  const E = {
    SLOWNIKI_XML: SLOWNIKI_XML,
    kolumny: function () { return POLA.slice(); },
    csv: function (r) { return csvZ(POLA, r.map(function (x) { return POLA.map(function (p) { return x[p]; }); })); },
    json: function (r) { return JSON.stringify(r.map(czyste), null, 2); },
    geojson: function (r) {
      return JSON.stringify({ type: 'FeatureCollection', features: r.filter(maWsp).map(function (x) {
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [x.dlugosc_geograficzna, x.szerokosc_geograficzna] }, properties: czyste(x) };
      }) });
    },
    xlsx: function (r) {
      const ws = XLSX.utils.json_to_sheet(r.map(czyste), { header: POLA });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'AED');
      return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    },
    rejestrZrodel: function (zrodla, rekordy) {
      const kolumny = ['kod_zrodla', 'nazwa_zrodla', 'dysponent', 'typ_zrodla', 'licencja', 'liczba_rekordow', 'data_pobrania'];
      const wiersze = zrodla.map(function (z) {
        return [z.kod, z.nazwa, z.dysponent, z.typ, z.licencja, rekordy.filter(function (r) { return r._kodZrodla === z.kod; }).length, z.dataPobrania];
      });
      return { kolumny: kolumny, wiersze: wiersze, csv: csvZ(kolumny, wiersze) };
    },
    datapackage: function (m, zasoby) {
      return { name: 'aed', title: m.tytul, description: m.opis, keywords: m.slowaKluczowe,
        resources: (zasoby || []).map(function (z) { return { name: z.nazwa, path: z.plik, format: z.format }; }) };
    },
    licencjaZbioru: function (r) {
      const l = new Set(r.map(function (x) { return x.licencja_rekordu; }));
      if (l.has('CC-BY-4.0')) return { kod: 'CC-BY-4.0', nazwa: 'Creative Commons Uznanie autorstwa 4.0',
        uzasadnienie: 'Część źródeł wymaga podania autora (CC BY 4.0).', atrybucje: ['Urząd Miasta Marki – dane.gov.pl/pl/dataset/4955'] };
      return { kod: 'CC0-1.0', nazwa: 'CC0 1.0 (domena publiczna)', uzasadnienie: 'Wszystkie źródła są na CC0.', atrybucje: [] };
    },
    metadaneXml: function (m, zasoby) {
      const t = function (n, v) { return v ? '<' + n + '>' + xmlEsc(v) + '</' + n + '>' : ''; };
      return '<?xml version="1.0" encoding="UTF-8"?>\n<ns2:datasets xmlns:ns2="urn:otwarte-dane:harvester:1.13">\n<dataset status="published">\n' +
        t('extIdent', m.extIdent) + '\n<title>' + t('polish', m.tytul) + t('english', m.tytulEn) + '</title>\n' +
        '<description>' + t('polish', m.opis) + t('english', m.opisEn) + '</description>\n' + t('url', m.url) + '\n' +
        t('updateFrequency', m.czestotliwosc) + '\n<categories>' + (m.kategorie || []).map(function (k) { return t('category', k); }).join('') + '</categories>\n' +
        '<resources>' + (zasoby || []).map(function (z) {
          return '<resource>' + t('extIdent', z.extIdent || z.nazwa) + t('url', z.url) + '<title>' + t('polish', z.tytul) + '</title><description>' + t('polish', z.opis || z.tytul) + '</description></resource>';
        }).join('\n') + '</resources>\n<tags>' + (m.slowaKluczowe || []).map(function (s) { return '<tag lang="pl">' + xmlEsc(s) + '</tag>'; }).join('') + '</tags>\n' +
        '</dataset>\n</ns2:datasets>\n';
    },
    walidujMetadane: function (m, zasoby) {
      const p = [];
      const b = function (pole, komunikat) { p.push({ pole: pole, poziom: 'blad', komunikat: komunikat }); };
      if (!m.tytul || !String(m.tytul).trim()) b('tytul', 'Wpisz tytuł zbioru.');
      else if (String(m.tytul).length > 300) b('tytul', 'Tytuł może mieć najwyżej 300 znaków.');
      if (!m.opis || String(m.opis).trim().length < 20) b('opis', 'Opis musi mieć co najmniej 20 znaków.');
      if (!m.czestotliwosc) b('czestotliwosc', 'Wybierz częstotliwość aktualizacji.');
      if (!m.kategorie || !m.kategorie.length) b('kategorie', 'Wybierz co najmniej jedną kategorię.');
      if (!m.slowaKluczowe || !m.slowaKluczowe.length) b('slowaKluczowe', 'Wpisz co najmniej jedno słowo kluczowe.');
      if (!m.extIdent || String(m.extIdent).length > 36) b('extIdent', 'Identyfikator zbioru: od 1 do 36 znaków.');
      if (m.url && !/^https?:\/\//.test(m.url)) b('url', 'Adres musi zaczynać się od https://');
      (zasoby || []).forEach(function (z, i) {
        if (!/^https:\/\/\S+$/.test(z.url || '')) p.push({ pole: 'zasoby.' + i + '.url', poziom: 'blad', kod: z.url ? 'WZORZEC' : 'WYMAGANE', komunikat: 'Adres zasobu musi zaczynać się od https://.' });
      });
      return p;
    },
    nazwaPliku: function (roz, data, opcje) {
      const d = new Date().toISOString().slice(0, 10);
      return ((opcje && opcje.przedrostek) || 'aed') + '_' + (opcje && opcje.terc ? opcje.terc + '_' : '') + d + '.' + roz;
    }
  };
  if (!AED.eksport) AED.eksport = E;

  // ------------------------------------------------------------ magazyn
  const S = AED.store;
  if (!S.znajdzDuplikaty) {
    let duplikaty = null, decyzje = {}, wynik = null;
    Object.defineProperty(S, 'duplikaty', { get: function () { return duplikaty; }, configurable: true });
    Object.defineProperty(S, 'decyzje', { get: function () { return Object.assign({}, decyzje); }, configurable: true });
    Object.defineProperty(S, 'wynik', { get: function () { return wynik; }, configurable: true });
    S.znajdzDuplikaty = function (opcje) {
      duplikaty = AED.duplikaty.znajdz(S.rekordy, opcje);
      const ids = new Set(duplikaty.grupy.map(function (g) { return g.id; }));
      Object.keys(decyzje).forEach(function (k) { if (!ids.has(k)) delete decyzje[k]; });
      wynik = null;
      AED.emit('duplikaty:zmiana', { akcja: 'znaleziono' });
      return duplikaty;
    };
    S.ustawDecyzje = function (id, d) {
      if (d) decyzje[id] = d; else delete decyzje[id];
      wynik = null;
      AED.emit('duplikaty:zmiana', { akcja: 'decyzja', grupaId: id });
    };
    S.przeliczWynik = function () {
      wynik = AED.duplikaty.scal(S.rekordy, duplikaty ? duplikaty.grupy : [], decyzje);
      AED.emit('wynik:zmiana', { liczba: wynik.rekordy.length });
      return wynik;
    };
    AED.on('rekordy:zmiana', function (e) { if (e && e.akcja === 'ustawiono') { duplikaty = null; decyzje = {}; } wynik = null; });
  }
})(window.AED);
