/* Start aplikacji. */
(function (AED) {
  'use strict';

  function sprawdzZaleznosci() {
    const braki = [];
    if (typeof Papa === 'undefined') braki.push('PapaParse');
    if (typeof XLSX === 'undefined') braki.push('SheetJS');
    if (!AED.wzorzec) braki.push('schemat wzorca (js/schema/schema.js)');
    if (braki.length) {
      const main = document.getElementById('tresc');
      const p = document.createElement('p');
      p.className = 'alert alert--err';
      p.setAttribute('role', 'alert');
      p.textContent = 'Nie wczytano: ' + braki.join(', ') + '. Sprawdź, czy katalogi vendor/ i js/ są obok index.html.';
      main.prepend(p);
      return false;
    }
    return true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    // „Przejdź do treści” przenosi fokus bez zmiany adresu (#hash służy routerowi)
    document.querySelector('.skip-link').addEventListener('click', function (e) {
      e.preventDefault();
      const main = document.getElementById('tresc');
      const h1 = main.querySelector('section:not([hidden]) h1');
      (h1 || main).focus();
    });

    if (!sprawdzZaleznosci()) return;
    AED.ui.zrodla.init();
    if (AED.ui.zdalne) AED.ui.zdalne.init();
    if (AED.ui.mapowanie) AED.ui.mapowanie.init();
    if (AED.ui.walidacja) AED.ui.walidacja.init();
    if (AED.ui.duplikaty) AED.ui.duplikaty.init();
    if (AED.ui.wynik) AED.ui.wynik.init();
    if (AED.ui.gov) AED.ui.gov.init();
    if (AED.ui.prywatnosc) AED.ui.prywatnosc.init();
    if (AED.ui.formularz) AED.ui.formularz.init();
    AED.router.start();
  });
})(window.AED);
