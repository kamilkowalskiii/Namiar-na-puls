/* Atrapa AED.gov (część 6: symulowana wysyłka do „bazy gov.pl”) – do testów interfejsu, gdy js/core/gov.js
   jeszcze nie istnieje albo test chce wymusić zachowanie (błąd, opóźnienie). NIE dołączać do index.html.
   Kontrakt (od BACK):
     tryb() -> Promise<'serwer'|'przegladarka'>
     zbierzZgloszenie(metadane?) -> obiekt z 4 etapów
     gotowosc(stanUI?) -> { gotowe, braki: [{ etap: 1..4, komunikat, pole? }] }
     wyslij(zgloszenie, { onPostep, opoznienieMs, signal }) -> Promise<{ id, numer, status: 'zatwierdzono_gov', data_wyslania, liczba, statystyki, tryb }>
     statystyki() -> Promise<{ liczba, sumaRekordow, ostatnie: [...] }>
     pobierzBaze() -> Promise<Blob>   // plik „wyniki.gov” (SQLite)
   Ustawienia (przed wczytaniem): window.AED_MOCK_GOV = { wymus: true, blad: 'tekst' | null, tryb: 'przegladarka' } */
(function (AED) {
  'use strict';
  const cfg = window.AED_MOCK_GOV || {};
  if (AED.gov && !cfg.wymus) return;
  const baza = [];

  function store() { return AED.store || {}; }
  function zbierzZgloszenie(metadane) {
    const s = store();
    const w = AED.ui && AED.ui.wynik && AED.ui.wynik.stan;
    const rekordy = (w && w.eksport) || [];
    return {
      etap1: { zrodla: (s.zrodla || []).map(function (z) { return { kod: z.kod, nazwa: z.nazwa, licencja: z.licencja }; }) },
      etap2: { mapowanie: (s.zrodla || []).map(function (z) { return { kod: z.kod, pola: Object.keys(z.mapowanie || {}).length }; }) },
      etap3: { duplikaty: s.duplikaty ? (s.duplikaty.grupy || []).length : null, decyzje: Object.keys(s.decyzje || {}).length },
      etap4: { metadane: metadane || null, rekordy: rekordy.length },
      rekordy: rekordy
    };
  }
  function gotowosc(stanUI) {
    const s = store();
    const braki = [];
    if (!(s.zrodla || []).length) braki.push({ etap: 1, komunikat: 'Dodaj co najmniej jedno źródło danych.' });
    if (!(s.rekordy || []).length) braki.push({ etap: 2, komunikat: 'Dopasuj kolumny i przelicz rekordy.' });
    const k3 = AED.ui && AED.ui.walidacja && AED.ui.walidacja.stan;
    if (!(k3 && k3.gotowe)) braki.push({ etap: 3, komunikat: 'Sprawdź rekordy w kroku 3 (walidacja).' });
    if (!s.duplikaty) braki.push({ etap: 3, komunikat: 'Wyszukaj duplikaty w kroku 3.' });
    const pm = (stanUI && stanUI.problemyMetadanych) || [];
    pm.filter(function (p) { return p.poziom !== 'ostrzezenie'; }).forEach(function (p) {
      braki.push({ etap: 4, pole: p.pole, komunikat: 'Metadane: ' + p.komunikat });
    });
    if (stanUI && !stanUI.metadane) braki.push({ etap: 4, komunikat: 'Uzupełnij opis zbioru (metadane).' });
    return { gotowe: !braki.length, braki: braki };
  }
  function statystyki() {
    return Promise.resolve({
      liczba: baza.length,
      sumaRekordow: baza.reduce(function (a, x) { return a + x.liczbaRekordow; }, 0),
      ostatnie: baza.slice(-5).reverse().map(function (x) { return { numer: x.numer, data_wyslania: x.data_wyslania, liczba_rekordow: x.liczbaRekordow, tytul: x.tytul }; })
    });
  }
  function czekaj(ms, signal) {
    return new Promise(function (ok, nie) {
      const t = setTimeout(ok, ms);
      if (signal) signal.addEventListener('abort', function () { clearTimeout(t); nie(Object.assign(new Error('Przerwano.'), { name: 'AbortError' })); });
    });
  }
  async function wyslij(z, o) {
    o = o || {};
    const krok = Math.max(0, (o.opoznienieMs === undefined ? 1200 : o.opoznienieMs) / 3);
    const post = o.onPostep || function () {};
    post('Trwa weryfikacja i wysyłka danych do systemu gov.pl...');
    await czekaj(krok, o.signal);
    post('Sprawdzanie zgodności rekordów ze wzorcem…');
    await czekaj(krok, o.signal);
    if (cfg.blad) throw new Error(cfg.blad);
    post('Zapisywanie zgłoszenia w pliku wyniki.gov…');
    await czekaj(krok, o.signal);
    const n = baza.length + 1;
    const wpis = { id: n, numer: 'SYM-' + new Date().getFullYear() + '-' + String(n).padStart(6, '0'), data_wyslania: new Date().toISOString(),
      liczbaRekordow: (z && z.rekordy ? z.rekordy.length : 0), tytul: z && z.etap4 && z.etap4.metadane ? z.etap4.metadane.tytul : '' };
    baza.push(wpis);
    const stat = await statystyki();
    return { id: wpis.id, numer: wpis.numer, status: 'zatwierdzono_gov', data_wyslania: wpis.data_wyslania, liczba: baza.length,
      statystyki: stat, tryb: cfg.tryb || 'przegladarka' };
  }
  function pobierzBaze() {
    // nagłówek pliku SQLite (16 bajtów) + treść atrapy
    const naglowek = 'SQLite format 3\u0000';
    return Promise.resolve(new Blob([naglowek, JSON.stringify(baza)], { type: 'application/vnd.sqlite3' }));
  }
  AED.gov = { atrapa: true, tryb: function () { return Promise.resolve(cfg.tryb || 'przegladarka'); },
    zbierzZgloszenie: zbierzZgloszenie, gotowosc: gotowosc, wyslij: wyslij, statystyki: statystyki, pobierzBaze: pobierzBaze };
})(window.AED);
