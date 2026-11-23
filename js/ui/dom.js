/* Pomocnicze funkcje DOM.
   Zasada bezpieczeństwa: dane z plików są niezaufane, więc NIGDY nie trafiają do innerHTML –
   wyłącznie do textContent / atrybutów przez funkcję h(). */
(function (AED) {
  'use strict';

  /** h('p', {class:'x', onclick: fn}, 'tekst', h('b', null, '!')) */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      });
    }
    for (let i = 2; i < arguments.length; i++) dodaj(el, arguments[i]);
    return el;
  }
  function dodaj(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { dodaj(el, x); }); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }

  /** Ikona SVG (statyczne ścieżki, ukryta przed czytnikami – znaczenie niesie tekst obok). */
  const IKONY = {
    ok: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
    warn: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    err: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
    info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    eye: 'M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'
  };
  function ikona(nazwa) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', IKONY[nazwa] || IKONY.info);
    p.setAttribute('fill', 'currentColor');
    svg.appendChild(p);
    return svg;
  }

  /** Odznaka statusu: zawsze ikona + tekst (nie sam kolor – WCAG 1.4.1). */
  function odznaka(rodzaj, tekst, tytul) {
    const ik = { ok: 'ok', warn: 'warn', err: 'err', info: 'info' }[rodzaj] || 'info';
    return h('span', { class: 'badge badge--' + rodzaj, title: tytul || null }, ikona(ik), tekst);
  }

  /** Komunikat dla czytników ekranu (region aria-live). */
  function oglos(tekst, pilne) {
    const el = document.getElementById(pilne ? 'live-assertive' : 'live-polite');
    if (!el) return;
    el.textContent = '';
    // krótka pauza, by czytnik zauważył zmianę także przy powtórzeniu tego samego tekstu
    setTimeout(function () { el.textContent = tekst; }, 60);
  }

  const fmtLiczba = new Intl.NumberFormat('pl-PL');
  function liczba(n) { return fmtLiczba.format(n); }
  function rozmiar(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1).replace('.', ',') + ' kB';
    return (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  }
  /** Polska odmiana: odmiana(5, 'rekord', 'rekordy', 'rekordów') */
  function odmiana(n, jeden, kilka, wiele) {
    if (n === 1) return jeden;
    const d = n % 10, s = n % 100;
    return (d >= 2 && d <= 4 && !(s >= 12 && s <= 14)) ? kilka : wiele;
  }

  /** Kontener przewijanej tabeli dostępny z klawiatury (WCAG 2.1.1). */
  function tabelaPrzewijana(etykieta, tabela) {
    return h('div', { class: 'table-scroll', role: 'region', 'aria-label': etykieta, tabindex: '0' }, tabela);
  }

  /** Adres z zewnętrznego API trafia do href tylko, gdy to http(s) – nigdy javascript: itp. */
  function bezpiecznyUrl(url) {
    try {
      const u = new URL(String(url || ''));
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
    } catch (e) { return null; }
  }
  /** Link do strony zewnętrznej (nowa karta zapowiedziana w tekście dla czytników). */
  function linkZewn(url, tekst, attrs) {
    const href = bezpiecznyUrl(url);
    if (!href) return document.createTextNode(tekst || String(url || '—'));
    return h('a', Object.assign({ href: href, target: '_blank', rel: 'noopener noreferrer' }, attrs || {}),
      tekst || href, h('span', { class: 'visually-hidden' }, ' (otwiera się w nowej karcie)'));
  }

  const fmtData = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtDataCzas = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  /** Data z API (ISO) w czytelnej postaci (opcjonalnie z godziną); gdy nie da się odczytać – tekst bez zmian. */
  function data(iso, zGodzina) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : (zGodzina ? fmtDataCzas : fmtData).format(d);
  }

  /** Pobranie pliku wygenerowanego w przeglądarce (Blob + a[download]). dane: tekst, ArrayBuffer, Uint8Array albo Blob. */
  function pobierz(nazwa, dane, typ) {
    const blob = dane instanceof Blob ? dane : new Blob([dane], { type: typ || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nazwa; a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // zwolnienie pamięci po rozpoczęciu pobierania
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    return blob.size;
  }

  AED.dom = { h: h, pobierz: pobierz, ikona: ikona, odznaka: odznaka, oglos: oglos, liczba: liczba, rozmiar: rozmiar,
    odmiana: odmiana, tabelaPrzewijana: tabelaPrzewijana, bezpiecznyUrl: bezpiecznyUrl, linkZewn: linkZewn, data: data };
})(window.AED);
