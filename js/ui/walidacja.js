/* Krok 3: Walidacja rekordów po mapowaniu.
   Reguły sprawdzania są w js/core/walidacja.js (AED.walidacja), rekordy w AED.store.
   Tu: podsumowanie, lista problemów z filtrami i stronicowaniem, poprawki w miejscu,
   podpowiedzi (pojedynczo i zbiorczo), zestawienie automatycznych napraw.
   Dane z rekordów są niezaufane – trafiają do DOM wyłącznie przez h() (textContent / atrybuty). */
(function (AED) {
  'use strict';
  const { h, odznaka, oglos, liczba, odmiana, tabelaPrzewijana } = AED.dom;
  const store = AED.store;

  const POLA = AED.wzorzec.schema.fields;
  const POLE = {};
  const KOLEJNOSC = {};
  POLA.forEach(function (p, i) { POLE[p.name] = p; KOLEJNOSC[p.name] = i; });
  const SLOWNIKI = AED.wzorzec.slowniki;
  const NA_STRONE = 50;

  // ------------------------------------------------------------ wartości wpisywane ręcznie
  function rozpakuj(x) {
    if (x && typeof x === 'object' && !(x instanceof Date) && 'wartosc' in x) return x.wartosc;
    return x;
  }
  function pusta(v) { return v === null || v === undefined || (typeof v === 'number' && isNaN(v)); }

  /** Zamienia tekst wpisany przez użytkownika na wartość pola wzorca. Zwraca {wartosc} albo {blad}. */
  function parsuj(pole, tekst) {
    const t = String(tekst === undefined || tekst === null ? '' : tekst).trim();
    if (t === '') return { wartosc: null };
    const N = AED.normalizacja || {};
    const typ = pole.type;
    let v;
    try {
      if (pole.aed.slownik) {
        v = N.slownik ? rozpakuj(N.slownik(pole.aed.slownik, t)) : t;
        const kody = (SLOWNIKI[pole.aed.slownik] || []).map(function (s) { return s.kod; });
        if (pusta(v) || (kody.length && kody.indexOf(v) < 0)) return { blad: 'Wybierz wartość ze słownika.' };
        return { wartosc: v };
      }
      if (typ === 'boolean') {
        v = N.bool ? rozpakuj(N.bool(t)) : (/^(tak|true|1)$/i.test(t) ? true : /^(nie|false|0)$/i.test(t) ? false : null);
        if (typeof v !== 'boolean') return { blad: 'Wpisz „tak” albo „nie”.' };
        return { wartosc: v };
      }
      // pola tekstowe z ujednoliceniem zapisu – gdy się nie uda, zostaje tekst (walidacja wskaże problem)
      const POPRAWIACZE = { kod_pocztowy: N.kodPocztowy, telefon_kontaktowy: N.telefon, email_kontaktowy: N.email, godziny_dostepnosci: N.godziny };
      if (POPRAWIACZE[pole.name]) {
        v = POPRAWIACZE[pole.name](t);
        return { wartosc: v === null || v === undefined ? t : v };
      }
      if (pole.name === 'id_aed') return { wartosc: t.toLowerCase() };
      if (pole.name === 'kod_terc_gminy' || pole.name === 'kod_simc') {
        const c = t.replace(/[\s-]/g, '');
        return { wartosc: /^\d{1,7}$/.test(c) ? c.padStart(7, '0') : t };
      }
      if (pole.name === 'kondygnacja') {
        v = N.kondygnacja ? N.kondygnacja(t) : null;
        if (typeof v !== 'number' || !Number.isInteger(v)) return { blad: 'Wpisz numer kondygnacji (0 = parter, -1 = piwnica, 1 = pierwsze piętro).' };
        return { wartosc: v };
      }
      if (typ === 'number' || typ === 'integer') {
        v = N.liczba ? rozpakuj(N.liczba(t)) : Number(t.replace(',', '.'));
        if (typeof v !== 'number' || isNaN(v)) return { blad: 'Wpisz liczbę (np. 52.229676).' };
        if (typ === 'integer' && !Number.isInteger(v)) return { blad: 'Wpisz liczbę całkowitą.' };
        return { wartosc: v };
      }
      if (typ === 'date') {
        v = N.data ? rozpakuj(N.data(t)) : (/^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null);
        if (pusta(v) || v === '') return { blad: 'Wpisz datę w postaci RRRR-MM-DD (np. 2026-11-21).' };
        return { wartosc: v };
      }
      if (typ === 'datetime') {
        v = N.dataCzas ? N.dataCzas(t) : (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t) ? t : null);
        if (pusta(v) || v === '') return { blad: 'Wpisz datę i godzinę, np. 2026-11-21 10:15 albo 21.11.2026 10:15.' };
        return { wartosc: v };
      }
    } catch (e) {
      return { blad: 'Nie rozpoznano wartości.' };
    }
    return { wartosc: t };
  }

  function pokazWartosc(v) {
    if (v === null || v === undefined || v === '') return '— (puste)';
    if (v === true) return 'tak';
    if (v === false) return 'nie';
    return String(v);
  }
  function wartoscPodpowiedzi(p) {
    const x = p.podpowiedz;
    return (x && typeof x === 'object' && 'wartosc' in x) ? x.wartosc : x;
  }
  /** Zmiany do zapisania po zastosowaniu podpowiedzi – {pole: wartość}; podpowiedź może zmieniać kilka pól naraz. */
  function zmianyPodpowiedzi(p) {
    const x = p.podpowiedz;
    if (x && typeof x === 'object' && x.zmiany && typeof x.zmiany === 'object') return Object.assign({}, x.zmiany);
    const z = {}; z[p.pole] = wartoscPodpowiedzi(p); return z;
  }
  function opisZmian(zmiany) {
    return Object.keys(zmiany).map(function (k) { return tytulPola(k) + ': „' + pokazWartosc(zmiany[k]) + '”'; }).join(', ');
  }
  function maPodpowiedz(p) { return p.podpowiedz !== undefined && p.podpowiedz !== null; }
  function opisPodpowiedzi(p) {
    const x = p.podpowiedz;
    if (x && typeof x === 'object' && x.opis) return x.opis;
    if (x && typeof x === 'object' && x.zmiany) return 'Proponowane zmiany: ' + opisZmian(x.zmiany) + '.';
    return 'Proponowana wartość: „' + pokazWartosc(wartoscPodpowiedzi(p)) + '”.';
  }
  function tytulPola(pole) { return POLE[pole] ? POLE[pole].title : (pole || 'cały rekord'); }

  // ------------------------------------------------------------ stan
  const stan = {
    gotowe: false,          // czy jest wynik walidacji
    nieaktualne: false,     // czy mapowanie/źródła zmieniły się od ostatniego przeliczenia
    problemy: new Map(),    // rekordId -> Problem[]
    indeks: new Map(),      // rekordId -> rekord
    lista: null,            // spłaszczona, posortowana lista (pamięć podręczna)
    naprawy: [],            // [{opis, pole, rekordy, przyklad}]
    licznikNapraw: 0,
    filtr: { poziom: '', zrodlo: '', pole: '', kod: '' },
    strona: 1,
    wlasnaAkcja: false,
    zaplanowane: false,
    wTrakcie: false,
    wsadowo: false,         // zbiorcza poprawka – walidujemy raz na końcu
    zdarzenie: false,
    podpis: null            // stan źródeł i mapowań użyty do ostatniego przeliczenia
  };
  // zmiana tych pól może wywołać lub usunąć problem UNIKALNY w innym rekordzie – wtedy walidujemy cały zbiór
  const POLA_ZBIORU = ['id_aed', 'id_lokalne', 'dysponent_nazwa'];

  /** Podpis danych wejściowych przeliczenia: zmiana = wynik walidacji nieaktualny. */
  function podpis() {
    return JSON.stringify(store.zrodla.map(function (z) {
      return [z.id, z.kod, z.licencja, z.dysponent, z.kolumny, z.wiersze.length, z.mapowanie || null];
    }));
  }

  function W() { return AED.walidacja || null; }
  function $(id) { return document.getElementById(id); }

  function pelnaWalidacja(zachowajStrone) {
    const rekordy = store.rekordy || [];
    stan.indeks = new Map();
    rekordy.forEach(function (r) { stan.indeks.set(r._id, r); });
    const wynik = W().waliduj(rekordy);
    // indeks id_aed / id_lokalne – sprawdzanie unikalności po edycji w O(1) zamiast przeglądania całego zbioru
    stan.indeksUnik = W().indeksUnikalnosci ? W().indeksUnikalnosci(rekordy) : null;
    stan.problemy = new Map();
    (wynik.problemy || []).forEach(function (p) {
      const k = p.rekordId;
      if (!stan.problemy.has(k)) stan.problemy.set(k, []);
      stan.problemy.get(k).push(p);
    });
    stan.lista = null; stan.podsumowanie = null;
    stan.naprawy = AED.ui.mapowanie.zliczNaprawy(rekordy);
    stan.licznikNapraw = rekordy.reduce(function (s, r) { return s + ((r._naprawy && r._naprawy.length) ? 1 : 0); }, 0);
    if (!zachowajStrone) stan.strona = 1;
    stan.gotowe = true;
  }

  /** Przelicza rekordy (mapowanie → rekordy) i waliduje je. Wywołuje krok 2 przed przejściem dalej. */
  async function uruchom() {
    stan.wTrakcie = true;
    try {
      // mapowanie zapisane dla każdego źródła – inaczej późniejszy zapis podpowiedzi wyglądałby jak zmiana
      if (AED.ui.mapowanie) store.zrodla.forEach(AED.ui.mapowanie.zapewnijMapowanie);
      await Promise.resolve(store.przelicz());
      pelnaWalidacja();
      stan.podpis = podpis();
      stan.nieaktualne = false;
    } finally {
      stan.wTrakcie = false;
    }
  }

  function lista() {
    if (stan.lista) return stan.lista;
    const out = [];
    stan.problemy.forEach(function (arr) { arr.forEach(function (p) { out.push(p); }); });
    out.sort(porownaj);
    stan.lista = out;
    return out;
  }
  function porownajRekord(a, b) {
    const ka = String(a.kodZrodla), kb = String(b.kodZrodla);
    const ra = String(a.rekordId), rb = String(b.rekordId);
    return (ka < kb ? -1 : ka > kb ? 1 : 0) || (a.wiersz || 0) - (b.wiersz || 0) || (ra < rb ? -1 : ra > rb ? 1 : 0);
  }
  function porownaj(a, b) {
    return porownajRekord(a, b) ||
      (KOLEJNOSC[a.pole] === undefined ? 999 : KOLEJNOSC[a.pole]) - (KOLEJNOSC[b.pole] === undefined ? 999 : KOLEJNOSC[b.pole]) ||
      (a.poziom === b.poziom ? 0 : a.poziom === 'blad' ? -1 : 1);
  }
  /** Podmiana problemów jednego rekordu w posortowanej liście bez sortowania całości (problemy rekordu leżą obok siebie). */
  function podmienWLiscie(rekord, nowe) {
    const l = stan.lista;
    if (!l) return;
    const wzor = { kodZrodla: rekord._kodZrodla, wiersz: rekord._wiersz, rekordId: rekord._id };
    let lo = 0, hi = l.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (porownajRekord(l[mid], wzor) < 0) lo = mid + 1; else hi = mid; }
    let koniec = lo;
    while (koniec < l.length && l[koniec].rekordId === rekord._id) koniec++;
    const posortowane = nowe.slice().sort(porownaj);
    l.splice.apply(l, [lo, koniec - lo].concat(posortowane));
  }

  function podsumuj() {
    if (stan.podsumowanie) return stan.podsumowanie;
    stan.podsumowanie = policzPodsumowanie();
    return stan.podsumowanie;
  }
  function policzPodsumowanie() {
    const wszystkie = lista();
    const s = { rekordy: stan.indeks.size, bledy: 0, ostrzezenia: 0, rekordyZBledami: 0, wgPola: {}, wgZrodla: {}, wgKodu: {} };
    stan.indeks.forEach(function (r) {
      const k = r._kodZrodla || '—';
      s.wgZrodla[k] = s.wgZrodla[k] || { rekordy: 0, bledy: 0, ostrzezenia: 0, rekordyZBledami: 0 };
      s.wgZrodla[k].rekordy++;
    });
    const zBledem = new Set();
    wszystkie.forEach(function (p) {
      const blad = p.poziom === 'blad';
      if (blad) s.bledy++; else s.ostrzezenia++;
      const pole = p.pole || '';
      const wp = s.wgPola[pole] = s.wgPola[pole] || { bledy: 0, ostrzezenia: 0 };
      if (blad) wp.bledy++; else wp.ostrzezenia++;
      const wz = s.wgZrodla[p.kodZrodla] = s.wgZrodla[p.kodZrodla] || { rekordy: 0, bledy: 0, ostrzezenia: 0, rekordyZBledami: 0 };
      if (blad) wz.bledy++; else wz.ostrzezenia++;
      if (blad && !zBledem.has(p.rekordId)) { zBledem.add(p.rekordId); wz.rekordyZBledami++; }
      const wk = s.wgKodu[p.kod] = s.wgKodu[p.kod] || { liczba: 0, komunikat: p.komunikat };
      wk.liczba++;
    });
    s.rekordyZBledami = zBledem.size;
    return s;
  }

  function przefiltrowane() {
    const f = stan.filtr;
    return lista().filter(function (p) {
      return (!f.poziom || p.poziom === f.poziom) && (!f.zrodlo || p.kodZrodla === f.zrodlo) &&
        (!f.pole || (p.pole || '') === f.pole) && (!f.kod || p.kod === f.kod);
    });
  }

  /** Klucz problemu stabilny po ponownej walidacji rekordu. */
  function klucz(p) { return p.rekordId + '|' + (p.pole || '') + '|' + p.kod; }
  let licznikId = 0;
  const idElementu = new Map(); // klucz -> krótkie id do atrybutów DOM
  function domId(p) {
    const k = klucz(p);
    if (!idElementu.has(k)) idElementu.set(k, 'pr' + (++licznikId));
    return idElementu.get(k);
  }

  // ------------------------------------------------------------ zmiany rekordów
  function poZmianieRekordu(rekord, pola) {
    if (!rekord || !W()) return;
    stan.indeks.set(rekord._id, rekord);
    if (stan.wsadowo) return; // zbiorcza poprawka – walidacja całości na końcu
    if (pola && pola.some(function (p) { return POLA_ZBIORU.indexOf(p) >= 0; })) { pelnaWalidacja(true); return; }
    let nowe = W().walidujRekord(rekord) || [];
    if (W().walidujUnikalnosc) nowe = nowe.concat(W().walidujUnikalnosc(stan.indeksUnik || store.rekordy, rekord) || []);
    if (nowe.length) stan.problemy.set(rekord._id, nowe); else stan.problemy.delete(rekord._id);
    podmienWLiscie(rekord, nowe);
    stan.podsumowanie = null;
  }

  /** Zapis zmian jednego rekordu: zmiany = {pole: wartość, …}. */
  function zmienRekord(rekordId, zmiany) {
    stan.wlasnaAkcja = true;
    stan.zdarzenie = false;
    try {
      const r = store.aktualizujRekord(rekordId, zmiany);
      // gdy magazyn nie wyemitował zdarzenia 'rekordy:zmiana' – walidujemy sami
      if (!stan.zdarzenie) poZmianieRekordu((r && r._id) ? r : stan.indeks.get(rekordId), Object.keys(zmiany));
    } finally {
      stan.wlasnaAkcja = false;
    }
  }
  function zmien1(rekordId, pole, wartosc) { const z = {}; z[pole] = wartosc; zmienRekord(rekordId, z); }

  /** Po poprawce: komunikat i fokus. Gdy problem zniknął – na następny problem w tym samym miejscu listy. */
  function poPoprawce(p, indeksNaStronie, tekstZrobione) {
    const pozostale = (stan.problemy.get(p.rekordId) || []).filter(function (x) { return (x.pole || '') === (p.pole || ''); });
    renderujWszystko();
    const s = podsumuj();
    const reszta = 'Pozostało ' + liczba(s.bledy) + ' ' + odmiana(s.bledy, 'błąd', 'błędy', 'błędów') + ' i ' +
      liczba(s.ostrzezenia) + ' ' + odmiana(s.ostrzezenia, 'ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń') + '.';
    const ten = pozostale.find(function (x) { return x.kod === p.kod; }) || pozostale[0];
    if (ten && $(domId(ten) + '-pole')) {
      const el = $(domId(ten) + '-pole');
      el.setAttribute('aria-invalid', 'true');
      el.focus();
      oglos(tekstZrobione + ' Wartość nadal wymaga uwagi: ' + ten.komunikat, true);
      return;
    }
    const elementy = document.querySelectorAll('#wal-lista .problem h3');
    const cel = elementy[Math.min(indeksNaStronie, elementy.length - 1)];
    if (cel) cel.focus(); else { const n = $('h-wal-lista'); if (n) n.focus(); }
    oglos(tekstZrobione + ' Problem rozwiązany. ' + reszta);
  }

  // ------------------------------------------------------------ renderowanie
  function przyciskFiltru(tekst, ustaw, opis) {
    return h('button', { type: 'button', class: 'btn-link', onclick: function () {
      stan.filtr = Object.assign({ poziom: '', zrodlo: '', pole: '', kod: '' }, ustaw);
      stan.strona = 1;
      renderujFiltry(); renderujListe();
      const n = $('h-wal-lista'); if (n) n.focus();
      oglos('Filtr: ' + opis + '. Znaleziono ' + liczba(przefiltrowane().length) + ' ' +
        odmiana(przefiltrowane().length, 'problem', 'problemy', 'problemów') + '.');
    } }, tekst, h('span', { class: 'visually-hidden' }, ' – pokaż problemy'));
  }

  function renderujPodsumowanie() {
    const kont = $('wal-podsumowanie');
    kont.textContent = '';
    const s = podsumuj();
    const bezBledow = s.rekordy - s.rekordyZBledami;
    kont.appendChild(h('ul', { class: 'stat-row', 'aria-label': 'Podsumowanie walidacji' },
      h('li', { class: 'stat' }, h('span', { class: 'stat__liczba' }, liczba(s.rekordy)), h('span', { class: 'stat__opis' }, odmiana(s.rekordy, 'rekord', 'rekordy', 'rekordów'))),
      h('li', { class: 'stat stat--err' }, h('span', { class: 'stat__liczba' }, liczba(s.bledy)), h('span', { class: 'stat__opis' }, odmiana(s.bledy, 'błąd', 'błędy', 'błędów'))),
      h('li', { class: 'stat stat--warn' }, h('span', { class: 'stat__liczba' }, liczba(s.ostrzezenia)), h('span', { class: 'stat__opis' }, odmiana(s.ostrzezenia, 'ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń'))),
      h('li', { class: 'stat stat--ok' }, h('span', { class: 'stat__liczba' }, liczba(bezBledow)), h('span', { class: 'stat__opis' }, odmiana(bezBledow, 'rekord bez błędów', 'rekordy bez błędów', 'rekordów bez błędów')))));

    // wg źródła
    const kody = Object.keys(s.wgZrodla).sort();
    const tZr = h('table', null,
      h('caption', null, 'Problemy według źródła'),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Źródło'), h('th', { scope: 'col', class: 'num' }, 'Rekordy'),
        h('th', { scope: 'col', class: 'num' }, 'Błędy'), h('th', { scope: 'col', class: 'num' }, 'Ostrzeżenia'),
        h('th', { scope: 'col', class: 'num' }, 'Rekordy z błędami'))),
      h('tbody', null, kody.map(function (k) {
        const w = s.wgZrodla[k];
        const z = store.zrodla.find(function (x) { return x.kod === k; });
        return h('tr', null,
          h('th', { scope: 'row' }, (w.bledy + w.ostrzezenia) ? przyciskFiltru(k, { zrodlo: k }, 'źródło ' + k) : h('code', null, k),
            z ? h('span', { class: 'meta cell-note' }, z.nazwa) : null),
          h('td', { class: 'num' }, liczba(w.rekordy)), h('td', { class: 'num' }, liczba(w.bledy)),
          h('td', { class: 'num' }, liczba(w.ostrzezenia)), h('td', { class: 'num' }, liczba(w.rekordyZBledami)));
      })));

    // wg pola
    const pola = Object.keys(s.wgPola).sort(function (a, b) {
      return (s.wgPola[b].bledy - s.wgPola[a].bledy) || (s.wgPola[b].ostrzezenia - s.wgPola[a].ostrzezenia);
    });
    const tPo = h('table', null,
      h('caption', null, 'Problemy według pola'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Pole'),
        h('th', { scope: 'col', class: 'num' }, 'Błędy'), h('th', { scope: 'col', class: 'num' }, 'Ostrzeżenia'))),
      h('tbody', null, pola.map(function (p) {
        const w = s.wgPola[p];
        return h('tr', null, h('th', { scope: 'row' }, przyciskFiltru(tytulPola(p), { pole: p }, 'pole ' + tytulPola(p))),
          h('td', { class: 'num' }, liczba(w.bledy)), h('td', { class: 'num' }, liczba(w.ostrzezenia)));
      })));

    kont.appendChild(h('div', { class: 'wal-tabele' },
      tabelaPrzewijana('Problemy według źródła', tZr),
      pola.length ? tabelaPrzewijana('Problemy według pola', tPo) : h('p', { class: 'alert alert--ok' }, 'Nie znaleziono problemów.')));
  }

  /** Grupy problemów (pole + kod) do poprawy zbiorczej: z podpowiedziami albo puste pola obowiązkowe. */
  function grupyZbiorcze() {
    const grupy = new Map();
    lista().forEach(function (p) {
      if (!POLE[p.pole]) return;
      const zPodp = maPodpowiedz(p);
      if (!zPodp && p.kod !== 'WYMAGANE') return;
      const k = p.pole + '|' + p.kod;
      let g = grupy.get(k);
      if (!g) { g = { klucz: k, pole: p.pole, kod: p.kod, komunikat: p.komunikat, rekordy: new Set(), zPodpowiedzia: new Set() }; grupy.set(k, g); }
      g.rekordy.add(p.rekordId);
      if (zPodp) g.zPodpowiedzia.add(p.rekordId);
    });
    return Array.from(grupy.values()).sort(function (a, b) { return b.rekordy.size - a.rekordy.size; });
  }
  function rekordow(n) { return liczba(n) + ' ' + odmiana(n, 'rekordzie', 'rekordach', 'rekordach'); }

  function renderujZbiorcze() {
    const kont = $('wal-zbiorcze');
    kont.textContent = '';
    const arr = grupyZbiorcze();
    if (!arr.length) return;
    kont.appendChild(h('h2', { id: 'h-wal-zbiorcze', tabindex: '-1' }, 'Poprawki zbiorcze'));
    kont.appendChild(h('p', null, 'Te problemy możesz poprawić od razu w wielu rekordach: zastosować podpowiedź ' +
      'albo – gdy brakuje wartości obowiązkowej – wpisać jedną wartość dla wszystkich.'));
    const tabela = h('table', null,
      h('caption', null, 'Problemy do poprawienia zbiorczo'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Pole'), h('th', { scope: 'col' }, 'Problem'),
        h('th', { scope: 'col', class: 'num' }, 'Rekordy'), h('th', { scope: 'col' }, 'Akcja'))),
      h('tbody', null, arr.map(function (g, i) {
        const n = g.rekordy.size, np = g.zPodpowiedzia.size;
        const opisSr = ' – pole ' + tytulPola(g.pole) + ', ';
        return h('tr', null,
          h('th', { scope: 'row' }, tytulPola(g.pole)),
          h('td', null, skroc(g.komunikat, 160), h('span', { class: 'meta cell-note' }, 'kod: ', g.kod)),
          h('td', { class: 'num' }, liczba(n)),
          h('td', null, h('div', { class: 'cell-actions' },
            np ? h('button', { type: 'button', class: 'btn btn--secondary btn--small', id: 'wal-zb-' + i,
              onclick: function () { potwierdzZbiorcze(g.klucz, 'podpowiedz', i); } },
              'Zastosuj podpowiedzi', h('span', { class: 'visually-hidden' }, opisSr + liczba(np) + ' ' + odmiana(np, 'rekord', 'rekordy', 'rekordów'))) : null,
            g.kod === 'WYMAGANE' ? h('button', { type: 'button', class: 'btn btn--secondary btn--small', id: 'wal-zw-' + i,
              onclick: function () { potwierdzZbiorcze(g.klucz, 'wartosc', i); } },
              'Wpisz jedną wartość…', h('span', { class: 'visually-hidden' }, opisSr + liczba(n) + ' ' + odmiana(n, 'rekord', 'rekordy', 'rekordów'))) : null)));
      })));
    kont.appendChild(tabelaPrzewijana('Problemy do poprawienia zbiorczo', tabela));
    kont.appendChild(h('div', { id: 'wal-zb-potwierdz' }));
  }

  function potwierdzZbiorcze(kluczGrupy, tryb, i) {
    const kont = $('wal-zb-potwierdz');
    kont.textContent = '';
    const g = grupyZbiorcze().find(function (x) { return x.klucz === kluczGrupy; });
    if (!g) return;
    const pole = POLE[g.pole];
    const n = tryb === 'podpowiedz' ? g.zPodpowiedzia.size : g.rekordy.size;
    const powrot = $((tryb === 'podpowiedz' ? 'wal-zb-' : 'wal-zw-') + i);
    const anuluj = function () { kont.textContent = ''; if (powrot) powrot.focus(); };
    let tekst, ctrl = null;
    if (tryb === 'podpowiedz') {
      tekst = 'Zastosować podpowiedź w ' + rekordow(n) + ' (pole „' + tytulPola(g.pole) + '”, problem: ' + skroc(g.komunikat, 120) + ')? ' +
        'Każdą zmianę możesz potem cofnąć przyciskiem „Przywróć wartość ze źródła”.';
    } else {
      tekst = 'Wpisz wartość pola „' + tytulPola(g.pole) + '” dla ' + liczba(n) + ' ' + odmiana(n, 'rekordu', 'rekordów', 'rekordów') +
        ', w których jej brakuje.';
      ctrl = h('div', { class: 'field' },
        h('label', { for: 'wal-zb-wartosc' }, 'Wartość dla wszystkich (' + tytulPola(g.pole) + ')'),
        kontrolkaWartosci('wal-zb-wartosc', { pole: g.pole, wartosc: null }, null, 'wal-zb-tekst'),
        h('p', { id: 'wal-zb-blad', class: 'field-error', hidden: true }));
    }
    const wykonaj = function () {
      let wartosc;
      if (tryb === 'wartosc') {
        const el = $('wal-zb-wartosc');
        const wynik = parsuj(pole, el.value);
        if (wynik.blad || wynik.wartosc === null) {
          const b = $('wal-zb-blad');
          b.textContent = wynik.blad || 'Wpisz albo wybierz wartość.'; b.hidden = false;
          el.setAttribute('aria-invalid', 'true'); el.setAttribute('aria-describedby', 'wal-zb-tekst wal-zb-blad');
          el.focus(); oglos(b.textContent, true);
          return;
        }
        wartosc = wynik.wartosc;
      }
      zastosujZbiorczo(kluczGrupy, tryb, wartosc);
    };
    kont.appendChild(h('form', { class: 'alert alert--warn', 'aria-labelledby': 'wal-zb-tekst', novalidate: true,
      onsubmit: function (e) { e.preventDefault(); wykonaj(); } },
      h('p', { id: 'wal-zb-tekst' }, tekst),
      ctrl,
      h('div', { class: 'alert-actions' },
        h('button', { type: 'submit', class: 'btn btn--primary btn--small', id: 'wal-zb-tak', 'aria-describedby': 'wal-zb-tekst' },
          (tryb === 'podpowiedz' ? 'Tak, zastosuj w ' : 'Zapisz w ') + rekordow(n)),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: anuluj }, 'Anuluj'))));
    kont.firstChild.addEventListener('keydown', function (e) { if (e.key === 'Escape') anuluj(); });
    (tryb === 'wartosc' ? $('wal-zb-wartosc') : $('wal-zb-tak')).focus();
  }

  /** Zbiorcza poprawka na BIEŻĄCYCH problemach grupy (pomija te, które zniknęły); walidacja całości raz na końcu. */
  function zastosujZbiorczo(kluczGrupy, tryb, wartosc) {
    const [pole, kod] = kluczGrupy.split('|');
    const zrobione = new Set();
    stan.wsadowo = true;
    try {
      lista().slice().forEach(function (p) {
        if (p.pole !== pole || p.kod !== kod || zrobione.has(p.rekordId)) return;
        if (tryb === 'podpowiedz') {
          if (!maPodpowiedz(p)) return;
          zmienRekord(p.rekordId, zmianyPodpowiedzi(p));
        } else {
          const z = {}; z[pole] = wartosc; zmienRekord(p.rekordId, z);
        }
        zrobione.add(p.rekordId);
      });
    } finally {
      stan.wsadowo = false;
    }
    pelnaWalidacja(true);
    renderujWszystko();
    const s = podsumuj();
    const nagl = $('h-wal-zbiorcze') || $('h-wal-lista');
    if (nagl) nagl.focus();
    const n = zrobione.size;
    oglos((tryb === 'podpowiedz' ? 'Zastosowano podpowiedź w ' : 'Zapisano wartość w ') + rekordow(n) + '. Pozostało ' +
      liczba(s.bledy) + ' ' + odmiana(s.bledy, 'błąd', 'błędy', 'błędów') + '.');
  }

  function opcje(wartosci, wybrana, etykietaWszystkie) {
    return [h('option', { value: '' }, etykietaWszystkie)].concat(wartosci.map(function (w) {
      return h('option', { value: w[0], selected: w[0] === wybrana }, w[1]);
    }));
  }

  function renderujFiltry() {
    const kont = $('wal-filtry');
    kont.textContent = '';
    const s = podsumuj();
    const f = stan.filtr;
    const zmien = function (nazwa) {
      return function (e) {
        stan.filtr[nazwa] = e.target.value;
        stan.strona = 1;
        renderujListe();
        const n = przefiltrowane().length;
        oglos('Znaleziono ' + liczba(n) + ' ' + odmiana(n, 'problem', 'problemy', 'problemów') + '.');
      };
    };
    const pole = function (id, etykieta, sel) {
      return h('div', { class: 'field' }, h('label', { for: id }, etykieta), sel);
    };
    kont.appendChild(h('form', { class: 'wal-filtry', 'aria-label': 'Filtry listy problemów', onsubmit: function (e) { e.preventDefault(); } },
      pole('wal-f-poziom', 'Poziom', h('select', { id: 'wal-f-poziom', onchange: zmien('poziom') },
        opcje([['blad', 'Błędy (' + liczba(s.bledy) + ')'], ['ostrzezenie', 'Ostrzeżenia (' + liczba(s.ostrzezenia) + ')']], f.poziom, 'Wszystkie'))),
      pole('wal-f-zrodlo', 'Źródło', h('select', { id: 'wal-f-zrodlo', onchange: zmien('zrodlo') },
        opcje(Object.keys(s.wgZrodla).sort().map(function (k) {
          const w = s.wgZrodla[k]; return [k, k + ' (' + liczba(w.bledy + w.ostrzezenia) + ')'];
        }), f.zrodlo, 'Wszystkie'))),
      pole('wal-f-pole', 'Pole', h('select', { id: 'wal-f-pole', onchange: zmien('pole') },
        opcje(Object.keys(s.wgPola).sort(function (a, b) { return (KOLEJNOSC[a] || 0) - (KOLEJNOSC[b] || 0); }).map(function (k) {
          const w = s.wgPola[k]; return [k, tytulPola(k) + ' (' + liczba(w.bledy + w.ostrzezenia) + ')'];
        }), f.pole, 'Wszystkie'))),
      pole('wal-f-kod', 'Rodzaj problemu', h('select', { id: 'wal-f-kod', onchange: zmien('kod') },
        opcje(Object.keys(s.wgKodu).sort().map(function (k) {
          return [k, s.wgKodu[k].komunikat ? k + ' – ' + skroc(s.wgKodu[k].komunikat, 50) + ' (' + liczba(s.wgKodu[k].liczba) + ')' : k];
        }), f.kod, 'Wszystkie'))),
      h('div', { class: 'wal-filtry__akcje' }, h('button', { type: 'button', class: 'btn btn--ghost btn--small', id: 'wal-f-wyczysc',
        onclick: function () {
          stan.filtr = { poziom: '', zrodlo: '', pole: '', kod: '' }; stan.strona = 1;
          renderujFiltry(); renderujListe(); $('wal-f-wyczysc').focus();
          oglos('Wyczyszczono filtry. Wszystkich problemów: ' + liczba(lista().length) + '.');
        } }, 'Wyczyść filtry'))));
  }
  function skroc(t, n) { t = String(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

  /** Kontrolka edycji wartości pola (słownik → select, tak/nie → select, pozostałe → tekst). */
  function kontrolkaWartosci(id, p, rekord, opisId) {
    const pole = POLE[p.pole];
    const v = rekord ? rekord[p.pole] : p.wartosc;
    if (pole && pole.aed.slownik && SLOWNIKI[pole.aed.slownik]) {
      return h('select', { id: id, 'aria-describedby': opisId },
        h('option', { value: '' }, '— puste —'),
        SLOWNIKI[pole.aed.slownik].map(function (s) { return h('option', { value: s.kod, selected: s.kod === v }, s.etykieta + ' (' + s.kod + ')'); }));
    }
    if (pole && pole.type === 'boolean') {
      return h('select', { id: id, 'aria-describedby': opisId },
        h('option', { value: '' }, '— puste —'),
        h('option', { value: 'tak', selected: v === true }, 'tak'),
        h('option', { value: 'nie', selected: v === false }, 'nie'));
    }
    const podp = pole && pole.type === 'date' ? 'RRRR-MM-DD' : null;
    return h('input', { type: 'text', id: id, value: v === null || v === undefined ? '' : String(v), 'aria-describedby': opisId,
      inputmode: pole && (pole.type === 'number' || pole.type === 'integer') ? 'decimal' : null,
      placeholder: podp, autocomplete: 'off', spellcheck: 'false' });
  }

  function poprawione(rekord, pole) {
    return !!(rekord && pole && Array.isArray(rekord._poprawione) && rekord._poprawione.indexOf(pole) >= 0);
  }
  /** „Przywróć wartość ze źródła” – cofa ręczną poprawkę pola (store.cofnijPoprawke). */
  function przyciskPrzywroc(rekord, pole, opisId, potem) {
    if (!store.cofnijPoprawke) return null;
    return h('button', { type: 'button', class: 'btn btn--ghost btn--small', 'aria-describedby': opisId, onclick: function () {
      stan.wlasnaAkcja = true; stan.zdarzenie = false;
      try {
        const r = store.cofnijPoprawke(rekord._id, pole);
        if (!stan.zdarzenie) poZmianieRekordu(r || rekord, [pole]);
      } finally { stan.wlasnaAkcja = false; }
      potem();
    } }, 'Przywróć wartość ze źródła', h('span', { class: 'visually-hidden' }, ' – ' + tytulPola(pole) + ', ' + rekord._kodZrodla + ' wiersz ' + rekord._wiersz));
  }

  /** Lista ręcznych poprawek (także tych, po których problem zniknął) z możliwością cofnięcia. */
  function renderujPoprawki() {
    const kont = $('wal-poprawki');
    if (!kont) return;
    const otwarte = kont.querySelector('details') && kont.querySelector('details').open;
    kont.textContent = '';
    const wiersze = [];
    stan.indeks.forEach(function (r) {
      (Array.isArray(r._poprawione) ? r._poprawione : []).forEach(function (pole) { wiersze.push({ r: r, pole: pole }); });
    });
    if (!wiersze.length) { kont.appendChild(h('p', { class: 'empty' }, 'Nie poprawiono jeszcze żadnej wartości.')); return; }
    const MAKS = 100;
    const tabela = h('table', null,
      h('caption', null, 'Ręczne poprawki' + (wiersze.length > MAKS ? ' (pierwsze ' + MAKS + ' z ' + liczba(wiersze.length) + ')' : '')),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Rekord'), h('th', { scope: 'col' }, 'Pole'),
        h('th', { scope: 'col' }, 'Wartość ze źródła'), h('th', { scope: 'col' }, 'Obecna wartość'), h('th', { scope: 'col' }, 'Akcja'))),
      h('tbody', null, wiersze.slice(0, MAKS).map(function (w, i) {
        const idW = 'wal-rp-' + i;
        return h('tr', { id: idW },
          h('th', { scope: 'row' }, h('code', null, w.r._kodZrodla), ', wiersz ' + w.r._wiersz),
          h('td', null, tytulPola(w.pole)),
          h('td', { class: 'przyklad-zmiany' }, pokazWartosc(w.r._oryginal ? w.r._oryginal[w.pole] : null)),
          h('td', { class: 'przyklad-zmiany' }, pokazWartosc(w.r[w.pole])),
          h('td', null, przyciskPrzywroc(w.r, w.pole, null, function () {
            renderujWszystko();
            const n = $('h-wal-poprawki'); if (n) n.focus();
            oglos('Przywrócono wartość ze źródła w polu „' + tytulPola(w.pole) + '”.');
          })));
      })));
    kont.appendChild(h('details', { class: 'wal-naprawy', open: otwarte || null },
      h('summary', null, 'Ręczne poprawki (' + liczba(wiersze.length) + ')'),
      tabelaPrzewijana('Ręczne poprawki', tabela)));
  }

  function elementProblemu(p, i) {
    const id = domId(p);
    const rekord = stan.indeks.get(p.rekordId);
    const blad = p.poziom === 'blad';
    const polePoprawne = !!POLE[p.pole];
    const idPola = id + '-pole', idKom = id + '-kom', idBlad = id + '-blad';

    const zapisz = function (e) {
      e.preventDefault();
      const el = $(idPola);
      const wynik = parsuj(POLE[p.pole], el.value);
      const bladEl = $(idBlad);
      if (wynik.blad) {
        el.setAttribute('aria-invalid', 'true');
        el.setAttribute('aria-describedby', idKom + ' ' + idBlad);
        bladEl.textContent = wynik.blad; bladEl.hidden = false;
        el.focus();
        oglos(wynik.blad, true);
        return;
      }
      zmien1(p.rekordId, p.pole, wynik.wartosc);
      poPoprawce(p, i, 'Zapisano wartość „' + pokazWartosc(wynik.wartosc) + '” w polu „' + tytulPola(p.pole) + '”.');
    };

    return h('li', { class: 'problem problem--' + (blad ? 'blad' : 'ostrzezenie') },
      h('h3', { class: 'problem__tytul', tabindex: '-1', id: id + '-h' },
        odznaka(blad ? 'err' : 'warn', blad ? 'Błąd' : 'Ostrzeżenie'), ' ',
        h('span', null, h('code', null, p.kodZrodla), ', wiersz ' + (p.wiersz || '—') + ' – ' + tytulPola(p.pole))),
      h('p', { id: idKom, class: 'problem__komunikat' }, p.komunikat),
      h('p', { class: 'meta' }, 'Wartość: ', h('span', { class: 'problem__wartosc' }, pokazWartosc(rekord && p.pole ? rekord[p.pole] : p.wartosc)),
        ' · kod: ', p.kod),
      poprawione(rekord, p.pole) ? h('div', { class: 'problem__reczne' },
        h('p', { id: id + '-rp' }, odznaka('info', 'Poprawione ręcznie'), ' Wartość ze źródła: ',
          h('span', { class: 'problem__wartosc' }, pokazWartosc(rekord._oryginal ? rekord._oryginal[p.pole] : null))),
        przyciskPrzywroc(rekord, p.pole, id + '-rp', function () { poPoprawce(p, i, 'Przywrócono wartość ze źródła.'); })) : null,
      maPodpowiedz(p) && polePoprawne ? h('div', { class: 'problem__podpowiedz' },
        h('p', { id: id + '-pp' }, odznaka('info', 'Podpowiedź'), ' ', opisPodpowiedzi(p)),
        h('button', { type: 'button', class: 'btn btn--secondary btn--small', 'aria-describedby': id + '-pp',
          onclick: function () {
            const zmiany = zmianyPodpowiedzi(p);
            zmienRekord(p.rekordId, zmiany);
            poPoprawce(p, i, 'Zastosowano podpowiedź: ' + opisZmian(zmiany) + '.');
          } }, 'Zastosuj podpowiedź', h('span', { class: 'visually-hidden' }, ' (' + p.kodZrodla + ', wiersz ' + p.wiersz + ')'))) : null,
      polePoprawne ? h('form', { class: 'problem__edycja', onsubmit: zapisz, novalidate: true },
        h('label', { for: idPola }, 'Popraw wartość', h('span', { class: 'visually-hidden' }, ' pola ' + tytulPola(p.pole) + ', ' + p.kodZrodla + ' wiersz ' + p.wiersz)),
        h('div', { class: 'input-row' },
          kontrolkaWartosci(idPola, p, rekord, idKom),
          h('button', { type: 'submit', class: 'btn btn--primary btn--small' }, 'Zapisz', h('span', { class: 'visually-hidden' }, ' (' + p.kodZrodla + ', wiersz ' + p.wiersz + ')'))),
        h('p', { id: idBlad, class: 'field-error', hidden: true })) : null);
  }

  function renderujListe() {
    const kont = $('wal-lista');
    kont.textContent = '';
    const wszystkie = przefiltrowane();
    const stron = Math.max(1, Math.ceil(wszystkie.length / NA_STRONE));
    if (stan.strona > stron) stan.strona = stron;
    const od = (stan.strona - 1) * NA_STRONE;
    const strona = wszystkie.slice(od, od + NA_STRONE);
    const aktywneFiltry = Object.keys(stan.filtr).some(function (k) { return stan.filtr[k]; });

    kont.appendChild(h('h2', { id: 'h-wal-lista', tabindex: '-1' }, 'Lista problemów',
      h('span', { class: 'meta' }, ' (' + liczba(wszystkie.length) + (aktywneFiltry ? ' po filtrowaniu' : '') + ')')));
    if (!wszystkie.length) {
      kont.appendChild(h('p', { class: 'empty' }, aktywneFiltry ? 'Brak problemów spełniających filtry.' : 'Brak problemów.'));
      return;
    }
    kont.appendChild(h('p', { class: 'meta' }, 'Pokazano ' + liczba(od + 1) + '–' + liczba(od + strona.length) + ' z ' + liczba(wszystkie.length) + '.'));
    kont.appendChild(h('ol', { class: 'problemy', start: od + 1 }, strona.map(elementProblemu)));
    if (stron > 1) kont.appendChild(paginacja(stron));
  }

  function paginacja(stron) {
    const idz = function (n) {
      return function () {
        stan.strona = n; renderujListe();
        $('h-wal-lista').focus();
        oglos('Strona ' + n + ' z ' + stron + '.');
      };
    };
    return h('nav', { class: 'paginacja', 'aria-label': 'Strony listy problemów' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: stan.strona <= 1, onclick: idz(stan.strona - 1) }, '‹ Poprzednia'),
      h('span', { class: 'paginacja__info' }, 'Strona ' + stan.strona + ' z ' + stron),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: stan.strona >= stron, onclick: idz(stan.strona + 1) }, 'Następna ›'));
  }

  function renderujNaprawy() {
    const kont = $('wal-naprawy');
    kont.textContent = '';
    const tabela = h('table', null,
      h('caption', null, 'Automatyczne naprawy według rodzaju'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Co zrobiliśmy'), h('th', { scope: 'col' }, 'Pole'),
        h('th', { scope: 'col', class: 'num' }, 'Rekordy'), h('th', { scope: 'col' }, 'Przykład'))),
      h('tbody', null, stan.naprawy.map(function (g) {
        return h('tr', null, h('th', { scope: 'row' }, g.opis), h('td', null, g.pole ? tytulPola(g.pole) : '—'),
          h('td', { class: 'num' }, liczba(g.rekordy)),
          h('td', { class: 'przyklad-zmiany' }, g.przyklad && (g.przyklad.z !== undefined || g.przyklad.na !== undefined)
            ? '„' + pokazWartosc(g.przyklad.z) + '” → „' + pokazWartosc(g.przyklad.na) + '”' : '—'));
      })));
    kont.appendChild(h('details', { class: 'wal-naprawy' },
      h('summary', null, 'Co poprawiliśmy automatycznie (' + liczba(stan.licznikNapraw) + ' ' +
        odmiana(stan.licznikNapraw, 'rekord', 'rekordy', 'rekordów') + ', ' + stan.naprawy.length + ' ' +
        odmiana(stan.naprawy.length, 'rodzaj', 'rodzaje', 'rodzajów') + ' napraw)'),
      stan.naprawy.length ? [h('p', null, 'Te zmiany wprowadziliśmy bez pytania, bo nie zmieniają znaczenia danych. ' +
        'Pierwotne wartości zostają w źródle.'), tabelaPrzewijana('Automatyczne naprawy', tabela)]
        : h('p', { class: 'empty' }, 'Nie było potrzeby niczego poprawiać.')));
  }

  function renderujDalej() {
    const kont = $('wal-ostrzezenie-dalej');
    const s = podsumuj();
    const btn = $('dalej-wynik');
    if (stan.gotowe && s.rekordyZBledami) {
      kont.hidden = false;
      kont.textContent = liczba(s.rekordyZBledami) + ' ' + odmiana(s.rekordyZBledami, 'rekord ma', 'rekordy mają', 'rekordów ma') +
        ' błędy. Możesz przejść dalej, ale rekordy z błędami zostaną oznaczone w wyniku i mogą nie spełniać wzorca. ' +
        'Zalecamy najpierw je poprawić.';
      btn.setAttribute('aria-describedby', 'wal-ostrzezenie-dalej');
    } else {
      kont.hidden = true;
      btn.removeAttribute('aria-describedby');
    }
  }

  function renderujWszystko() {
    const gotowe = stan.gotowe && !!W();
    $('wal-tresc').hidden = !gotowe;
    $('wal-brak').hidden = gotowe;
    $('wal-nieaktualne').hidden = !(gotowe && stan.nieaktualne);
    if (!gotowe) {
      const brak = $('wal-brak');
      brak.textContent = '';
      brak.appendChild(h('p', null, !W() ? 'Nie wczytano modułu walidacji (js/core/walidacja.js).'
        : 'Nie ma jeszcze rekordów do sprawdzenia. ', W() ? h('a', { href: '#mapowanie' }, 'Przejdź do kroku 2 i zatwierdź mapowanie kolumn') : null, W() ? '.' : null));
      renderujDalej();
      return;
    }
    renderujPodsumowanie();
    renderujZbiorcze();
    renderujFiltry();
    renderujListe();
    renderujNaprawy();
    renderujPoprawki();
    if (AED.ui.duplikaty) AED.ui.duplikaty.renderuj();
    renderujDalej();
  }

  function zaplanujRender() {
    if (stan.zaplanowane) return;
    stan.zaplanowane = true;
    Promise.resolve().then(function () { stan.zaplanowane = false; if (AED.router.trasa === 'walidacja') renderujWszystko(); });
  }

  async function przeliczTeraz() {
    const btn = $('wal-przelicz');
    btn.setAttribute('aria-disabled', 'true'); btn.classList.add('is-busy');
    oglos('Przeliczanie rekordów…');
    await new Promise(function (ok) { setTimeout(ok, 30); });
    try {
      if (AED.ui.mapowanie && store.zrodla.some(function (z) { AED.ui.mapowanie.zapewnijMapowanie(z); return AED.ui.mapowanie.brakujaceKrytyczne(store.zrodlo(z.id)).length; })) {
        AED.router.idz('mapowanie');
        return;
      }
      await uruchom();
      renderujWszystko();
      $('h-walidacja').focus();
      const s = podsumuj();
      oglos('Przeliczono. ' + liczba(s.bledy) + ' ' + odmiana(s.bledy, 'błąd', 'błędy', 'błędów') + ', ' +
        liczba(s.ostrzezenia) + ' ' + odmiana(s.ostrzezenia, 'ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń') + '.');
    } finally {
      btn.removeAttribute('aria-disabled'); btn.classList.remove('is-busy');
    }
  }

  function init() {
    AED.on('trasa', function (e) {
      if (e.trasa !== 'walidacja') return;
      // wejście bez zatwierdzania kroku 2 (np. z paska kroków) – przeliczamy, jeśli mapowanie jest kompletne
      if (!stan.gotowe && W() && store.zrodla.length && AED.mapowanie && AED.ui.mapowanie) {
        const kompletne = store.zrodla.every(function (z) {
          AED.ui.mapowanie.zapewnijMapowanie(z);
          return !AED.ui.mapowanie.brakujaceKrytyczne(store.zrodlo(z.id)).length;
        });
        if (kompletne) {
          uruchom().then(renderujWszystko).catch(function (err) { console.error(err); renderujWszystko(); });
          return;
        }
      }
      renderujWszystko();
    });
    AED.on('zrodla:zmiana', function (e) {
      if (stan.wTrakcie) return;
      if (stan.gotowe) stan.nieaktualne = podpis() !== stan.podpis;
      if (e.akcja === 'usunieto' && !store.zrodla.length) stan.gotowe = false;
    });
    AED.on('rekordy:zmiana', function (e) {
      if (stan.wTrakcie) return;
      if (e && e.akcja === 'zmieniono' && e.rekord) { stan.zdarzenie = true; poZmianieRekordu(e.rekord, e.pola); }
      else if (W()) pelnaWalidacja();
      if (!stan.wlasnaAkcja) zaplanujRender();
    });
    $('wal-przelicz').addEventListener('click', function () {
      if ($('wal-przelicz').getAttribute('aria-disabled') !== 'true') przeliczTeraz();
    });
  }

  AED.ui = AED.ui || {};
  AED.ui.wartosci = { parsuj: parsuj, pokaz: pokazWartosc };
  AED.ui.walidacja = { init: init, uruchom: uruchom, get stan() { return stan; } };
})(window.AED);
