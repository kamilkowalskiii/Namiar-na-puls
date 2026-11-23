-- Schemat bazy „wyniki.gov” (SQLite) – symulacja wysyłki zgłoszeń do systemu gov.pl w aplikacji „Namiar na puls”.
-- JEDNO ŹRÓDŁO PRAWDY: ten plik wykonuje serwer.py (sqlite3) i tryb przeglądarkowy js/core/gov.js (sql.js).
-- Wszystkie polecenia są idempotentne (IF NOT EXISTS) – plik wykonuje się przy każdym otwarciu bazy.
-- Kolumny etap*_ i dane przechowują JSON (tekst UTF-8). Zgłoszeń nigdy się nie nadpisuje: każde wysłanie = nowy wiersz.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS zgloszenia (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  numer                       TEXT UNIQUE,                                  -- GOV-RRRR-NNNNNN (NNNNNN = id)
  data_wyslania               TEXT NOT NULL,                                -- ISO 8601, czas lokalny: RRRR-MM-DDThh:mm:ss
  status                      TEXT NOT NULL DEFAULT 'zatwierdzono_gov',
  tytul                       TEXT,
  obszar                      TEXT,
  liczba_zrodel               INTEGER NOT NULL DEFAULT 0,
  liczba_rekordow_wejsciowych INTEGER NOT NULL DEFAULT 0,
  liczba_rekordow             INTEGER NOT NULL DEFAULT 0,                   -- rekordy wynikowe (po scaleniu)
  liczba_bledow               INTEGER NOT NULL DEFAULT 0,
  liczba_ostrzezen            INTEGER NOT NULL DEFAULT 0,
  liczba_scalonych            INTEGER NOT NULL DEFAULT 0,
  licencja                    TEXT,                                         -- SPDX licencji zbioru (CC0-1.0 / CC-BY-4.0)
  etap1_zrodla                TEXT NOT NULL,                                -- JSON: rejestr źródeł (bez surowych wierszy)
  etap2_mapowanie             TEXT NOT NULL,                                -- JSON: mapowanie kolumn każdego źródła
  etap3_walidacja             TEXT NOT NULL,                                -- JSON: podsumowanie, problemy, decyzje duplikatów, odstające
  etap4_wynik                 TEXT NOT NULL,                                -- JSON: metadane, licencja, raport scalenia, rekordy wynikowe
  suma_kontrolna              TEXT NOT NULL,                                -- SHA-256 kanonicznego JSON zgłoszenia (klucze posortowane)
  tryb                        TEXT NOT NULL CHECK (tryb IN ('serwer', 'przegladarka')),
  wersja_aplikacji            TEXT
);

CREATE TABLE IF NOT EXISTS rekordy_aed (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  zgloszenie_id  INTEGER NOT NULL REFERENCES zgloszenia(id) ON DELETE CASCADE,
  id_aed         TEXT,
  nazwa          TEXT,
  miejscowosc    TEXT,
  szerokosc      REAL,
  dlugosc        REAL,
  status         TEXT,
  dane           TEXT NOT NULL                                              -- JSON: pełny rekord wg wzorca
);

CREATE INDEX IF NOT EXISTS rekordy_aed_zgloszenie ON rekordy_aed(zgloszenie_id);
CREATE INDEX IF NOT EXISTS rekordy_aed_id_aed ON rekordy_aed(id_aed);
CREATE INDEX IF NOT EXISTS zgloszenia_data ON zgloszenia(data_wyslania);

CREATE VIEW IF NOT EXISTS podsumowanie AS
SELECT
  COUNT(*)                                         AS liczba_zgloszen,
  COALESCE(SUM(liczba_rekordow), 0)                AS suma_rekordow,
  COALESCE(SUM(liczba_bledow), 0)                  AS suma_bledow,
  COALESCE(SUM(liczba_ostrzezen), 0)               AS suma_ostrzezen,
  MIN(data_wyslania)                               AS pierwsze_zgloszenie,
  MAX(data_wyslania)                               AS ostatnie_zgloszenie,
  COALESCE(SUM(status = 'zatwierdzono_gov'), 0)    AS liczba_zatwierdzonych
FROM zgloszenia;

CREATE VIEW IF NOT EXISTS zgloszenia_wg_statusu AS
SELECT status, COUNT(*) AS liczba FROM zgloszenia GROUP BY status;

CREATE VIEW IF NOT EXISTS statystyki_dzienne AS
SELECT substr(data_wyslania, 1, 10) AS dzien, COUNT(*) AS liczba_zgloszen, COALESCE(SUM(liczba_rekordow), 0) AS suma_rekordow
FROM zgloszenia GROUP BY substr(data_wyslania, 1, 10);

PRAGMA user_version = 1;
