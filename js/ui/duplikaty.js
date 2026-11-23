/* Krok 3 (część 4): duplikaty i punkty odstające.
   Wyszukiwanie i scalanie są w js/core/duplikaty.js (AED.duplikaty), wynik i decyzje w AED.store
   (znajdzDuplikaty, duplikaty, decyzje, ustawDecyzje). Tu: ustawienia wyszukiwania, podsumowanie,
   lista grup z tabelą porównawczą i decyzjami, lista punktów odstających z poprawką współrzędnych.
   Dane z rekordów są niezaufane – trafiają do DOM wyłącznie przez h() (textContent / atrybuty). */
(function (AED) {
  'use strict';
  const { h, odznaka, oglos, liczba, odmiana, tabelaPrzewijana } = AED.dom;
  const store = AED.store;

  const POLA = AED.wzorzec.schema.fields;
  const POLE = {};
  POLA.forEach(function (p) { POLE[p.name] = p; });
  const NA_STRONE = 10;
  const NA_STRONE_ODST = 20;
  const PROMIENIE = [10, 30, 50, 100];
  const DUZO = 5000; // od tylu rekordów pokazujemy komunikat o czasie wyszukiwania

  const PEWNOSC = {
    wysoka: { tekst: 'Pewność wysoka', rodzaj: 'ok' },
    srednia: { tekst: 'Pewność średnia', rodzaj: 'warn' },
    niska: { tekst: 'Pewność niska', rodzaj: 'info' }
  };
  const ODSTAJACY = {
    DALEKO_OD_ZBIORU: 'Daleko od reszty zbioru',
    DALEKO_OD_MIEJSCOWOSCI: 'Daleko od swojej miejscowości',
    POZA_WOJEWODZTWEM: 'Poza wskazanym województwem',
    TE_SAME_WSPOLRZEDNE: 'Te same współrzędne co inny rekord'
  };

  const st = {
    promien: 30,
    strona: 1,
    filtr: { pewnosc: '', stan: '' },
    wTrakcie: false,
    nieaktualne: false,
    wlasna: false,          // własna zmiana decyzji – bez ponownego rysowania przy zdarzeniu
    szkic: {},              // grupaId -> { glowny, wartosci } wybrane, zanim zapadnie decyzja
    poprawne: new Set(),    // odstające oznaczone „To poprawne”
    poprawioneWsp: new Map(), // rekordId -> {szer, dl} zapisane w tym kroku
    edycja: null,           // rekordId odstającego z otwartym formularzem
    stronaOdst: 1,
    blad: null,
    mapy: new Set()         // otwarte mapy: 'g:' + id grupy albo 'o:' + rekordId odstającego
  };
  const aktywneMapy = { g: [], o: [] }; // obiekty map do zniszczenia przy ponownym rysowaniu listy

  // ------------------------------------------------------------ mapa w kroku 3 (dodatek – dane są też w tabelach)
  function zniszczMapy(rodzaj) { aktywneMapy[rodzaj].forEach(function (m) { m.zniszcz(); }); aktywneMapy[rodzaj] = []; }

  /** Przycisk „Pokaż na mapie” (aria-expanded) – przełącza mapę pod elementem listy. */
  function przyciskMapy(klucz, opis, przerysuj, idFokus) {
    if (!AED.ui.mapa) return null;
    const otwarta = st.mapy.has(klucz);
    return h('button', { type: 'button', class: 'btn btn--ghost btn--small', id: idFokus, 'aria-expanded': otwarta ? 'true' : 'false',
      onclick: function () {
        if (otwarta) st.mapy.delete(klucz); else st.mapy.add(klucz);
        przerysuj();
        const b = document.getElementById(idFokus); if (b) b.focus();
        oglos(otwarta ? 'Ukryto mapę.' : 'Pokazano mapę pod listą rekordów. Opis punktów jest też w tekście pod mapą.');
      } }, otwarta ? 'Ukryj mapę' : 'Pokaż na mapie', h('span', { class: 'visually-hidden' }, ' – ' + opis));
  }

  /** Mapa z numerowanymi punktami. punkty: [{wsp, etykieta, rekord}]; o.przeciagany: fn(lat, lon) dla pierwszego punktu. */
  function mapaPunktow(rodzaj, etykieta, punkty, o) {
    o = o || {};
    const M = AED.ui.mapa;
    const m = M.utworz({ etykieta: etykieta, klasa: 'mapa__okno--mala',
      opisDodatkowy: o.przeciagany ? 'Punkt możesz przeciągnąć myszą – współrzędne wpiszą się w pola formularza. Możesz też wpisać je ręcznie.' : '' });
    aktywneMapy[rodzaj].push(m);
    const wsp = punkty.map(function (p) { return p.wsp; }).filter(Boolean);
    if (m.mapa) {
      punkty.forEach(function (p, i) {
        if (!p.wsp) return;
        const mk = L.marker(p.wsp, {
          keyboard: true, draggable: !!(o.przeciagany && i === 0), title: p.etykieta,
          alt: p.etykieta,
          icon: L.divIcon({ className: 'mapa-numer', html: '<span>' + (i + 1) + '</span>', iconSize: [28, 28] })
        }).addTo(m.mapa);
        mk.bindPopup(function () { return M.opisPunktu(p.rekord); });
        if (o.przeciagany && i === 0) mk.on('dragend', function () { const ll = mk.getLatLng(); o.przeciagany(ll.lat, ll.lng); });
      });
      setTimeout(function () { m.odswiez(); m.dopasuj(wsp, 17); }, 0);
    }
    const lista = h('ol', { class: 'mapa-punkty' }, punkty.map(function (p) {
      return h('li', null, p.etykieta, ': ', p.wsp ? p.wsp[0] + ', ' + p.wsp[1] : 'brak poprawnych współrzędnych – punktu nie ma na mapie');
    }));
    return h('div', { class: 'mapa-wstawka' }, m.element, h('p', { class: 'meta' }, 'Numery na mapie:'), lista);
  }

  function $(id) { return document.getElementById(id); }
  function dostepne() { return !!(AED.duplikaty && store.znajdzDuplikaty); }
  function wynik() { return (dostepne() && store.duplikaty) || null; }
  function decyzje() { return store.decyzje || {}; }
  function rekord(id) { return store.rekord ? store.rekord(id) : (store.rekordy || []).find(function (r) { return r._id === id; }) || null; }
  function pokaz(v) { return AED.ui.wartosci ? AED.ui.wartosci.pokaz(v) : (v === null || v === undefined || v === '' ? '— (puste)' : String(v)); }
  function tytulPola(p) {
    if (POLE[p]) return POLE[p].title;
    return p === POLE_WSP() ? 'Współrzędne (szerokość, długość)' : p;
  }
  // pseudo-pole konfliktu: szerokość i długość wybierane razem
  function POLE_WSP() { return (AED.duplikaty && AED.duplikaty.POLE_WSPOLRZEDNE) || 'wspolrzedne'; }
  function pusta(v) { return v === null || v === undefined || v === ''; }
  function rowne(a, b) { return JSON.stringify(pusta(a) ? null : a) === JSON.stringify(pusta(b) ? null : b); }
  function metry(m) {
    if (typeof m !== 'number' || !isFinite(m)) return '—';
    if (m >= 1000) return (Math.round(m / 100) / 10).toString().replace('.', ',') + ' km';
    return (m < 10 ? m.toFixed(1).replace('.', ',') : liczba(Math.round(m))) + ' m';
  }
  function opisRekordu(r, id) { return r ? r._kodZrodla + ', wiersz ' + r._wiersz : String(id); }
  function grupy() { const w = wynik(); return (w && w.grupy) || []; }
  function w0() { return wynik() || {}; }

  /** Stan grupy: decyzja użytkownika albo to, co stanie się bez niej. */
  function stanGrupy(g, D) {
    const d = D[g.id];
    if (d && d.status === 'scal') return 'scal';
    if (d && d.status === 'rozdziel') return 'rozdziel';
    return g.pewnosc === 'wysoka' ? 'auto-scal' : 'auto-rozdziel';
  }
  const OPIS_STANU = {
    'scal': ['ok', 'Decyzja: scalić w jeden rekord'],
    'rozdziel': ['info', 'Decyzja: to różne urządzenia'],
    'auto-scal': ['warn', 'Bez decyzji – scalimy automatycznie, jeśli nie zdecydujesz inaczej'],
    'auto-rozdziel': ['warn', 'Bez decyzji – rekordy zostaną osobno']
  };

  function wybory(g) {
    const d = decyzje()[g.id];
    const s = st.szkic[g.id] || {};
    const wartosci = {};
    (g.konflikty || []).forEach(function (k) {
      wartosci[k.pole] = (s.wartosci && s.wartosci[k.pole]) || (d && d.wartosci && d.wartosci[k.pole]) || k.proponowana || null;
    });
    return { glowny: s.glowny || (d && d.glowny) || g.glowny, wartosci: wartosci };
  }
  /** Decyzja „scal” z tym, co użytkownik wybrał ręcznie; reszta według reguły automatycznej (najnowsza weryfikacja, priorytet źródła). */
  function decyzjaScal(g) {
    const d = decyzje()[g.id];
    const s = st.szkic[g.id] || {};
    const out = { status: 'scal' };
    const gl = s.glowny || (d && d.glowny);
    if (gl) out.glowny = gl;
    const w = Object.assign({}, (d && d.wartosci) || {}, s.wartosci || {});
    if (Object.keys(w).length) out.wartosci = w;
    return out;
  }
  /** Punkt odstający uznany za poprawny (stan w magazynie; zapas: stan interfejsu). */
  function zaakceptowany(o) { return store.ustawOdstajacyOk ? !!o.zaakceptowany : st.poprawne.has(o.rekordId); }
  function ustawPoprawny(o, ok) {
    if (store.ustawOdstajacyOk) {
      st.wlasna = true;
      try { store.ustawOdstajacyOk(o.rekordId, ok); } finally { st.wlasna = false; }
    } else if (ok) st.poprawne.add(o.rekordId); else st.poprawne.delete(o.rekordId);
  }

  // ------------------------------------------------------------ wyszukiwanie
  async function szukaj() {
    if (st.wTrakcie || !dostepne()) return;
    st.wTrakcie = true;
    st.blad = null;
    const n = store.liczbaRekordowWynik !== undefined ? store.liczbaRekordowWynik : (store.rekordy || []).length;
    const btn = $('dup-szukaj');
    const stanEl = $('dup-stan');
    btn.setAttribute('aria-disabled', 'true'); btn.classList.add('is-busy');
    const pasek = $('dup-postep');
    const tekst = $('dup-stan-tekst');
    stanEl.hidden = false;
    tekst.textContent = 'Szukam duplikatów w ' + liczba(n) + ' ' + odmiana(n, 'rekordzie', 'rekordach', 'rekordach') + '…' +
      (n >= DUZO ? ' Przy tak dużym zbiorze może to potrwać kilkanaście sekund. Nie zamykaj strony.' : '');
    pasek.value = 0;
    oglos(tekst.textContent);
    await new Promise(function (ok) { setTimeout(ok, 40); }); // pozwala przeglądarce pokazać komunikat
    try {
      const opcje = {
        promienM: st.promien,
        postep: function (ulamek) {
          const proc = Math.round(Math.max(0, Math.min(1, ulamek)) * 100);
          pasek.value = proc;
          pasek.setAttribute('aria-valuetext', proc + '%');
        }
      };
      // wersja asynchroniczna oddaje sterowanie przeglądarce – pasek postępu się odświeża
      await (store.znajdzDuplikatyAsync ? store.znajdzDuplikatyAsync(opcje) : Promise.resolve(store.znajdzDuplikaty(opcje)));
      st.strona = 1; st.stronaOdst = 1; st.szkic = {}; st.nieaktualne = false;
      st.poprawioneWsp = new Map(); st.edycja = null;
    } catch (e) {
      console.error(e);
      st.blad = 'Nie udało się wyszukać duplikatów: ' + (e && e.message ? e.message : e);
    } finally {
      st.wTrakcie = false;
    }
    renderuj();
    const nagl = $('h-dup-wynik') || $('h-wal-duplikaty');
    if (nagl) nagl.focus();
    if (st.blad) { oglos(st.blad, true); return; }
    const w = wynik();
    const gr = (w && w.grupy) || [], od = (w && w.odstajace) || [];
    oglos('Znaleziono ' + liczba(gr.length) + ' ' + odmiana(gr.length, 'grupę', 'grupy', 'grup') + ' możliwych duplikatów i ' +
      liczba(od.length) + ' ' + odmiana(od.length, 'punkt odstający', 'punkty odstające', 'punktów odstających') + '.');
  }

  // ------------------------------------------------------------ decyzje
  function zapiszDecyzje(id, d) {
    st.wlasna = true;
    try { store.ustawDecyzje(id, d); } finally { st.wlasna = false; }
  }

  function przefiltrowane() {
    const D = decyzje();
    const f = st.filtr;
    return grupy().map(function (g, i) { return { g: g, nr: i + 1 }; }).filter(function (x) {
      if (f.pewnosc && x.g.pewnosc !== f.pewnosc) return false;
      if (f.stan) {
        const s = stanGrupy(x.g, D);
        if (f.stan === 'bez' && (s === 'scal' || s === 'rozdziel')) return false;
        if (f.stan !== 'bez' && s !== f.stan) return false;
      }
      return true;
    });
  }

  /** Decyzja dla grupy, potem fokus na następną grupę (WCAG 2.4.3) i komunikat. */
  function zdecyduj(g, nr, d, tekst) {
    const przed = przefiltrowane().map(function (x) { return x.g.id; });
    const poz = przed.indexOf(g.id);
    const nastepna = poz >= 0 ? przed[poz + 1] : null;
    zapiszDecyzje(g.id, d);
    if (d === null) delete st.szkic[g.id];
    const po = przefiltrowane().map(function (x) { return x.g.id; });
    let cel = nastepna && po.indexOf(nastepna) >= 0 ? nastepna : null;
    if (d === null) cel = g.id; // cofnięcie decyzji – zostajemy przy tej grupie
    if (cel) st.strona = Math.floor(po.indexOf(cel) / NA_STRONE) + 1;
    renderuj();
    const el = cel ? $('dup-h-' + domId(cel)) : null;
    if (el) {
      el.focus();
      oglos(tekst + (cel !== g.id ? ' Następna: grupa ' + (grupy().findIndex(function (x) { return x.id === cel; }) + 1) + '.' : ''));
    } else {
      const n = $('h-dup-lista') || $('h-dup-wynik');
      if (n) n.focus();
      oglos(tekst + ' To była ostatnia grupa na liście.');
    }
  }

  function zatwierdzWysokie() {
    const D = decyzje();
    const doZrobienia = grupy().filter(function (g) { return g.pewnosc === 'wysoka' && !D[g.id]; });
    const mapa = {};
    doZrobienia.forEach(function (g) { mapa[g.id] = decyzjaScal(g); });
    st.wlasna = true;
    try {
      if (store.ustawDecyzjeWiele) store.ustawDecyzjeWiele(mapa);   // jedno zdarzenie zamiast setek
      else Object.keys(mapa).forEach(function (id) { store.ustawDecyzje(id, mapa[id]); });
    } finally { st.wlasna = false; }
    renderuj();
    const n = $('h-dup-wynik'); if (n) n.focus();
    oglos('Zatwierdzono scalenie ' + liczba(doZrobienia.length) + ' ' + odmiana(doZrobienia.length, 'grupy', 'grup', 'grup') + ' o wysokiej pewności.');
  }

  // identyfikatory grup mogą zawierać dowolne znaki – w DOM używamy numerów
  const ID_DOM = new Map();
  function domId(grupaId) {
    if (!ID_DOM.has(grupaId)) ID_DOM.set(grupaId, 'g' + (ID_DOM.size + 1));
    return ID_DOM.get(grupaId);
  }

  // ------------------------------------------------------------ renderowanie: narzędzia i podsumowanie
  function narzedzia() {
    const w = wynik();
    return h('form', { class: 'dup-narzedzia', 'aria-label': 'Wyszukiwanie duplikatów', novalidate: true,
      onsubmit: function (e) { e.preventDefault(); if ($('dup-szukaj').getAttribute('aria-disabled') !== 'true') szukaj(); } },
      h('div', { class: 'field' },
        h('label', { for: 'dup-promien' }, 'Szukaj punktów odległych o mniej niż'),
        h('select', { id: 'dup-promien', 'aria-describedby': 'dup-promien-pomoc', onchange: function (e) { st.promien = Number(e.target.value); } },
          PROMIENIE.map(function (m) { return h('option', { value: m, selected: m === st.promien }, m + ' m'); })),
        h('p', { class: 'hint', id: 'dup-promien-pomoc' }, 'Większa odległość znajdzie więcej par, ale też więcej różnych urządzeń stojących obok siebie. Zalecamy 30 m.')),
      h('div', { class: 'dup-narzedzia__akcje' },
        h('button', { type: 'submit', class: 'btn btn--primary', id: 'dup-szukaj' }, w ? 'Szukaj ponownie' : 'Szukaj duplikatów')),
      h('div', { class: 'dup-stan', id: 'dup-stan', hidden: true },
        h('p', { class: 'remote-status', id: 'dup-stan-tekst' }),
        h('progress', { id: 'dup-postep', max: 100, value: 0, 'aria-labelledby': 'dup-stan-tekst' })));
  }

  function statystyka(n, opis, klasa) {
    return h('li', { class: 'stat' + (klasa ? ' ' + klasa : '') }, h('span', { class: 'stat__liczba' }, liczba(n)), h('span', { class: 'stat__opis' }, opis));
  }

  function podsumowanie(kont) {
    const gr = grupy();
    const D = decyzje();
    const wg = { wysoka: 0, srednia: 0, niska: 0 };
    let zdecydowane = 0, wysokieBez = 0;
    gr.forEach(function (g) {
      wg[g.pewnosc] = (wg[g.pewnosc] || 0) + 1;
      if (D[g.id]) zdecydowane++; else if (g.pewnosc === 'wysoka') wysokieBez++;
    });
    kont.appendChild(h('h3', { id: 'h-dup-wynik', tabindex: '-1' }, 'Wynik wyszukiwania'));
    if (!gr.length) {
      kont.appendChild(h('p', { class: 'alert alert--ok' }, 'Nie znaleziono możliwych duplikatów przy odległości ' + st.promien + ' m.'));
      return;
    }
    kont.appendChild(h('ul', { class: 'stat-row', 'aria-label': 'Grupy możliwych duplikatów według pewności' },
      statystyka(gr.length, odmiana(gr.length, 'grupa', 'grupy', 'grup') + ' razem'),
      statystyka(wg.wysoka, 'pewność wysoka', 'stat--ok'),
      statystyka(wg.srednia, 'pewność średnia', 'stat--warn'),
      statystyka(wg.niska, 'pewność niska'),
      statystyka(zdecydowane, 'z decyzją (z ' + liczba(gr.length) + ')')));
    // decyzje z poprzedniego wyszukiwania, których grupy już nie ma (magazyn: lista; zapas: liczba w podsumowaniu)
    const nd = store.decyzjeNiedopasowane !== undefined ? store.decyzjeNiedopasowane : (w0().podsumowanie && w0().podsumowanie.decyzjeNiedopasowane);
    const niedop = Array.isArray(nd) ? nd.length : (Number(nd) || 0);
    if (niedop > 0) {
      kont.appendChild(h('p', { class: 'alert alert--warn' }, liczba(niedop) + ' ' +
        odmiana(niedop, 'Twoja wcześniejsza decyzja nie pasuje', 'Twoje wcześniejsze decyzje nie pasują', 'Twoich wcześniejszych decyzji nie pasuje') +
        ' do nowych grup (zmieniły się rekordy lub współrzędne). Przejrzyj grupy bez decyzji.'));
    }
    kont.appendChild(h('p', null, 'Grupy o wysokiej pewności scalimy automatycznie, jeśli nie zdecydujesz inaczej. ' +
      'Grupy o średniej i niskiej pewności bez Twojej decyzji zostaną jako osobne rekordy.'));
    if (wysokieBez) {
      kont.appendChild(h('div', { class: 'alert-actions dup-zbiorcze' },
        h('button', { type: 'button', class: 'btn btn--secondary', id: 'dup-zatwierdz-wysokie', onclick: zatwierdzWysokie },
          'Zatwierdź wszystkie propozycje o wysokiej pewności (' + liczba(wysokieBez) + ')')));
    }
  }

  function filtry(kont) {
    const zmien = function (nazwa) {
      return function (e) {
        st.filtr[nazwa] = e.target.value; st.strona = 1;
        renderujListe();
        const n = przefiltrowane().length;
        oglos('Pokazano ' + liczba(n) + ' ' + odmiana(n, 'grupę', 'grupy', 'grup') + '.');
      };
    };
    const opcja = function (v, t, wybr) { return h('option', { value: v, selected: v === wybr }, t); };
    kont.appendChild(h('form', { class: 'wal-filtry', 'aria-label': 'Filtry listy duplikatów', onsubmit: function (e) { e.preventDefault(); } },
      h('div', { class: 'field' }, h('label', { for: 'dup-f-pewnosc' }, 'Pewność'),
        h('select', { id: 'dup-f-pewnosc', onchange: zmien('pewnosc') },
          opcja('', 'Wszystkie', st.filtr.pewnosc), opcja('wysoka', 'Wysoka', st.filtr.pewnosc),
          opcja('srednia', 'Średnia', st.filtr.pewnosc), opcja('niska', 'Niska', st.filtr.pewnosc))),
      h('div', { class: 'field' }, h('label', { for: 'dup-f-stan' }, 'Decyzja'),
        h('select', { id: 'dup-f-stan', onchange: zmien('stan') },
          opcja('', 'Wszystkie', st.filtr.stan), opcja('bez', 'Bez decyzji', st.filtr.stan),
          opcja('scal', 'Do scalenia', st.filtr.stan), opcja('rozdziel', 'Różne urządzenia', st.filtr.stan)))));
  }

  // ------------------------------------------------------------ renderowanie: grupa
  // podpis kolumny pokazywany przy wartości na wąskim ekranie (tabela układa się wtedy w karty)
  function kolumna(r) { return r ? r._kodZrodla + ', wiersz ' + r._wiersz : ''; }

  function tabelaGrupy(g, nr, rek, w) {
    const gid = domId(g.id);
    const konflikt = {};
    (g.konflikty || []).forEach(function (k) { konflikt[k.pole] = k; });
    const rozne = [], zgodne = [];
    // konflikty pól spoza wzorca (np. współrzędne wybierane razem) – na początku tabeli
    (g.konflikty || []).forEach(function (k) { if (!POLE[k.pole]) rozne.push(k.pole); });
    POLA.forEach(function (p) {
      const wart = rek.map(function (r) { return r ? r[p.name] : null; });
      if (wart.every(pusta) && !konflikt[p.name]) return;
      const roznica = !!konflikt[p.name] || wart.some(function (v) { return !rowne(v, wart[0]); });
      (roznica ? rozne : zgodne).push(p.name);
    });

    const naglowki = h('tr', null, h('th', { scope: 'col' }, 'Pole'), rek.map(function (r, i) {
      const id = g.rekordy[i];
      const z = r && store.zrodlo ? store.zrodlo(r._zrodlo) : null;
      const idR = 'dup-' + gid + '-gl-' + i;
      return h('th', { scope: 'col', class: 'dup-kol' },
        h('span', { class: 'dup-kol__zrodlo' }, h('code', null, r ? r._kodZrodla : '?'), ', wiersz ' + (r ? r._wiersz : '—')),
        z ? h('span', { class: 'meta cell-note' }, z.nazwa) : null,
        h('span', { class: 'radio dup-glowny' },
          h('input', { type: 'radio', name: 'dup-' + gid + '-gl', id: idR, value: id, checked: w.glowny === id,
            onchange: function () { zmienWybor(g, 'glowny', id); } }),
          h('label', { for: idR }, 'Rekord główny', h('span', { class: 'visually-hidden' }, ' – ' + opisRekordu(r, id)))));
    }));

    const wiersz = function (pole, zRoznica) {
      const k = konflikt[pole];
      return h('tr', { class: zRoznica ? 'is-rozne' : null },
        h('th', { scope: 'row' }, tytulPola(pole),
          zRoznica ? h('span', { class: 'dup-roznica' }, h('span', { 'aria-hidden': 'true' }, '≠ '), 'różne wartości') : null),
        rek.map(function (r, i) {
          let v = r ? r[pole] : null;
          if (k && !POLE[pole]) {
            const x = k.wartosci.find(function (y) { return y.rekordId === g.rekordy[i]; });
            v = x ? x.wartosc : null;
          }
          if (k) {
            const ma = k.wartosci.some(function (x) { return x.rekordId === g.rekordy[i]; });
            if (ma) {
              const idK = 'dup-' + gid + '-k-' + pole + '-' + i;
              return h('td', { class: 'dup-wartosc', 'data-kol': kolumna(r) }, h('span', { class: 'radio dup-wybor' },
                h('input', { type: 'radio', name: 'dup-' + gid + '-k-' + pole, id: idK, value: g.rekordy[i],
                  checked: w.wartosci[pole] === g.rekordy[i], onchange: function () { zmienWybor(g, pole, g.rekordy[i]); } }),
                h('label', { for: idK }, h('span', { class: 'visually-hidden' }, 'Użyj wartości z ' + opisRekordu(r, g.rekordy[i]) + ': '), pokaz(v))));
            }
          }
          return h('td', { class: 'dup-wartosc' + (pusta(v) ? ' is-puste' : ''), 'data-kol': kolumna(r) }, pokaz(v));
        }));
    };

    const tabela = h('table', { class: 'dup-tabela' },
      h('caption', null, 'Grupa ' + nr + ': pola z różnymi wartościami',
        (g.konflikty || []).length ? h('span', { class: 'meta cell-note' }, 'Przy polach z wyborem zaznacz wartość, która ma trafić do scalonego rekordu.') : null),
      h('thead', null, naglowki),
      h('tbody', null, rozne.length ? rozne.map(function (p) { return wiersz(p, true); })
        : h('tr', null, h('td', { colspan: rek.length + 1 }, 'Wszystkie wypełnione pola mają te same wartości.'))));

    const out = [tabelaPrzewijana('Porównanie rekordów, grupa ' + nr, tabela)];
    if (zgodne.length) {
      const t2 = h('table', { class: 'dup-tabela' },
        h('caption', { class: 'visually-hidden' }, 'Grupa ' + nr + ': pola z tymi samymi wartościami'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Pole'), h('th', { scope: 'col' }, 'Wartość (taka sama we wszystkich rekordach)'))),
        h('tbody', null, zgodne.map(function (p) { return h('tr', null, h('th', { scope: 'row' }, tytulPola(p)), h('td', null, pokaz(rek[0] ? rek[0][p] : null))); })));
      out.push(h('details', { class: 'wal-naprawy' }, h('summary', null, 'Pola z tymi samymi wartościami (' + zgodne.length + ')'),
        tabelaPrzewijana('Pola zgodne, grupa ' + nr, t2)));
    }
    return out;
  }

  function zmienWybor(g, co, rekordId) {
    const s = st.szkic[g.id] = st.szkic[g.id] || {};
    if (co === 'glowny') s.glowny = rekordId;
    else { s.wartosci = s.wartosci || {}; s.wartosci[co] = rekordId; }
    const d = decyzje()[g.id];
    if (d && d.status === 'scal') {
      zapiszDecyzje(g.id, decyzjaScal(g));
      oglos('Zapisano wybór w decyzji o scaleniu.');
    }
  }

  function elementGrupy(x) {
    const g = x.g, nr = x.nr;
    const gid = domId(g.id);
    const D = decyzje();
    const s = stanGrupy(g, D);
    const rek = g.rekordy.map(rekord);
    const w = wybory(g);
    const p = PEWNOSC[g.pewnosc] || PEWNOSC.niska;
    const opisStanu = OPIS_STANU[s];
    const idStan = 'dup-' + gid + '-stan';
    const tekst = 'grupa ' + nr;
    const kluczMapy = 'g:' + g.id;
    return h('li', { class: 'grupa grupa--' + g.pewnosc + (D[g.id] ? ' is-zdecydowana' : '') },
      h('h4', { class: 'grupa__tytul', tabindex: '-1', id: 'dup-h-' + gid },
        'Grupa ' + nr + ': ' + liczba(g.rekordy.length) + ' ' + odmiana(g.rekordy.length, 'rekord', 'rekordy', 'rekordów') +
        ', odległość ' + metry(g.odlegloscM), ' ', odznaka(p.rodzaj, p.tekst)),
      h('p', { id: idStan, class: 'grupa__stan' }, odznaka(opisStanu[0], opisStanu[1])),
      (g.powody || []).length ? h('div', { class: 'grupa__powody' }, h('p', { class: 'meta' }, 'Dlaczego to może być to samo urządzenie:'),
        h('ul', null, g.powody.map(function (t) { return h('li', null, t); }))) : null,
      tabelaGrupy(g, nr, rek, w),
      h('div', { class: 'cell-actions grupa__akcje' },
        s !== 'scal' ? h('button', { type: 'button', class: 'btn btn--primary btn--small', 'aria-describedby': idStan,
          onclick: function () {
            zdecyduj(g, nr, decyzjaScal(g), 'Grupa ' + nr + ': zdecydowano scalić.');
          } }, 'Scal', h('span', { class: 'visually-hidden' }, ' – ' + tekst)) : null,
        s !== 'rozdziel' ? h('button', { type: 'button', class: 'btn btn--secondary btn--small', 'aria-describedby': idStan,
          onclick: function () { zdecyduj(g, nr, { status: 'rozdziel' }, 'Grupa ' + nr + ': oznaczono jako różne urządzenia.'); } },
          'To różne urządzenia', h('span', { class: 'visually-hidden' }, ' – ' + tekst)) : null,
        D[g.id] ? h('button', { type: 'button', class: 'btn btn--ghost btn--small',
          onclick: function () { zdecyduj(g, nr, null, 'Grupa ' + nr + ': cofnięto decyzję.'); } },
          'Cofnij decyzję', h('span', { class: 'visually-hidden' }, ' – ' + tekst)) : null,
        przyciskMapy(kluczMapy, tekst, renderujListe, 'dup-' + gid + '-mapa')),
      st.mapy.has(kluczMapy) && AED.ui.mapa ? mapaPunktow('g', 'Mapa – ' + tekst, rek.map(function (r, i) {
        return { wsp: AED.ui.mapa.wspolrzedne(r), etykieta: opisRekordu(r, g.rekordy[i]) + (r && r.nazwa ? ' – ' + r.nazwa : ''), rekord: r };
      })) : null);
  }

  function paginacja(stron, aktualna, etykieta, idz) {
    return h('nav', { class: 'paginacja', 'aria-label': etykieta },
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: aktualna <= 1, onclick: function () { idz(aktualna - 1); } }, '‹ Poprzednia'),
      h('span', { class: 'paginacja__info' }, 'Strona ' + aktualna + ' z ' + stron),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: aktualna >= stron, onclick: function () { idz(aktualna + 1); } }, 'Następna ›'));
  }

  function renderujListe() {
    const kont = $('dup-lista');
    if (!kont) return;
    zniszczMapy('g');
    kont.textContent = '';
    const wszystkie = przefiltrowane();
    const stron = Math.max(1, Math.ceil(wszystkie.length / NA_STRONE));
    if (st.strona > stron) st.strona = stron;
    const od = (st.strona - 1) * NA_STRONE;
    const strona = wszystkie.slice(od, od + NA_STRONE);
    const filtr = st.filtr.pewnosc || st.filtr.stan;
    kont.appendChild(h('h3', { id: 'h-dup-lista', tabindex: '-1' }, 'Grupy możliwych duplikatów',
      h('span', { class: 'meta' }, ' (' + liczba(wszystkie.length) + (filtr ? ' po filtrowaniu' : '') + ')')));
    if (!wszystkie.length) { kont.appendChild(h('p', { class: 'empty' }, filtr ? 'Brak grup spełniających filtry.' : 'Brak grup.')); return; }
    kont.appendChild(h('p', { class: 'meta' }, 'Pokazano ' + liczba(od + 1) + '–' + liczba(od + strona.length) + ' z ' + liczba(wszystkie.length) + '.'));
    kont.appendChild(h('ol', { class: 'grupy', start: od + 1 }, strona.map(elementGrupy)));
    if (stron > 1) kont.appendChild(paginacja(stron, st.strona, 'Strony listy duplikatów', function (n) {
      st.strona = n; renderujListe(); $('h-dup-lista').focus(); oglos('Strona ' + n + ' z ' + stron + '.');
    }));
  }

  // ------------------------------------------------------------ punkty odstające
  function liczbaWsp(v) { return typeof v === 'number' ? String(v) : (v === null || v === undefined ? '' : String(v)); }

  function zapiszWsp(o, i) {
    const r = rekord(o.rekordId);
    const pSz = $('odst-' + i + '-sz'), pDl = $('odst-' + i + '-dl'), bl = $('odst-' + i + '-blad');
    const parsuj = AED.ui.wartosci ? AED.ui.wartosci.parsuj : function (p, t) { const v = Number(String(t).replace(',', '.')); return isNaN(v) ? { blad: 'Wpisz liczbę.' } : { wartosc: v }; };
    const a = parsuj(POLE.szerokosc_geograficzna, pSz.value);
    const b = parsuj(POLE.dlugosc_geograficzna, pDl.value);
    [pSz, pDl].forEach(function (el) { el.removeAttribute('aria-invalid'); });
    let blad = null, el = null;
    if (a.blad || a.wartosc === null) { blad = 'Szerokość: ' + (a.blad || 'wpisz wartość.'); el = pSz; }
    else if (b.blad || b.wartosc === null) { blad = 'Długość: ' + (b.blad || 'wpisz wartość.'); el = pDl; }
    if (blad) {
      bl.textContent = blad; bl.hidden = false;
      el.setAttribute('aria-invalid', 'true');
      el.focus(); oglos(blad, true);
      return;
    }
    store.aktualizujRekord(o.rekordId, { szerokosc_geograficzna: a.wartosc, dlugosc_geograficzna: b.wartosc });
    st.poprawioneWsp.set(o.rekordId, { sz: a.wartosc, dl: b.wartosc });
    st.edycja = null;
    // walidacja przerysowuje krok po zdarzeniu 'rekordy:zmiana' (w mikrozadaniu) – fokus ustawiamy po niej
    setTimeout(function () {
      renderujOdstajace();
      fokusOdst(i);
      oglos('Zapisano nowe współrzędne dla ' + opisRekordu(r, o.rekordId) + '. Wyszukaj duplikaty ponownie, aby sprawdzić ten punkt.');
    }, 0);
  }

  function fokusOdst(i) {
    const el = document.querySelectorAll('#odst-lista .odst__tytul');
    const cel = el[Math.min(i, el.length - 1)];
    if (cel) cel.focus(); else { const n = $('h-wal-odstajace'); if (n) n.focus(); }
  }

  function elementOdstajacego(o, i) {
    const r = rekord(o.rekordId);
    const id = 'odst-' + i;
    const edycja = st.edycja === o.rekordId;
    return h('li', { class: 'problem odst' },
      h('h3', { class: 'problem__tytul odst__tytul', tabindex: '-1', id: id + '-h' },
        odznaka('warn', ODSTAJACY[o.kod] || o.kod), ' ',
        h('span', null, h('code', null, r ? r._kodZrodla : '?'), ', wiersz ' + (r ? r._wiersz : '—') + (r && r.nazwa ? ' – ' + r.nazwa : ''))),
      h('p', { id: id + '-kom', class: 'problem__komunikat' }, o.komunikat),
      (o.dodatkowe || []).length ? h('ul', { class: 'odst__dodatkowe' }, o.dodatkowe.map(function (x) {
        return h('li', null, h('strong', null, (ODSTAJACY[x.kod] || x.kod) + ': '), x.komunikat);
      })) : null,
      h('p', { class: 'meta' }, 'Współrzędne: ', h('span', { class: 'problem__wartosc' },
        r ? liczbaWsp(r.szerokosc_geograficzna) + ', ' + liczbaWsp(r.dlugosc_geograficzna) : '—'),
        typeof o.odlegloscKm === 'number' && o.kod !== 'TE_SAME_WSPOLRZEDNE' ? ' · odległość: ' + liczba(Math.round(o.odlegloscKm)) + ' km' : null,
        r && r.miejscowosc ? ' · miejscowość: ' + r.miejscowosc : null),
      h('div', { class: 'cell-actions' },
        h('button', { type: 'button', class: 'btn btn--secondary btn--small', 'aria-expanded': edycja ? 'true' : 'false', 'aria-controls': id + '-form',
          onclick: function () {
            st.edycja = edycja ? null : o.rekordId;
            renderujOdstajace();
            const el = edycja ? $(id + '-edytuj') : $(id + '-sz');
            if (el) el.focus();
          }, id: id + '-edytuj' }, 'Popraw współrzędne', h('span', { class: 'visually-hidden' }, ' – ' + opisRekordu(r, o.rekordId))),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', 'aria-describedby': id + '-kom',
          onclick: function () {
            ustawPoprawny(o, true); st.edycja = null;
            renderujOdstajace(); fokusOdst(i);
            oglos('Oznaczono punkt ' + opisRekordu(r, o.rekordId) + ' jako poprawny.');
          } }, 'To poprawne', h('span', { class: 'visually-hidden' }, ' – ' + opisRekordu(r, o.rekordId))),
        przyciskMapy('o:' + o.rekordId, opisRekordu(r, o.rekordId), renderujOdstajace, id + '-mapa')),
      st.mapy.has('o:' + o.rekordId) && AED.ui.mapa ? mapaPunktow('o', 'Mapa – ' + opisRekordu(r, o.rekordId),
        [{ wsp: AED.ui.mapa.wspolrzedne(r), etykieta: opisRekordu(r, o.rekordId) + (r && r.nazwa ? ' – ' + r.nazwa : ''), rekord: r }],
        { przeciagany: edycja ? function (lat, lon) {
          const a = $(id + '-sz'), b = $(id + '-dl');
          if (a && b) { a.value = lat.toFixed(6); b.value = lon.toFixed(6); oglos('Wpisano współrzędne z mapy: ' + a.value + ', ' + b.value + '. Zapisz je przyciskiem „Zapisz współrzędne”.'); }
        } : null }) : null,
      edycja ? h('form', { class: 'problem__edycja odst__form', id: id + '-form', novalidate: true,
        'aria-label': 'Popraw współrzędne – ' + opisRekordu(r, o.rekordId),
        onsubmit: function (e) { e.preventDefault(); zapiszWsp(o, i); },
        onkeydown: function (e) { if (e.key === 'Escape') { st.edycja = null; renderujOdstajace(); const b = $(id + '-edytuj'); if (b) b.focus(); } } },
        h('div', { class: 'odst__pola' },
          h('div', { class: 'field' }, h('label', { for: id + '-sz' }, 'Szerokość geograficzna'),
            h('input', { type: 'text', id: id + '-sz', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
              value: r ? liczbaWsp(r.szerokosc_geograficzna) : '', 'aria-describedby': id + '-pomoc ' + id + '-blad' })),
          h('div', { class: 'field' }, h('label', { for: id + '-dl' }, 'Długość geograficzna'),
            h('input', { type: 'text', id: id + '-dl', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
              value: r ? liczbaWsp(r.dlugosc_geograficzna) : '', 'aria-describedby': id + '-pomoc ' + id + '-blad' }))),
        h('p', { class: 'hint', id: id + '-pomoc' }, 'W Polsce szerokość to ok. 49–55, długość ok. 14–24 (np. 49.6887 i 21.7650).'),
        h('p', { class: 'field-error', id: id + '-blad', hidden: true }),
        h('div', { class: 'cell-actions' },
          h('button', { type: 'submit', class: 'btn btn--primary btn--small' }, 'Zapisz współrzędne'),
          h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: function () {
            st.edycja = null; renderujOdstajace(); const b = $(id + '-edytuj'); if (b) b.focus();
          } }, 'Anuluj'))) : null);
  }

  function renderujOdstajace() {
    const kont = $('wal-odstajace');
    if (!kont) return;
    zniszczMapy('o');
    kont.textContent = '';
    const w = wynik();
    if (!dostepne()) return;
    if (!w) { kont.appendChild(h('p', { class: 'empty' }, 'Lista pojawi się po wyszukaniu duplikatów.')); return; }
    const wszystkie = w.odstajace || [];
    const aktywne = wszystkie.filter(function (o) { return !zaakceptowany(o) && !st.poprawioneWsp.has(o.rekordId); });
    if (!wszystkie.length) { kont.appendChild(h('p', { class: 'alert alert--ok' }, 'Nie znaleziono punktów odstających.')); return; }
    const stron = Math.max(1, Math.ceil(aktywne.length / NA_STRONE_ODST));
    if (st.stronaOdst > stron) st.stronaOdst = stron;
    const od = (st.stronaOdst - 1) * NA_STRONE_ODST;
    const lista = h('div', { id: 'odst-lista' });
    if (aktywne.length) {
      const doSpr = w.podsumowanie && typeof w.podsumowanie.odstajaceDoSprawdzenia === 'number' && !st.poprawioneWsp.size
        ? w.podsumowanie.odstajaceDoSprawdzenia : aktywne.length;
      lista.appendChild(h('p', { class: 'meta' }, liczba(doSpr) + ' ' + odmiana(doSpr, 'punkt do sprawdzenia', 'punkty do sprawdzenia', 'punktów do sprawdzenia') +
        (stron > 1 ? '. Strona ' + st.stronaOdst + ' z ' + stron + '.' : '.')));
      lista.appendChild(h('ul', { class: 'problemy' }, aktywne.slice(od, od + NA_STRONE_ODST).map(function (o, i) { return elementOdstajacego(o, od + i); })));
      if (stron > 1) lista.appendChild(paginacja(stron, st.stronaOdst, 'Strony listy punktów odstających', function (n) {
        st.stronaOdst = n; renderujOdstajace(); $('h-wal-odstajace').focus(); oglos('Strona ' + n + ' z ' + stron + '.');
      }));
    } else {
      lista.appendChild(h('p', { class: 'alert alert--ok' }, 'Wszystkie punkty odstające zostały sprawdzone.'));
    }
    kont.appendChild(lista);

    const zalatwione = wszystkie.filter(function (o) { return zaakceptowany(o) || st.poprawioneWsp.has(o.rekordId); });
    if (zalatwione.length) {
      kont.appendChild(h('details', { class: 'wal-naprawy', open: true },
        h('summary', null, 'Sprawdzone punkty (' + liczba(zalatwione.length) + ')'),
        h('ul', { class: 'odst-sprawdzone' }, zalatwione.map(function (o) {
          const r = rekord(o.rekordId);
          const nowe = st.poprawioneWsp.get(o.rekordId);
          return h('li', null, h('code', null, r ? r._kodZrodla : '?'), ', wiersz ' + (r ? r._wiersz : '—') + ': ',
            nowe ? 'poprawiono współrzędne na ' + nowe.sz + ', ' + nowe.dl + ' (zmianę cofniesz w sekcji „Ręczne poprawki”).'
              : 'oznaczono jako poprawny. ',
            nowe ? null : h('button', { type: 'button', class: 'btn-link', onclick: function () {
              ustawPoprawny(o, false); renderujOdstajace();
              const n = $('h-wal-odstajace'); if (n) n.focus();
              oglos('Przywrócono punkt ' + opisRekordu(r, o.rekordId) + ' na listę do sprawdzenia.');
            } }, 'Przywróć na listę', h('span', { class: 'visually-hidden' }, ' – ' + opisRekordu(r, o.rekordId))));
        }))));
    }
  }

  // ------------------------------------------------------------ całość
  function renderuj() {
    const kont = $('wal-duplikaty');
    if (!kont) return;
    kont.textContent = '';
    if (!dostepne()) {
      kont.appendChild(h('p', { class: 'alert alert--err' }, 'Nie wczytano modułu wyszukiwania duplikatów (js/core/duplikaty.js).'));
      renderujOdstajace();
      return;
    }
    kont.appendChild(narzedzia());
    if (st.blad) kont.appendChild(h('p', { class: 'alert alert--err', role: 'alert' }, st.blad));
    const w = wynik();
    if (w && st.nieaktualne) {
      kont.appendChild(h('p', { class: 'alert alert--warn' }, 'Rekordy zmieniły się od ostatniego wyszukiwania. ' +
        'Wyszukaj duplikaty ponownie, aby lista była aktualna. Podjęte decyzje zostaną zachowane dla tych samych grup.'));
    }
    if (!w) {
      kont.appendChild(h('p', { class: 'empty' }, 'Nie wyszukano jeszcze duplikatów. Wybierz odległość i naciśnij „Szukaj duplikatów”.'));
    } else {
      podsumowanie(kont);
      if (grupy().length) {
        filtry(kont);
        kont.appendChild(h('div', { id: 'dup-lista' }));
        renderujListe();
      }
    }
    renderujOdstajace();
  }

  function init() {
    AED.on('duplikaty:zmiana', function (e) {
      // magazyn sam wyszukuje ponownie po przeliczeniu rekordów – wynik znów jest aktualny
      if (e && e.akcja === 'znaleziono') { st.nieaktualne = false; st.poprawioneWsp = new Map(); }
      if (st.wlasna || st.wTrakcie) return;
      if (AED.router.trasa === 'walidacja') renderuj();
    });
    AED.on('rekordy:zmiana', function (e) {
      if (!wynik()) return;
      if (e && e.akcja === 'zmieniono' && e.pola && !e.pola.some(function (p) { return /geograficzna|nazwa|ulica|numer_budynku|miejscowosc|id_/.test(p); })) return;
      st.nieaktualne = true;
    });
  }

  AED.ui = AED.ui || {};
  AED.ui.duplikaty = { init: init, renderuj: renderuj, szukaj: szukaj, get stan() { return st; } };
})(window.AED);
