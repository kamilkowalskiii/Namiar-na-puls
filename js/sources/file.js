/* Źródło „Plik”: wczytanie CSV / TSV / XLSX / XLS / ODS / JSON / GeoJSON w przeglądarce.
   Wynik: { kolumny: string[], wiersze: object[] (wartości jako tekst), meta: {...} }
   Plik nie opuszcza komputera użytkownika – czytamy go przez File API. */
(function (AED) {
  'use strict';

  const MAKS_ROZMIAR = 50 * 1024 * 1024;
  const ROZSZERZENIA = {
    csv: 'csv', tsv: 'csv', txt: 'csv',
    xlsx: 'arkusz', xlsm: 'arkusz', xls: 'arkusz', ods: 'arkusz',
    json: 'json', geojson: 'json'
  };

  function rozszerzenie(nazwa) {
    const m = /\.([a-z0-9]+)$/i.exec(nazwa || '');
    return m ? m[1].toLowerCase() : '';
  }

  /** Dekodowanie tekstu: UTF-8 (z BOM lub bez), w razie błędu Windows-1250 (częsty eksport z Excela w PL). */
  function dekoduj(bufor) {
    const bajty = new Uint8Array(bufor);
    let start = 0;
    if (bajty[0] === 0xEF && bajty[1] === 0xBB && bajty[2] === 0xBF) start = 3;
    const dane = bajty.subarray(start);
    try {
      return { tekst: new TextDecoder('utf-8', { fatal: true }).decode(dane), kodowanie: start ? 'UTF-8 (z BOM)' : 'UTF-8' };
    } catch (e) {
      return { tekst: new TextDecoder('windows-1250').decode(dane), kodowanie: 'Windows-1250' };
    }
  }

  /** Zamiana tablicy wierszy (tablic) na obiekty z unikalnymi, niepustymi nagłówkami. */
  function tablicaNaObiekty(tablica, idxNaglowka) {
    const surowe = tablica[idxNaglowka] || [];
    const uzyte = {};
    const kolumny = surowe.map(function (n, i) {
      let nazwa = String(n === undefined || n === null ? '' : n).replace(/\s+/g, ' ').trim();
      if (!nazwa) nazwa = 'kolumna_' + (i + 1);
      if (uzyte[nazwa]) { uzyte[nazwa]++; nazwa = nazwa + '_' + uzyte[nazwa]; } else uzyte[nazwa] = 1;
      return nazwa;
    });
    // kolumny dłuższych wierszy bez nagłówka
    const maks = tablica.reduce(function (m, w) { return Math.max(m, w.length); }, kolumny.length);
    for (let i = kolumny.length; i < maks; i++) kolumny.push('kolumna_' + (i + 1));

    const wiersze = [];
    for (let r = idxNaglowka + 1; r < tablica.length; r++) {
      const w = tablica[r];
      if (!w || w.every(function (c) { return c === null || c === undefined || String(c).trim() === ''; })) continue;
      const o = {};
      kolumny.forEach(function (k, i) { o[k] = tekst(w[i]); });
      wiersze.push(o);
    }
    // usuń kolumny całkowicie puste i bez nagłówka (np. końcowy separator w CSV)
    const kolumnyFinal = kolumny.filter(function (k) {
      return !/^kolumna_\d+$/.test(k) || wiersze.some(function (o) { return o[k] !== ''; });
    });
    return { kolumny: kolumnyFinal, wiersze: wiersze.map(function (o) {
      const n = {}; kolumnyFinal.forEach(function (k) { n[k] = o[k]; }); return n;
    }) };
  }

  function tekst(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v).trim();
  }

  /** Wiersz nagłówka = wiersz z największą liczbą niepustych komórek wśród pierwszych 10
      (gminne arkusze często mają tytuł nad tabelą). */
  function znajdzNaglowek(tablica) {
    let najlepszy = 0, maks = -1;
    for (let i = 0; i < Math.min(10, tablica.length); i++) {
      const n = (tablica[i] || []).filter(function (c) { return String(c === undefined || c === null ? '' : c).trim() !== ''; }).length;
      if (n > maks) { maks = n; najlepszy = i; }
    }
    return najlepszy;
  }

  // ------------------------------------------------------------------ CSV
  /** Wykrywanie separatora: liczymy separatory poza cudzysłowami w pierwszych 30 niepustych liniach
      i wybieramy ten, który daje tę samą liczbę pól w największej liczbie linii.
      (Autodetekcja PapaParse myli się, gdy nad tabelą jest tytuł, a w danych przecinki dziesiętne.) */
  function wykryjSeparator(tekstPliku) {
    const linie = tekstPliku.split(/\r\n|\n|\r/).filter(function (l) { return l.trim(); }).slice(0, 30);
    let najlepszy = ',', najlepszyWynik = -1;
    [',', ';', '\t', '|'].forEach(function (sep) {
      const liczby = linie.map(function (l) {
        let n = 0, wCudz = false;
        for (let i = 0; i < l.length; i++) {
          const c = l[i];
          if (c === '"') wCudz = !wCudz;
          else if (c === sep && !wCudz) n++;
        }
        return n;
      }).filter(function (n) { return n > 0; });
      if (!liczby.length) return;
      const czest = {};
      liczby.forEach(function (n) { czest[n] = (czest[n] || 0) + 1; });
      const moda = Object.keys(czest).reduce(function (a, b) { return czest[b] > czest[a] || (czest[b] === czest[a] && +b > +a) ? b : a; });
      const wynik = czest[moda] * 1000 + Number(moda); // spójność ważniejsza niż liczba pól
      if (wynik > najlepszyWynik) { najlepszyWynik = wynik; najlepszy = sep; }
    });
    return najlepszy;
  }

  /** Naprawa: każdy wiersz ujęty w cudzysłów jako jedno pole (spotykane w zbiorach na dane.gov.pl). */
  function odpakujWiersze(tekstPliku) {
    return tekstPliku.split(/\r\n|\n|\r/).map(function (l) {
      const t = l.trim();
      return (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') ? t.slice(1, -1).replace(/""/g, '"') : t;
    }).join('\n');
  }

  function parsujCsv(tekstPliku) {
    const parsuj = function (t) {
      return Papa.parse(t, { header: false, skipEmptyLines: 'greedy', dynamicTyping: false, delimiter: wykryjSeparator(t) });
    };
    let wynik = parsuj(tekstPliku);
    const meta = { separator: opisSeparatora(wynik.meta.delimiter), naprawy: [] };

    const szerokosc = Math.max.apply(null, wynik.data.slice(0, 20).map(function (w) { return w.length; }).concat([0]));
    if (szerokosc === 1 && wynik.data.length && /[,;\t]/.test(wynik.data[0][0])) {
      const ponownie = parsuj(odpakujWiersze(tekstPliku));
      if ((ponownie.data[0] || []).length > 1) {
        wynik = ponownie;
        meta.separator = opisSeparatora(wynik.meta.delimiter);
        meta.naprawy.push('Każdy wiersz był ujęty w cudzysłów jako jedno pole – usunięto zewnętrzne cudzysłowy.');
      }
    }
    const idx = znajdzNaglowek(wynik.data);
    const dlNagl = (wynik.data[idx] || []).length;
    const nierowne = wynik.data.slice(idx + 1).filter(function (w) { return w.length !== dlNagl; }).length;
    if (nierowne) meta.ostrzezenia = [nierowne + ' ' + AED.dom.odmiana(nierowne, 'wiersz ma', 'wiersze mają', 'wierszy ma') + ' inną liczbę pól niż nagłówek.'];
    if ((wynik.errors || []).some(function (e) { return e.type === 'Quotes'; })) {
      (meta.ostrzezenia = meta.ostrzezenia || []).push('Niezamknięty cudzysłów – część wierszy mogła zostać połączona.');
    }

    if (idx > 0) meta.naprawy.push('Pominięto ' + idx + ' ' + AED.dom.odmiana(idx, 'wiersz', 'wiersze', 'wierszy') + ' nad nagłówkiem tabeli.');
    meta.wierszNaglowka = idx + 1;
    return Object.assign(tablicaNaObiekty(wynik.data, idx), { meta: meta });
  }
  function opisSeparatora(d) {
    return ({ ',': 'przecinek', ';': 'średnik', '\t': 'tabulator', '|': 'kreska pionowa' })[d] || (d ? '„' + d + '”' : 'nieznany');
  }

  // ------------------------------------------------------------- arkusze
  function wczytajSkoroszyt(bufor) {
    return XLSX.read(bufor, { type: 'array', cellDates: true, dense: true });
  }
  function wybierzArkusz(wb) {
    if (wb.SheetNames.indexOf('dane_aed') >= 0) return 'dane_aed'; // plik zgodny ze wzorcem
    const fd = AED.wzorzec && AED.wzorzec.formularzDysponenta;
    if (fd && wb.SheetNames.indexOf(fd.arkusz) >= 0) return fd.arkusz;  // prosty formularz dysponenta (arkusz 1 to instrukcja)
    for (const n of wb.SheetNames) {
      const ref = wb.Sheets[n] && wb.Sheets[n]['!ref'];
      if (ref && ref !== 'A1') return n;
    }
    return wb.SheetNames[0];
  }
  function parsujArkusz(wb, nazwaArkusza) {
    const ws = wb.Sheets[nazwaArkusza];
    const tablica = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd', blankrows: false });

    // Arkusz, w którym cały wiersz CSV wklejono do jednej komórki (np. zbiór z Marek) – parsujemy jak CSV
    const jednaKomorka = tablica.length && tablica.every(function (w) {
      return w.filter(function (c) { return String(c).trim() !== ''; }).length <= 1;
    });
    if (jednaKomorka && /[,;\t]/.test(String((tablica[0] || []).find(function (c) { return String(c).trim(); }) || ''))) {
      const tekstCsv = tablica.map(function (w) { return w.find(function (c) { return String(c).trim(); }) || ''; }).join('\n');
      const w = parsujCsv(tekstCsv);
      w.meta.arkusz = nazwaArkusza;
      w.meta.arkusze = wb.SheetNames.slice();
      w.meta.naprawy.unshift('Cały wiersz był wpisany do jednej komórki arkusza – rozdzielono go na kolumny.');
      return w;
    }

    const idx = znajdzNaglowek(tablica);
    const meta = { arkusz: nazwaArkusza, arkusze: wb.SheetNames.slice(), wierszNaglowka: idx + 1, naprawy: [] };
    if (idx > 0) meta.naprawy.push('Pominięto ' + idx + ' ' + AED.dom.odmiana(idx, 'wiersz', 'wiersze', 'wierszy') + ' nad nagłówkiem tabeli.');
    if ((ws['!merges'] || []).length) meta.ostrzezenia = ['Arkusz zawiera scalone komórki – Standard techniczny dane.gov.pl ich nie dopuszcza.'];
    return Object.assign(tablicaNaObiekty(tablica, idx), { meta: meta });
  }

  // ---------------------------------------------------------------- JSON
  function splaszcz(obj, prefiks, wynik) {
    wynik = wynik || {};
    Object.keys(obj || {}).forEach(function (k) {
      const v = obj[k];
      const klucz = prefiks ? prefiks + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 30 && prefiks.split('.').length < 3) {
        splaszcz(v, klucz, wynik);
      } else {
        wynik[klucz] = tekst(v);
      }
    });
    return wynik;
  }
  function punktGeometrii(g) {
    if (!g || !g.coordinates) return null;
    let c = g.coordinates;
    while (Array.isArray(c[0])) c = c[0]; // dla linii / poligonów bierzemy pierwszy wierzchołek
    return (typeof c[0] === 'number' && typeof c[1] === 'number') ? c : null;
  }
  function parsujJson(tekstPliku) {
    const dane = JSON.parse(tekstPliku);
    const meta = { naprawy: [] };
    let obiekty;
    if (dane && dane.type === 'FeatureCollection' && Array.isArray(dane.features)) {
      meta.format = 'GeoJSON';
      obiekty = dane.features.map(function (f) {
        const o = splaszcz(f.properties || {}, '');
        const p = punktGeometrii(f.geometry);
        // GeoJSON: kolejność [długość, szerokość] (RFC 7946)
        o['geometria.dlugosc'] = p ? String(p[0]) : '';
        o['geometria.szerokosc'] = p ? String(p[1]) : '';
        if (f.id !== undefined) o['id'] = tekst(f.id);
        return o;
      });
    } else {
      let lista = Array.isArray(dane) ? dane
        : Array.isArray(dane && dane.data) ? dane.data
        : Array.isArray(dane && dane.elements) ? dane.elements
        : Array.isArray(dane && dane.records) ? dane.records : null;
      if (!lista) throw new Error('Nie znaleziono listy rekordów w pliku JSON (oczekiwano tablicy, „data”, „elements” lub GeoJSON).');
      meta.format = 'JSON';
      obiekty = lista.map(function (el) {
        // JSON:API (np. API dane.gov.pl) – wartości w attributes
        return splaszcz(el && el.attributes && typeof el.attributes === 'object' ? el.attributes : el, '');
      });
    }
    const kolumny = [];
    obiekty.forEach(function (o) { Object.keys(o).forEach(function (k) { if (kolumny.indexOf(k) < 0) kolumny.push(k); }); });
    const wiersze = obiekty.map(function (o) { const n = {}; kolumny.forEach(function (k) { n[k] = o[k] || ''; }); return n; });
    return { kolumny: kolumny, wiersze: wiersze, meta: meta };
  }

  // ------------------------------------------- formularz dysponenta
  /** Plik z prostego formularza dysponenta: pomijamy wiersz z opisami kolumn i wiersze przykładu (oznaczone „PRZYKŁAD”)
      leżące tuż pod nagłówkiem. Numeracja wierszy zostaje zgodna z arkuszem (przesuwamy wierszNaglowka). */
  function pominWierszePomocnicze(wynik) {
    const fd = AED.wzorzec && AED.wzorzec.formularzDysponenta;
    if (!fd || !wynik || !wynik.wiersze || !wynik.wiersze.length) return wynik;
    const opisy = {};
    fd.kolumny.forEach(function (k) { opisy[k.naglowek] = k.opis; });
    const zFormularza = wynik.kolumny.filter(function (k) { return Object.prototype.hasOwnProperty.call(opisy, k); });
    if (zFormularza.length < Math.max(3, wynik.kolumny.length / 2)) return wynik;
    // wielkie litery i myślnik/dwukropek: „PRZYKŁAD – …” (a nie np. miejscowość „Przykładowo”)
    const znacznik = String(fd.znacznikPrzykladu || 'PRZYKŁAD –');
    const RE_ZNACZNIK = /^PRZYKŁAD\s*[-–—:]/;
    const pomocniczy = function (w) {
      let opis = 0, niepuste = 0;
      for (const k of wynik.kolumny) {
        const v = String(w[k] === undefined || w[k] === null ? '' : w[k]).trim();
        if (!v) continue;
        niepuste++;
        if (v.indexOf(znacznik) === 0 || RE_ZNACZNIK.test(v)) return true;
        if (opisy[k] === v) opis++;
      }
      return niepuste > 0 && opis >= niepuste / 2;
    };
    let n = 0;
    while (n < wynik.wiersze.length && pomocniczy(wynik.wiersze[n])) n++;
    if (!n) return wynik;
    wynik.wiersze = wynik.wiersze.slice(n);
    wynik.meta = wynik.meta || {};
    wynik.meta.wierszNaglowka = (Number(wynik.meta.wierszNaglowka) || 1) + n;
    wynik.meta.formularzDysponenta = true;
    (wynik.meta.naprawy = wynik.meta.naprawy || []).push('Formularz dysponenta: pominięto ' + n + ' ' +
      AED.dom.odmiana(n, 'wiersz pomocniczy', 'wiersze pomocnicze', 'wierszy pomocniczych') + ' (opisy kolumn, przykład) pod nagłówkiem.');
    return wynik;
  }

  // ------------------------------------------- wycofane rekordy
  /** Po cichu pomija wiersze ze starych plików przykładowych, których źródło współrzędnych (`osm`) lub licencja (`ODbL…`)
      nie występuje już we wzorcu. Niczego nie pokazuje w interfejsie. */
  function pominRekordyOsm(wynik) {
    if (!wynik || !wynik.wiersze || !wynik.wiersze.length) return wynik;
    const kol = function (nazwa) { return wynik.kolumny.indexOf(nazwa) >= 0; };
    if (!kol('zrodlo_wspolrzednych') && !kol('licencja_rekordu')) return wynik;
    const tekst = function (w, k) { return String(w[k] === undefined || w[k] === null ? '' : w[k]).trim().toLowerCase(); };
    wynik.wiersze = wynik.wiersze.filter(function (w) { return tekst(w, 'zrodlo_wspolrzednych') !== 'osm' && !/^odbl/.test(tekst(w, 'licencja_rekordu')); });
    return wynik;
  }

  // ------------------------------------------------- zgodność ze wzorcem
  function zgodnoscZeWzorcem(kolumny) {
    const pola = AED.wzorzec.schema.fields;
    const nazwy = pola.map(function (f) { return f.name; });
    const obowiazkowe = pola.filter(function (f) { return f.aed.obowiazkowosc === 'O'; }).map(function (f) { return f.name; });
    const dopasowane = kolumny.filter(function (k) { return nazwy.indexOf(k) >= 0; });
    return {
      dopasowane: dopasowane.length,
      wszystkie: kolumny.length,
      brakujaceObowiazkowe: obowiazkowe.filter(function (n) { return kolumny.indexOf(n) < 0; }),
      zgodny: obowiazkowe.every(function (n) { return kolumny.indexOf(n) >= 0; })
    };
  }

  // ------------------------------------------------------------- publiczne API
  /** @returns {Promise<{kolumny, wiersze, meta, skoroszyt?}>} */
  async function wczytaj(plik) {
    const roz = rozszerzenie(plik.name);
    const rodzaj = ROZSZERZENIA[roz];
    if (!rodzaj) throw new Error('Nieobsługiwany format „.' + (roz || '?') + '”. Wybierz CSV, XLSX, XLS, ODS, JSON lub GeoJSON.');
    if (plik.size > MAKS_ROZMIAR) throw new Error('Plik ma ' + AED.dom.rozmiar(plik.size) + ' – limit prototypu to 50 MB.');
    if (plik.size === 0) throw new Error('Plik jest pusty.');

    const bufor = await plik.arrayBuffer();
    let wynik, skoroszyt = null;
    if (rodzaj === 'arkusz') {
      skoroszyt = wczytajSkoroszyt(bufor);
      wynik = parsujArkusz(skoroszyt, wybierzArkusz(skoroszyt));
      wynik.meta.format = roz.toUpperCase();
    } else {
      const d = dekoduj(bufor);
      wynik = rodzaj === 'csv' ? parsujCsv(d.tekst) : parsujJson(d.tekst);
      wynik.meta.kodowanie = d.kodowanie;
      if (rodzaj === 'csv') wynik.meta.format = roz === 'tsv' ? 'TSV' : 'CSV';
      if (d.kodowanie === 'Windows-1250') wynik.meta.naprawy.push('Plik nie był w UTF-8 – odczytano go jako Windows-1250. Sprawdź polskie znaki w podglądzie.');
    }
    pominWierszePomocnicze(wynik);
    pominRekordyOsm(wynik);
    if (!wynik.wiersze.length) throw new Error('Nie znaleziono w pliku żadnych wierszy z danymi.');
    wynik.meta.plik = { nazwa: plik.name, rozmiar: plik.size };
    wynik.meta.wzorzec = zgodnoscZeWzorcem(wynik.kolumny);
    wynik.skoroszyt = skoroszyt;
    return wynik;
  }

  /** Zmiana arkusza w już wczytanym skoroszycie. */
  function zmienArkusz(skoroszyt, nazwa) {
    const w = pominRekordyOsm(pominWierszePomocnicze(parsujArkusz(skoroszyt, nazwa)));
    w.meta.wzorzec = zgodnoscZeWzorcem(w.kolumny);
    return w;
  }

  AED.zrodla = AED.zrodla || {};
  AED.zrodla.plik = { wczytaj: wczytaj, zmienArkusz: zmienArkusz, zgodnoscZeWzorcem: zgodnoscZeWzorcem, ROZSZERZENIA: ROZSZERZENIA,
    _test: { pominWierszePomocnicze: pominWierszePomocnicze, dekoduj: dekoduj, parsujCsv: parsujCsv, wykryjSeparator: wykryjSeparator, parsujJson: parsujJson, znajdzNaglowek: znajdzNaglowek } };
})(window.AED);
