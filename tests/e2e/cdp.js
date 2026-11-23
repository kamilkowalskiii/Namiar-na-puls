/* Minimalny klient Chrome DevTools Protocol dla headless Edge/Chrome (Node 22+: globalny WebSocket).
   Bez zależności npm. Przeglądarkę wskazuje zmienna AED_PRZEGLADARKA albo wykrywamy Edge/Chrome/Chromium.
   Sieć: wszystkie żądania poza lokalnym serwerem testowym są przechwytywane – kafle mapy GUGiK dostają
   lokalny obrazek 1×1 px (testy nie pobierają nic z internetu), inne adresy są blokowane i zapisywane w api.zewnetrzne. */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

function znajdzPrzegladarke() {
  if (process.env.AED_PRZEGLADARKA) return process.env.AED_PRZEGLADARKA;
  const kandydaci = process.platform === 'win32' ? [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable']
    .map(function (n) {
      for (const d of (process.env.PATH || '').split(':')) { const p = path.join(d, n); if (fs.existsSync(p)) return p; }
      return null;
    });
  const p = kandydaci.find(function (x) { return x && fs.existsSync(x); });
  if (!p) throw new Error('Nie znaleziono przeglądarki Edge/Chrome. Ustaw zmienną AED_PRZEGLADARKA na ścieżkę do pliku wykonywalnego.');
  return p;
}

async function uruchom(o) {
  const port = o.portDebug;
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'aed-e2e-profil-'));
  const proces = spawn(znajdzPrzegladarke(), ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profil,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--window-size=1280,900',
    '--lang=pl-PL'].concat(process.env.CI ? ['--no-sandbox'] : [], ['about:blank']), { stdio: 'ignore' });
  let lista = [];
  for (let i = 0; i < 100; i++) {
    try { lista = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); if (lista.some(function (x) { return x.type === 'page'; })) break; } catch (e) { /* jeszcze startuje */ }
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  const strona = lista.find(function (x) { return x.type === 'page'; });
  if (!strona) { proces.kill(); throw new Error('Przeglądarka nie wystartowała (port ' + port + ').'); }
  const ws = new WebSocket(strona.webSocketDebuggerUrl);
  await new Promise(function (ok, nie) { ws.addEventListener('open', ok); ws.addEventListener('error', nie); });
  let id = 0;
  const czeka = new Map();
  const sluchacze = [];
  ws.addEventListener('message', function (ev) {
    const m = JSON.parse(ev.data);
    if (m.id && czeka.has(m.id)) {
      const c = czeka.get(m.id); czeka.delete(m.id);
      if (m.error) c.nie(new Error(JSON.stringify(m.error))); else c.tak(m.result);
    } else if (m.method) sluchacze.slice().forEach(function (f) { f(m); });
  });
  function wyslij(method, params) {
    return new Promise(function (tak, nie) { const i = ++id; czeka.set(i, { tak: tak, nie: nie }); ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); });
  }

  const bledy = [];
  const zewnetrzne = [];
  const kafle = [];
  sluchacze.push(function (m) {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      bledy.push('WYJĄTEK: ' + ((d.exception && d.exception.description) || d.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) {
      bledy.push('KONSOLA ' + m.params.type + ': ' + m.params.args.map(function (a) { return a.value !== undefined ? a.value : a.description; }).join(' '));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      const e = m.params.entry;
      if (!/favicon\.ico/.test(e.url || '')) bledy.push('LOG: ' + e.text + ' ' + (e.url || ''));
    }
    if (m.method === 'Fetch.requestPaused') {
      const u = m.params.request.url;
      if (u.indexOf(o.adres) === 0 || /^(data|blob):/.test(u)) {
        wyslij('Fetch.continueRequest', { requestId: m.params.requestId }).catch(function () {});
      } else if (/^https:\/\/mapy\.geoportal\.gov\.pl\//.test(u)) {
        kafle.push(u);
        wyslij('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'image/png' }], body: PNG_1PX }).catch(function () {});
      } else {
        zewnetrzne.push(u);
        wyslij('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }).catch(function () {});
      }
    }
  });
  await wyslij('Runtime.enable'); await wyslij('Page.enable'); await wyslij('Log.enable'); await wyslij('DOM.enable');
  if (!o.siec) await wyslij('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

  const api = {
    wyslij: wyslij, bledy: bledy, zewnetrzne: zewnetrzne, kafle: kafle,
    async ocen(expr) {
      const r = await wyslij('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error('ocen(' + expr.slice(0, 80) + '): ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
      return r.result.value;
    },
    async idz(url) {
      // ten sam dokument z innym #hash – nawigacja bez zdarzenia „load”
      const zaladowano = new Promise(function (r) {
        const f = function (m) { if (m.method === 'Page.loadEventFired' || m.method === 'Page.navigatedWithinDocument') { sluchacze.splice(sluchacze.indexOf(f), 1); r(); } };
        sluchacze.push(f);
      });
      await wyslij('Page.navigate', { url: url });
      await zaladowano;
    },
    async przeladuj() {
      const zaladowano = new Promise(function (r) {
        const f = function (m) { if (m.method === 'Page.loadEventFired') { sluchacze.splice(sluchacze.indexOf(f), 1); r(); } };
        sluchacze.push(f);
      });
      await wyslij('Page.reload', {});
      await zaladowano;
    },
    async czekaj(expr, ms) {
      const t0 = Date.now();
      let ost = null;
      while (Date.now() - t0 < (ms || 20000)) {
        try { if (await api.ocen(expr)) return true; } catch (e) { ost = e; }
        await new Promise(function (r) { setTimeout(r, 100); });
      }
      throw new Error('Przekroczono czas oczekiwania na: ' + expr + (ost ? ' (' + ost.message + ')' : ''));
    },
    async pauza(ms) { await new Promise(function (r) { setTimeout(r, ms); }); },
    async pliki(selektor, sciezki) {
      const doc = await wyslij('DOM.getDocument');
      const n = await wyslij('DOM.querySelector', { nodeId: doc.root.nodeId, selector: selektor });
      await wyslij('DOM.setFileInputFiles', { nodeId: n.nodeId, files: sciezki });
    },
    /** Naciśnięcie klawisza: klawisz('Tab'), klawisz('Enter'), klawisz('Tab', 8) = Shift+Tab. */
    async klawisz(nazwa, modyfikatory) {
      const K = {
        Tab: ['Tab', 9], Enter: ['Enter', 13, '\r'], Escape: ['Escape', 27], ' ': ['Space', 32, ' '],
        ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40],
        '+': ['NumpadAdd', 107, '+'], '-': ['NumpadSubtract', 109, '-']
      }[nazwa];
      if (!K) throw new Error('Nieznany klawisz ' + nazwa);
      const wsp = { key: nazwa, code: K[0], windowsVirtualKeyCode: K[1], nativeVirtualKeyCode: K[1], modifiers: modyfikatory || 0 };
      await wyslij('Input.dispatchKeyEvent', Object.assign({ type: K[2] ? 'keyDown' : 'rawKeyDown', text: K[2] }, wsp));
      await wyslij('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, wsp));
    },
    async wpisz(tekst) { await wyslij('Input.insertText', { text: tekst }); },
    async szerokosc(w) { await wyslij('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: w < 500 }); },
    async pobierania(kat) { fs.mkdirSync(kat, { recursive: true }); await wyslij('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: kat, eventsEnabled: true }); },
    async zrzut(plik) { const r = await wyslij('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(plik, Buffer.from(r.data, 'base64')); },
    async zamknij() {
      try { await wyslij('Browser.close'); } catch (e) { /* już zamknięta */ }
      try { proces.kill(); } catch (e) { /* już zamknięta */ }
      await new Promise(function (r) { setTimeout(r, 300); });
      try { fs.rmSync(profil, { recursive: true, force: true }); } catch (e) { /* pliki jeszcze zajęte – zostaną w katalogu tymczasowym */ }
    }
  };
  return api;
}

module.exports = { uruchom: uruchom, znajdzPrzegladarke: znajdzPrzegladarke };
