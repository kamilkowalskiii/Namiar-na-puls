/* Atrapa (mock) AED.zrodla.dgp do testów interfejsu bez sieci.
   Wczytuje się TYLKO, gdy prawdziwy moduł nie istnieje. Nie dołączaj na stałe do index.html.
   Sterowanie błędami: fraza „błąd” → SIEC, „nic” → brak wyników; zasób o nazwie zawierającej „cors” → CORS z linkiem ręcznym. */
(function (AED) {
  'use strict';
  AED.zrodla = AED.zrodla || {};
  if (AED.zrodla.dgp) return;

  function czekaj(ms, signal) {
    return new Promise(function (ok, nie) {
      const t = setTimeout(ok, ms);
      if (signal) signal.addEventListener('abort', function () {
        clearTimeout(t);
        const e = new Error('Przerwano pobieranie.'); e.kod = 'PRZERWANO'; nie(e);
      });
    });
  }
  function blad(kod, msg, link) { const e = new Error(msg); e.kod = kod; if (link) e['linkRęczny'] = link; return e; }
  const OPOZNIENIE = Number(window.MOCK_OPOZNIENIE || 600);

  if (!AED.zrodla.dgp) AED.zrodla.dgp = {
    szukaj: async function (fraza, o) {
      await czekaj(OPOZNIENIE, o && o.signal);
      if (/błąd/i.test(fraza)) throw blad('SIEC', 'Brak połączenia z API dane.gov.pl.');
      if (/nic/i.test(fraza)) return [];
      return [
        { id: 3624, tytul: 'Lokalizacja defibrylatorów AED w Krośnie', instytucja: 'Gmina Miasto Krosno',
          licencja: 'CC BY 4.0', licencjaOpis: 'Uznanie autorstwa 4.0', zmodyfikowano: '2025-03-14T10:00:00Z',
          url: 'https://dane.gov.pl/pl/dataset/3624',
          zasoby: [{ id: 1, nazwa: 'AED Krosno 2025', format: 'csv', url: 'https://dane.gov.pl/r/1', tabelaryczny: true },
            { id: 2, nazwa: 'AED Krosno (XLSX)', format: 'xlsx', url: 'https://dane.gov.pl/r/2', tabelaryczny: true },
            { id: 3, nazwa: 'Mapa – opis', format: 'pdf', url: 'https://dane.gov.pl/r/3', tabelaryczny: false }] },
        { id: 4581, tytul: 'Defibrylatory AED – Przemyśl', instytucja: 'Gmina Miejska Przemyśl',
          licencja: 'CC0 1.0', zmodyfikowano: '2024-10-01', url: 'javascript:alert(1)',
          zasoby: [{ id: 9, nazwa: 'zasób cors', format: 'csv', url: 'https://dane.gov.pl/r/9', tabelaryczny: true }] }
      ];
    },
    pobierzZasob: async function (zbior, zasob, o) {
      o = o || {};
      (o.onPostep || function () {})('Pobieranie ' + zasob.format + '…');
      await czekaj(OPOZNIENIE, o.signal);
      if (/cors/.test(zasob.nazwa)) throw blad('CORS', 'Serwer z plikiem nie pozwala na pobranie z przeglądarki.', zasob.url);
      return {
        kolumny: ['Lp', 'Adres', 'Lokalizacja'],
        wiersze: [{ Lp: '1', Adres: 'ul. Lwowska 28a', Lokalizacja: 'Urząd' }, { Lp: '2', Adres: 'ul. Bieszczadzka 1', Lokalizacja: 'Szkoła' }],
        meta: { format: zasob.format.toUpperCase(), url: zasob.url, dataDanych: zbior.zmodyfikowano,
          licencjaSugerowana: 'CC-BY-4.0', dysponentSugerowany: zbior.instytucja, atrybucja: zbior.instytucja + ', dane.gov.pl',
          naprawy: [], ostrzezenia: [], wzorzec: { zgodny: false, dopasowane: 1, wszystkie: 30, brakujaceObowiazkowe: ['x'] } }
      };
    }
  };
})(window.AED);
