/* Stan aplikacji: rejestr źródeł danych i rekordy po mapowaniu.
   Źródło = { id, kod, nazwa, typ, dysponent, licencja, priorytet, kolumny[], wiersze[], meta{}, dataPobrania, mapowanie? }
   Rekord = wynik AED.mapowanie.zastosuj: pola wzorca + _id, _zrodlo, _kodZrodla, _wiersz, _surowy, _naprawy,
            _poprawione (lista pól poprawionych ręcznie), _oryginal ({pole: wartość przed ręczną poprawką}).
   Zmiany ogłaszane zdarzeniami 'zrodla:zmiana', 'rekordy:zmiana', a w części 4 także 'duplikaty:zmiana' i 'wynik:zmiana'. */
(function (AED) {
  'use strict';

  const state = {
    zrodla: [], licznik: { PLIK: 0, DGP: 0, FORMULARZ: 0 },
    rekordy: [], indeks: new Map(),   // _id -> rekord
    poprawki: new Map(),              // _id -> { odcisk, pola: { pole: wartość wpisana ręcznie } } – przetrwa przelicz()
    // część 4: duplikaty i wynik scalenia
    duplikaty: null, opcjeDuplikatow: null,
    decyzje: new Map(),               // id grupy -> { status, glowny?, wartosci? } – przetrwa przelicz() (id grupy jest stałe)
    decyzjeRekordy: new Map(),        // id grupy -> [_id] rekordów grupy w chwili decyzji (pary „rozdziel”, decyzje niedopasowane)
    wynik: null, wynikNieaktualny: true,
    odstajaceOk: new Map()            // rekordId -> {lat, lon} punktu uznanego za poprawny (zmiana współrzędnych unieważnia)
  };

  // Domyślny priorytet z rejestru źródeł we wzorcu (1 = najwyższy)
  const PRIORYTET = { PLIK: 1, DGP: 1, FORMULARZ: 2 };
  const TYP_OPIS = { PLIK: 'plik lokalny', DGP: 'zbiór dane.gov.pl', FORMULARZ: 'formularz dysponenta' };

  function nowyKod(typ) {
    state.licznik[typ] = (state.licznik[typ] || 0) + 1;
    return typ + '-' + String(state.licznik[typ]).padStart(2, '0');
  }

  /** Nałożenie zapamiętanych ręcznych poprawek na świeżo zbudowany rekord. */
  const WSP = { szerokosc_geograficzna: 1, dlugosc_geograficzna: 1 };

  function nalozPoprawki(r) {
    const zapis = state.poprawki.get(r._id);
    // poprawka należy do wiersza o tej samej treści – po podmianie wierszy źródła (inny plik, arkusz) nie przechodzi na obcy rekord
    if (!zapis || (zapis.odcisk && r._odcisk && zapis.odcisk !== r._odcisk)) return r;
    const p = zapis.pola;
    r._oryginal = {};
    Object.keys(p).forEach(function (pole) {
      r._oryginal[pole] = r[pole] === undefined ? null : r[pole];
      r[pole] = p[pole];
      if (WSP[pole]) delete r._precyzja; // precyzja z tekstu źródła nie dotyczy wpisanej wartości
    });
    r._poprawione = Object.keys(p);
    return r;
  }

  AED.store = {
    TYP_OPIS: TYP_OPIS,

    get zrodla() { return state.zrodla.slice(); },

    zrodlo(id) { return state.zrodla.find(function (z) { return z.id === id; }) || null; },

    dodajZrodlo(dane) {
      const typ = dane.typ || 'PLIK';
      const z = Object.assign({
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
        kod: nowyKod(typ),
        typ: typ,
        nazwa: '',
        dysponent: '',
        licencja: '',
        priorytet: PRIORYTET[typ] || 2,
        kolumny: [],
        wiersze: [],
        meta: {},
        dataPobrania: new Date().toISOString().slice(0, 19)
      }, dane);
      state.zrodla.push(z);
      AED.emit('zrodla:zmiana', { akcja: 'dodano', zrodlo: z });
      return z;
    },

    aktualizujZrodlo(id, zmiany) {
      const z = this.zrodlo(id);
      if (!z) return null;
      Object.assign(z, zmiany);
      AED.emit('zrodla:zmiana', { akcja: 'zmieniono', zrodlo: z, pola: Object.keys(zmiany) });
      return z;
    },

    usunZrodlo(id) {
      const i = state.zrodla.findIndex(function (z) { return z.id === id; });
      if (i < 0) return null;
      const [z] = state.zrodla.splice(i, 1);
      AED.emit('zrodla:zmiana', { akcja: 'usunieto', zrodlo: z });
      // rekordy usuniętego źródła znikają od razu
      // ręczne poprawki i nadane ID tego źródła przestają obowiązywać
      const pref = id + ':';
      Array.from(state.poprawki.keys()).forEach(function (k) { if (k.indexOf(pref) === 0) state.poprawki.delete(k); });
      Array.from(state.odstajaceOk.keys()).forEach(function (k) { if (k.indexOf(pref) === 0) state.odstajaceOk.delete(k); });
      if (AED.mapowanie && AED.mapowanie.zapomnij) AED.mapowanie.zapomnij(id);
      if (state.rekordy.some(function (r) { return r._zrodlo === id; })) {
        this.ustawRekordy(state.rekordy.filter(function (r) { return r._zrodlo !== id; }));
      }
      return z;
    },

    /** Kod, który dostanie następne źródło danego typu (np. 'FORMULARZ-02') – bez rezerwowania go. */
    przewidzKod(typ) {
      return typ + '-' + String((state.licznik[typ] || 0) + 1).padStart(2, '0');
    },

    get liczbaRekordow() {
      return state.zrodla.reduce(function (s, z) { return s + z.wiersze.length; }, 0);
    },

    // ------------------------------------------------ mapowanie i rekordy (część 3)

    /** Zapisuje mapowanie źródła (null = wróć do podpowiedzi automatycznej). */
    ustawMapowanie(idZrodla, mapowanie) {
      const z = this.zrodlo(idZrodla);
      if (!z) return null;
      z.mapowanie = mapowanie || null;
      AED.emit('zrodla:zmiana', { akcja: 'zmieniono', zrodlo: z, pola: ['mapowanie'] });
      return z;
    },

    /** UWAGA: zwraca KOPIĘ tablicy (O(n)) – w pętlach używaj liczbaRekordowWynik albo rekord(id). */
    get rekordy() { return state.rekordy.slice(); },

    /** Liczba rekordów po mapowaniu (bez kopiowania tablicy). */
    get liczbaRekordowWynik() { return state.rekordy.length; },

    rekord(id) { return state.indeks.get(id) || null; },

    ustawRekordy(rekordy) {
      state.rekordy = (rekordy || []).slice();
      state.indeks = new Map();
      state.rekordy.forEach(function (r) { state.indeks.set(r._id, r); });
      AED.emit('rekordy:zmiana', { akcja: 'ustawiono', liczba: state.rekordy.length });
      // wyniki wyszukiwania duplikatów dotyczą starych rekordów – liczymy je od nowa (decyzje zostają)
      if (state.duplikaty && AED.duplikaty) this.znajdzDuplikaty(state.opcjeDuplikatow);
      else oznaczWynik();
      return state.rekordy.length;
    },

    /** Ręczna poprawka pól rekordu (pola zaczynające się od „_” są pomijane). Poprawka przetrwa przelicz(). */
    aktualizujRekord(rekordId, zmiany) {
      const r = state.indeks.get(rekordId);
      if (!r) return null;
      const zapis = state.poprawki.get(rekordId) || { odcisk: r._odcisk || null, pola: {} };
      const p = zapis.pola;
      r._oryginal = r._oryginal || {};
      Object.keys(zmiany || {}).forEach(function (pole) {
        if (pole[0] === '_') return;
        if (!Object.prototype.hasOwnProperty.call(r._oryginal, pole)) r._oryginal[pole] = r[pole] === undefined ? null : r[pole];
        r[pole] = zmiany[pole];
        p[pole] = zmiany[pole];
        if (WSP[pole]) delete r._precyzja;
      });
      state.poprawki.set(rekordId, zapis);
      r._poprawione = Object.keys(p);
      AED.emit('rekordy:zmiana', { akcja: 'zmieniono', rekord: r, pola: Object.keys(zmiany || {}) });
      oznaczWynik();
      return r;
    },

    /** Cofnięcie ręcznej poprawki jednego pola (albo wszystkich, gdy pole nie podane). */
    cofnijPoprawke(rekordId, pole) {
      const r = state.indeks.get(rekordId);
      const zapis = state.poprawki.get(rekordId);
      if (!r || !zapis) return null;
      const p = zapis.pola;
      const pola = pole ? [pole] : Object.keys(p);
      pola.forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(p, k)) return;
        delete p[k];
        if (r._oryginal && Object.prototype.hasOwnProperty.call(r._oryginal, k)) { r[k] = r._oryginal[k]; delete r._oryginal[k]; }
      });
      if (!Object.keys(p).length) { state.poprawki.delete(rekordId); delete r._poprawione; delete r._oryginal; } else r._poprawione = Object.keys(p);
      AED.emit('rekordy:zmiana', { akcja: 'zmieniono', rekord: r, pola: pola });
      oznaczWynik();
      return r;
    },

    /** Mapowanie (zapisane albo automatyczne) -> rekordy dla wszystkich źródeł; zachowuje ręczne poprawki.
        @returns {{rekordy:number, zrodla:Object<string,{rekordy,naprawy,puste}>}} – podsumowania wg kodu źródła */
    przelicz() {
      const wszystkie = [];
      const podsumowania = {};
      state.zrodla.forEach(function (z) {
        const m = z.mapowanie || AED.mapowanie.podpowiedz(z);
        const w = AED.mapowanie.zastosuj(z, m);
        w.rekordy.forEach(function (r) { wszystkie.push(nalozPoprawki(r)); });
        podsumowania[z.kod] = w.podsumowanie;
      });
      this.ustawRekordy(wszystkie);
      return { rekordy: wszystkie.length, zrodla: podsumowania };
    },

    // ------------------------------------------------ duplikaty i wynik (część 4)

    /** Ostatni wynik AED.duplikaty.znajdz ({ grupy, odstajace, podsumowanie }) albo null. */
    get duplikaty() { return state.duplikaty; },

    /** Decyzje użytkownika: { [grupaId]: { status: 'scal'|'rozdziel', glowny?, wartosci? } } (kopia). */
    get decyzje() {
      const o = {};
      state.decyzje.forEach(function (d, k) { o[k] = d; });
      return o;
    },

    /** Szukanie duplikatów w bieżących rekordach (synchronicznie).
        opcje jak AED.duplikaty.znajdz: promienM, promienMaksM, postep(ulamek). Zapamiętujemy je (bez postep) do ponownych wyszukiwań. */
    znajdzDuplikaty(opcje) {
      const o = zapamietajOpcje(opcje);
      return zapiszDuplikaty(AED.duplikaty.znajdz(state.rekordy, o));
    },

    /** To samo, ale z oddawaniem sterowania przeglądarce (pasek postępu). @returns {Promise<wynik znajdz>} */
    znajdzDuplikatyAsync(opcje) {
      const o = zapamietajOpcje(opcje);
      const rekordy = state.rekordy;
      return AED.duplikaty.znajdzAsync(rekordy, o).then(function (w) {
        // w międzyczasie rekordy się zmieniły – ustawRekordy już policzył nowy wynik synchronicznie
        if (rekordy !== state.rekordy) return state.duplikaty;
        return zapiszDuplikaty(w);
      });
    },

    /** Decyzje bez pasującej grupy w bieżącym wyniku: [{ grupaId, decyzja, rekordy: [_id] }] (np. po „rozdziel” grupa znika,
        bo jej pary nie są już łączone; cofnięcie: ustawDecyzje(grupaId, null) i ponowne wyszukanie). */
    get decyzjeNiedopasowane() { return niedopasowane(); },

    /** Punkty odstające uznane za poprawne: [{ rekordId, lat, lon }]. */
    get odstajaceOk() {
      const t = [];
      state.odstajaceOk.forEach(function (v, k) { t.push({ rekordId: k, lat: v.lat, lon: v.lon }); });
      return t;
    },

    /** Oznaczenie punktu odstającego jako poprawnego (ok=true) albo cofnięcie (false). Przetrwa ponowne wyszukiwanie
        i przelicz(); traci ważność, gdy zmienią się współrzędne rekordu. Ustawia pole `zaakceptowany` w store.duplikaty.odstajace. */
    ustawOdstajacyOk(rekordId, ok) {
      const r = state.indeks.get(rekordId);
      if (ok && r) state.odstajaceOk.set(rekordId, { lat: r.szerokosc_geograficzna, lon: r.dlugosc_geograficzna });
      else state.odstajaceOk.delete(rekordId);
      if (state.duplikaty) oznaczOdstajace(state.duplikaty);
      AED.emit('duplikaty:zmiana', { akcja: 'odstajacy', rekordId: rekordId, ok: !!(ok && r) });
      return !!(ok && r);
    },

    /** Wiele decyzji naraz (np. „zatwierdź wszystkie wysokie”): { [grupaId]: decyzja|null }; jedno zdarzenie. */
    ustawDecyzjeWiele(mapa) {
      Object.keys(mapa || {}).forEach(function (id) {
        const d = mapa[id];
        if (d && d.status !== 'scal' && d.status !== 'rozdziel') throw new Error('Decyzja musi mieć status „scal” albo „rozdziel”.');
      });
      Object.keys(mapa || {}).forEach(function (id) { zapiszDecyzje(id, mapa[id]); });
      AED.emit('duplikaty:zmiana', { akcja: 'decyzje', grupy: Object.keys(mapa || {}) });
      oznaczWynik();
    },

    /** Scalenie tylko wybranych rekordów wejściowych (np. jednej licencji) – nie zmienia stanu; decyzje jak w wyniku.
        Rekord scalony powstaje wtedy wyłącznie z rekordów, które przeszły filtr. @returns {{rekordy, raport}} */
    wynikDla(filtr) {
      const wej = state.rekordy.filter(filtr);
      if (!state.duplikaty || !AED.duplikaty) return { rekordy: wej, raport: null };
      return AED.duplikaty.scal(wej, state.duplikaty.grupy, this.decyzje, { zrodla: state.zrodla });
    },

    /** Decyzja dla grupy (null = wróć do propozycji automatycznej). */
    ustawDecyzje(grupaId, decyzja) {
      if (!grupaId) return null;
      if (decyzja === null || decyzja === undefined) state.decyzje.delete(grupaId);
      else {
        if (decyzja.status !== 'scal' && decyzja.status !== 'rozdziel') throw new Error('Decyzja musi mieć status „scal” albo „rozdziel”.');
        zapiszDecyzje(grupaId, decyzja);
      }
      AED.emit('duplikaty:zmiana', { akcja: 'decyzja', grupaId: grupaId, decyzja: state.decyzje.get(grupaId) || null });
      oznaczWynik();
      return state.decyzje.get(grupaId) || null;
    },

    /** Rekordy wynikowe (po scaleniu wg decyzji; bez wyszukania duplikatów – rekordy bez zmian). Liczone przy pierwszym odczycie. */
    get wynik() {
      if (state.wynikNieaktualny || !state.wynik) this.przeliczWynik(true);
      return state.wynik.rekordy.slice();
    },

    /** Raport ostatniego scalenia: { grupy, scalone, rozdzielone, usuniete, … } albo null. */
    get raportScalenia() {
      if (state.wynikNieaktualny || !state.wynik) this.przeliczWynik(true);
      return state.wynik.raport;
    },

    /** Scalenie od nowa (AED.duplikaty.scal). Zwraca { rekordy, raport }. */
    przeliczWynik(cicho) {
      if (state.duplikaty && AED.duplikaty) {
        state.wynik = AED.duplikaty.scal(state.rekordy, state.duplikaty.grupy, this.decyzje, { zrodla: state.zrodla });
      } else {
        state.wynik = { rekordy: state.rekordy.slice(), raport: null };
      }
      state.wynikNieaktualny = false;
      if (!cicho) AED.emit('wynik:zmiana', { akcja: 'przeliczono', liczba: state.wynik.rekordy.length, raport: state.wynik.raport });
      return { rekordy: state.wynik.rekordy.slice(), raport: state.wynik.raport };
    }
  };

  function zapiszDecyzje(grupaId, decyzja) {
    if (!decyzja) { state.decyzje.delete(grupaId); state.decyzjeRekordy.delete(grupaId); return; }
    const g = state.duplikaty && state.duplikaty.grupy.find(function (x) { return x.id === grupaId; });
    if (g) state.decyzjeRekordy.set(grupaId, g.rekordy.slice());
    const d = { status: decyzja.status };
    if (decyzja.glowny) d.glowny = decyzja.glowny;
    if (decyzja.wartosci && Object.keys(decyzja.wartosci).length) d.wartosci = Object.assign({}, decyzja.wartosci);
    state.decyzje.set(grupaId, d);
  }
  function zapamietajOpcje(opcje) {
    const o = Object.assign({}, opcje || {});
    state.opcjeDuplikatow = Object.assign({}, o);
    delete state.opcjeDuplikatow.zrodla; delete state.opcjeDuplikatow.postep;
    o.zrodla = state.zrodla;
    o.rozdzielone = paryRozdzielone();
    return o;
  }
  /** Pary rekordów z grup oznaczonych „rozdziel” – nowe wyszukiwanie ich nie łączy. */
  function paryRozdzielone() {
    const pary = [];
    state.decyzje.forEach(function (d, gid) {
      if (d.status !== 'rozdziel') return;
      const ids = state.decyzjeRekordy.get(gid) || [];
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) pary.push([ids[a], ids[b]]);
    });
    return pary;
  }
  /** Decyzje, których id grupy nie ma w bieżącym wyniku wyszukiwania. */
  function niedopasowane() {
    if (!state.duplikaty) return [];
    const ids = new Set(state.duplikaty.grupy.map(function (g) { return g.id; }));
    const t = [];
    state.decyzje.forEach(function (d, gid) {
      if (!ids.has(gid)) t.push({ grupaId: gid, decyzja: d, rekordy: (state.decyzjeRekordy.get(gid) || []).slice() });
    });
    return t;
  }
  /** Pole `zaakceptowany` w odstających wg listy punktów uznanych za poprawne (te same współrzędne). */
  function oznaczOdstajace(wynik) {
    (wynik.odstajace || []).forEach(function (o) {
      const ok = state.odstajaceOk.get(o.rekordId);
      const r = state.indeks.get(o.rekordId);
      o.zaakceptowany = !!(ok && r && ok.lat === r.szerokosc_geograficzna && ok.lon === r.dlugosc_geograficzna);
    });
    wynik.podsumowanie.odstajaceDoSprawdzenia = (wynik.odstajace || []).filter(function (o) { return !o.zaakceptowany; }).length;
  }
  function zapiszDuplikaty(w) {
    state.duplikaty = w;
    oznaczOdstajace(w);
    w.podsumowanie.decyzjeNiedopasowane = niedopasowane().length;
    AED.emit('duplikaty:zmiana', { akcja: 'znaleziono', podsumowanie: w.podsumowanie });
    oznaczWynik();
    return w;
  }

  /** Wynik scalenia jest nieaktualny – przeliczy się przy odczycie store.wynik. */
  function oznaczWynik() {
    state.wynikNieaktualny = true;
    AED.emit('wynik:zmiana', { akcja: 'nieaktualny' });
  }
})(window.AED);
