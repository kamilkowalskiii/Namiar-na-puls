/* Krok 2: Dopasowanie kolumn źródeł do pól wzorca.
   Logika (podpowiedzi, zastosowanie mapowania, normalizacja) jest w js/core/mapowanie.js i js/core/normalizacja.js
   (AED.mapowanie, AED.normalizacja). Tu jest tylko interfejs.
   Wydajność: podgląd i przykłady liczymy na próbce wierszy, nigdy na całym źródle przy każdej zmianie.
   Dane ze źródeł są niezaufane – trafiają do DOM wyłącznie przez h() (textContent / atrybuty). */
(function (AED) {
  'use strict';
  const { h, odznaka, oglos, liczba, odmiana, tabelaPrzewijana } = AED.dom;
  const store = AED.store;

  const POLA = AED.wzorzec.schema.fields;
  const POLE = {};
  POLA.forEach(function (p) { POLE[p.name] = p; });
  const SLOWNIKI = AED.wzorzec.slowniki;

  const OBOW = { O: 'obowiązkowe', Z: 'zalecane', W: 'warunkowe', F: 'fakultatywne' };
  const POLA_ADRES = ['cecha_ulicy', 'ulica', 'numer_budynku', 'kod_pocztowy', 'miejscowosc'];
  const POLA_WSP = ['szerokosc_geograficzna', 'dlugosc_geograficzna'];
  // Pola, które moduł mapowania uzupełnia sam, gdy nie wskazano źródła wartości (nie blokują przejścia dalej)
  const POLA_AUTO_DOMYSLNE = ['id_aed', 'zrodlo_danych', 'licencja_rekordu', 'data_aktualizacji_rekordu'];
  const PODGLAD_N = 5;          // rekordy w podglądzie
  const PROBKA_NAPRAW = 2000;   // wiersze, na których liczymy listę automatycznych napraw
  const KLUCZOWE = ['nazwa', 'status', 'szerokosc_geograficzna', 'dlugosc_geograficzna', 'miejscowosc', 'ulica',
    'numer_budynku', 'kod_pocztowy', 'opis_lokalizacji', 'dostepnosc'];

  let wybraneId = null;          // id źródła pokazanego w tabeli
  let filtr = 'wszystkie';       // wszystkie | obowiazkowe | niedopasowane
  const podpowiedzi = {};        // id źródła -> mapowanie z podpowiedz()
  let timerNapraw = null;

  function $(id) { return document.getElementById(id); }
  function M() { return AED.mapowanie || null; }
  function polaAuto() {
    const m = M();
    return (m && Array.isArray(m.POLA_AUTOMATYCZNE)) ? m.POLA_AUTOMATYCZNE : POLA_AUTO_DOMYSLNE;
  }
  function klon(o) { return JSON.parse(JSON.stringify(o || {})); }
  function rekordow(n) { return liczba(n) + ' ' + odmiana(n, 'rekordzie', 'rekordach', 'rekordach'); }

  /** Wartość z rekordu w czytelnej postaci. */
  function pokazWartosc(v) {
    if (v === null || v === undefined || v === '') return '— (puste)';
    if (v === true) return 'tak';
    if (v === false) return 'nie';
    if (typeof v === 'number') return String(v);
    return String(v);
  }

  // ---------------------------------------------------------------- stan mapowania
  function zapewnijMapowanie(z) {
    if (!M()) return null;
    if (!podpowiedzi[z.id]) podpowiedzi[z.id] = M().podpowiedz(z) || {};
    if (!z.mapowanie) store.ustawMapowanie(z.id, klon(podpowiedzi[z.id]));
    return store.zrodlo(z.id).mapowanie;
  }

  function regula(m, pole) { return (m && m[pole]) || { regula: 'brak' }; }
  function ustalone(m, pole, z) {
    const r = regula(m, pole);
    // stała brana z rejestru źródeł (kod, licencja, dysponent) – liczy się bieżąca wartość źródła
    if (r.regula === 'stala' && r.zZrodla && z && z[r.zZrodla]) return true;
    if (r.regula === 'brak' || !r.regula) return false;
    if (r.regula === 'kolumna' || r.regula === 'adres' || r.regula === 'wspolrzedne_tekst') {
      if (!r.kolumna) return false;
      if (z && z.kolumny && z.kolumny.indexOf(r.kolumna) < 0 && !r.szablon) return false; // kolumny już nie ma w źródle
    }
    if (r.regula === 'stala' && (r.wartosc === undefined || r.wartosc === null || r.wartosc === '')) return false;
    return true;
  }
  /** Pola obowiązkowe bez ustalonego źródła wartości (z pominięciem uzupełnianych automatycznie). */
  function brakujaceObowiazkowe(z) {
    const m = z.mapowanie || {};
    const auto = polaAuto();
    return POLA.filter(function (p) {
      return p.aed.obowiazkowosc === 'O' && auto.indexOf(p.name) < 0 && !ustalone(m, p.name, z);
    });
  }
  /** Braki blokujące przejście dalej: bez współrzędnych rekord nie trafi na mapę. Pozostałe braki zgłosi walidacja. */
  function brakujaceKrytyczne(z) {
    return brakujaceObowiazkowe(z).filter(function (p) { return POLA_WSP.indexOf(p.name) >= 0; });
  }
  function kolumnaZniknela(z, r) {
    return (r.regula === 'kolumna' || r.regula === 'adres' || r.regula === 'wspolrzedne_tekst') && r.kolumna && !r.szablon &&
      z.kolumny.indexOf(r.kolumna) < 0;
  }
  function licznikObowiazkowych(z) {
    const auto = polaAuto();
    const obow = POLA.filter(function (p) { return p.aed.obowiazkowosc === 'O' && auto.indexOf(p.name) < 0; });
    const brak = brakujaceObowiazkowe(z).length;
    return { dopasowane: obow.length - brak, wszystkie: obow.length };
  }

  function zapiszRegule(z, pole, nowa, ogloszenie) {
    const m = klon(z.mapowanie);
    m[pole] = nowa;
    // jedna kolumna z adresem / współrzędnymi zasila kilka pól – uzupełniamy pola jeszcze bez źródła
    const pokrewne = [];
    if (nowa.regula === 'adres') {
      POLA_ADRES.forEach(function (p) {
        if (p !== pole && !ustalone(m, p)) { m[p] = { regula: 'adres', kolumna: nowa.kolumna, pewnosc: 'srednia', powod: 'Ustawiono razem z polem „' + POLE[pole].title + '”.' }; pokrewne.push(p); }
      });
    }
    if (nowa.regula === 'wspolrzedne_tekst') {
      POLA_WSP.forEach(function (p) {
        if (p !== pole) { m[p] = { regula: 'wspolrzedne_tekst', kolumna: nowa.kolumna, pewnosc: 'srednia', powod: 'Ustawiono razem z polem „' + POLE[pole].title + '”.' }; pokrewne.push(p); }
      });
    }
    store.ustawMapowanie(z.id, m);
    const tekst = (ogloszenie || 'Zapisano.') + (pokrewne.length
      ? ' Ta sama kolumna zasila też: ' + pokrewne.map(function (p) { return POLE[p].title; }).join(', ') + '.' : '');
    oglos(tekst);
  }

  // ---------------------------------------------------------------- próbka i podgląd
  function probka(z, n) {
    return Object.assign({}, z, { wiersze: z.wiersze.slice(0, n) });
  }
  function zastosujProbke(z, n) {
    try {
      return M().zastosuj(probka(z, n), z.mapowanie || {});
    } catch (e) {
      console.error('[AED] błąd podglądu mapowania', e);
      return { rekordy: [], podsumowanie: {}, blad: e.message || String(e) };
    }
  }

  /** Zlicza naprawy wg rodzaju (opis); zwraca [{opis, pole, rekordy, przyklad}] od najczęstszej. */
  function zliczNaprawy(rekordy) {
    const grupy = new Map();
    rekordy.forEach(function (r) {
      const widziane = new Set();
      (r._naprawy || []).forEach(function (n) {
        // rodzaj: stały kod naprawy (gdy moduł go podaje), inaczej opis – opis może zawierać konkretne wartości
        const klucz = (n.rodzaj || n.opis || 'Naprawa') + '\u0000' + (n.pole || '');
        let g = grupy.get(klucz);
        if (!g) { g = { opis: n.opisRodzaju || n.opis || 'Naprawa', pole: n.pole || '', rekordy: 0, przyklad: n }; grupy.set(klucz, g); }
        if (!widziane.has(klucz)) { g.rekordy++; widziane.add(klucz); }
      });
    });
    return Array.from(grupy.values()).sort(function (a, b) { return b.rekordy - a.rekordy; });
  }

  // ---------------------------------------------------------------- renderowanie: lista źródeł
  function renderujZrodla() {
    const kont = $('map-zrodla');
    kont.textContent = '';
    const zrodla = store.zrodla;
    if (!zrodla.length) return;
    const lista = h('ul', { class: 'map-zrodla' }, zrodla.map(function (z) {
      const l = licznikObowiazkowych(z);
      const pelne = l.dopasowane === l.wszystkie;
      const aktywne = z.id === wybraneId;
      return h('li', null, h('button', {
        type: 'button', id: 'map-zr-' + z.id, class: 'map-zrodlo' + (aktywne ? ' is-active' : ''),
        'aria-current': aktywne ? 'true' : null,
        onclick: function () { wybierz(z.id, true); }
      },
      h('span', { class: 'map-zrodlo__nazwa' }, h('code', null, z.kod), ' ', z.nazwa, h('span', { class: 'visually-hidden' }, ', ')),
      h('span', { class: 'map-zrodlo__stan' },
        odznaka(pelne ? 'ok' : brakujaceKrytyczne(z).length ? 'err' : 'warn',
          'dopasowano ' + l.dopasowane + ' z ' + l.wszystkie + ' obowiązkowych' + (brakujaceKrytyczne(z).length ? ' – brak współrzędnych' : '')),
        h('span', { class: 'visually-hidden' }, ', ')),
      h('span', { class: 'meta' }, liczba(z.wiersze.length) + ' ' + odmiana(z.wiersze.length, 'rekord', 'rekordy', 'rekordów'))));
    }));
    kont.appendChild(lista);
  }

  // ---------------------------------------------------------------- renderowanie: tabela pól
  function opcjeZrodla(z, p) {
    const auto = polaAuto().indexOf(p.name) >= 0;
    const opcje = [h('option', { value: 'brak' }, auto ? 'Automatycznie (uzupełnia narzędzie)' : 'Brak (pole puste)')];
    opcje.push(h('optgroup', { label: 'Kolumna źródła' }, z.kolumny.map(function (k) {
      return h('option', { value: 'k:' + k }, 'Kolumna: ' + k);
    })));
    if (POLA_ADRES.indexOf(p.name) >= 0) opcje.push(h('option', { value: 'adres' }, 'Rozbij adres z kolumny…'));
    if (POLA_WSP.indexOf(p.name) >= 0) opcje.push(h('option', { value: 'wspolrzedne_tekst' }, 'Współrzędne z jednej kolumny…'));
    opcje.push(h('option', { value: 'stala' }, 'Stała wartość…'));
    return opcje;
  }
  function wartoscSelecta(r) {
    if (r.regula === 'kolumna') return 'k:' + (r.kolumna || '');
    return r.regula || 'brak';
  }

  /** Pole na stałą wartość: słownik → select, logiczne → tak/nie, pozostałe → tekst. */
  function kontrolkaStalej(z, p, r) {
    const id = 'map-stala-' + p.name;
    const idBlad = id + '-blad', idRej = id + '-rej';
    // stała z rejestru źródeł (kod, licencja, dysponent): pokazujemy bieżącą wartość źródła
    const zRej = r.zZrodla ? (z[r.zZrodla] || null) : undefined;
    const biezaca = zRej !== undefined && zRej !== null ? zRej : r.wartosc;
    const zapisz = function (v) {
      zapiszRegule(z, p.name, { regula: 'stala', wartosc: v, pewnosc: 'wysoka', powod: 'Wartość ustawiona ręcznie.' },
        'Ustawiono stałą wartość pola „' + p.title + '”.');
      odswiezPoZmianie(p.name);
    };
    let ctrl;
    if (p.aed.slownik && SLOWNIKI[p.aed.slownik]) {
      ctrl = h('select', { id: id, 'aria-describedby': r.zZrodla ? idRej : null, onchange: function (e) { zapisz(e.target.value || null); } },
        h('option', { value: '' }, '— wybierz —'),
        SLOWNIKI[p.aed.slownik].map(function (s) {
          return h('option', { value: s.kod, selected: s.kod === biezaca }, s.etykieta + ' (' + s.kod + ')' + (r.zZrodla && s.kod === zRej ? ' – z rejestru źródeł' : ''));
        }));
    } else if (p.type === 'boolean') {
      ctrl = h('select', { id: id, onchange: function (e) { zapisz(e.target.value === '' ? null : e.target.value === 'true'); } },
        h('option', { value: '' }, '— wybierz —'),
        h('option', { value: 'true', selected: r.wartosc === true }, 'tak'),
        h('option', { value: 'false', selected: r.wartosc === false }, 'nie'));
    } else {
      ctrl = h('input', { type: 'text', id: id, value: biezaca === undefined || biezaca === null ? '' : String(biezaca),
        'aria-describedby': idBlad + (r.zZrodla ? ' ' + idRej : ''), onchange: function (e) {
          const wynik = AED.ui.wartosci.parsuj(p, e.target.value);
          const bladEl = $(idBlad);
          if (wynik.blad) {
            e.target.setAttribute('aria-invalid', 'true');
            bladEl.textContent = wynik.blad;
            bladEl.hidden = false;
            oglos(wynik.blad, true);
            return;
          }
          e.target.removeAttribute('aria-invalid');
          bladEl.hidden = true;
          zapisz(wynik.wartosc);
        } });
    }
    return h('div', { class: 'map-dodatkowe' },
      h('label', { for: id }, 'Stała wartość', h('span', { class: 'visually-hidden' }, ' pola ' + p.title)),
      ctrl,
      r.zZrodla ? h('p', { id: idRej, class: 'hint' }, zRej
        ? 'Wartość z rejestru źródeł (zmienisz ją w kroku 1). Wpisanie innej wartości zastąpi ją tylko w tym mapowaniu.'
        : 'Brak tej wartości w rejestrze źródeł – uzupełnij ją w kroku 1 albo wpisz tutaj.') : null,
      h('p', { id: idBlad, class: 'field-error', hidden: true }));
  }

  function kontrolkaKolumny(z, p, r, etykieta) {
    const id = 'map-kol-' + p.name;
    return h('div', { class: 'map-dodatkowe' },
      h('label', { for: id }, etykieta, h('span', { class: 'visually-hidden' }, ' (pole ' + p.title + ')')),
      h('select', { id: id, onchange: function (e) {
        const nowa = { regula: r.regula, kolumna: e.target.value || undefined, pewnosc: 'wysoka', powod: 'Wybrano ręcznie.' };
        zapiszRegule(z, p.name, nowa, 'Pole „' + p.title + '”: ' + (e.target.value ? 'kolumna ' + e.target.value : 'nie wybrano kolumny') + '.');
        odswiezPoZmianie(p.name);
      } },
      h('option', { value: '' }, '— wybierz kolumnę —'),
      z.kolumny.map(function (k) { return h('option', { value: k, selected: k === r.kolumna }, k); })));
  }

  function odznakaPewnosci(z, p, r) {
    const pod = podpowiedzi[z.id] && podpowiedzi[z.id][p.name];
    const auto = polaAuto().indexOf(p.name) >= 0 && !ustalone(z.mapowanie, p.name, z);
    if (auto) return h('div', null, odznaka('info', 'uzupełniane automatycznie'));
    if (!pod || !pod.regula || pod.regula === 'brak') {
      return pod && pod.powod ? h('div', null, odznaka('info', 'brak podpowiedzi'), h('span', { class: 'meta cell-note' }, pod.powod))
        : h('div', null, odznaka('info', 'brak podpowiedzi'));
    }
    const taSama = pod.regula === r.regula && (pod.kolumna || null) === (r.kolumna || null) &&
      JSON.stringify(pod.wartosc) === JSON.stringify(r.wartosc);
    if (!taSama) return h('div', null, odznaka('info', 'zmieniono ręcznie'),
      h('span', { class: 'meta cell-note' }, 'Podpowiedź: ', opisReguly(pod), '.'));
    const rodzaj = { wysoka: 'ok', srednia: 'info', niska: 'warn' }[pod.pewnosc] || 'info';
    const tekst = { wysoka: 'pewność wysoka', srednia: 'pewność średnia', niska: 'pewność niska – sprawdź' }[pod.pewnosc] || 'podpowiedź';
    return h('div', null, odznaka(rodzaj, tekst), pod.powod ? h('span', { class: 'meta cell-note' }, pod.powod) : null);
  }
  function opisReguly(r) {
    switch (r.regula) {
      case 'kolumna': return 'kolumna „' + r.kolumna + '”' + (r.wzorzec ? ', wyciąg wzorcem' : '');
      case 'adres': return 'adres z kolumny „' + r.kolumna + '”';
      case 'wspolrzedne_tekst': return 'współrzędne z kolumny „' + r.kolumna + '”';
      case 'stala': return 'stała wartość „' + pokazWartosc(r.wartosc) + '”';
      default: return 'brak';
    }
  }

  function wierszPola(z, p, przyklad) {
    const m = z.mapowanie || {};
    const r = regula(m, p.name);
    const idSel = 'map-sel-' + p.name;
    const obow = p.aed.obowiazkowosc;
    const brakuje = obow === 'O' && polaAuto().indexOf(p.name) < 0 && !ustalone(m, p.name, z);
    const krytyczne = brakuje && POLA_WSP.indexOf(p.name) >= 0;
    const zniknela = kolumnaZniknela(z, r);

    const sel = h('select', { id: idSel, 'aria-invalid': brakuje || zniknela ? 'true' : null,
      'aria-describedby': brakuje || zniknela ? 'map-brak-' + p.name : null,
      onchange: function (e) { zmienRegule(z, p, e.target.value); } }, opcjeZrodla(z, p));
    sel.value = wartoscSelecta(r);
    if (sel.value !== wartoscSelecta(r)) sel.value = 'brak'; // kolumna zniknęła ze źródła

    let dodatkowe = null;
    if (r.regula === 'stala') dodatkowe = kontrolkaStalej(z, p, r);
    else if (r.regula === 'adres') dodatkowe = kontrolkaKolumny(z, p, r, 'Kolumna z pełnym adresem');
    else if (r.regula === 'wspolrzedne_tekst') dodatkowe = kontrolkaKolumny(z, p, r, 'Kolumna ze współrzędnymi „szerokość, długość”');
    else if (r.regula === 'kolumna' && (r.wzorzec || r.szablon || r.zapas)) {
      // dodatki reguły z podpowiedzi (wzorzec, szablon, kolumna zapasowa) – zostają, dopóki użytkownik nie zmieni źródła wartości
      dodatkowe = h('p', { class: 'hint map-dodatkowe' },
        r.wzorzec ? ['Z kolumny „' + r.kolumna + '” brany jest tylko fragment pasujący do wzorca ', h('code', null, r.wzorzec), '.'] : null,
        r.szablon ? ['Wartość składana według szablonu ', h('code', null, r.szablon), '.'] : null,
        r.zapas ? ' Gdy komórka jest pusta – kolumna „' + r.zapas + '”.' : null);
    }

    return h('tr', { class: brakuje ? 'is-missing' : null },
      h('th', { scope: 'row' },
        h('span', { class: 'map-pole__tytul' }, p.title),
        h('code', { class: 'map-pole__kod' }, p.name),
        h('span', { class: 'map-obow map-obow--' + obow }, OBOW[obow] || obow)),
      h('td', null,
        h('label', { for: idSel, class: 'visually-hidden' }, 'Źródło wartości dla pola ' + p.title),
        sel, dodatkowe,
        zniknela ? h('p', { id: 'map-brak-' + p.name, class: 'field-error' }, 'Kolumny „' + r.kolumna + '” nie ma już w źródle – wybierz inną.')
          : brakuje ? h('p', { id: 'map-brak-' + p.name, class: krytyczne ? 'field-error' : 'field-warn' }, krytyczne
            ? 'Bez współrzędnych nie można przejść dalej – wskaż źródło wartości.'
            : 'Pole obowiązkowe bez źródła wartości. Możesz przejść dalej – walidacja zgłosi brak, a uzupełnisz go zbiorczo.') : null),
      h('td', null, odznakaPewnosci(z, p, r)),
      h('td', { class: 'map-przyklad' }, przyklad));
  }

  function zmienRegule(z, p, v) {
    let nowa;
    if (v === 'brak') nowa = { regula: 'brak', pewnosc: 'wysoka', powod: 'Wybrano ręcznie.' };
    else if (v.indexOf('k:') === 0) nowa = { regula: 'kolumna', kolumna: v.slice(2), pewnosc: 'wysoka', powod: 'Wybrano ręcznie.' };
    else {
      const stara = regula(z.mapowanie, p.name);
      nowa = { regula: v, pewnosc: 'wysoka', powod: 'Wybrano ręcznie.' };
      if ((v === 'adres' || v === 'wspolrzedne_tekst') && stara.kolumna) nowa.kolumna = stara.kolumna;
    }
    const opis = { brak: 'brak', stala: 'stała wartość – wpisz ją w polu obok', adres: 'rozbicie adresu – wybierz kolumnę',
      wspolrzedne_tekst: 'współrzędne z jednej kolumny – wybierz kolumnę' }[v] || ('kolumna ' + v.slice(2));
    zapiszRegule(z, p.name, nowa, 'Pole „' + p.title + '”: ' + opis + '.');
    odswiezPoZmianie(p.name, v === 'stala' ? 'map-stala-' + p.name
      : (v === 'adres' || v === 'wspolrzedne_tekst') ? 'map-kol-' + p.name : null);
  }

  /** Po zmianie reguły: przebudowa tabeli (z zachowaniem fokusu) i podglądu na próbce. */
  function odswiezPoZmianie(pole, fokusId) {
    const aktywny = fokusId || (document.activeElement && document.activeElement.id);
    renderujZrodla();
    renderujPanel();
    const el = aktywny && $(aktywny);
    if (el) el.focus();
    else { const s = $('map-sel-' + pole); if (s) s.focus(); }
    usunBladDalej(false);
    renderujUwagi();
  }

  function renderujPanel() {
    const kont = $('map-panel');
    kont.textContent = '';
    const z = wybraneId && store.zrodlo(wybraneId);
    if (!z) return;
    zapewnijMapowanie(z);
    const zr = store.zrodlo(z.id);
    const wynik = zastosujProbke(zr, PODGLAD_N);
    const pierwszy = wynik.rekordy[0] || null;

    // filtr
    const filtry = h('fieldset', { class: 'radio-group map-filtr' },
      h('legend', null, 'Pokaż pola'),
      [['wszystkie', 'Wszystkie'], ['obowiazkowe', 'Tylko obowiązkowe'], ['niedopasowane', 'Tylko niedopasowane']].map(function (f) {
        const id = 'map-filtr-' + f[0];
        return h('div', { class: 'radio' },
          h('input', { type: 'radio', name: 'map-filtr', id: id, value: f[0], checked: filtr === f[0],
            onchange: function () {
              filtr = f[0]; renderujPanel(); $(id).focus();
              const n = document.querySelectorAll('#map-panel tbody tr').length;
              oglos('Pokazano ' + n + ' ' + odmiana(n, 'pole', 'pola', 'pól') + '.');
            } }),
          h('label', { for: id }, f[1]));
      }));

    const akcje = h('div', { class: 'remote-actions' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', id: 'map-przywroc', onclick: function () {
        podpowiedzi[zr.id] = M().podpowiedz(zr) || {};
        store.ustawMapowanie(zr.id, klon(podpowiedzi[zr.id]));
        renderujZrodla(); renderujPanel();
        $('map-przywroc').focus();
        usunBladDalej(false);
        renderujUwagi();
        oglos('Przywrócono podpowiedzi dla źródła ' + zr.kod + '.');
      } }, 'Przywróć podpowiedzi'));

    // tabele wg grup
    const grupy = [];
    POLA.forEach(function (p) {
      let g = grupy.find(function (x) { return x.nazwa === p.aed.grupa; });
      if (!g) { g = { nazwa: p.aed.grupa, pola: [] }; grupy.push(g); }
      g.pola.push(p);
    });
    const m = zr.mapowanie || {};
    const tabele = grupy.map(function (g) {
      const pola = g.pola.filter(function (p) {
        if (filtr === 'obowiazkowe') return p.aed.obowiazkowosc === 'O';
        if (filtr === 'niedopasowane') return !ustalone(m, p.name, zr) && polaAuto().indexOf(p.name) < 0;
        return true;
      });
      if (!pola.length) return null;
      const tabela = h('table', { class: 'map-tabela' },
        h('caption', null, g.nazwa, h('span', { class: 'meta' }, ' (' + pola.length + ' ' + odmiana(pola.length, 'pole', 'pola', 'pól') + ')')),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Pole wzorca'),
          h('th', { scope: 'col' }, 'Źródło wartości'),
          h('th', { scope: 'col' }, 'Podpowiedź'),
          h('th', { scope: 'col' }, 'Przykład po zmianach'))),
        h('tbody', null, pola.map(function (p) {
          return wierszPola(zr, p, pierwszy ? pokazWartosc(pierwszy[p.name]) : '—');
        })));
      return tabelaPrzewijana('Pola z grupy ' + g.nazwa, tabela);
    }).filter(Boolean);

    const l = licznikObowiazkowych(zr);
    kont.appendChild(h('section', { class: 'panel map-panel', 'aria-labelledby': 'h-map-panel' },
      h('h2', { id: 'h-map-panel', tabindex: '-1' }, 'Mapowanie: ', zr.nazwa, ' (', zr.kod, ')'),
      h('p', null, 'Dopasowano ' + l.dopasowane + ' z ' + l.wszystkie + ' pól obowiązkowych. ' +
        'Przykłady pochodzą z pierwszego wiersza źródła po zmianach (np. zamianie przecinka na kropkę).'),
      h('div', { class: 'map-narzedzia' }, filtry, akcje),
      wynik.blad ? h('p', { class: 'alert alert--err' }, 'Nie udało się przygotować podglądu: ', wynik.blad) : null,
      tabele.length ? tabele : h('p', { class: 'empty' }, filtr === 'niedopasowane'
        ? 'Wszystkie pola mają ustalone źródło wartości.' : 'Brak pól do pokazania.')));

    renderujPodglad(zr, wynik);
    zaplanujNaprawy(zr);
  }

  function renderujPodglad(z, wynik) {
    const kont = $('map-podglad');
    kont.textContent = '';
    const rekordy = wynik.rekordy.slice(0, PODGLAD_N);
    const tabela = h('table', { class: 'table--data' },
      h('caption', null, 'Pierwsze ' + rekordy.length + ' z ' + liczba(z.wiersze.length) + ' ' +
        odmiana(z.wiersze.length, 'rekordu', 'rekordów', 'rekordów') + ' po zastosowaniu mapowania'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Wiersz'),
        KLUCZOWE.map(function (k) { return h('th', { scope: 'col' }, POLE[k] ? POLE[k].title : k); }))),
      h('tbody', null, rekordy.map(function (r, i) {
        return h('tr', null, h('th', { scope: 'row' }, String(r._wiersz || i + 1)),
          KLUCZOWE.map(function (k) { const t = pokazWartosc(r[k]); return h('td', { title: t }, t); }));
      })));
    kont.appendChild(h('section', { class: 'map-podglad', 'aria-labelledby': 'h-map-podglad' },
      h('h2', { id: 'h-map-podglad' }, 'Podgląd rekordów'),
      rekordy.length ? tabelaPrzewijana('Podgląd rekordów źródła ' + z.kod, tabela) : h('p', { class: 'empty' }, 'Źródło nie ma wierszy.'),
      h('div', { id: 'map-naprawy', 'aria-live': 'off' })));
  }

  /** Lista napraw liczona z opóźnieniem (po serii zmian) na próbce do PROBKA_NAPRAW wierszy. */
  function zaplanujNaprawy(z) {
    clearTimeout(timerNapraw);
    const kont = $('map-naprawy');
    if (kont) kont.setAttribute('aria-busy', 'true');
    timerNapraw = setTimeout(function () {
      const kont = $('map-naprawy');
      const zr = store.zrodlo(z.id);
      if (!kont || !zr || zr.id !== wybraneId) return;
      const n = Math.min(zr.wiersze.length, PROBKA_NAPRAW);
      const wynik = zastosujProbke(zr, n);
      const grupy = zliczNaprawy(wynik.rekordy);
      kont.textContent = '';
      kont.setAttribute('aria-busy', 'false');
      kont.appendChild(h('h3', null, 'Automatyczne naprawy'));
      if (n < zr.wiersze.length) {
        kont.appendChild(h('p', { class: 'meta' }, 'Policzone na pierwszych ' + liczba(n) + ' z ' + liczba(zr.wiersze.length) +
          ' rekordów. Pełne zestawienie zobaczysz w kroku 3.'));
      }
      if (!grupy.length) { kont.appendChild(h('p', { class: 'empty' }, 'Nie było potrzeby niczego poprawiać.')); return; }
      kont.appendChild(h('ul', { class: 'map-naprawy' }, grupy.map(function (g) {
        return h('li', null, g.opis.replace(/\.\s*$/, ''), ' w ', h('strong', null, rekordow(g.rekordy)),
          g.przyklad && (g.przyklad.z !== undefined || g.przyklad.na !== undefined)
            ? h('span', { class: 'meta przyklad-zmiany' }, ' (np. „' + pokazWartosc(g.przyklad.z) + '” → „' + pokazWartosc(g.przyklad.na) + '”)') : null);
      })));
    }, 300);
  }

  // ---------------------------------------------------------------- wybór źródła i przejście dalej
  function wybierz(id, fokus) {
    wybraneId = id;
    renderujZrodla();
    renderujPanel();
    if (fokus) { const n = $('h-map-panel'); if (n) n.focus(); }
  }

  function renderuj() {
    const brakModulu = $('map-brak-modulu');
    brakModulu.hidden = !!M();
    if (!M()) { $('map-zrodla').textContent = ''; $('map-panel').textContent = ''; $('map-podglad').textContent = ''; return; }
    const zrodla = store.zrodla;
    $('map-pusto').hidden = zrodla.length > 0;
    zrodla.forEach(zapewnijMapowanie);
    if (!wybraneId || !store.zrodlo(wybraneId)) wybraneId = zrodla.length ? zrodla[0].id : null;
    renderujZrodla();
    renderujPanel();
    renderujUwagi();
    if (!zrodla.length) { $('map-podglad').textContent = ''; }
  }

  function usunBladDalej(wymus) {
    const box = $('map-blad-dalej');
    if (!box) return;
    if (wymus || store.zrodla.every(function (z) { return !brakujaceKrytyczne(z).length; })) box.remove();
  }

  /** Lista linków do pól (przełącza źródło i ustawia fokus). */
  function linkiPol(b) {
    return h('li', null, h('code', null, b.z.kod), ' ', b.z.nazwa, ': ',
      b.pola.map(function (p, i) {
        return [i ? ', ' : '', h('a', { href: '#map-sel-' + p.name, onclick: function (e) {
          e.preventDefault(); pokazPole(b.z.id, p.name);
        } }, p.title)];
      }));
  }

  /** Stałe ostrzeżenie: pola obowiązkowe bez źródła wartości (nie blokują przejścia dalej). */
  function renderujUwagi() {
    const kont = $('map-uwagi');
    if (!kont) return;
    kont.textContent = '';
    if (!M()) return;
    const braki = store.zrodla.map(function (z) {
      return { z: z, pola: brakujaceObowiazkowe(z).filter(function (p) { return POLA_WSP.indexOf(p.name) < 0; }) };
    }).filter(function (b) { return b.pola.length; });
    if (!braki.length) return;
    kont.appendChild(h('div', { class: 'alert alert--warn' },
      h('p', null, h('strong', null, 'Pola obowiązkowe bez źródła wartości. '),
        'Możesz przejść dalej – w kroku 3 te pola będą oznaczone jako błędy i uzupełnisz je jedną wartością dla wielu rekordów. ' +
        'Możesz też wskazać kolumnę albo stałą wartość już teraz:'),
      h('ul', null, braki.map(linkiPol))));
  }

  async function dalej() {
    const przycisk = $('dalej-walidacja');
    if (przycisk.getAttribute('aria-disabled') === 'true') return;
    usunBladDalej(true);
    const akcje = document.querySelector('[data-route="mapowanie"] .step-actions');
    const pokazBlad = function (tresc) {
      akcje.before(h('div', { id: 'map-blad-dalej', class: 'alert alert--err', role: 'alert' }, tresc));
    };
    if (!M()) { pokazBlad(h('p', null, 'Nie wczytano modułu mapowania (js/core/mapowanie.js).')); return; }
    const zrodla = store.zrodla;
    if (!zrodla.length) {
      pokazBlad(h('p', null, 'Nie ma źródeł do dopasowania. ', h('a', { href: '#zrodla' }, 'Dodaj źródło w kroku 1'), '.'));
      return;
    }
    zrodla.forEach(zapewnijMapowanie);
    const braki = store.zrodla.map(function (z) { return { z: z, pola: brakujaceKrytyczne(z) }; })
      .filter(function (b) { return b.pola.length; });
    if (braki.length) {
      pokazBlad([
        h('p', null, h('strong', null, 'Nie można przejść dalej. '),
          'Bez współrzędnych rekordy nie trafią na mapę. Wskaż kolumnę ze współrzędnymi (albo jedną kolumnę z parą „szerokość, długość”):'),
        h('ul', null, braki.map(linkiPol))
      ]);
      pokazPole(braki[0].z.id, braki[0].pola[0].name);
      return;
    }
    // przeliczenie wszystkich rekordów (może potrwać przy dużych zbiorach) – najpierw pokazujemy stan
    przycisk.setAttribute('aria-disabled', 'true');
    przycisk.classList.add('is-busy');
    const stan = $('map-stan');
    stan.hidden = false;
    stan.textContent = 'Przeliczanie ' + liczba(store.liczbaRekordow) + ' rekordów…';
    oglos(stan.textContent);
    await new Promise(function (ok) { setTimeout(ok, 30); });
    try {
      await AED.ui.walidacja.uruchom();
      AED.router.idz('walidacja');
    } catch (e) {
      console.error(e);
      pokazBlad(h('p', null, 'Nie udało się przeliczyć rekordów: ', e.message || String(e)));
      przycisk.focus();
    } finally {
      przycisk.removeAttribute('aria-disabled');
      przycisk.classList.remove('is-busy');
      stan.hidden = true;
      stan.textContent = '';
    }
  }

  /** Pokazuje pole w tabeli (przełącza źródło, w razie potrzeby filtr) i ustawia na nim fokus. */
  function pokazPole(idZrodla, pole) {
    if (filtr === 'obowiazkowe' && POLE[pole].aed.obowiazkowosc !== 'O') filtr = 'wszystkie';
    if (idZrodla !== wybraneId) wybierz(idZrodla, false); else { renderujZrodla(); renderujPanel(); }
    const el = $('map-sel-' + pole);
    if (el) el.focus();
  }

  function init() {
    $('dalej-walidacja').addEventListener('click', dalej);
    AED.on('trasa', function (e) { if (e.trasa === 'mapowanie') renderuj(); });
    AED.on('zrodla:zmiana', function (e) {
      if (e.akcja === 'usunieto') delete podpowiedzi[e.zrodlo.id];
      // inny arkusz w kroku 1 → nowe kolumny, stare mapowanie nieaktualne
      if (e.akcja === 'zmieniono' && e.pola && e.pola.indexOf('kolumny') >= 0) {
        delete podpowiedzi[e.zrodlo.id];
        if (M()) {
          podpowiedzi[e.zrodlo.id] = M().podpowiedz(e.zrodlo) || {};
          store.ustawMapowanie(e.zrodlo.id, klon(podpowiedzi[e.zrodlo.id]));
        }
      }
      if (AED.router.trasa === 'mapowanie' && !(e.pola && e.pola.length === 1 && e.pola[0] === 'mapowanie')) renderuj();
    });
  }

  AED.ui = AED.ui || {};
  AED.ui.mapowanie = { init: init, brakujaceObowiazkowe: brakujaceObowiazkowe, brakujaceKrytyczne: brakujaceKrytyczne, zapewnijMapowanie: zapewnijMapowanie,
    zliczNaprawy: zliczNaprawy, pokazWartosc: pokazWartosc };
})(window.AED);
