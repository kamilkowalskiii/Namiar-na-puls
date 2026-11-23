/* Źródło „dane.gov.pl”: wyszukiwanie zbiorów i pobieranie zasobów przez publiczne API (bez kluczy).
   API (https://api.dane.gov.pl/1.4) wysyła nagłówki CORS, ale same pliki (/media/...) – NIE.
   Dlatego zasoby tabelaryczne czytamy z endpointu /resources/{id}/data (z paginacją),
   a pozostałe próbujemy pobrać bezpośrednio; gdy przeglądarka zablokuje plik – błąd 'CORS'
   z linkiem do ręcznego pobrania (użytkownik wczyta plik jako „Plik”).
   Wynik jak w file.js: { kolumny, wiersze (wartości jako tekst), meta }. */
(function (AED) {
  'use strict';

  const API = 'https://api.dane.gov.pl/1.4';
  const PORTAL = 'https://dane.gov.pl/pl/dataset/';
  const DOMYSLNA_FRAZA = 'AED defibrylator';
  const MAKS_WYNIKOW = 20;
  const NA_STRONE = 100;          // maksimum akceptowane przez /data i /resources (200 -> błąd 422)
  const MAKS_WIERSZY = 50000;
  const MAKS_ZASOBOW = 500;        // na zbiór (5 stron po 100)
  const MAKS_ROWNOLEGLYCH = 4;     // równoległe zapytania o zasoby przy wyszukiwaniu
  const LIMIT_API_MS = 30000;
  const LIMIT_PLIKU_MS = 60000;

  // Kolejność zasobów na liście: najpierw te, które umiemy wczytać
  const PREFERENCJA = ['csv', 'xlsx', 'xls', 'ods', 'geojson', 'json', 'tsv', 'txt'];

  // ---------------------------------------------------------------- pomocnicze
  function blad(komunikat, kod, dodatki) {
    const e = new Error(komunikat);
    e.kod = kod;
    if (dodatki) Object.assign(e, dodatki);
    return e;
  }

  function odmiana(n, jeden, kilka, wiele) {
    if (AED.dom && AED.dom.odmiana) return AED.dom.odmiana(n, jeden, kilka, wiele);
    if (n === 1) return jeden;
    const d = n % 10, s = n % 100;
    return (d >= 2 && d <= 4 && (s < 12 || s > 14)) ? kilka : wiele;
  }

  /** fetch + odczyt treści z jednym limitem czasu i sygnałem przerwania.
      `czytaj(odp)` czyta treść; nasłuch przerwania i zegar zdejmujemy dopiero po jej odczytaniu,
      więc „Anuluj” i limit czasu działają także w trakcie pobierania treści.
      TypeError (sieć lub CORS) -> kod 'SIEC' z flagą e.typeError, żeby wywołujący mógł go przekwalifikować na 'CORS'. */
  async function pobierzZLimitem(url, signal, limitMs, czytaj) {
    if (signal && signal.aborted) throw blad('Przerwano pobieranie.', 'PRZERWANO');
    const ctrl = new AbortController();
    let przekroczono = false;
    const zegar = setTimeout(function () { przekroczono = true; ctrl.abort(); }, limitMs);
    const przerwij = function () { ctrl.abort(); };
    if (signal) signal.addEventListener('abort', przerwij);
    try {
      const odp = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/vnd.api+json, application/json, */*' } });
      return await czytaj(odp);
    } catch (e) {
      if (przekroczono) throw blad('Serwer ' + new URL(url).host + ' nie odpowiedział w ciągu ' + Math.round(limitMs / 1000) + ' s.', 'TIMEOUT');
      if ((signal && signal.aborted) || (e && e.name === 'AbortError')) throw blad('Przerwano pobieranie.', 'PRZERWANO');
      if (e && e.kod) throw e;
      throw blad('Brak połączenia z serwerem ' + new URL(url).host + '. Sprawdź połączenie z internetem.', 'SIEC', { typeError: true, przyczyna: e });
    } finally {
      clearTimeout(zegar);
      if (signal) signal.removeEventListener('abort', przerwij);
    }
  }

  function pobierzJson(url, signal) {
    return pobierzZLimitem(url, signal, LIMIT_API_MS, async function (odp) {
      if (odp.status === 429) throw blad('Portal dane.gov.pl ogranicza liczbę zapytań. Odczekaj chwilę i spróbuj ponownie.', 'LIMIT');
      if (odp.status === 404) throw blad('Nie znaleziono zasobu w API dane.gov.pl (mógł zostać usunięty).', 'BRAK_DANYCH');
      if (odp.status >= 500) throw blad('Portal dane.gov.pl ma chwilowe problemy (błąd ' + odp.status + '). Spróbuj później.', 'SIEC');
      if (!odp.ok) throw blad('API dane.gov.pl zwróciło błąd ' + odp.status + '.', 'FORMAT');
      const tekst = await odp.text();
      try { return JSON.parse(tekst); } catch (e) {
        throw blad('API dane.gov.pl zwróciło odpowiedź, której nie da się odczytać.', 'FORMAT');
      }
    });
  }

  /** Uruchamia fn dla elementów listy, najwyżej `n` naraz. Pierwszy błąd przerywa start kolejnych i jest zwracany. */
  async function rownolegle(lista, n, fn) {
    let i = 0, pierwszyBlad = null;
    async function watek() {
      while (i < lista.length && !pierwszyBlad) {
        const el = lista[i++];
        try { await fn(el); } catch (e) { pierwszyBlad = pierwszyBlad || e; }
      }
    }
    const watki = [];
    for (let k = 0; k < Math.min(n, lista.length); k++) watki.push(watek());
    await Promise.all(watki);
    if (pierwszyBlad) throw pierwszyBlad;
  }

  /** Tytuły z wyszukiwarki zawierają podświetlenia <mark> i inne znaczniki HTML. */
  function bezHtml(t) {
    return String(t || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  }

  /** Licencja z portalu („CC0 1.0”, „CC BY 4.0”…) -> kod ze słownika licencja_rekordu albo ''. */
  function mapujLicencje(nazwa) {
    const t = String(nazwa || '').toUpperCase().replace(/[\s_-]+/g, ' ').trim();
    let kod = '';
    if (/^CC ?0( 1(\.0)?)?$/.test(t) || /PUBLIC DOMAIN|DOMENA PUBLICZNA/.test(t)) kod = 'CC0-1.0';
    else if (/^CC BY 4(\.0)?$/.test(t)) kod = 'CC-BY-4.0';
    const dozwolone = ((AED.wzorzec && AED.wzorzec.slowniki && AED.wzorzec.slowniki.licencja_rekordu) || [])
      .map(function (l) { return l.kod; });
    return dozwolone.length && dozwolone.indexOf(kod) < 0 ? '' : kod;
  }

  /** Czy zbiór pasuje do frazy? Wyszukiwarka portalu dopasowuje rozmyto (np. „AED” -> „AEO”, „LED”),
      więc odsiewamy wyniki, w których nie ma żadnego słowa frazy (porównujemy rdzenie, 6 znaków). */
  function pasuje(fraza, tekst) {
    const t = tekst.toLowerCase();
    const slowa = String(fraza || '').toLowerCase().split(/[^0-9a-ząćęłńóśźż]+/i).filter(function (s) { return s.length >= 3; });
    if (!slowa.length) return true;
    return slowa.some(function (s) { return t.indexOf(s.length > 6 ? s.slice(0, 6) : s) >= 0; });
  }

  function rozszerzenieUrl(url) {
    const m = /\.([a-z0-9]{2,7})(?:[?#]|$)/i.exec(url || '');
    return m ? m[1].toLowerCase() : '';
  }

  /** Adres zasobu to strona WWW dostawcy (np. katalog dane.um.warszawa.pl), a nie plik:
      poza /media/ portalu i bez rozszerzenia pliku w adresie. */
  function czyStronaWww(url) {
    if (!url || !/^https?:/i.test(url)) return false;
    if (/\/media\/resources\//.test(url)) return false;
    if (/^https?:\/\/api\.dane\.gov\.pl\/resources\//i.test(url)) return false; // /file – przekierowanie portalu
    return !rozszerzenieUrl(url.replace(/[?#].*$/, ''));
  }

  function zasobZApi(r) {
    const a = r.attributes || {};
    const format = String(a.format || rozszerzenieUrl(a.file_url) || '').toLowerCase();
    const rel = r.relationships || {};
    const tabelaryczny = !!(rel.tabular_data && rel.tabular_data.data);
    const stronaWww = !tabelaryczny && czyStronaWww(a.file_url || a.link || '');
    return {
      id: String(r.id),
      nazwa: bezHtml(a.title) || ('Zasób ' + r.id),
      format: format.toUpperCase(),
      url: a.file_url || a.download_url || a.link || '',
      tabelaryczny: tabelaryczny,
      // pola dodatkowe (poza kontraktem)
      urlPobrania: a.download_url || a.file_url || a.link || '',
      zrodloOryginalne: a.link || '',
      zmodyfikowano: a.modified || a.data_date || '',
      stronaWww: stronaWww,
      obslugiwany: tabelaryczny || (!stronaWww && PREFERENCJA.indexOf(format) >= 0),
      _zbiorId: rel.dataset && rel.dataset.data ? String(rel.dataset.data.id) : ''
    };
  }

  function sortujZasoby(zasoby) {
    const waga = function (z) {
      const i = PREFERENCJA.indexOf(z.format.toLowerCase());
      return (z.tabelaryczny ? 0 : 100) + (i < 0 ? 50 : i);
    };
    return zasoby.slice().sort(function (a, b) { return waga(a) - waga(b); });
  }

  // ----------------------------------------------------------------- szukaj
  /**
   * @param {string} [fraza='AED defibrylator']
   * @param {{signal?:AbortSignal}} [ust]
   * @returns {Promise<Zbior[]>}
   */
  async function szukaj(fraza, ust) {
    ust = ust || {};
    fraza = String(fraza || '').trim() || DOMYSLNA_FRAZA;
    // Bez include=resource: przy 20 wynikach (część zbiorów ma tysiące zasobów) API odpowiada > 60 s.
    const url = API + '/datasets?q=' + encodeURIComponent(fraza) + '&per_page=' + MAKS_WYNIKOW + '&sort=relevance';
    const odp = await pobierzJson(url, ust.signal);
    if (!odp || !Array.isArray(odp.data)) throw blad('Nieoczekiwana odpowiedź wyszukiwarki dane.gov.pl.', 'FORMAT');

    let zbiory = odp.data.map(function (d) {
      const a = d.attributes || {};
      return {
        id: String(d.id),
        tytul: bezHtml(a.title),
        instytucja: '',
        licencja: mapujLicencje(a.license_name),
        licencjaOpis: a.license_name || '',
        zmodyfikowano: a.modified || '',
        url: PORTAL + d.id + (a.slug ? ',' + a.slug : ''),
        zasoby: [],
        // dodatkowe
        opis: bezHtml(a.notes).slice(0, 300),
        slowaKluczowe: a.keywords || [],
        _tekst: bezHtml(a.title) + ' ' + (a.keywords || []).join(' ') + ' ' + bezHtml(a.notes)
      };
    });

    const trafne = zbiory.filter(function (z) { return pasuje(fraza, z._tekst); });
    if (trafne.length) zbiory = trafne;

    // Zasoby i nazwa instytucji – osobne zapytanie na zbiór, najwyżej MAKS_ROWNOLEGLYCH naraz
    await rownolegle(zbiory, MAKS_ROWNOLEGLYCH, async function (z) {
      try {
        await zasobyZbioru(z, { signal: ust.signal });
      } catch (e) {
        if (e.kod === 'PRZERWANO') throw e;
        z.zasoby = [];
        z.bladZasobow = 'Nie udało się pobrać listy zasobów: ' + e.message; // zbiór pokazujemy bez zasobów
      }
    });

    zbiory.forEach(function (z) { delete z._tekst; });
    return zbiory;
  }

  /**
   * Lista zasobów zbioru (z paginacją) i nazwa instytucji. Uzupełnia w miejscu zbior.zasoby
   * i zbior.instytucja (jeśli była pusta), usuwa zbior.bladZasobow; przy > MAKS_ZASOBOW ustawia
   * zbior.ostrzezenieZasobow. Przy błędzie rzuca Error z e.kod i NIE zmienia obiektu zbior.
   * @param {Zbior} zbior  co najmniej {id}
   * @param {{signal?:AbortSignal}} [ust]
   * @returns {Promise<Zasob[]>}  posortowane: tabelaryczne i CSV/XLSX najpierw
   */
  async function zasobyZbioru(zbior, ust) {
    ust = ust || {};
    if (!zbior || !zbior.id) throw blad('Nie wskazano zbioru.', 'FORMAT');
    let url = API + '/datasets/' + encodeURIComponent(zbior.id) + '/resources?per_page=' + NA_STRONE + '&include=institution';
    const zasoby = [];
    let instytucja = '', liczba = null, strony = 0;
    while (url) {
      const r = await pobierzJson(url, ust.signal);
      if (!r || !Array.isArray(r.data)) throw blad('Nieoczekiwana odpowiedź API dane.gov.pl (lista zasobów).', 'FORMAT');
      strony++;
      r.data.forEach(function (x) { zasoby.push(zasobZApi(x)); });
      const inst = (r.included || []).find(function (x) { return x.type === 'institution'; });
      if (inst && !instytucja) instytucja = bezHtml(inst.attributes && inst.attributes.title);
      if (r.meta && typeof r.meta.count === 'number') liczba = r.meta.count;
      const nast = r.links && r.links.next;
      url = nast && r.data.length && zasoby.length < MAKS_ZASOBOW ? nast : null;
    }
    zbior.zasoby = sortujZasoby(zasoby.slice(0, MAKS_ZASOBOW)).map(function (x) { delete x._zbiorId; return x; });
    if (instytucja && !zbior.instytucja) zbior.instytucja = instytucja;
    delete zbior.bladZasobow;
    if (liczba !== null && liczba > zbior.zasoby.length) {
      zbior.ostrzezenieZasobow = 'Zbiór ma ' + liczba + ' zasobów – pokazano ' + zbior.zasoby.length + '. Pozostałe znajdziesz na stronie zbioru.';
    } else delete zbior.ostrzezenieZasobow;
    return zbior.zasoby;
  }

  // ------------------------------------------------------------ pobierzZasob
  /** Zamiana tabeli na CSV (wszystkie pola w cudzysłowie) – dalej czyta ją AED.zrodla.plik. */
  function naCsv(tablica) {
    return tablica.map(function (w) {
      return w.map(function (v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
  }

  /** Wszystkie strony /resources/{id}/data -> tablica wierszy (pierwszy = nagłówek). */
  async function pobierzTabele(zasob, ust, postep) {
    let url = API + '/resources/' + encodeURIComponent(zasob.id) + '/data?per_page=' + NA_STRONE + '&page=1';
    let naglowki = null, klucze = null, liczba = null, strona = 0;
    const tablica = [];
    const ostrzezenia = [];
    while (url) {
      strona++;
      const odp = await pobierzJson(url, ust.signal);
      const meta = odp.meta || {};
      if (!naglowki) {
        const mapa = meta.headers_map || {};
        klucze = Object.keys(mapa).sort(function (a, b) {
          return (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0);
        });
        naglowki = klucze.map(function (k) { return mapa[k]; });
        liczba = typeof meta.count === 'number' ? meta.count : null;
        tablica.push(naglowki);
      }
      (odp.data || []).forEach(function (w) {
        const at = w.attributes || {};
        tablica.push(klucze.map(function (k) {
          const c = at[k];
          if (c === null || c === undefined) return '';
          if (typeof c === 'object') return c.repr !== undefined && c.repr !== null ? c.repr : (c.val === null || c.val === undefined ? '' : c.val);
          return c;
        }));
      });
      postep('Pobrano ' + (tablica.length - 1) + (liczba !== null ? ' z ' + liczba : '') + ' wierszy (strona ' + strona + ')…');
      if (tablica.length - 1 >= MAKS_WIERSZY) {
        ostrzezenia.push('Zasób ma więcej niż ' + MAKS_WIERSZY + ' wierszy – wczytano tylko pierwsze ' + MAKS_WIERSZY + '.');
        break;
      }
      const nast = odp.links && odp.links.next;
      url = nast && (odp.data || []).length ? nast : null;
    }
    return { tablica: tablica, ostrzezenia: ostrzezenia, liczba: liczba };
  }

  function nazwaPliku(zasob, rozszerzenie) {
    return 'dane_gov_pl_' + zasob.id + '.' + rozszerzenie;
  }

  async function wczytajPlikiem(plik) {
    try {
      return await AED.zrodla.plik.wczytaj(plik);
    } catch (e) {
      if (e && e.kod) throw e;
      throw blad('Nie udało się odczytać zasobu: ' + (e && e.message ? e.message : e), 'FORMAT');
    }
  }

  function linkRecznyDla(zbior, zasob) {
    return zasob.urlPobrania || zasob.url || (zbior && zbior.url) || '';
  }

  /** Bezpośrednie pobranie pliku zasobu (działa tylko, gdy serwer pliku wysyła nagłówek CORS). */
  async function pobierzPlik(zbior, zasob, ust, postep) {
    const format = String(zasob.format || '').toLowerCase() || rozszerzenieUrl(zasob.url);
    const roz = AED.zrodla.plik.ROZSZERZENIA;
    const link = linkRecznyDla(zbior, zasob);
    if (!roz[format]) {
      throw blad('Format „' + (zasob.format || '?') + '” nie jest obsługiwany. Wybierz zasób CSV, XLSX, ODS, JSON lub GeoJSON albo pobierz plik ręcznie.',
        'FORMAT', { linkRęczny: link });
    }
    if (zasob.stronaWww || (!zasob.tabelaryczny && czyStronaWww(zasob.url))) {
      const strona = zasob.zrodloOryginalne || zasob.url;
      throw blad('Zasób wskazuje stronę WWW dostawcy (' + new URL(strona).host + '), a nie plik z danymi. ' +
        'Otwórz stronę, pobierz z niej plik i wczytaj go jako „Plik”.', 'FORMAT', { linkRęczny: strona });
    }
    const kandydaci = [zasob.url, zasob.zrodloOryginalne].filter(function (u, i, t) { return u && /^https?:/i.test(u) && t.indexOf(u) === i; });
    let ostatni = null;
    for (const u of kandydaci) {
      postep('Pobieranie pliku ' + new URL(u).host + '…');
      let odp;
      try {
        odp = await pobierzZLimitem(u, ust.signal, LIMIT_PLIKU_MS, async function (o) {
          if (!o.ok) return { ok: false, status: o.status };
          return { ok: true, typ: String(o.headers.get('content-type') || ''), blob: await o.blob() };
        });
      } catch (e) {
        if (e.kod === 'PRZERWANO' || e.kod === 'TIMEOUT') throw e;
        ostatni = e; continue;
      }
      if (!odp.ok) { ostatni = blad('Serwer pliku zwrócił błąd ' + odp.status + '.', odp.status === 404 ? 'BRAK_DANYCH' : 'SIEC', { linkRęczny: link }); continue; }
      if (/text\/html/i.test(odp.typ) && format !== 'html') {
        ostatni = blad('Pod adresem zasobu jest strona WWW, a nie plik z danymi.', 'FORMAT', { linkRęczny: link }); continue;
      }
      const w = await wczytajPlikiem(new File([odp.blob], nazwaPliku(zasob, format)));
      w.meta.url = u;
      return w;
    }
    if (ostatni && ostatni.typeError) {
      // API dane.gov.pl odpowiedziało przed chwilą, więc TypeError przy pliku to niemal na pewno blokada CORS
      throw blad('Serwer z plikiem nie pozwala przeglądarce pobrać go bezpośrednio (brak nagłówka CORS). ' +
        'Pobierz plik ręcznie z podanego linku i wczytaj go jako „Plik”.', 'CORS', { linkRęczny: link });
    }
    if (ostatni && !ostatni.linkRęczny) ostatni.linkRęczny = link;
    throw ostatni || blad('Zasób nie ma adresu pliku.', 'BRAK_DANYCH', { linkRęczny: link });
  }

  /**
   * @param {Zbior} zbior  element wyniku szukaj()
   * @param {Zasob} zasob  element zbior.zasoby
   * @param {{signal?:AbortSignal, onPostep?:function(string)}} [ust]
   * @returns {Promise<{kolumny, wiersze, meta}>}
   */
  async function pobierzZasob(zbior, zasob, ust) {
    ust = ust || {};
    zbior = zbior || {};
    if (!zasob || !zasob.id) throw blad('Nie wskazano zasobu do pobrania.', 'FORMAT');
    const postep = function (t) { if (typeof ust.onPostep === 'function') { try { ust.onPostep(t); } catch (e) { /* UI */ } } };

    let wynik = null, zrodloUrl = '';
    const dodatkoweOstrz = [];
    if (zasob.tabelaryczny) {
      postep('Pobieranie danych tabelarycznych z API dane.gov.pl…');
      const t = await pobierzTabele(zasob, ust, postep);
      if (t.tablica.length > 1) {
        postep('Przetwarzanie ' + (t.tablica.length - 1) + ' wierszy…');
        // przez AED.zrodla.plik – te same naprawy (wiersz w jednej komórce, tytuł nad tabelą itd.)
        const tekst = naCsv(t.tablica);
        wynik = await wczytajPlikiem(new File([tekst], nazwaPliku(zasob, 'csv'), { type: 'text/csv' }));
        delete wynik.meta.kodowanie; delete wynik.meta.separator;
        zrodloUrl = API + '/resources/' + zasob.id + '/data';
        wynik.meta.format = (zasob.format || 'tabela') + ' (API dane.gov.pl, dane tabelaryczne)';
        Array.prototype.push.apply(dodatkoweOstrz, t.ostrzezenia);
      } else {
        throw blad('Zasób „' + (zasob.nazwa || zasob.id) + '” nie zawiera w API dane.gov.pl żadnych wierszy danych.',
          'BRAK_DANYCH', { linkRęczny: linkRecznyDla(zbior, zasob) });
      }
    }
    if (!wynik) {
      wynik = await pobierzPlik(zbior, zasob, ust, postep);
      zrodloUrl = wynik.meta.url;
      wynik.meta.format = zasob.format || wynik.meta.format;
    }
    delete wynik.skoroszyt; // nie jest potrzebny dla źródeł zdalnych
    delete wynik.meta.plik;

    const meta = wynik.meta;
    meta.url = zrodloUrl;
    meta.dataDanych = zasob.zmodyfikowano || zbior.zmodyfikowano || '';
    meta.licencjaSugerowana = zbior.licencja || mapujLicencje(zbior.licencjaOpis);
    meta.dysponentSugerowany = zbior.instytucja || '';
    meta.atrybucja = (zbior.instytucja ? zbior.instytucja + ', ' : '') + (zbior.tytul ? '„' + zbior.tytul + '”, ' : '') +
      'dane.gov.pl' + (zbior.licencjaOpis ? ', licencja ' + zbior.licencjaOpis : '');
    meta.zbior = { id: zbior.id || '', tytul: zbior.tytul || '', url: zbior.url || '' };
    meta.zasob = { id: zasob.id, nazwa: zasob.nazwa || '', format: zasob.format || '' };
    meta.naprawy = meta.naprawy || [];
    meta.ostrzezenia = (meta.ostrzezenia || []).concat(dodatkoweOstrz);
    if (!meta.licencjaSugerowana) {
      meta.ostrzezenia.push('Licencja zbioru' + (zbior.licencjaOpis ? ' („' + zbior.licencjaOpis + '”)' : '') +
        ' nie należy do licencji dopuszczonych we wzorcu (CC0 1.0, CC BY 4.0) – ustal ją z dysponentem.');
    }
    postep('Wczytano ' + wynik.wiersze.length + ' ' + odmiana(wynik.wiersze.length, 'wiersz', 'wiersze', 'wierszy') + '.');
    return wynik;
  }

  AED.zrodla = AED.zrodla || {};
  AED.zrodla.dgp = {
    API: API,
    DOMYSLNA_FRAZA: DOMYSLNA_FRAZA,
    szukaj: szukaj,
    pobierzZasob: pobierzZasob,
    zasobyZbioru: zasobyZbioru,
    mapujLicencje: mapujLicencje,
    _test: { naCsv: naCsv, pasuje: pasuje, bezHtml: bezHtml, zasobZApi: zasobZApi, czyStronaWww: czyStronaWww, rownolegle: rownolegle, MAKS_ROWNOLEGLYCH: MAKS_ROWNOLEGLYCH }
  };
})(window.AED);
