/* Uruchamia po kolei wszystkie pliki tests/*.test.js (każdy w osobnym procesie Node).
   Użycie: node tests/uruchom.js [fragment-nazwy ...]   np. node tests/uruchom.js czesc5
   Kod wyjścia: 0 – wszystkie zaliczone, 1 – co najmniej jeden plik z błędem. */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const filtry = process.argv.slice(2);
const pliki = fs.readdirSync(__dirname)
  .filter(function (n) { return /\.test\.js$/.test(n); })
  .filter(function (n) { return !filtry.length || filtry.some(function (f) { return n.indexOf(f) >= 0; }); })
  .sort();

if (!pliki.length) {
  console.error('Nie znaleziono plików testów' + (filtry.length ? ' pasujących do: ' + filtry.join(', ') : '') + '.');
  process.exit(1);
}

const wyniki = [];
pliki.forEach(function (n) {
  console.log('\n=== ' + n + ' ===');
  const t0 = Date.now();
  const w = cp.spawnSync(process.execPath, [path.join(__dirname, n)], { stdio: 'inherit', env: process.env });
  wyniki.push({ plik: n, kod: w.status === null ? 1 : w.status, ms: Date.now() - t0, sygnal: w.signal });
});

console.log('\n=== Podsumowanie ===');
wyniki.forEach(function (w) {
  console.log('  ' + (w.kod === 0 ? 'OK  ' : 'BŁĄD') + '  ' + w.plik + '  (' + (w.ms / 1000).toFixed(1) + ' s' + (w.sygnal ? ', sygnał ' + w.sygnal : '') + ')');
});
const zle = wyniki.filter(function (w) { return w.kod !== 0; }).length;
console.log('\n' + (wyniki.length - zle) + '/' + wyniki.length + ' plików testów bez błędów');
process.exit(zle ? 1 : 0);
