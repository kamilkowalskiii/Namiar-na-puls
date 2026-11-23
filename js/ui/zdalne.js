/* Krok 1: źródło zdalne – dane.gov.pl (API portalu).
   Logika pobierania jest w js/sources/dgp.js (AED.zrodla.dgp);
   tu jest tylko interfejs: formularze, stan „w toku”, anulowanie, komunikaty i dodanie do rejestru.
   Dane z API są niezaufane – trafiają do DOM wyłącznie przez h() (textContent / atrybuty). */
(function (AED) {
  'use strict';
  const { h, odznaka, oglos, liczba, odmiana, ikona, linkZewn, data } = AED.dom;
  const store = AED.store;

  const ODSTEP_OGLOSZEN = 4000; // ms – postęp ogłaszamy rzadziej, by nie zagłuszać czytnika

  function modul(nazwa) { return (AED.zrodla && AED.zrodla[nazwa]) || null; }
  function $(id) { return document.getElementById(id); }
  function rekordy(n) { return liczba(n) + ' ' + odmiana(n, 'rekord', 'rekordy', 'rekordów'); }

  /** Źródło już dodane z tego samego zapytania / zasobu (meta.klucz nadaje ten plik). */
  function znajdzPoKluczu(klucz) {
    return store.zrodla.find(function (z) { return z.meta && z.meta.klucz === klucz; }) || null;
  }

  // ------------------------------------------------------------ wspólne
  /** Obsługa stanu „w toku” jednej karty. */
  function stanKarty(o) {
    // o: { karta, przycisk, anuluj, stan, etykietaTrwa }
    let kontroler = null, ostatnieOgloszenie = 0, etykieta = '';

    function postep(info) {
      const tekst = typeof info === 'string' ? info
        : (info && (info.tekst || info.komunikat)) || '';
      if (!tekst) return;
      o.stan().textContent = tekst;
      const teraz = Date.now();
      if (teraz - ostatnieOgloszenie >= ODSTEP_OGLOSZEN) { ostatnieOgloszenie = teraz; oglos(tekst); }
    }

    return {
      get trwa() { return !!kontroler; },
      postep: postep,
      start: function (przycisk, tekstStanu) {
        kontroler = new AbortController();
        ostatnieOgloszenie = 0;
        o.karta().setAttribute('aria-busy', 'true');
        o.anuluj().hidden = false;
        const st = o.stan(); st.hidden = false; st.textContent = '';
        if (przycisk) {
          etykieta = przycisk.dataset.etykieta || '';
          przycisk.setAttribute('aria-disabled', 'true');
          przycisk.classList.add('is-busy');
        }
        postep(tekstStanu);
        return kontroler.signal;
      },
      koniec: function (przycisk) {
        kontroler = null;
        o.karta().setAttribute('aria-busy', 'false');
        const anuluj = o.anuluj();
        const fokusNaAnuluj = document.activeElement === anuluj;
        anuluj.hidden = true;
        const st = o.stan(); st.hidden = true; st.textContent = '';
        if (przycisk) {
          przycisk.removeAttribute('aria-disabled');
          przycisk.classList.remove('is-busy');
        }
        // ukryty „Anuluj” nie może zabrać fokusu w próżnię
        if (fokusNaAnuluj && przycisk) przycisk.focus();
        return etykieta;
      },
      anuluj: function () { if (kontroler) kontroler.abort(); }
    };
  }

  function przerwano() { const e = new Error('Przerwano pobieranie.'); e.kod = 'PRZERWANO'; return e; }
  function czyPrzerwano(e) { return e && (e.kod === 'PRZERWANO' || e.name === 'AbortError'); }

  function wyczysc(kontId) {
    const kont = $(kontId);
    // fokus w usuwanym komunikacie (np. „Podgląd”) przenosimy na nagłówek karty
    if (kont.contains(document.activeElement)) {
      const nagl = kont.closest('.card').querySelector('h2');
      nagl.setAttribute('tabindex', '-1'); nagl.focus();
    }
    kont.textContent = '';
  }

  /** Komunikat błędu przy karcie: role="alert" + akcje (ponów, pobierz ręcznie). */
  function pokazBlad(kontId, e, ponow, kontekst, powrot) {
    const kont = $(kontId);
    wyczysc(kontId);
    const kod = e && e.kod;
    let tytul = 'Nie udało się pobrać danych.';
    const opis = (e && e.message) || 'Nieznany błąd.';
    const wskazowki = [];
    if (kod === 'LIMIT') {
      tytul = 'Serwer jest teraz przeciążony.';
      wskazowki.push('Odczekaj chwilę (zwykle wystarczy minuta) i spróbuj ponownie.');
    } else if (kod === 'TIMEOUT') {
      tytul = 'Serwer nie odpowiedział na czas.';
    } else if (kod === 'SIEC') {
      if (!/połączeni/i.test(opis)) wskazowki.push('Sprawdź połączenie z internetem.');
    } else if (kod === 'BRAK_DANYCH') {
      tytul = 'Brak danych.';
    } else if (kod === 'CORS') {
      tytul = 'Portal nie pozwala pobrać tego pliku w przeglądarce.';
    } else if (kod === 'FORMAT') {
      tytul = 'Tego zasobu nie da się wczytać automatycznie.';
    }
    const linkReczny = e && (e['linkRęczny'] || e.linkReczny);
    const akcje = [];
    // przy CORS i FORMAT ponowienie da ten sam wynik – zostaje pobranie ręczne
    if (kod === 'CORS' || kod === 'FORMAT') ponow = null;
    if (ponow) {
      // przed usunięciem komunikatu fokus wraca na przycisk akcji, by nie przepadł
      akcje.push(h('button', { type: 'button', class: 'btn btn--secondary btn--small',
        onclick: function () { if (powrot) powrot.focus(); ponow(); } }, 'Spróbuj ponownie'));
    }
    if (linkReczny && AED.dom.bezpiecznyUrl(linkReczny)) {
      if (kod === 'CORS') {
        if (!/ręcznie/i.test(opis)) wskazowki.push('Możesz pobrać plik ręcznie i wgrać go w karcie „Plik od dysponenta”.');
        akcje.push(linkZewn(linkReczny, 'Pobierz plik ręcznie', { class: 'btn btn--secondary btn--small' }));
        akcje.push(h('button', { type: 'button', class: 'btn btn--ghost btn--small',
          onclick: function () { $('plik-input').focus(); $('dropzone').scrollIntoView({ block: 'center' }); } },
          'Przejdź do wgrywania pliku'));
      } else {
        // np. FORMAT: link prowadzi do strony WWW, a nie do pliku z danymi
        akcje.push(linkZewn(linkReczny, 'Otwórz stronę zasobu', { class: 'btn btn--secondary btn--small' }));
      }
    }
    const pilny = kod === 'LIMIT' || kod === 'BRAK_DANYCH';
    const box = h('div', { class: 'alert ' + (pilny ? 'alert--warn' : 'alert--err'), role: 'alert' },
      h('p', null, h('strong', null, tytul), ' ', opis === tytul ? '' : opis),
      wskazowki.length ? h('p', null, wskazowki.join(' ')) : null,
      akcje.length ? h('div', { class: 'alert-actions' }, akcje) : null);
    kont.appendChild(box);
    // fokus na pierwszą akcję – użytkownik od razu może ponowić
    const pierwsza = box.querySelector('button, a');
    if (pierwsza) pierwsza.focus();
  }

  function pokazInfo(kontId, rodzaj, tresc) {
    const kont = $(kontId);
    wyczysc(kontId);
    kont.appendChild(h('div', { class: 'alert alert--' + rodzaj }, tresc));
  }

  function przyciskPodgladu(z) {
    return h('button', { type: 'button', class: 'btn btn--secondary btn--small',
      onclick: function () { AED.ui.zrodla.pokazPodglad(z.id); } },
    ikona('eye'), 'Podgląd', h('span', { class: 'visually-hidden' }, ' ' + z.kod));
  }

  function dodajDoRejestru(typ, nazwa, w, dodatki) {
    const meta = Object.assign({}, w.meta || {}, dodatki);
    return store.dodajZrodlo({
      typ: typ,
      nazwa: nazwa,
      dysponent: meta.dysponentSugerowany || '',
      licencja: meta.licencjaSugerowana || '',
      kolumny: w.kolumny || [],
      wiersze: w.wiersze || [],
      meta: meta
    });
  }

  // ======================================================= dane.gov.pl
  const dgpStan = stanKarty({
    karta: function () { return $('karta-dgp'); },
    anuluj: function () { return $('dgp-anuluj'); },
    stan: function () { return $('dgp-stan'); }
  });
  let ostatnieWyniki = [];
  const zasobPrzycisku = new WeakMap(); // przycisk -> { zb, zs }

  function kluczZasobu(zbior, zasob) { return 'DGP:' + zbior.id + ':' + zasob.id; }

  async function dgpSzukaj() {
    if (dgpStan.trwa) { oglos('Poczekaj na zakończenie bieżącego pobierania albo je anuluj.'); return; }
    const przycisk = $('dgp-szukaj');
    const pole = $('dgp-fraza');
    const fraza = pole.value.trim();
    const dgp = modul('dgp');
    if (!dgp) {
      pokazBlad('dgp-komunikat', { message: 'Nie wczytano modułu dane.gov.pl (js/sources/dgp.js).' });
      return;
    }
    if (!fraza) {
      pokazInfo('dgp-komunikat', 'err', h('p', null, ikona('err'), ' Wpisz szukaną frazę, np. AED defibrylator.'));
      pole.setAttribute('aria-invalid', 'true');
      pole.focus();
      oglos('Wpisz szukaną frazę.', true);
      return;
    }
    pole.removeAttribute('aria-invalid');
    wyczysc('dgp-komunikat');
    const signal = dgpStan.start(przycisk, 'Szukanie zbiorów w dane.gov.pl…');
    let wyniki;
    try {
      wyniki = await dgp.szukaj(fraza, { signal: signal });
      if (signal.aborted) throw przerwano();
    } catch (e) {
      dgpStan.koniec(przycisk);
      if (czyPrzerwano(e)) { oglos('Anulowano wyszukiwanie.'); return; }
      console.warn('[AED] obsłużony błąd źródła zdalnego:', e);
      pokazBlad('dgp-komunikat', e, dgpSzukaj, { zrodlo: 'dgp' }, przycisk);
      return;
    }
    dgpStan.koniec(przycisk);
    ostatnieWyniki = wyniki || [];
    renderujWyniki(fraza);
    oglos(ostatnieWyniki.length
      ? 'Znaleziono ' + ostatnieWyniki.length + ' ' + odmiana(ostatnieWyniki.length, 'zbiór', 'zbiory', 'zbiorów') +
        '. Lista wyników jest pod polem wyszukiwania.'
      : 'Nie znaleziono zbiorów dla frazy ' + fraza + '.');
  }

  function renderujWyniki(fraza) {
    const kont = $('dgp-wyniki');
    kont.textContent = '';
    if (!ostatnieWyniki.length) {
      kont.appendChild(h('p', { class: 'empty' }, 'Nie znaleziono zbiorów dla frazy „', fraza, '”. Spróbuj innych słów, np. „defibrylator” albo nazwy miasta.'));
      return;
    }
    kont.appendChild(h('h3', { id: 'h-dgp-wyniki', class: 'results-title' },
      'Wyniki: ', String(ostatnieWyniki.length), ' ', odmiana(ostatnieWyniki.length, 'zbiór', 'zbiory', 'zbiorów'),
      ' dla „', fraza, '”'));
    kont.appendChild(h('ul', { class: 'dgp-lista', 'aria-labelledby': 'h-dgp-wyniki' },
      ostatnieWyniki.map(function (zb, i) { return elementZbioru(zb, i); })));
  }

  function elementZbioru(zb, i) {
    const idT = 'dgp-zb-' + i;
    const zasoby = zb.zasoby || [];
    const opis = [
      zb.instytucja ? h('span', null, h('span', { class: 'visually-hidden' }, 'Instytucja: '), zb.instytucja) : null,
      h('span', null, 'aktualizacja: ', data(zb.zmodyfikowano)),
      zb.licencjaOpis || zb.licencja
        ? h('span', null, 'licencja: ', zb.licencjaOpis || zb.licencja) : null
    ].filter(Boolean);
    return h('li', { class: 'dgp-zbior' },
      h('h4', { id: idT, class: 'dgp-zbior__tytul' }, zb.url ? linkZewn(zb.url, zb.tytul || 'Zbiór bez tytułu') : (zb.tytul || 'Zbiór bez tytułu')),
      h('p', { class: 'meta dgp-zbior__meta' }, opis.map(function (el, j) { return j ? [' · ', el] : el; })),
      zasoby.length
        ? h('ul', { class: 'dgp-zasoby', 'aria-label': 'Zasoby zbioru: ' + (zb.tytul || '') },
          zasoby.map(function (zs) { return elementZasobu(zb, zs); }))
        : zb.bladZasobow
          ? h('div', { class: 'alert alert--warn alert--small' },
            h('p', null, h('strong', null, 'Nie udało się pobrać listy zasobów.'), ' ', zb.bladZasobow),
            h('div', { class: 'alert-actions' }, h('button', { type: 'button', class: 'btn btn--secondary btn--small',
              'aria-label': 'Spróbuj ponownie pobrać listę zasobów zbioru ' + (zb.tytul || ''),
              onclick: function (e) { ponowZasoby(zb, i, e.currentTarget); } }, 'Spróbuj ponownie')))
          : h('p', { class: 'empty' }, 'Zbiór nie ma zasobów do pobrania.'),
      zb.ostrzezenieZasobow ? h('p', { class: 'meta' }, odznaka('warn', 'Uwaga'), ' ', zb.ostrzezenieZasobow) : null);
  }

  /** Ponowne pobranie listy zasobów jednego zbioru (bez powtarzania całego wyszukiwania). */
  async function ponowZasoby(zb, i, btn) {
    const dgp = modul('dgp');
    if (!dgp || typeof dgp.zasobyZbioru !== 'function') { $('dgp-szukaj').focus(); dgpSzukaj(); return; }
    btn.setAttribute('aria-disabled', 'true');
    btn.classList.add('is-busy');
    btn.textContent = 'Pobieranie…';
    oglos('Pobieranie listy zasobów zbioru ' + (zb.tytul || '') + '…');
    try {
      await dgp.zasobyZbioru(zb, {});
    } catch (e) {
      console.warn('[AED] obsłużony błąd źródła zdalnego:', e);
      zb.bladZasobow = e.message || String(e);
    }
    const stary = btn.closest('li.dgp-zbior');
    if (!stary) return;
    const nowy = elementZbioru(zb, i);
    stary.replaceWith(nowy);
    const zasoby = zb.zasoby || [];
    if (zasoby.length) {
      const cel = nowy.querySelector('button, a[href]') || nowy.querySelector('h4');
      if (cel) cel.focus();
      oglos('Pobrano listę zasobów: ' + zasoby.length + ' ' + odmiana(zasoby.length, 'zasób', 'zasoby', 'zasobów') + '.');
    } else {
      const ponow = nowy.querySelector('.alert-actions button');
      if (ponow) ponow.focus();
      oglos('Nadal nie udało się pobrać listy zasobów. ' + (zb.bladZasobow || ''), true);
    }
  }

  function elementZasobu(zb, zs) {
    const format = (zs.format || '?').toUpperCase();
    const nazwa = zs.nazwa || 'zasób bez nazwy';
    const klucz = kluczZasobu(zb, zs);
    let akcja;
    if (!obslugiwany(zs)) {
      akcja = h('span', { class: 'dgp-zasob__akcje' },
        odznaka('info', zs.stronaWww ? 'Strona WWW dostawcy, nie plik' : 'Format ' + format + ' nieobsługiwany'),
        zs.url ? linkZewn(zs.url, 'Otwórz', { 'aria-label': 'Otwórz zasób ' + nazwa }) : null);
    } else {
      const btn = h('button', {
        type: 'button', class: 'btn btn--secondary btn--small', 'data-klucz': klucz,
        'data-etykieta': 'Dodaj ' + format,
        onclick: function () { dgpDodaj(zb, zs, btn); }
      });
      zasobPrzycisku.set(btn, { zb: zb, zs: zs });
      akcja = h('span', { class: 'dgp-zasob__akcje' }, btn);
      ustawPrzyciskZasobu(btn, zb, zs);
    }
    return h('li', { class: 'dgp-zasob' },
      h('span', { class: 'dgp-zasob__nazwa' }, h('span', { class: 'format-tag' }, format), ' ', nazwa),
      akcja);
  }

  /** Zasób da się dodać: API portalu ma jego dane tabelaryczne albo to plik, który umie odczytać źródło „Plik”.
      Gdy serwer pliku blokuje pobranie (CORS), moduł dgp.js zwraca link do ręcznego pobrania. */
  function obslugiwany(zs) {
    if (typeof zs.obslugiwany === 'boolean') return zs.obslugiwany;
    if (zs.tabelaryczny) return true;
    const roz = (AED.zrodla.plik && AED.zrodla.plik.ROZSZERZENIA) || {};
    return Object.prototype.hasOwnProperty.call(roz, String(zs.format || '').toLowerCase());
  }

  /** Stan przycisku zasobu: „Dodaj CSV” albo „Dodano (DGP-01)” – zmiana w miejscu, fokus zostaje. */
  function ustawPrzyciskZasobu(btn, zb, zs) {
    const format = (zs.format || '?').toUpperCase();
    const nazwa = zs.nazwa || 'zasób bez nazwy';
    const z = znajdzPoKluczu(kluczZasobu(zb, zs));
    btn.textContent = '';
    btn.classList.remove('is-busy');
    if (z) {
      btn.append(ikona('ok'), 'Dodano jako ' + z.kod);
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('aria-label', 'Dodano jako ' + z.kod + ': ' + format + ' – ' + nazwa + ' (zbiór: ' + (zb.tytul || '') + ')');
      btn.classList.add('is-done');
    } else {
      btn.append('Dodaj ' + format);
      btn.removeAttribute('aria-disabled');
      btn.setAttribute('aria-label', 'Dodaj ' + format + ' – ' + nazwa + ' (zbiór: ' + (zb.tytul || '') + ')');
      btn.classList.remove('is-done');
    }
  }

  function odswiezPrzyciskiZasobow() {
    document.querySelectorAll('#dgp-wyniki button[data-klucz]').forEach(function (btn) {
      if (btn.classList.contains('is-busy')) return;
      const p = zasobPrzycisku.get(btn);
      if (p) ustawPrzyciskZasobu(btn, p.zb, p.zs);
    });
  }

  async function dgpDodaj(zb, zs, btn) {
    const istniejace = znajdzPoKluczu(kluczZasobu(zb, zs));
    if (istniejace) {
      oglos('Ten zasób jest już w rejestrze jako ' + istniejace.kod + '. Nie dodano go ponownie.');
      pokazInfo('dgp-komunikat', 'warn', [
        h('p', null, 'Zasób „', zs.nazwa || '', '” jest już w rejestrze jako ', h('strong', null, istniejace.kod),
          '. Nie dodano go ponownie.'),
        h('div', { class: 'alert-actions' }, przyciskPodgladu(istniejace))]);
      return;
    }
    if (dgpStan.trwa) { oglos('Poczekaj na zakończenie bieżącego pobierania albo je anuluj.'); return; }
    const dgp = modul('dgp');
    wyczysc('dgp-komunikat');
    const format = (zs.format || '').toUpperCase();
    const signal = dgpStan.start(btn, 'Pobieranie zasobu „' + (zs.nazwa || '') + '” (' + format + ')…');
    btn.textContent = 'Pobieranie…';
    let w;
    try {
      w = await dgp.pobierzZasob(zb, zs, { signal: signal, onPostep: dgpStan.postep });
      if (signal.aborted) throw przerwano();
    } catch (e) {
      dgpStan.koniec(btn);
      ustawPrzyciskZasobu(btn, zb, zs);
      if (czyPrzerwano(e)) { oglos('Anulowano pobieranie zasobu.'); return; }
      console.warn('[AED] obsłużony błąd źródła zdalnego:', e);
      pokazBlad('dgp-komunikat', e, function () { dgpDodaj(zb, zs, btn); }, { zrodlo: 'dgp' }, btn);
      return;
    }
    dgpStan.koniec(btn);
    if (!w.wiersze || !w.wiersze.length) {
      ustawPrzyciskZasobu(btn, zb, zs);
      pokazInfo('dgp-komunikat', 'warn', h('p', null, 'Zasób „', zs.nazwa || '', '” nie zawiera rekordów. Nic nie dodano do rejestru.'));
      oglos('Zasób nie zawiera rekordów. Nic nie dodano.');
      return;
    }
    const nazwa = (zb.instytucja ? zb.instytucja + ' – ' : '') + (zs.nazwa || zb.tytul || 'zasób dane.gov.pl');
    const z = dodajDoRejestru('DGP', nazwa, w, {
      klucz: kluczZasobu(zb, zs),
      zbiorUrl: (w.meta && w.meta.zbior && w.meta.zbior.url) || zb.url,
      zbiorTytul: (w.meta && w.meta.zbior && w.meta.zbior.tytul) || zb.tytul,
      dysponentSugerowany: (w.meta && w.meta.dysponentSugerowany) || zb.instytucja || ''
    });
    ustawPrzyciskZasobu(btn, zb, zs);
    pokazInfo('dgp-komunikat', 'ok', [
      h('p', null, odznaka('ok', 'Dodano'), ' Źródło ', h('strong', null, z.kod), ' „', z.nazwa, '”: ', rekordy(z.wiersze.length), '.'),
      h('div', { class: 'alert-actions' }, przyciskPodgladu(z))]);
    oglos('Dodano źródło ' + z.kod + ' ' + z.nazwa + ': ' + rekordy(z.wiersze.length) + '. Źródło jest w rejestrze.');
  }

  // ----------------------------------------------------------- inicjalizacja
  function init() {
    // --- dane.gov.pl
    if (!modul('dgp')) {
      pokazInfo('dgp-komunikat', 'err', h('p', null, 'Nie wczytano modułu dane.gov.pl (js/sources/dgp.js). ' +
        'Sprawdź, czy katalog js/ jest kompletny.'));
    }
    $('dgp-form').addEventListener('submit', function (e) { e.preventDefault(); dgpSzukaj(); });
    $('dgp-fraza').addEventListener('input', function (e) { e.target.removeAttribute('aria-invalid'); });
    $('dgp-anuluj').addEventListener('click', function () { dgpStan.anuluj(); });

    // po usunięciu źródła z rejestru zasób można dodać ponownie
    AED.on('zrodla:zmiana', function (e) { if (e.akcja !== 'zmieniono') odswiezPrzyciskiZasobow(); });
  }

  AED.ui = AED.ui || {};
  AED.ui.zdalne = { init: init };
})(window.AED);
