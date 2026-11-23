# Pliki testowe

| Plik | Pochodzenie | Licencja | Co testuje |
|---|---|---|---|
| `krosno_dgp3624.csv` | Urząd Miasta Krosna, „Defibrylatory zlokalizowane w Mieście Krosno”, https://dane.gov.pl/pl/dataset/3624 (pobrano 2026-11-21) | CC0 1.0 | adres w jednym polu, spacje w nagłówkach |
| `marki_dgp4955.csv` | Urząd Miasta Marki, „Defibrylatory zlokalizowane na terenie Miasta Marki”, https://dane.gov.pl/pl/dataset/4955 (pobrano 2026-11-21) | CC BY 4.0 | każdy wiersz ujęty w cudzysłów; współrzędne w odwrotnej kolejności niż nagłówki |
| `marki_dgp4955.xlsx` | jw. | CC BY 4.0 | wczytywanie XLSX |
| `przemysl_dgp4581.csv` | Urząd Miejski w Przemyślu, „Lokalizacje AED…”, https://dane.gov.pl/pl/dataset/4581 (pobrano 2026-11-21) | CC0 1.0 | separator średnik, współrzędne jako GeoJSON w kolumnie |
| `gmina_przyklad_cp1250.csv` | dane fikcyjne przygotowane przez zespół | — | kodowanie Windows-1250, wiersz tytułu nad tabelą, przecinek dziesiętny |
| `przyklad_wzorzec.csv`, `przyklad_wzorzec.xlsx` | wygenerowane przez `wzorzec/generuj_wzorzec.py` (dane fikcyjne) | — | plik w pełni zgodny ze wzorcem |
| `formularz_dysponenta_przyklad.xlsx` | wygenerowany przez `wzorzec/generuj_wzorzec.py` – prosty formularz dysponenta z 3 wypełnionymi wierszami (dane fikcyjne) | — | ludzkie nagłówki i etykiety list, wiersz opisów i wiersz przykładu do pominięcia, arkusz „Urządzenia” za instrukcją |

## Odpowiedzi usług GUGiK (`api/`, pobrane 2026-11-21, prawdziwe wycinki)

| Plik | Zapytanie | Co testuje |
|---|---|---|
| `uug_adres_krosno_rynek1_2180.json` | UUG `GetAddress` „Krosno, Rynek 1” bez `srid` | współrzędne w PUWG 1992 (EPSG:2180) -> przeliczenie na WGS84 |
| `uug_adres_warszawa_marszalkowska140.json` | UUG `GetAddress` + `srid=4326` | „ulica Marszałkowska” -> cecha + nazwa, TERC 1465011 |
| `uug_adres_przemysl_rynek2.json` | UUG `GetAddress` + `srid=4326` | miasto na prawach powiatu |
| `uug_ulica_krosno_lwowska.json` | UUG `GetAddress` (sama ulica) | wynik typu `street` (LINESTRING) |
| `uug_miejscowosc_rymanow.json` | UUG `GetAddress` (sama miejscowość) | wynik typu `city`; gmina miejsko-wiejska (rodzaj gminy nieznany bez ULDK) |
| `uug_brak.json` | UUG `GetAddress` – adres nieistniejący | pusta lista wyników |
| `uug_odwrotne_krosno.json` | UUG `GetAddressReverse` POINT(21.7655 49.6886) | odwrotne geokodowanie |
| `uug_zablokowane.json` | UUG po serii zapytań | `{"notice":"blocked for abuse"}` -> błąd `LIMIT` |
| `uug_odrzucone_waf.html` | UUG z nieprzekodowanym znakiem w URL | strona HTML zamiast JSON -> błąd `FORMAT` |
| `uldk_gmina_krosno.txt` | ULDK `GetCommuneByXY` (EPSG:2180) | TERC 7 cyfr (`186101_1` -> 1861011) |
| `uldk_pusta.txt` | ULDK poza zasięgiem | pusta odpowiedź -> brak gminy |

