# Baza zgłoszeń „dane.gov.pl” (symulacja)

To tutaj trafiają dane po kliknięciu przycisku **„Wyślij do zatwierdzenia przez bazę gov.pl”**
(krok 4 „Wynik i eksport” oraz formularz dysponenta). To **symulacja** – nic nie jest wysyłane do prawdziwego dane.gov.pl.

| Co | Gdzie |
|---|---|
| Plik bazy (SQLite) | `baza/wyniki.gov` – powstaje przy pierwszej wysyłce (uruchom `python serwer.py` w katalogu projektu) |
| Schemat bazy (SQL, z komentarzami) | `js/core/gov_schemat.sql` |
| Kod zapisu po stronie serwera | `serwer.py` (`POST /api/zgloszenia`) |
| Kod przycisku i zapisu w przeglądarce | `js/ui/gov.js`, `js/core/gov.js` |

## Co jest w bazie
- tabela `zgloszenia` – jedno wiersz na jedno kliknięcie: numer (`GOV-RRRR-NNNNNN`), data, status, tytuł, liczby rekordów/błędów, dane 4 kroków (JSON),
- tabela `rekordy_aed` – urządzenia AED z każdego zgłoszenia (id, nazwa, miejscowość, współrzędne, pełny rekord w JSON).

## Jak zajrzeć do bazy
- DB Browser for SQLite (otwórz `baza/wyniki.gov`), albo
- `python -c "import sqlite3; print(sqlite3.connect('baza/wyniki.gov').execute('SELECT numer, data_wyslania, tytul, liczba_rekordow FROM zgloszenia').fetchall())"`

## Uwagi
- Po każdym kliknięciu przeglądarka pobiera też plik **`wyniki_gov.txt`** zbudowany z danych wpisanych w formularzu: tabela `zgloszenie` (numer, data, dysponent, licencja) i tabela `urzadzenia_aed`, w której każde pole formularza to osobna kolumna (jeden wiersz = jedno urządzenie). Wczytasz go poleceniem `sqlite3 wyniki.db < wyniki_gov.txt` albo w DB Browser for SQLite („Execute SQL”).
- Bez serwera (GitHub Pages, `python -m http.server`) strona nie może zapisać pliku w katalogu – baza powstaje wtedy tylko w przeglądarce (IndexedDB), a dane masz w pobranym `wyniki_gov.txt`.
- Plik `*.gov` jest w `.gitignore` (zawiera dane z formularzy) i nie jest serwowany przez serwer.
