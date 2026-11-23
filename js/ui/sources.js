/* Ekran „Krok 1: Źródła danych” – wgrywanie plików, rejestr źródeł, podgląd.
   Źródła zdalne (dane.gov.pl) dodaje js/ui/zdalne.js – nie mają meta.plik,
   za to mają meta.url, meta.dataDanych, meta.zapytanie, meta.atrybucja. */
(function (AED) {
  'use strict';
  const { h, odznaka, oglos, liczba, rozmiar, odmiana, tabelaPrzewijana, ikona, linkZewn, data } = AED.dom;
  const store = AED.store;

  const LICENCJE = AED.wzorzec.slowniki.licencja_rekordu;
  let podgladId = null;     // id źródła pokazanego w podglądzie
  const skoroszyty = {};    // id źródła -> skoroszyt (do zmiany arkusza)

  // ------------------------------------------------------------ wgrywanie
  async function wgrajPliki(lista) {
    const pliki = Array.from(lista || []);
    if (!pliki.length) return;
    const bledy = [];
    let dodane = 0, rekordy = 0;
    oglos('Wczytywanie ' + pliki.length + ' ' + odmiana(pliki.length, 'pliku', 'plików', 'plików') + '…');
    ustawStanStrefy(true);

    for (const plik of pliki) {
      try {
        const w = await AED.zrodla.plik.wczytaj(plik);
        const z = store.dodajZrodlo({
          typ: 'PLIK',
          nazwa: plik.name.replace(/\.[^.]+$/, ''),
          kolumny: w.kolumny,
          wiersze: w.wiersze,
          meta: w.meta
        });
        if (w.skoroszyt) skoroszyty[z.id] = w.skoroszyt;
        dodane++; rekordy += w.wiersze.length;
      } catch (e) {
        console.error(e);
        bledy.push({ plik: plik.name, komunikat: e.message || String(e) });
      }
    }
    ustawStanStrefy(false);
    pokazBledy(bledy);

    let msg = '';
    if (dodane) msg += 'Dodano ' + dodane + ' ' + odmiana(dodane, 'źródło', 'źródła', 'źródeł') + ', razem ' +
      liczba(rekordy) + ' ' + odmiana(rekordy, 'rekord', 'rekordy', 'rekordów') + '. ';
    if (bledy.length) msg += 'Nie udało się wczytać ' + bledy.length + ' ' + odmiana(bledy.length, 'pliku', 'plików', 'plików') + '.';
    oglos(msg.trim(), bledy.length > 0);
  }

  function ustawStanStrefy(trwa) {
    const strefa = document.getElementById('dropzone');
    const hint = document.getElementById('plik-pomoc');
    strefa.setAttribute('aria-busy', trwa ? 'true' : 'false');
    hint.textContent = trwa ? 'Wczytywanie…' : 'lub upuść je tutaj';
  }

  function pokazBledy(bledy) {
    let box = document.getElementById('bledy-plikow');
    if (box) box.remove();
    if (!bledy.length) return;
    box = h('div', { id: 'bledy-plikow', class: 'alert alert--err', role: 'alert' },
      h('p', null, h('strong', null, 'Nie wczytano niektórych plików:')),
      h('ul', null, bledy.map(function (b) { return h('li', null, h('strong', null, b.plik), ': ', b.komunikat); })));
    document.getElementById('h-rejestr').before(box);
  }

  // -------------------------------------------------------------- rejestr
  function statusZrodla(z) {
    const out = [];
    const wz = z.meta.wzorzec;
    if (wz && wz.zgodny) out.push(odznaka('ok', 'Zgodny ze wzorcem'));
    else if (wz) out.push(odznaka('info', wz.dopasowane + ' z ' + wz.wszystkie + ' kolumn ze wzorca',
      'Kolumny dopasujesz w kroku 2'));
    if (z.meta.naprawy && z.meta.naprawy.length) out.push(odznaka('warn', 'Naprawiono: ' + z.meta.naprawy.length, z.meta.naprawy.join(' ')));
    if (z.meta.ostrzezenia && z.meta.ostrzezenia.length) out.push(odznaka('warn', 'Ostrzeżenia: ' + z.meta.ostrzezenia.length, z.meta.ostrzezenia.join(' ')));
    if (!z.licencja) out.push(odznaka('err', 'Wskaż licencję'));
    return h('div', { class: 'badges' }, out);
  }

  function wierszRejestru(z) {
    const idN = 'zr-nazwa-' + z.id, idL = 'zr-lic-' + z.id, idP = 'zr-prio-' + z.id;
    const selLic = h('select', { id: idL, 'aria-label': 'Licencja źródła ' + z.kod, 'aria-invalid': z.licencja ? null : 'true',
      onchange: function (e) { store.aktualizujZrodlo(z.id, { licencja: e.target.value }); } },
      h('option', { value: '' }, '— wybierz —'),
      LICENCJE.map(function (l) { return h('option', { value: l.kod, selected: l.kod === z.licencja }, l.etykieta); }));
    const selPrio = h('select', { id: idP, 'aria-label': 'Priorytet źródła ' + z.kod,
      onchange: function (e) { store.aktualizujZrodlo(z.id, { priorytet: Number(e.target.value) }); } },
      [1, 2, 3].map(function (p) {
        return h('option', { value: p, selected: p === z.priorytet }, p + (p === 1 ? ' – najwyższy' : p === 3 ? ' – najniższy' : ''));
      }));
    const otwarty = podgladId === z.id;
    const format = [z.meta.format, z.meta.plik ? rozmiar(z.meta.plik.rozmiar) : null,
      !z.meta.plik && z.meta.dataDanych ? 'dane z ' + data(z.meta.dataDanych) : null].filter(Boolean).join(', ');

    return h('tr', null,
      h('th', { scope: 'row' }, h('code', null, z.kod)),
      h('td', null, h('input', { type: 'text', id: idN, class: 'input--table', value: z.nazwa,
        'aria-label': 'Nazwa źródła ' + z.kod,
        onchange: function (e) { store.aktualizujZrodlo(z.id, { nazwa: e.target.value.trim() || z.kod }); } }),
        z.dysponent ? h('span', { class: 'meta cell-note' }, 'Dysponent: ', z.dysponent) : null),
      h('td', null, store.TYP_OPIS[z.typ], format ? h('br') : null, format ? h('span', { class: 'meta' }, format) : null),
      h('td', { class: 'num' }, liczba(z.wiersze.length)),
      h('td', null, statusZrodla(z)),
      h('td', null, selLic),
      h('td', null, selPrio),
      h('td', null, h('div', { class: 'cell-actions' },
        h('button', { type: 'button', id: 'zr-podglad-' + z.id, class: 'btn btn--secondary btn--small',
          'aria-expanded': otwarty ? 'true' : 'false', 'aria-controls': 'podglad',
          onclick: function () { przelaczPodglad(z.id); } },
          ikona('eye'), otwarty ? 'Ukryj podgląd' : 'Podgląd', h('span', { class: 'visually-hidden' }, ' ' + z.kod)),
        h('button', { type: 'button', id: 'zr-usun-' + z.id, class: 'btn btn--danger btn--small',
          onclick: function () { usun(z.id); } },
          ikona('trash'), 'Usuń', h('span', { class: 'visually-hidden' }, ' ' + z.kod))
      ))
    );
  }

  function renderujRejestr() {
    const kont = document.getElementById('rejestr');
    const aktywnyId = document.activeElement && document.activeElement.id;
    kont.textContent = '';
    const zrodla = store.zrodla;

    if (!zrodla.length) {
      kont.appendChild(h('p', { class: 'empty' }, 'Nie dodano jeszcze żadnego źródła.'));
    } else {
      const suma = store.liczbaRekordow;
      const tabela = h('table', null,
        h('caption', null, zrodla.length + ' ' + odmiana(zrodla.length, 'źródło', 'źródła', 'źródeł') + ', ' +
          liczba(suma) + ' ' + odmiana(suma, 'rekord', 'rekordy', 'rekordów') + ' przed scaleniem'),
        h('thead', null, h('tr', null,
          ['Kod', 'Nazwa źródła', 'Typ i format', 'Rekordy', 'Stan', 'Licencja', 'Priorytet', 'Akcje'].map(function (t) {
            return h('th', { scope: 'col', class: t === 'Rekordy' ? 'num' : null }, t);
          }))),
        h('tbody', null, zrodla.map(wierszRejestru)));
      kont.appendChild(tabelaPrzewijana('Rejestr źródeł danych', tabela));
      kont.appendChild(h('p', { class: 'meta' },
        'Priorytet rozstrzyga konflikty przy scalaniu, gdy rekordy mają tę samą datę weryfikacji. ' +
        'Licencja trafia do każdego rekordu (pole licencja_rekordu).'));
    }
    // przywróć fokus po przebudowie tabeli
    if (aktywnyId) {
      const el = document.getElementById(aktywnyId);
      if (el) el.focus();
    }
  }

  function usun(id) {
    const z = store.zrodlo(id);
    if (!z) return;
    if (podgladId === id) podgladId = null;
    delete skoroszyty[id];
    store.usunZrodlo(id);
    renderujPodglad();
    const nagl = document.getElementById('h-rejestr');
    nagl.setAttribute('tabindex', '-1');
    nagl.focus();
    oglos('Usunięto źródło ' + z.kod + ' (' + z.nazwa + ').');
  }

  // --------------------------------------------------------------- podgląd
  function przelaczPodglad(id) {
    podgladId = podgladId === id ? null : id;
    renderujRejestr();
    renderujPodglad();
    if (podgladId) {
      const n = document.getElementById('h-podglad');
      if (n) n.focus();
    }
  }

  function renderujPodglad() {
    const kont = document.getElementById('podglad');
    kont.textContent = '';
    const z = podgladId && store.zrodlo(podgladId);
    if (!z) return;
    const m = z.meta;
    const N = 10;

    const zdalne = !m.plik;
    const opis = [
      zdalne ? null : ['Plik', m.plik.nazwa],
      zdalne && m.zbiorUrl ? ['Zbiór w dane.gov.pl', linkZewn(m.zbiorUrl, m.zbiorTytul || m.zbiorUrl)] : null,
      zdalne && m.url ? ['Adres danych', linkZewn(m.url, m.url, { class: 'url' })] : null,
      z.dysponent ? ['Dysponent', z.dysponent] : null,
      ['Format', m.format || '—'],
      zdalne ? ['Data danych', data(m.dataDanych)] : null,
      zdalne ? ['Pobrano', data(z.dataPobrania)] : null,
      m.licencjaSugerowana ? ['Licencja wg źródła', m.licencjaSugerowana] : null,
      m.atrybucja ? ['Atrybucja', m.atrybucja] : null,
      m.kodowanie ? ['Kodowanie', m.kodowanie] : null,
      m.separator ? ['Separator', m.separator] : null,
      m.wierszNaglowka ? ['Wiersz nagłówka', String(m.wierszNaglowka)] : null,
      ['Rekordy', liczba(z.wiersze.length)],
      ['Kolumny', String(z.kolumny.length)]
    ].filter(Boolean);

    const dl = h('dl', { class: 'dl-grid' }, opis.map(function (p) { return [h('dt', null, p[0]), h('dd', null, p[1])]; }));

    // wybór arkusza (gdy skoroszyt ma kilka arkuszy)
    let arkusz = null;
    if (m.arkusze && m.arkusze.length > 1 && skoroszyty[z.id]) {
      arkusz = h('div', { class: 'field' },
        h('label', { for: 'podglad-arkusz' }, 'Arkusz z danymi'),
        h('select', { id: 'podglad-arkusz', onchange: function (e) {
          const w = AED.zrodla.plik.zmienArkusz(skoroszyty[z.id], e.target.value);
          w.meta.plik = m.plik; w.meta.format = m.format;
          store.aktualizujZrodlo(z.id, { kolumny: w.kolumny, wiersze: w.wiersze, meta: w.meta });
          renderujPodglad();
          document.getElementById('podglad-arkusz').focus();
          oglos('Wczytano arkusz „' + e.target.value + '”: ' + liczba(w.wiersze.length) + ' ' + odmiana(w.wiersze.length, 'rekord', 'rekordy', 'rekordów') + '.');
        } }, m.arkusze.map(function (a) { return h('option', { value: a, selected: a === m.arkusz }, a); })));
    }

    const uwagi = [].concat(
      (m.naprawy || []).map(function (t) { return h('li', null, odznaka('warn', 'Naprawa'), ' ', t); }),
      (m.ostrzezenia || []).map(function (t) { return h('li', null, odznaka('warn', 'Uwaga'), ' ', t); }),
      m.wzorzec && !m.wzorzec.zgodny && m.wzorzec.brakujaceObowiazkowe.length
        ? [h('li', null, odznaka('info', 'Wzorzec'), ' Brak ' + m.wzorzec.brakujaceObowiazkowe.length +
            ' obowiązkowych kolumn wzorca – dopasujesz je w kroku 2.')] : []);

    const pokazane = z.wiersze.slice(0, N);
    const tabela = h('table', { class: 'table--data' },
      h('caption', null, 'Pierwsze ' + pokazane.length + ' z ' + liczba(z.wiersze.length) + ' ' +
        odmiana(z.wiersze.length, 'rekordu', 'rekordów', 'rekordów')),
      h('thead', null, h('tr', null, z.kolumny.map(function (k) { return h('th', { scope: 'col' }, k); }))),
      h('tbody', null, pokazane.map(function (w) {
        return h('tr', null, z.kolumny.map(function (k) { return h('td', { title: w[k] || null }, w[k]); }));
      })));

    kont.appendChild(h('section', { class: 'panel', 'aria-labelledby': 'h-podglad' },
      h('h3', { id: 'h-podglad', tabindex: '-1' }, 'Podgląd: ', z.nazwa, ' (', z.kod, ')'),
      dl, arkusz,
      m.zapytanie ? h('details', { class: 'query' },
        h('summary', null, 'Pokaż zapytanie użyte do pobrania danych'),
        h('pre', { tabindex: '0', 'aria-label': 'Zapytanie' }, h('code', null, m.zapytanie))) : null,
      uwagi.length ? h('ul', { class: 'link-list' }, uwagi) : null,
      tabelaPrzewijana('Podgląd danych źródła ' + z.kod, tabela)));
  }

  // ----------------------------------------------------------- inicjalizacja
  function init() {
    const input = document.getElementById('plik-input');
    const strefa = document.getElementById('dropzone');

    input.addEventListener('change', function () {
      wgrajPliki(input.files).then(function () { input.value = ''; });
    });

    // Przeciąganie to tylko skrót – przycisk „Wybierz pliki” działa zawsze (WCAG 2.5.7)
    ['dragenter', 'dragover'].forEach(function (ev) {
      strefa.addEventListener(ev, function (e) { e.preventDefault(); strefa.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      strefa.addEventListener(ev, function (e) { e.preventDefault(); strefa.classList.remove('is-over'); });
    });
    strefa.addEventListener('drop', function (e) { wgrajPliki(e.dataTransfer && e.dataTransfer.files); });
    // upuszczenie pliku poza strefą nie może otworzyć go w karcie
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    document.getElementById('dalej-mapowanie').addEventListener('click', function () {
      let box = document.getElementById('blad-dalej');
      if (box) box.remove();
      if (!store.zrodla.length) {
        box = h('p', { id: 'blad-dalej', class: 'alert alert--err', role: 'alert' },
          'Dodaj co najmniej jedno źródło danych, aby przejść dalej.');
        document.querySelector('[data-route="zrodla"] .step-actions').before(box);
        input.focus();
        return;
      }
      const bezLicencji = store.zrodla.filter(function (z) { return !z.licencja; });
      if (bezLicencji.length) {
        box = h('p', { id: 'blad-dalej', class: 'alert alert--err', role: 'alert' },
          'Wskaż licencję dla: ' + bezLicencji.map(function (z) { return z.kod; }).join(', ') +
          '. Bez niej nie wiadomo, na jakich zasadach można opublikować rekordy.');
        document.querySelector('[data-route="zrodla"] .step-actions').before(box);
        document.getElementById('zr-lic-' + bezLicencji[0].id).focus();
        return;
      }
      AED.router.idz('mapowanie');
    });

    AED.on('zrodla:zmiana', function (e) {
      renderujRejestr();
      if (e.akcja === 'zmieniono' && e.zrodlo.id === podgladId && e.pola.indexOf('nazwa') >= 0) renderujPodglad();
      const blad = document.getElementById('blad-dalej');
      if (blad && store.zrodla.length && store.zrodla.every(function (z) { return z.licencja; })) blad.remove();
    });
    renderujRejestr();
  }

  AED.ui = AED.ui || {};
  /** Otwiera podgląd źródła i przenosi na niego fokus (używa js/ui/zdalne.js). */
  function pokazPodglad(id) {
    if (podgladId === id) { const n = document.getElementById('h-podglad'); if (n) n.focus(); return; }
    przelaczPodglad(id);
  }

  AED.ui.zrodla = { init: init, wgrajPliki: wgrajPliki, pokazPodglad: pokazPodglad };
})(window.AED);
