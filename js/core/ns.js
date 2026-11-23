/* Przestrzeń nazw aplikacji i prosta szyna zdarzeń.
   Zwykły skrypt (nie moduł ES), aby aplikacja działała także po otwarciu index.html z dysku. */
(function (root) {
  'use strict';
  const AED = (root.AED = root.AED || {});
  AED.version = '0.1.0';

  const handlers = {};
  AED.on = function (evt, fn) {
    (handlers[evt] = handlers[evt] || []).push(fn);
  };
  AED.emit = function (evt, payload) {
    (handlers[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error('[AED] błąd obsługi zdarzenia', evt, e); }
    });
  };
})(window);
