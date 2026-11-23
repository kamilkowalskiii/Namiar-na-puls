/* Atrapa (mock) AED.formularz i AED.geokoder (kontrakt części 5) do testów interfejsu bez sieci.
   Wczytuje się TYLKO, gdy prawdziwe moduły nie istnieją; window.AED_MOCK_CZESC5 = 'geokoder' wymusza atrapę
   samego geokodera (testy e2e bez sieci), 'wszystko' – obu modułów. Nie dołączaj na stałe do index.html.
   Sygnatury jak w js/core/formularz.js i js/sources/geokoder.js (część 5).
   Geokoder: fraza z „błąd” → SIEC, „limit” → LIMIT, „nic” → brak wyników; inne → dwie propozycje w Krośnie. */
(function (AED) {
  'use strict';
  const tryb = window.AED_MOCK_CZESC5 || '';
  const W = AED.wzorzec;
  const POLA = W.schema.fields;
  const POLE = {};
  POLA.forEach(function (p) { POLE[p.name] = p; });

  function blad(kod, msg) { const e = new Error(msg); e.kod = kod; return e; }
  function czekaj(ms, signal) {
    return new Promise(function (ok, nie) {
      if (signal && signal.aborted) { nie(blad('PRZERWANO', 'Przerwano.')); return; }
      const t = setTimeout(ok, ms);
      if (signal) signal.addEventListener('abort', function () { clearTimeout(t); nie(blad('PRZERWANO', 'Przerwano.')); });
    });
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const x = Array.from(b, function (v) { return v.toString(16).padStart(2, '0'); }).join('');
    return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
  }
  function dzis() { return new Date().toISOString().slice(0, 10); }
  function pusta(v) { return v === null || v === undefined || v === ''; }

  // ------------------------------------------------------------------ formularz
  if (tryb === 'wszystko' || !AED.formularz) {
    const GRUPY = [
      ['Miejsce i status', ['nazwa', 'status', 'id_lokalne']],
      ['Lokalizacja', ['szerokosc_geograficzna', 'dlugosc_geograficzna', 'zrodlo_wspolrzednych', 'lokalizacja_przyblizona',
        'miejscowosc', 'cecha_ulicy', 'ulica', 'numer_budynku', 'kod_pocztowy', 'kod_terc_gminy', 'wojewodztwo',
        'opis_lokalizacji', 'opis_lokalizacji_en', 'wewnatrz_budynku', 'kondygnacja']],
      ['Dostępność', ['dostepnosc', 'godziny_dostepnosci', 'sposob_dostepu', 'instrukcja_dostepu']],
      ['Urządzenie', ['typ_urzadzenia', 'producent', 'model', 'tryb_pediatryczny', 'data_waznosci_elektrod', 'data_waznosci_baterii', 'data_przegladu']],
      ['Dysponent', ['dysponent_nazwa', 'dysponent_typ', 'dysponent_regon', 'telefon_kontaktowy', 'email_kontaktowy']],
      ['Weryfikacja', ['data_weryfikacji', 'sposob_weryfikacji', 'uwagi']]
    ];
    const TYP = { boolean: 'tak_nie', date: 'data', number: 'liczba', integer: 'liczba' };
    const POLA_TECHNICZNE = ['id_aed', 'lokalizacja_przyblizona', 'zrodlo_wspolrzednych', 'kod_terc_gminy', 'wojewodztwo'];
    const POLA_FORMULARZA = [];
    GRUPY.forEach(function (g) {
      g[1].forEach(function (n) {
        if (POLA_TECHNICZNE.indexOf(n) >= 0) return;
        const f = POLE[n], o = f.aed.obowiazkowosc;
        POLA_FORMULARZA.push({ grupa: g[0], pole: n, etykieta: f.title, typ: f.aed.slownik ? 'slownik' : (TYP[f.type] || ((f.constraints || {}).maxLength >= 300 ? 'tekst_dlugi' : 'tekst')),
          pomoc: f.description, wymagane: o === 'O', zalecane: o === 'Z' || o === 'W', warunek: null,
          slownik: f.aed.slownik ? W.slowniki[f.aed.slownik] : undefined, maks: (f.constraints || {}).maxLength });
      });
    });
    const KLUCZ = 'aed.formularz.szkic.v1';

    function normalizujWpis(pole, tekst) {
      const p = POLE[pole];
      const t = tekst === null || tekst === undefined ? '' : String(tekst).trim();
      if (!p) return { wartosc: t || null };
      if (t === '') return { wartosc: null };
      if (p.type === 'number' || p.type === 'integer') {
        const v = Number(t.replace(',', '.').replace(/\s/g, ''));
        if (!isFinite(v)) return { wartosc: t, problem: 'Wpisz liczbę, np. ' + (p.type === 'integer' ? '0' : '49.6887') + '.' };
        if (p.type === 'integer' && !Number.isInteger(v)) return { wartosc: t, problem: 'Wpisz liczbę całkowitą.' };
        return { wartosc: p.type === 'number' ? Math.round(v * 1e6) / 1e6 : v };
      }
      if (p.type === 'boolean') {
        if (/^(true|tak|t|1|yes)$/i.test(t)) return { wartosc: true };
        if (/^(false|nie|n|0|no)$/i.test(t)) return { wartosc: false };
        return { wartosc: t, problem: 'Wybierz „Tak” albo „Nie”.' };
      }
      if (p.type === 'date') {
        let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
        if (!m) { const x = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/.exec(t); if (x) m = [null, x[3], x[2].padStart(2, '0'), x[1].padStart(2, '0')]; }
        if (!m) return { wartosc: t, problem: 'Wpisz datę w postaci RRRR-MM-DD, np. 2026-05-31.' };
        return { wartosc: m[1] + '-' + m[2] + '-' + m[3] };
      }
      if (pole === 'telefon_kontaktowy') return { wartosc: t.replace(/[\s()-]/g, '') };
      if (pole === 'dysponent_regon') return { wartosc: t.replace(/[\s-]/g, '') };
      if (pole === 'kod_pocztowy' && /^\d{5}$/.test(t)) return { wartosc: t.slice(0, 2) + '-' + t.slice(2) };
      return { wartosc: t };
    }

    function waliduj(r) {
      const wynik = [];
      const dodaj = function (pole, poziom, kod, komunikat) { wynik.push({ pole: pole, poziom: poziom, kod: kod, komunikat: komunikat, wartosc: r[pole] }); };
      POLA.forEach(function (p) {
        const v = r[p.name];
        const c = p.constraints || {};
        if (/^(id_aed|zrodlo_danych|licencja_rekordu|data_aktualizacji_rekordu)$/.test(p.name)) return;
        const wg = p.aed.wymaganeGdy;
        let wymagane = !!c.required;
        if (wg && !pusta(r[wg.pole]) && (wg.niepuste || (wg.wartosci || []).indexOf(r[wg.pole]) >= 0)) wymagane = true;
        if (pusta(v)) { if (wymagane) dodaj(p.name, 'blad', 'WYMAGANE', 'Uzupełnij pole „' + p.title + '”.'); return; }
        if (c.enum && c.enum.indexOf(v) < 0) dodaj(p.name, 'blad', 'SLOWNIK', 'Wybierz wartość z listy.');
        if (c.pattern && !new RegExp(c.pattern).test(String(v))) dodaj(p.name, 'blad', 'FORMAT', 'Niepoprawny format. Oczekiwany: ' + p.aed.format + '.');
        if ((p.type === 'number' || p.type === 'integer') && typeof v !== 'number') dodaj(p.name, 'blad', 'LICZBA', 'Wpisz liczbę.');
        else if (typeof v === 'number') {
          if (c.minimum !== undefined && v < c.minimum) dodaj(p.name, 'blad', 'ZAKRES', 'Wartość poniżej ' + c.minimum + ' (poza Polską?).');
          if (c.maximum !== undefined && v > c.maximum) dodaj(p.name, 'blad', 'ZAKRES', 'Wartość powyżej ' + c.maximum + ' (poza Polską?).');
        }
        if (c.maxLength && String(v).length > c.maxLength) dodaj(p.name, 'blad', 'DLUGOSC', 'Najwyżej ' + c.maxLength + ' znaków (jest ' + String(v).length + ').');
        if (p.type === 'date' && /^data_waznosci/.test(p.name) && String(v) < dzis()) dodaj(p.name, 'ostrzezenie', 'PRZETERMINOWANE', 'Data już minęła – sprawdź, czy wymieniono.');
      });
      return wynik;
    }

    function ustawPunkt(r, lat, lon, skad) {
      r.szerokosc_geograficzna = Math.round(lat * 1e6) / 1e6; r.dlugosc_geograficzna = Math.round(lon * 1e6) / 1e6;
      r.zrodlo_wspolrzednych = skad === 'gps' ? 'pomiar_gps' : skad === 'adres' ? 'geokodowanie_adresu' : 'wskazanie_na_mapie';
      r.lokalizacja_przyblizona = skad === 'adres';
      return r;
    }
    AED.formularz = {
      atrapa: true,
      GRUPY: GRUPY.map(function (g) { return { id: g[0], nazwa: g[0], opis: '' }; }),
      POLA_FORMULARZA: POLA_FORMULARZA,
      POLA_TECHNICZNE: POLA_TECHNICZNE,
      pusty: function (d) {
        const dys = typeof d === 'string' ? { nazwa: d } : (d || {});
        return { id_aed: uuid(), status: 'aktywny', lokalizacja_przyblizona: false, zrodlo_wspolrzednych: 'wskazanie_na_mapie',
          data_weryfikacji: dzis(), sposob_weryfikacji: 'potwierdzenie_dysponenta', dysponent_nazwa: dys.nazwa || null };
      },
      ustawPunkt: ustawPunkt,
      zGeokodera: function (r, w, o) {
        o = o || {};
        const ustaw = function (k, v) { if (!pusta(v) && (o.nadpisz || pusta(r[k]))) r[k] = v; };
        ustaw('miejscowosc', w.miejscowosc); ustaw('cecha_ulicy', w.ulica ? w.cecha_ulicy : null); ustaw('ulica', w.ulica);
        ustaw('numer_budynku', w.numer); ustaw('kod_pocztowy', w.kod_pocztowy); ustaw('kod_terc_gminy', w.kod_terc_gminy); ustaw('wojewodztwo', w.wojewodztwo);
        if (o.punkt && typeof w.lat === 'number') ustawPunkt(r, w.lat, w.lon, 'adres');
        return r;
      },
      normalizujWpis: normalizujWpis,
      waliduj: waliduj,
      dodajDoZbioru: function (rekordy, o) {
        o = o || {};
        const nazwa = o.dysponent || 'dysponent';
        const kolumny = POLA.map(function (p) { return p.name; });
        const wiersze = rekordy.map(function (r) {
          const w = {};
          kolumny.forEach(function (k) { const v = r[k]; w[k] = pusta(v) ? '' : String(v); });
          w.licencja_rekordu = o.licencja || 'CC0-1.0';
          return w;
        });
        return AED.store.dodajZrodlo({ typ: 'FORMULARZ', nazwa: 'Formularz – ' + nazwa, dysponent: nazwa, licencja: o.licencja || 'CC0-1.0',
          kolumny: kolumny, wiersze: wiersze, meta: { format: 'formularz dysponenta' } });
      },
      csv: function (rekordy) {
        if (AED.eksport && AED.eksport.csv) return AED.eksport.csv(rekordy);
        const k = POLA.map(function (p) { return p.name; });
        const pole = function (v) { v = pusta(v) ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        return [k.join(',')].concat(rekordy.map(function (r) { return k.map(function (x) { return pole(r[x]); }).join(','); })).join('\r\n') + '\r\n';
      },
      zapiszSzkic: function (lista, stan) { try { localStorage.setItem(KLUCZ, JSON.stringify({ wersja: 1, rekordy: lista || [], stan: stan || undefined })); return true; } catch (e) { return false; } },
      wczytajStanSzkicu: function () { try { const d = JSON.parse(localStorage.getItem(KLUCZ) || 'null'); return d && d.stan ? d.stan : null; } catch (e) { return null; } },
      wczytajSzkic: function () { try { const d = JSON.parse(localStorage.getItem(KLUCZ) || 'null'); return d && Array.isArray(d.rekordy) ? d.rekordy : []; } catch (e) { return []; } },
      usunSzkic: function () { try { localStorage.removeItem(KLUCZ); } catch (e) { /* brak dostępu */ } }
    };
  }

  // ------------------------------------------------------------------ geokoder
  if (tryb === 'wszystko' || tryb === 'geokoder' || !AED.geokoder) {
    const WYNIKI = [
      { lat: 49.688712, lon: 21.765034, opis: 'ul. Lwowska 28A, 38-400 Krosno', miejscowosc: 'Krosno', cecha_ulicy: 'ul.', ulica: 'Lwowska', numer: '28A',
        kod_pocztowy: '38-400', kod_terc_gminy: '1861011', wojewodztwo: 'podkarpackie', dokladnosc: 'adres' },
      { lat: 49.690101, lon: 21.770220, opis: 'ul. Lwowska 28, 38-400 Krosno', miejscowosc: 'Krosno', cecha_ulicy: 'ul.', ulica: 'Lwowska', numer: '28',
        kod_pocztowy: '38-400', kod_terc_gminy: '1861011', wojewodztwo: 'podkarpackie', dokladnosc: 'adres' }
    ];
    const OPOZNIENIE = Number(window.MOCK_OPOZNIENIE || 300);
    AED.geokoder = {
      atrapa: true,
      szukaj: async function (adres, o) {
        o = o || {};
        await czekaj(OPOZNIENIE, o.signal);
        if (/błąd|blad/i.test(adres)) throw blad('SIEC', 'Brak połączenia z usługą wyszukiwania adresów.');
        if (/limit/i.test(adres)) throw blad('LIMIT', 'Usługa wyszukiwania adresów jest przeciążona.');
        if (/nic/i.test(adres)) return [];
        return WYNIKI.map(function (x) { return Object.assign({}, x); });
      },
      gmina: async function (lat, lon, o) {
        await czekaj(OPOZNIENIE, (o || {}).signal);
        return { kod_terc_gminy: '1861011', gmina: 'Krosno (miasto)', powiat: 'powiat Krosno', wojewodztwo: 'podkarpackie' };
      },
      odwrotne: async function (lat, lon, o) {
        o = o || {};
        await czekaj(OPOZNIENIE, o.signal);
        return Object.assign({}, WYNIKI[0], { adres_lat: WYNIKI[0].lat, adres_lon: WYNIKI[0].lon, lat: lat, lon: lon, odleglosc_m: 20 });
      }
    };
  }
})(window.AED);
