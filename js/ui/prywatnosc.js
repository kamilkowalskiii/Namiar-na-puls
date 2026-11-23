/* Stopka: przycisk „Ustawienia prywatności” (jak na gov.pl otwiera okno z ustawieniami zgód).
   Aplikacja nie używa cookies śledzących – okno informuje o tym i o szkicu zapisywanym lokalnie.
   Natywne <dialog>: fokus zostaje w oknie, Esc zamyka, po zamknięciu fokus wraca na przycisk. */
(function (AED) {
  'use strict';

  function init() {
    const przycisk = document.getElementById('manage-consent');
    const okno = document.getElementById('ustawienia-prywatnosci');
    if (!przycisk || !okno) return;
    if (typeof okno.showModal !== 'function') { // starsze przeglądarki: okno pokazujemy jako zwykły blok
      przycisk.addEventListener('click', function () { okno.setAttribute('open', ''); });
      return;
    }
    przycisk.addEventListener('click', function () { okno.showModal(); });
    okno.addEventListener('close', function () { przycisk.focus(); });
    // kliknięcie w tło (poza oknem) zamyka okno
    okno.addEventListener('click', function (e) { if (e.target === okno) okno.close(); });
  }

  AED.ui = AED.ui || {};
  AED.ui.prywatnosc = { init: init };
})(window.AED);
