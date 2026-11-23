/* Krok 4, na końcu: „Wyślij do zatwierdzenia przez bazę gov.pl ”.
   Logika (gotowość, zgłoszenie, zapis w bazie „wyniki.gov”, tryb serwer/przeglądarka) – AED.gov (js/core/gov.js).
   Tu tylko interfejs. To SYMULACJA – dane nie trafiają do żadnego prawdziwego systemu gov.pl.
   WCAG: przycisk zablokowany przez aria-disabled (zostaje w kolejności Tab, opis mówi dlaczego), lista braków
   z linkami, stan ładowania z aria-busy i regionem aria-live, wynik z fokusem na nagłówku. */
(function (AED) {
  'use strict';
  const { h, oglos, liczba, odmiana, ikona, pobierz } = AED.dom;

  const TEKST_PRZYCISKU = 'Wyślij do zatwierdzenia przez bazę gov.pl';
  const PIERWSZY_KOMUNIKAT = 'Trwa weryfikacja i wysyłka danych do systemu gov.pl...';
  const OPOZNIENIE_MS = 1500;
  const ETAPY = {
    1: { trasa: 'zrodla', nazwa: 'Krok 1 – źródła danych' },
    2: { trasa: 'mapowanie', nazwa: 'Krok 2 – mapowanie kolumn' },
    3: { trasa: 'walidacja', nazwa: 'Krok 3 – walidacja i duplikaty' },
    4: { trasa: 'wynik', nazwa: 'Krok 4 – opis zbioru (metadane)' }
  };

  const st = {
    gotowosc: null,     // { gotowe, braki }
    wysylanie: false,
    wynik: null,        // odpowiedź wyslij()
    blad: null,
    kontroler: null
  };
  let timer = null;

  function $(id) { return document.getElementById(id); }
  function G() { return AED.gov || null; }
  function stanUI() {
    try { return AED.ui.wynik && AED.ui.wynik.stanDlaGov ? AED.ui.wynik.stanDlaGov() : {}; } catch (e) { console.error(e); return {}; }
  }
  function komunikatBledu(e) { return String((e && e.message) || e || 'nieznany błąd'); }

  // ------------------------------------------------------------ gotowość
  function sprawdzGotowosc() {
    if (!G() || !G().gotowosc) { st.gotowosc = { gotowe: false, braki: [], brakModulu: true }; return Promise.resolve(st.gotowosc); }
    let w;
    try { w = G().gotowosc(stanUI()); } catch (e) { console.error(e); w = { gotowe: false, braki: [{ etap: 4, komunikat: 'Nie udało się sprawdzić gotowości: ' + komunikatBledu(e) }] }; }
    return Promise.resolve(w).then(function (x) {
      st.gotowosc = { gotowe: !!(x && x.gotowe), braki: (x && Array.isArray(x.braki)) ? x.braki : [] };
      return st.gotowosc;
    }, function (e) {
      console.error(e);
      st.gotowosc = { gotowe: false, braki: [{ etap: 4, komunikat: 'Nie udało się sprawdzić gotowości: ' + komunikatBledu(e) }] };
      return st.gotowosc;
    });
  }
  /** Odświeżenie gotowości po zmianach (zdarzenia store, metadane) – z krótkim opóźnieniem, bez przenoszenia fokusu. */
  function zaplanuj() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (!AED.router || AED.router.trasa !== 'wynik' || st.wysylanie) return;
      sprawdzGotowosc().then(renderujGotowosc);
    }, 150);
  }

  /** Link do miejsca braku: etap 1–3 – ekran kroku; etap 4 – pole metadanych (fokus bez zmiany #hash). */
  function linkBraku(b) {
    const etap = ETAPY[b.etap] || ETAPY[4];
    const idPola = b.pole && AED.ui.wynik && AED.ui.wynik.POLE_METADANYCH ? AED.ui.wynik.POLE_METADANYCH(b.pole) : null;
    if (etap.trasa === 'wynik') {
      const cel = idPola && $(idPola) ? idPola : 'h-wyn-metadane';
      return h('a', { href: '#' + cel, onclick: function (e) {
        e.preventDefault(); // #hash służy routerowi – przenosimy tylko fokus
        const el = $(cel);
        const f = el && (el.matches('fieldset') ? el.querySelector('input') : el);
        if (f) { f.focus(); f.scrollIntoView({ block: 'center' }); }
      } }, b.komunikat);
    }
    return h('a', { href: '#' + etap.trasa }, b.komunikat);
  }

  function renderujGotowosc() {
    const kont = $('gov-gotowosc'), btn = $('gov-wyslij'), opis = $('gov-wyslij-opis');
    if (!kont || !btn) return;
    const g = st.gotowosc || { gotowe: false, braki: [] };
    kont.textContent = '';
    if (g.brakModulu) {
      kont.appendChild(h('p', { class: 'alert alert--err' }, 'Nie wczytano modułu wysyłki (js/core/gov.js). Sprawdź, czy katalog js/ jest obok index.html.'));
    } else if (g.gotowe) {
      kont.appendChild(h('p', { class: 'alert alert--ok gov-gotowe' }, ikona('ok'), ' Wszystkie 4 kroki są gotowe. Możesz zatwierdzić zbiór.'));
    } else {
      // braki pogrupowane według kroków
      const wgEtapu = {};
      g.braki.forEach(function (b) { (wgEtapu[b.etap] = wgEtapu[b.etap] || []).push(b); });
      kont.appendChild(h('div', { class: 'alert alert--warn' },
        h('h3', { id: 'gov-braki-tytul', tabindex: '-1' }, 'Zanim wyślesz: ' + (g.braki.length
          ? 'uzupełnij ' + liczba(g.braki.length) + ' ' + odmiana(g.braki.length, 'brak', 'braki', 'braków')
          : 'dokończ wcześniejsze kroki')),
        h('ul', { class: 'gov-braki' }, Object.keys(wgEtapu).sort().map(function (e) {
          return h('li', null, h('strong', null, (ETAPY[e] || ETAPY[4]).nazwa + ':'),
            h('ul', null, wgEtapu[e].map(function (b) { return h('li', null, linkBraku(b)); })));
        }))));
    }
    const zablokowany = !g.gotowe || st.wysylanie;
    if (zablokowany) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
    opis.textContent = st.wysylanie ? 'Trwa wysyłka – poczekaj na wynik.'
      : g.brakModulu ? 'Przycisk nieaktywny: brak modułu wysyłki.'
        : g.gotowe ? 'Wyśle dane do bazy dane.gov.pl (symulacja – zapis w lokalnej bazie projektu).'
          : 'Przycisk nieaktywny – najpierw uzupełnij braki z listy powyżej.';
  }

  // ------------------------------------------------------------ wysyłka
  function ustawZajety(tak) {
    st.wysylanie = tak;
    const sekcja = $('gov-wysylka'), btn = $('gov-wyslij');
    if (sekcja) sekcja.setAttribute('aria-busy', tak ? 'true' : 'false');
    if (btn) {
      btn.classList.toggle('is-busy', tak);
      if (tak) btn.setAttribute('aria-disabled', 'true');
    }
  }
  function postep(tekst) {
    const el = $('gov-postep');
    if (!el) return;
    el.textContent = String(tekst);
  }

  function klik() {
    const btn = $('gov-wyslij');
    if (st.wysylanie) return; // blokada podwójnego kliknięcia
    if (btn.getAttribute('aria-disabled') === 'true') {
      const t = $('gov-braki-tytul');
      if (t) { t.focus(); t.scrollIntoView({ block: 'center' }); }
      oglos('Nie można jeszcze wysłać. ' + ((st.gotowosc && st.gotowosc.braki.length)
        ? 'Uzupełnij ' + liczba(st.gotowosc.braki.length) + ' ' + odmiana(st.gotowosc.braki.length, 'brak', 'braki', 'braków') + ' z listy.'
        : 'Dokończ wcześniejsze kroki.'), true);
      return;
    }
    wyslij();
  }

  /** Pobiera plik wyniki_gov.txt z wysłanymi danymi (schemat bazy + INSERT-y zgłoszenia i rekordów AED). */
  async function zapiszPlikBazy(zgloszenie, w) {
    try {
      pobierz('wyniki_gov.txt', await G().zrzutSql(zgloszenie, w), 'text/plain;charset=utf-8');
      return true;
    } catch (e) { console.warn('[AED] zapis pliku wyniki_gov.txt:', e); return false; }
  }

  async function wyslij() {
    ustawZajety(true);
    st.blad = null; st.przerwano = false; st.doOgloszenia = null;
    st.kontroler = new AbortController(); // od razu – wyjście z kroku 4 przerywa także sprawdzanie gotowości
    $('gov-wynik').textContent = '';
    renderujGotowosc();
    postep(PIERWSZY_KOMUNIKAT);
    // gotowość sprawdzamy jeszcze raz tuż przed wysyłką (metadane mogły się zmienić bez wyjścia z pola)
    const g = await sprawdzGotowosc();
    if (!g.gotowe && !st.kontroler.signal.aborted) {
      st.kontroler = null;
      ustawZajety(false);
      $('gov-postep').textContent = '';
      renderujGotowosc();
      const t = $('gov-braki-tytul'); if (t) t.focus();
      oglos('Nie wysłano – są braki do uzupełnienia.', true);
      return;
    }
    try {
      if (st.kontroler.signal.aborted) throw Object.assign(new Error('Przerwano.'), { kod: 'PRZERWANO' });
      const ui = stanUI();
      const zgloszenie = G().zbierzZgloszenie(ui.metadane || undefined, { rekordy: ui.rekordy, pominieteBledne: ui.pominieteBledne || 0, walidacja: ui.walidacja });
      const w = await G().wyslij(zgloszenie, { onPostep: postep, opoznienieMs: OPOZNIENIE_MS, signal: st.kontroler.signal });
      st.wynik = w;
      st.plikBazy = await zapiszPlikBazy(zgloszenie, w);
      ustawZajety(false);
      $('gov-postep').textContent = '';
      renderujWynik();
      renderujGotowosc();
      const tekst = 'Dane zostały wysłane do bazy dane.gov.pl (symulacja).';
      if (AED.router.trasa === 'wynik') {
        const n = $('gov-wynik-tytul'); if (n) n.focus();
        oglos(tekst);
      } else st.doOgloszenia = tekst; // zakończyło się poza krokiem 4 – ogłosimy po powrocie
    } catch (e) {
      ustawZajety(false);
      $('gov-postep').textContent = '';
      if (e && (e.kod === 'PRZERWANO' || e.name === 'AbortError')) {
        // przerwano (np. wyjście z kroku 4) – nic nie zapisano; komunikat zostaje w sekcji do powrotu
        st.blad = 'Wysyłkę przerwano, bo opuszczono krok 4. Nic nie zapisano w bazie wyniki.gov.';
        st.przerwano = true;
        renderujBlad();
        renderujGotowosc();
        return;
      }
      console.warn('[AED] obsłużony błąd wysyłki:', e);
      st.blad = komunikatBledu(e);
      renderujBlad();
      renderujGotowosc();
    } finally {
      st.kontroler = null;
    }
  }

  function renderujBlad() {
    const kont = $('gov-wynik');
    kont.textContent = '';
    const przerwano = !!st.przerwano;
    kont.appendChild(h('div', { class: 'alert ' + (przerwano ? 'alert--warn' : 'alert--err'), role: przerwano ? null : 'alert' },
      h('h3', { id: 'gov-blad-tytul', tabindex: '-1' }, przerwano ? 'Wysyłka przerwana' : 'Nie udało się wysłać zgłoszenia'),
      h('p', null, st.blad),
      przerwano ? null : h('p', null, 'Nic nie zostało zapisane. Sprawdź połączenie z lokalnym serwerem (jeśli go używasz) i spróbuj ponownie.'),
      h('div', { class: 'alert-actions' }, h('button', { type: 'button', class: 'btn btn--secondary btn--small', id: 'gov-ponow',
        onclick: function () { if (!st.wysylanie) wyslij(); } }, 'Spróbuj ponownie'))));
  }

  /** Po wysyłce – tylko krótkie potwierdzenie (bez statystyk bazy, listy zgłoszeń i pobierania pliku). */
  function renderujWynik() {
    const kont = $('gov-wynik');
    kont.textContent = '';
    if (!st.wynik) return;
    kont.appendChild(h('div', { class: 'alert alert--ok gov-potwierdzenie', role: 'status' },
      h('h3', { id: 'gov-wynik-tytul', tabindex: '-1' }, ikona('ok'), ' Dane zostały wysłane do bazy dane.gov.pl'),
      h('p', { class: 'gov-wysylka__sym-tekst' }, 'Dane zapisano w lokalnej bazie projektu' + (st.plikBazy ? ' i pobrano plik wyniki_gov.txt z wysłanymi danymi.' : '.'))));
  }

  // ------------------------------------------------------------ całość
  function renderuj() {
    const kont = $('gov-tresc');
    if (!kont) return;
    if (!$('gov-wyslij')) {
      kont.textContent = '';
      kont.append(
        h('div', { id: 'gov-gotowosc' }),
        h('div', { class: 'gov-przycisk' },
          h('button', { type: 'button', class: 'btn btn--gov btn--big', id: 'gov-wyslij', 'aria-describedby': 'gov-wyslij-opis', 'aria-disabled': 'true', onclick: klik },
            TEKST_PRZYCISKU),
          h('p', { class: 'hint', id: 'gov-wyslij-opis' })),
        h('p', { class: 'remote-status gov-postep', id: 'gov-postep', role: 'status', 'aria-live': 'polite' }), // stale w DOM – czytnik ogłasza zmiany
        h('div', { id: 'gov-wynik' }));
      if (st.wynik) renderujWynik(); else if (st.blad) renderujBlad();
    }
    renderujGotowosc();
    sprawdzGotowosc().then(renderujGotowosc);
  }

  function init() {
    AED.on('trasa', function (e) {
      if (e.trasa !== 'wynik') {
        // wyjście z kroku 4 w trakcie symulacji – przerywamy (zapis jeszcze nie ruszył, więc nic nie zostanie zapisane)
        if (st.wysylanie && st.kontroler) st.kontroler.abort();
        return;
      }
      renderuj();
      if (st.doOgloszenia) {
        const t = st.doOgloszenia; st.doOgloszenia = null;
        setTimeout(function () { oglos(t + ' Wynik jest w kroku 4, pod metadanymi.'); }, 300);
      } else if (st.przerwano) {
        setTimeout(function () { oglos('Poprzednia wysyłka została przerwana. Nic nie zapisano – możesz wysłać ponownie w kroku 4, pod metadanymi.'); }, 300);
      }
    });
    ['zrodla:zmiana', 'rekordy:zmiana', 'duplikaty:zmiana', 'wynik:zmiana'].forEach(function (ev) { AED.on(ev, zaplanuj); });
    // zmiany metadanych (pola formularza w kroku 4)
    const sekcja = document.querySelector('section[data-route="wynik"]');
    if (sekcja) {
      ['change', 'input'].forEach(function (typ) {
        sekcja.addEventListener(typ, function (e) {
          if (e.target && e.target.closest && e.target.closest('#wyn-metadane, #wyn-podsumowanie')) zaplanuj();
        });
      });
      // „Przywróć podpowiedzi” i „Sprawdź metadane” przebudowują formularz bez zdarzenia change
      sekcja.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('#wyn-m-form button')) zaplanuj(); });
    }
  }

  AED.ui = AED.ui || {};
  AED.ui.gov = { zapiszPlikBazy: zapiszPlikBazy, init: init, renderuj: renderuj, odswiez: zaplanuj, get stan() { return st; } };
})(window.AED);
