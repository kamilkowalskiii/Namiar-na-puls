/* PLIK GENEROWANY przez wzorzec/generuj_wzorzec.py – nie edytuj ręcznie. */
window.AED = window.AED || {};
window.AED.wzorzec = {
 "schema": {
  "name": "aed",
  "title": "Wzorcowy zakres danych o defibrylatorach AED",
  "version": "0.1 (szkic HackNation 2026)",
  "fields": [
   {
    "name": "id_aed",
    "title": "Identyfikator AED",
    "description": "Stały, globalnie unikalny identyfikator urządzenia w zbiorze ogólnopolskim. Nadaje go narzędzie przy pierwszym imporcie; potem się nie zmienia.",
    "type": "string",
    "constraints": {
     "unique": true,
     "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
     "required": true
    },
    "aed": {
     "grupa": "Identyfikacja",
     "obowiazkowosc": "O",
     "format": "UUID (RFC 9562), małe litery; nowe rekordy: wersja 4 (losowa)",
     "przyklad": "8f14e45f-ceea-467a-9a3b-2c1d0e5f6a7b",
     "uzasadnienie": "Pozwala aktualizować rekord zamiast tworzyć duplikat i łączyć go z innymi zbiorami. UUID nie wymaga centralnego rejestru, więc może go nadać dysponent lub aplikacja w przeglądarce.",
     "slownik": null,
     "walidacja": "wzorzec UUID; unikalny w zbiorze"
    }
   },
   {
    "name": "id_lokalne",
    "title": "Identyfikator u dysponenta",
    "description": "Numer inwentarzowy lub ID w systemie dysponenta (np. „Numer Id” w Krośnie, „AED 9485” w Przemyślu).",
    "type": "string",
    "aed": {
     "grupa": "Identyfikacja",
     "obowiazkowosc": "Z",
     "format": "dowolny",
     "przyklad": "AED-9485",
     "uzasadnienie": "Dysponent szybko odnajduje swój rekord. Para dysponent + id_lokalne pewnie wykrywa duplikaty przy kolejnych importach.",
     "slownik": null,
     "walidacja": "unikalny w obrębie dysponenta"
    }
   },
   {
    "name": "nazwa",
    "title": "Nazwa miejsca",
    "description": "Krótka nazwa obiektu, w którym jest AED, rozpoznawalna dla przechodnia.",
    "type": "string",
    "constraints": {
     "maxLength": 150,
     "required": true
    },
    "aed": {
     "grupa": "Identyfikacja",
     "obowiazkowosc": "O",
     "format": "maks. 150 znaków",
     "przyklad": "Szkoła Podstawowa nr 1 – hol główny",
     "uzasadnienie": "Świadek zdarzenia szuka budynku, a nie współrzędnych. Nazwa jest też tytułem pinezki w aplikacjach.",
     "slownik": null,
     "walidacja": "niepuste; maks. 150 znaków"
    }
   },
   {
    "name": "status",
    "title": "Status urządzenia",
    "description": "Czy urządzenie jest obecnie dostępne.",
    "type": "string",
    "constraints": {
     "required": true,
     "enum": [
      "aktywny",
      "tymczasowo_niedostepny",
      "wycofany",
      "do_weryfikacji"
     ]
    },
    "aed": {
     "grupa": "Identyfikacja",
     "obowiazkowosc": "O",
     "format": "kod ze słownika",
     "przyklad": "aktywny",
     "uzasadnienie": "Wycofanych rekordów nie kasujemy, tylko oznaczamy. Dzięki temu urządzenie, którego już nie ma, nie „wraca” z innego źródła przy kolejnym scaleniu.",
     "slownik": "status",
     "walidacja": "wartość ze słownika"
    }
   },
   {
    "name": "szerokosc_geograficzna",
    "title": "Szerokość geograficzna",
    "description": "Szerokość geograficzna miejsca zawieszenia AED (nie środka działki).",
    "type": "number",
    "constraints": {
     "minimum": 49.0,
     "maximum": 54.9,
     "required": true
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "O",
     "format": "WGS84 (EPSG:4326), stopnie dziesiętne, kropka, 6 miejsc po przecinku",
     "przyklad": "52.229676",
     "uzasadnienie": "Bez współrzędnych nie ma nawigacji ani mapy. WGS84 wymaga format GeoJSON (RFC 7946) i używa go GPS oraz większość map internetowych. Kropka dziesiętna zgodnie ze Standardem technicznym dane.gov.pl (2020).",
     "slownik": null,
     "walidacja": "49.0–54.9 (granice PL); kontrola zamiany z długością"
    }
   },
   {
    "name": "dlugosc_geograficzna",
    "title": "Długość geograficzna",
    "description": "Długość geograficzna miejsca zawieszenia AED.",
    "type": "number",
    "constraints": {
     "minimum": 14.1,
     "maximum": 24.2,
     "required": true
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "O",
     "format": "WGS84 (EPSG:4326), stopnie dziesiętne, kropka, 6 miejsc po przecinku",
     "przyklad": "21.012229",
     "uzasadnienie": "Jw. W zbiorze z Marek na dane.gov.pl nagłówki mają odwrotną kolejność niż wartości. Walidator musi to wykrywać.",
     "slownik": null,
     "walidacja": "14.1–24.2 (granice PL)"
    }
   },
   {
    "name": "lokalizacja_przyblizona",
    "title": "Lokalizacja przybliżona",
    "description": "true, gdy punkt wyznaczono z adresu lub „na oko”, a nie w miejscu zawieszenia urządzenia.",
    "type": "boolean",
    "trueValues": [
     "true"
    ],
    "falseValues": [
     "false"
    ],
    "constraints": {
     "required": true
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "O",
     "format": "true / false",
     "przyklad": "false",
     "uzasadnienie": "Ratownik wie, czy może ufać pinezce, czy musi szukać w budynku. Rekordy przybliżone wskazują też, gdzie potrzebna jest weryfikacja w terenie.",
     "slownik": null,
     "walidacja": "true/false"
    }
   },
   {
    "name": "zrodlo_wspolrzednych",
    "title": "Źródło współrzędnych",
    "description": "Jak ustalono współrzędne.",
    "type": "string",
    "constraints": {
     "enum": [
      "pomiar_gps",
      "wskazanie_na_mapie",
      "geokodowanie_adresu",
      "nieznane"
     ]
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "Z",
     "format": "kod ze słownika",
     "przyklad": "pomiar_gps",
     "uzasadnienie": "Uzupełnia flagę przybliżenia. Pomaga rozstrzygać konflikty przy scalaniu (pomiar GPS > geokodowanie).",
     "slownik": "zrodlo_wspolrzednych",
     "walidacja": "wartość ze słownika"
    }
   },
   {
    "name": "kod_terc_gminy",
    "title": "Kod TERC gminy",
    "description": "Kod terytorialny gminy z rejestru TERYT GUS (z cyfrą rodzaju gminy).",
    "type": "string",
    "constraints": {
     "pattern": "^\\d{7}$"
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "Z",
     "format": "7 cyfr WWPPGGR (TERYT)",
     "przyklad": "1465011",
     "uzasadnienie": "Pozwala agregować dane po gminach, powiatach i województwach oraz łączyć je z innymi zbiorami publicznymi. Standard techniczny dane.gov.pl wskazuje TERYT jako miejsce publikacji danych adresowych.",
     "slownik": null,
     "walidacja": "7 cyfr; tekst, z zerem wiodącym"
    }
   },
   {
    "name": "wojewodztwo",
    "title": "Województwo",
    "description": "Nazwa województwa.",
    "type": "string",
    "constraints": {
     "enum": [
      "dolnośląskie",
      "kujawsko-pomorskie",
      "lubelskie",
      "lubuskie",
      "łódzkie",
      "małopolskie",
      "mazowieckie",
      "opolskie",
      "podkarpackie",
      "podlaskie",
      "pomorskie",
      "śląskie",
      "świętokrzyskie",
      "warmińsko-mazurskie",
      "wielkopolskie",
      "zachodniopomorskie"
     ]
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "Z",
     "format": "nazwa małymi literami",
     "przyklad": "mazowieckie",
     "uzasadnienie": "Ułatwia filtrowanie bez znajomości kodów. Można ją wyliczyć z kod_terc_gminy (pierwsze 2 cyfry).",
     "slownik": "wojewodztwo",
     "walidacja": "jedna z 16 nazw"
    }
   },
   {
    "name": "miejscowosc",
    "title": "Miejscowość",
    "description": "Nazwa miejscowości.",
    "type": "string",
    "constraints": {
     "required": true
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "O",
     "format": "jak w TERYT SIMC",
     "przyklad": "Warszawa",
     "uzasadnienie": "Standard techniczny dane.gov.pl wymaga adresu w odrębnych polach (ulica, numer, kod, miejscowość), a nie w jednym polu tekstowym.",
     "slownik": null,
     "walidacja": "niepuste"
    }
   },
   {
    "name": "kod_simc",
    "title": "Identyfikator miejscowości SIMC",
    "description": "Identyfikator miejscowości z TERYT SIMC.",
    "type": "string",
    "constraints": {
     "pattern": "^\\d{7}$"
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "F",
     "format": "7 cyfr",
     "przyklad": "0918123",
     "uzasadnienie": "Jednoznaczny i niezmienny. Rozwiązuje problem powtarzalnych nazw miejscowości (np. wiele miejscowości „Zalesie”).",
     "slownik": null,
     "walidacja": "7 cyfr"
    }
   },
   {
    "name": "cecha_ulicy",
    "title": "Cecha ulicy",
    "description": "Typ ulicy: ul., al., pl. itd. Obowiązkowe, jeśli wypełniono pole ulica.",
    "type": "string",
    "constraints": {
     "enum": [
      "ul.",
      "al.",
      "pl.",
      "os.",
      "rondo",
      "skwer",
      "bulw.",
      "inne"
     ]
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "W",
     "format": "kod ze słownika",
     "przyklad": "ul.",
     "uzasadnienie": "Rozdzielenie cechy od nazwy wzorujemy na tabeli 4 Standardu technicznego dane.gov.pl.",
     "slownik": "cecha_ulicy",
     "walidacja": "wymagane gdy ulica niepusta",
     "wymaganeGdy": {
      "pole": "ulica",
      "niepuste": true
     }
    }
   },
   {
    "name": "ulica",
    "title": "Nazwa ulicy",
    "description": "Nazwa ulicy. Puste w miejscowościach bez nazw ulic.",
    "type": "string",
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "W",
     "format": "bez cechy, jak w TERYT ULIC",
     "przyklad": "Marszałkowska",
     "uzasadnienie": "Jw. Część małych miejscowości nie ma ulic, więc pole jest warunkowe.",
     "slownik": null,
     "walidacja": "—"
    }
   },
   {
    "name": "kod_ulic",
    "title": "Identyfikator ulicy ULIC",
    "description": "Identyfikator ulicy z TERYT ULIC.",
    "type": "string",
    "constraints": {
     "pattern": "^\\d{5}$"
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "F",
     "format": "5 cyfr",
     "przyklad": "12345",
     "uzasadnienie": "Jednoznaczny klucz do rejestru adresów; ułatwia geokodowanie i deduplikację.",
     "slownik": null,
     "walidacja": "5 cyfr"
    }
   },
   {
    "name": "numer_budynku",
    "title": "Numer budynku",
    "description": "Numer porządkowy budynku. Obowiązkowe, jeśli budynek ma numer.",
    "type": "string",
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "W",
     "format": "np. 5A, 12/14",
     "przyklad": "100",
     "uzasadnienie": "Potrzebny do nawigacji i porównywania adresów przy deduplikacji. Typ tekstowy, bo numery zawierają litery.",
     "slownik": null,
     "walidacja": "—"
    }
   },
   {
    "name": "kod_pocztowy",
    "title": "Kod pocztowy",
    "description": "Kod pocztowy (PNA).",
    "type": "string",
    "constraints": {
     "pattern": "^\\d{2}-\\d{3}$"
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "Z",
     "format": "NN-NNN",
     "przyklad": "00-001",
     "uzasadnienie": "Standardowy element adresu pocztowego (Standard techniczny, tabela 4).",
     "slownik": null,
     "walidacja": "wzorzec \\d{2}-\\d{3}"
    }
   },
   {
    "name": "opis_lokalizacji",
    "title": "Opis dojścia / miejsca",
    "description": "Gdzie dokładnie wisi AED w obiekcie lub na budynku.",
    "type": "string",
    "constraints": {
     "maxLength": 300,
     "required": true
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "O",
     "format": "maks. 300 znaków",
     "przyklad": "Hol główny, na lewo od wejścia, obok recepcji",
     "uzasadnienie": "Najważniejsza informacja w pierwszych minutach. Współrzędne nie powiedzą, za którymi drzwiami szukać.",
     "slownik": null,
     "walidacja": "niepuste"
    }
   },
   {
    "name": "opis_lokalizacji_en",
    "title": "Opis dojścia (EN)",
    "description": "Opis dojścia po angielsku.",
    "type": "string",
    "constraints": {
     "maxLength": 300
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "F",
     "format": "maks. 300 znaków",
     "przyklad": "Main hall, left of the entrance, next to the reception",
     "uzasadnienie": "Turyści i obcokrajowcy.",
     "slownik": null,
     "walidacja": "—"
    }
   },
   {
    "name": "wewnatrz_budynku",
    "title": "Wewnątrz budynku",
    "description": "true: wewnątrz budynku; false: na zewnątrz (np. kapsuła na elewacji).",
    "type": "boolean",
    "trueValues": [
     "true"
    ],
    "falseValues": [
     "false"
    ],
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "Z",
     "format": "true / false",
     "przyklad": "true",
     "uzasadnienie": "AED na zewnątrz jest zwykle dostępny całą dobę; wewnątrz zależy od godzin otwarcia.",
     "slownik": null,
     "walidacja": "true/false"
    }
   },
   {
    "name": "kondygnacja",
    "title": "Kondygnacja",
    "description": "Numer piętra, na którym jest urządzenie.",
    "type": "integer",
    "constraints": {
     "minimum": -5,
     "maximum": 100
    },
    "aed": {
     "grupa": "Lokalizacja",
     "obowiazkowosc": "F",
     "format": "0 = parter, -1 = piwnica",
     "przyklad": "0",
     "uzasadnienie": "W wielopiętrowych budynkach (galerie, dworce) oszczędza czas.",
     "slownik": null,
     "walidacja": "liczba całkowita od -5 do 100"
    }
   },
   {
    "name": "dostepnosc",
    "title": "Dostępność",
    "description": "Kto i kiedy może skorzystać z urządzenia.",
    "type": "string",
    "constraints": {
     "required": true,
     "enum": [
      "publiczna_24_7",
      "publiczna_w_godzinach",
      "dla_klientow",
      "tylko_personel",
      "mobilny"
     ]
    },
    "aed": {
     "grupa": "Dostępność",
     "obowiazkowosc": "O",
     "format": "kod ze słownika",
     "przyklad": "publiczna_w_godzinach",
     "uzasadnienie": "To sedno lekcji z opisu zadania: AED był w kilku miejscach, ale zamknięty. Ratownik musi wiedzieć to z góry.",
     "slownik": "dostepnosc",
     "walidacja": "wartość ze słownika"
    }
   },
   {
    "name": "godziny_dostepnosci",
    "title": "Godziny dostępności",
    "description": "Godziny, w których urządzenie jest dostępne. Obowiązkowe, gdy dostepnosc = publiczna_w_godzinach lub dla_klientow.",
    "type": "string",
    "aed": {
     "grupa": "Dostępność",
     "obowiazkowosc": "W",
     "format": "składnia opening_hours, np. Mo-Fr 07:00-17:00; Sa 08:00-14:00 lub 24/7",
     "przyklad": "Mo-Fr 07:00-17:00",
     "uzasadnienie": "Składnia opening_hours jest maszynowo czytelna (są do niej otwarte parsery). Aplikacja może więc pokazać „dostępny teraz”. Zwykły tekst („w godzinach pracy”) na to nie pozwala.",
     "slownik": null,
     "walidacja": "poprawna składnia opening_hours",
     "wymaganeGdy": {
      "pole": "dostepnosc",
      "wartosci": [
       "publiczna_w_godzinach",
       "dla_klientow"
      ]
     }
    }
   },
   {
    "name": "sposob_dostepu",
    "title": "Sposób dostępu / zabezpieczenie",
    "description": "Czy urządzenie jest zamknięte i w jaki sposób.",
    "type": "string",
    "constraints": {
     "required": true,
     "enum": [
      "otwarta_szafka",
      "szafka_z_alarmem",
      "szafka_na_kod",
      "szafka_na_klucz",
      "u_personelu",
      "nieznany"
     ]
    },
    "aed": {
     "grupa": "Dostępność",
     "obowiazkowosc": "O",
     "format": "kod ze słownika",
     "przyklad": "szafka_z_alarmem",
     "uzasadnienie": "Szafka na klucz bez informacji, gdzie jest klucz, oznacza w praktyce brak AED.",
     "slownik": "sposob_dostepu",
     "walidacja": "wartość ze słownika"
    }
   },
   {
    "name": "instrukcja_dostepu",
    "title": "Instrukcja dostępu",
    "description": "Gdzie jest klucz lub kto podaje kod. Obowiązkowe, gdy sposob_dostepu = szafka_na_kod lub szafka_na_klucz. NIE wpisujemy samego kodu.",
    "type": "string",
    "constraints": {
     "maxLength": 300
    },
    "aed": {
     "grupa": "Dostępność",
     "obowiazkowosc": "W",
     "format": "maks. 300 znaków",
     "przyklad": "Klucz w portierni (całodobowo)",
     "uzasadnienie": "Uzupełnia sposób dostępu. Publikowanie kodu w otwartych danych byłoby ryzykiem kradzieży (Standard bezpieczeństwa).",
     "slownik": null,
     "walidacja": "nie zawiera ciągu wyglądającego na kod (np. 4–8 cyfr)",
     "wymaganeGdy": {
      "pole": "sposob_dostepu",
      "wartosci": [
       "szafka_na_kod",
       "szafka_na_klucz"
      ]
     }
    }
   },
   {
    "name": "typ_urzadzenia",
    "title": "Typ urządzenia",
    "description": "AED półautomatyczny lub automatyczny.",
    "type": "string",
    "constraints": {
     "enum": [
      "polautomatyczny",
      "automatyczny",
      "nieznany"
     ]
    },
    "aed": {
     "grupa": "Urządzenie",
     "obowiazkowosc": "F",
     "format": "kod ze słownika",
     "przyklad": "polautomatyczny",
     "uzasadnienie": "Pomocne dla dyspozytora prowadzącego świadka przez telefon.",
     "slownik": "typ_urzadzenia",
     "walidacja": "wartość ze słownika"
    }
   },
   {
    "name": "producent",
    "title": "Producent",
    "description": "Producent urządzenia.",
    "type": "string",
    "aed": {
     "grupa": "Urządzenie",
     "obowiazkowosc": "F",
     "format": "",
     "przyklad": "Producent X",
     "uzasadnienie": "Komunikaty bezpieczeństwa (wycofania z rynku) dotyczą konkretnych producentów i modeli.",
     "slownik": null,
     "walidacja": "—"
    }
   },
   {
    "name": "model",
    "title": "Model",
    "description": "Model urządzenia.",
    "type": "string",
    "aed": {
     "grupa": "Urządzenie",
     "obowiazkowosc": "F",
     "format": "",
     "przyklad": "Model Y",
     "uzasadnienie": "Jw. Dyspozytor może też podać instrukcję obsługi dla danego modelu.",
     "slownik": null,
     "walidacja": "—"
    }
   },
   {
    "name": "tryb_pediatryczny",
    "title": "Tryb / elektrody pediatryczne",
    "description": "Czy na miejscu są elektrody lub klucz pediatryczny.",
    "type": "boolean",
    "trueValues": [
     "true"
    ],
    "falseValues": [
     "false"
    ],
    "aed": {
     "grupa": "Urządzenie",
     "obowiazkowosc": "F",
     "format": "true / false",
     "przyklad": "true",
     "uzasadnienie": "Przy NZK u dziecka pozwala wybrać właściwe urządzenie (szkoły, przedszkola, baseny).",
     "slownik": null,
     "walidacja": "true/false"
    }
   },
   {
    "name": "data_waznosci_elektrod",
    "title": "Ważność elektrod",
    "description": "Data ważności założonych elektrod.",
    "type": "date",
    "aed": {
     "grupa": "Urządzenie",
     "obowiazkowosc": "Z",
     "format": "RRRR-MM-DD (ISO 8601)",
     "przyklad": "2027-06-30",
     "uzasadnienie": "Elektrody po terminie mogą nie działać. Pole odpowiada na pytanie z zadania „czy działa” i pozwala przypominać dysponentom o wymianie.",
     "slownik": null,
     "walidacja": "data ISO; ostrzeżenie, gdy w przeszłości"
    }
   },
   {
    "name": "data_waznosci_baterii",
    "title": "Ważność baterii",
    "description": "Data ważności lub wymiany baterii.",
    "type": "date",
    "aed": {
     "grupa": "Urządzenie",
     "obowiazkowosc": "Z",
     "format": "RRRR-MM-DD (ISO 8601)",
     "przyklad": "2029-01-31",
     "uzasadnienie": "Jw.",
     "slownik": null,
     "walidacja": "data ISO; ostrzeżenie, gdy w przeszłości"
    }
   },
   {
    "name": "data_przegladu",
    "title": "Data ostatniego przeglądu",
    "description": "Data ostatniego przeglądu technicznego (serwisu).",
    "type": "date",
    "aed": {
     "grupa": "Urządzenie",
     "obowiazkowosc": "Z",
     "format": "RRRR-MM-DD (ISO 8601)",
     "przyklad": "2026-09-15",
     "uzasadnienie": "Pokazuje, czy urządzenie jest utrzymywane.",
     "slownik": null,
     "walidacja": "data ISO; nie w przyszłości"
    }
   },
   {
    "name": "dysponent_nazwa",
    "title": "Dysponent (nazwa)",
    "description": "Podmiot odpowiedzialny za urządzenie i aktualność danych.",
    "type": "string",
    "constraints": {
     "required": true
    },
    "aed": {
     "grupa": "Dysponent",
     "obowiazkowosc": "O",
     "format": "pełna nazwa instytucji",
     "przyklad": "Urząd Dzielnicy Śródmieście m.st. Warszawy",
     "uzasadnienie": "Wiadomo, kogo pytać o poprawki. Grupowanie po dysponencie służy do kampanii zachęcającej do publikacji.",
     "slownik": null,
     "walidacja": "niepuste"
    }
   },
   {
    "name": "dysponent_typ",
    "title": "Typ dysponenta",
    "description": "Kategoria podmiotu.",
    "type": "string",
    "constraints": {
     "enum": [
      "jst",
      "administracja_rzadowa",
      "podmiot_leczniczy",
      "placowka_oswiatowa",
      "sluzby",
      "transport",
      "firma",
      "organizacja_pozarzadowa",
      "inny"
     ]
    },
    "aed": {
     "grupa": "Dysponent",
     "obowiazkowosc": "Z",
     "format": "kod ze słownika",
     "przyklad": "jst",
     "uzasadnienie": "Analiza pokrycia (np. ile AED mają szkoły) i kierowanie kampanii do grup dysponentów.",
     "slownik": "dysponent_typ",
     "walidacja": "wartość ze słownika"
    }
   },
   {
    "name": "dysponent_regon",
    "title": "REGON dysponenta",
    "description": "REGON instytucji. Nie podawać dla osób fizycznych prowadzących działalność.",
    "type": "string",
    "constraints": {
     "pattern": "^(\\d{9}|\\d{14})$"
    },
    "aed": {
     "grupa": "Dysponent",
     "obowiazkowosc": "F",
     "format": "9 lub 14 cyfr, bez spacji",
     "przyklad": "012345678",
     "uzasadnienie": "Jednoznacznie identyfikuje podmiot (format wg Standardu technicznego dane.gov.pl). Wyłączenie osób fizycznych ogranicza ryzyko RODO.",
     "slownik": null,
     "walidacja": "9 lub 14 cyfr"
    }
   },
   {
    "name": "telefon_kontaktowy",
    "title": "Telefon kontaktowy",
    "description": "Telefon instytucji (portiernia, recepcja). Nie numer prywatny.",
    "type": "string",
    "constraints": {
     "pattern": "^(\\+48)?\\d{9}$"
    },
    "aed": {
     "grupa": "Dysponent",
     "obowiazkowosc": "F",
     "format": "9 cyfr bez spacji lub +48 i 9 cyfr",
     "przyklad": "225970927",
     "uzasadnienie": "Pozwala zadzwonić po klucz lub zgłosić usterkę. Format wg Standardu technicznego dane.gov.pl.",
     "slownik": null,
     "walidacja": "wzorzec (\\+48)?\\d{9}"
    }
   },
   {
    "name": "email_kontaktowy",
    "title": "E-mail kontaktowy",
    "description": "Funkcyjny adres e-mail instytucji do zgłaszania zmian. Nie adres imienny.",
    "type": "string",
    "constraints": {
     "pattern": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"
    },
    "aed": {
     "grupa": "Dysponent",
     "obowiazkowosc": "F",
     "format": "adres funkcyjny",
     "przyklad": "sekretariat@przyklad.gov.pl",
     "uzasadnienie": "Kanał na zgłoszenia błędów w danych. Adres funkcyjny ogranicza ryzyko RODO.",
     "slownik": null,
     "walidacja": "poprawny e-mail"
    }
   },
   {
    "name": "data_weryfikacji",
    "title": "Data weryfikacji",
    "description": "Kiedy ostatnio potwierdzono, że urządzenie jest na miejscu i działa.",
    "type": "date",
    "constraints": {
     "required": true
    },
    "aed": {
     "grupa": "Jakość i pochodzenie",
     "obowiazkowosc": "O",
     "format": "RRRR-MM-DD (ISO 8601)",
     "przyklad": "2026-11-20",
     "uzasadnienie": "Najważniejsza miara aktualności. Pozwala odróżnić dane świeże od zalegających od lat i ustalić, który rekord wygrywa przy scalaniu.",
     "slownik": null,
     "walidacja": "data ISO; nie w przyszłości; ostrzeżenie, gdy > 12 mies."
    }
   },
   {
    "name": "sposob_weryfikacji",
    "title": "Sposób weryfikacji",
    "description": "Jak potwierdzono dane.",
    "type": "string",
    "constraints": {
     "enum": [
      "wizja_lokalna",
      "potwierdzenie_dysponenta",
      "zdjecie",
      "import_bez_weryfikacji"
     ]
    },
    "aed": {
     "grupa": "Jakość i pochodzenie",
     "obowiazkowosc": "Z",
     "format": "kod ze słownika",
     "przyklad": "wizja_lokalna",
     "uzasadnienie": "Wizja lokalna jest pewniejsza niż import. Pole wspiera ocenę jakości.",
     "slownik": "sposob_weryfikacji",
     "walidacja": "wartość ze słownika"
    }
   },
   {
    "name": "zrodlo_danych",
    "title": "Źródło danych (kod)",
    "description": "Kod źródła, z którego pochodzi rekord. Rekordy scalone z wielu źródeł mają tu źródło nadrzędne, a pełną listę w tabeli zrodla_rekordu.",
    "type": "string",
    "constraints": {
     "required": true
    },
    "aed": {
     "grupa": "Jakość i pochodzenie",
     "obowiazkowosc": "O",
     "format": "kod z arkusza zakres_referencyjny_zrodel",
     "przyklad": "DGP-4581",
     "uzasadnienie": "Wymóg zadania: oznaczenie źródła każdego rekordu i wskazanie zakresu referencyjnego źródeł.",
     "slownik": null,
     "walidacja": "kod istnieje w rejestrze źródeł"
    }
   },
   {
    "name": "zrodlo_id_rekordu",
    "title": "ID rekordu w źródle",
    "description": "Identyfikator rekordu w systemie źródłowym.",
    "type": "string",
    "aed": {
     "grupa": "Jakość i pochodzenie",
     "obowiazkowosc": "Z",
     "format": "dowolny (np. numer wiersza lub ID w systemie dysponenta)",
     "przyklad": "AED-9485",
     "uzasadnienie": "Pozwala wrócić do źródła i zsynchronizować zmiany (np. zmiany w zbiorze dysponenta).",
     "slownik": null,
     "walidacja": "—"
    }
   },
   {
    "name": "licencja_rekordu",
    "title": "Licencja rekordu",
    "description": "Licencja, na której udostępniono rekord.",
    "type": "string",
    "constraints": {
     "required": true,
     "enum": [
      "CC0-1.0",
      "CC-BY-4.0"
     ]
    },
    "aed": {
     "grupa": "Jakość i pochodzenie",
     "obowiazkowosc": "O",
     "format": "identyfikator SPDX",
     "przyklad": "CC0-1.0",
     "uzasadnienie": "Zbiór łączy dane na różnych licencjach (CC0, CC BY). Licencja na poziomie rekordu pozwala ustalić licencję zbioru wynikowego i wymagane uznanie autorstwa.",
     "slownik": "licencja_rekordu",
     "walidacja": "wartość ze słownika"
    }
   },
   {
    "name": "data_aktualizacji_rekordu",
    "title": "Data aktualizacji rekordu",
    "description": "Kiedy rekord ostatnio zmieniono w zbiorze.",
    "type": "datetime",
    "format": "%Y-%m-%dT%H:%M:%S",
    "constraints": {
     "required": true
    },
    "aed": {
     "grupa": "Jakość i pochodzenie",
     "obowiazkowosc": "O",
     "format": "RRRR-MM-DDThh:mm:ss (ISO 8601)",
     "przyklad": "2026-11-21T10:15:00",
     "uzasadnienie": "Pozwala pobierać przyrostowo tylko zmiany. To co innego niż data weryfikacji: zmiana w zbiorze nie oznacza sprawdzenia urządzenia.",
     "slownik": null,
     "walidacja": "data i czas ISO"
    }
   },
   {
    "name": "uwagi",
    "title": "Uwagi",
    "description": "Dodatkowe informacje.",
    "type": "string",
    "constraints": {
     "maxLength": 500
    },
    "aed": {
     "grupa": "Jakość i pochodzenie",
     "obowiazkowosc": "F",
     "format": "maks. 500 znaków",
     "przyklad": "Urządzenie w serwisie do 2026-12-15",
     "uzasadnienie": "Miejsce na wyjątki, których nie da się zapisać w słownikach.",
     "slownik": null,
     "walidacja": "—"
    }
   }
  ],
  "missingValues": [
   ""
  ],
  "primaryKey": "id_aed"
 },
 "slowniki": {
  "status": [
   {
    "kod": "aktywny",
    "etykieta": "Aktywny",
    "opis": "Urządzenie jest na miejscu i sprawne wg dysponenta."
   },
   {
    "kod": "tymczasowo_niedostepny",
    "etykieta": "Tymczasowo niedostępny",
    "opis": "Serwis, kradzież, remont budynku. Wpisz przyczynę w polu uwagi."
   },
   {
    "kod": "wycofany",
    "etykieta": "Wycofany",
    "opis": "Urządzenie usunięte. Rekord zostaje w zbiorze (historia), aby nie wracał z innych źródeł."
   },
   {
    "kod": "do_weryfikacji",
    "etykieta": "Do weryfikacji",
    "opis": "Rekord z importu, niepotwierdzony przez dysponenta."
   }
  ],
  "dostepnosc": [
   {
    "kod": "publiczna_24_7",
    "etykieta": "Publiczna 24/7",
    "opis": "Każdy, o każdej porze, bez pytania kogokolwiek (zwykle kapsuła zewnętrzna)."
   },
   {
    "kod": "publiczna_w_godzinach",
    "etykieta": "Publiczna w godzinach",
    "opis": "Każdy, ale tylko gdy obiekt jest otwarty. Wymaga pola godziny_dostepnosci."
   },
   {
    "kod": "dla_klientow",
    "etykieta": "Dla klientów / użytkowników obiektu",
    "opis": "Np. za bramkami biletowymi, w strefie dla klientów."
   },
   {
    "kod": "tylko_personel",
    "etykieta": "Tylko personel / na wezwanie",
    "opis": "Urządzenie wydaje personel (np. ochrona, recepcja)."
   },
   {
    "kod": "mobilny",
    "etykieta": "Mobilny (pojazd, patrol)",
    "opis": "AED w pojeździe OSP, policji, straży miejskiej. Współrzędne = baza pojazdu."
   }
  ],
  "sposob_dostepu": [
   {
    "kod": "otwarta_szafka",
    "etykieta": "Otwarta szafka / uchwyt",
    "opis": "Bez zamka i bez alarmu."
   },
   {
    "kod": "szafka_z_alarmem",
    "etykieta": "Szafka z alarmem, bez zamka",
    "opis": "Otwarcie uruchamia sygnał dźwiękowy."
   },
   {
    "kod": "szafka_na_kod",
    "etykieta": "Szafka zamykana na kod",
    "opis": "Kod NIE jest publikowany w zbiorze. Opisz, kto go podaje (instrukcja_dostepu)."
   },
   {
    "kod": "szafka_na_klucz",
    "etykieta": "Szafka zamykana na klucz",
    "opis": "Opisz, gdzie jest klucz (instrukcja_dostepu)."
   },
   {
    "kod": "u_personelu",
    "etykieta": "Wydawany przez personel",
    "opis": "Urządzenie nie wisi w miejscu ogólnodostępnym."
   },
   {
    "kod": "nieznany",
    "etykieta": "Nieznany",
    "opis": "Brak informacji (typowe dla importu)."
   }
  ],
  "zrodlo_wspolrzednych": [
   {
    "kod": "pomiar_gps",
    "etykieta": "Pomiar GPS na miejscu",
    "opis": "Najdokładniejsze."
   },
   {
    "kod": "wskazanie_na_mapie",
    "etykieta": "Wskazanie na mapie",
    "opis": "Dysponent zaznaczył punkt w formularzu."
   },
   {
    "kod": "geokodowanie_adresu",
    "etykieta": "Geokodowanie adresu",
    "opis": "Punkt adresowy, nie miejsce zawieszenia. lokalizacja_przyblizona=true."
   },
   {
    "kod": "nieznane",
    "etykieta": "Nieznane",
    "opis": "Brak informacji."
   }
  ],
  "cecha_ulicy": [
   {
    "kod": "ul.",
    "etykieta": "ulica",
    "opis": ""
   },
   {
    "kod": "al.",
    "etykieta": "aleja",
    "opis": ""
   },
   {
    "kod": "pl.",
    "etykieta": "plac",
    "opis": ""
   },
   {
    "kod": "os.",
    "etykieta": "osiedle",
    "opis": ""
   },
   {
    "kod": "rondo",
    "etykieta": "rondo",
    "opis": ""
   },
   {
    "kod": "skwer",
    "etykieta": "skwer",
    "opis": ""
   },
   {
    "kod": "bulw.",
    "etykieta": "bulwar",
    "opis": ""
   },
   {
    "kod": "inne",
    "etykieta": "inne",
    "opis": "Zgodnie z rejestrem TERYT ULIC."
   }
  ],
  "typ_urzadzenia": [
   {
    "kod": "polautomatyczny",
    "etykieta": "AED półautomatyczny",
    "opis": "Użytkownik naciska przycisk wyładowania."
   },
   {
    "kod": "automatyczny",
    "etykieta": "AED w pełni automatyczny",
    "opis": "Wyładowanie bez przycisku."
   },
   {
    "kod": "nieznany",
    "etykieta": "Nieznany",
    "opis": ""
   }
  ],
  "dysponent_typ": [
   {
    "kod": "jst",
    "etykieta": "Jednostka samorządu terytorialnego",
    "opis": "Urzędy, jednostki organizacyjne gminy/powiatu/województwa."
   },
   {
    "kod": "administracja_rzadowa",
    "etykieta": "Administracja rządowa",
    "opis": ""
   },
   {
    "kod": "podmiot_leczniczy",
    "etykieta": "Podmiot leczniczy",
    "opis": ""
   },
   {
    "kod": "placowka_oswiatowa",
    "etykieta": "Szkoła / uczelnia",
    "opis": ""
   },
   {
    "kod": "sluzby",
    "etykieta": "Służby (PSP, OSP, Policja, SM)",
    "opis": ""
   },
   {
    "kod": "transport",
    "etykieta": "Transport (kolej, metro, lotnisko)",
    "opis": ""
   },
   {
    "kod": "firma",
    "etykieta": "Przedsiębiorstwo",
    "opis": ""
   },
   {
    "kod": "organizacja_pozarzadowa",
    "etykieta": "Organizacja pozarządowa / fundacja",
    "opis": ""
   },
   {
    "kod": "inny",
    "etykieta": "Inny",
    "opis": ""
   }
  ],
  "sposob_weryfikacji": [
   {
    "kod": "wizja_lokalna",
    "etykieta": "Wizja lokalna",
    "opis": "Ktoś fizycznie sprawdził urządzenie."
   },
   {
    "kod": "potwierdzenie_dysponenta",
    "etykieta": "Potwierdzenie dysponenta",
    "opis": "Dysponent potwierdził dane (np. formularzem)."
   },
   {
    "kod": "zdjecie",
    "etykieta": "Zdjęcie z datą",
    "opis": ""
   },
   {
    "kod": "import_bez_weryfikacji",
    "etykieta": "Import bez weryfikacji",
    "opis": "Dane przejęte automatycznie ze źródła zewnętrznego."
   }
  ],
  "wojewodztwo": [
   {
    "kod": "dolnośląskie",
    "etykieta": "dolnośląskie",
    "opis": "kod TERC 02"
   },
   {
    "kod": "kujawsko-pomorskie",
    "etykieta": "kujawsko-pomorskie",
    "opis": "kod TERC 04"
   },
   {
    "kod": "lubelskie",
    "etykieta": "lubelskie",
    "opis": "kod TERC 06"
   },
   {
    "kod": "lubuskie",
    "etykieta": "lubuskie",
    "opis": "kod TERC 08"
   },
   {
    "kod": "łódzkie",
    "etykieta": "łódzkie",
    "opis": "kod TERC 10"
   },
   {
    "kod": "małopolskie",
    "etykieta": "małopolskie",
    "opis": "kod TERC 12"
   },
   {
    "kod": "mazowieckie",
    "etykieta": "mazowieckie",
    "opis": "kod TERC 14"
   },
   {
    "kod": "opolskie",
    "etykieta": "opolskie",
    "opis": "kod TERC 16"
   },
   {
    "kod": "podkarpackie",
    "etykieta": "podkarpackie",
    "opis": "kod TERC 18"
   },
   {
    "kod": "podlaskie",
    "etykieta": "podlaskie",
    "opis": "kod TERC 20"
   },
   {
    "kod": "pomorskie",
    "etykieta": "pomorskie",
    "opis": "kod TERC 22"
   },
   {
    "kod": "śląskie",
    "etykieta": "śląskie",
    "opis": "kod TERC 24"
   },
   {
    "kod": "świętokrzyskie",
    "etykieta": "świętokrzyskie",
    "opis": "kod TERC 26"
   },
   {
    "kod": "warmińsko-mazurskie",
    "etykieta": "warmińsko-mazurskie",
    "opis": "kod TERC 28"
   },
   {
    "kod": "wielkopolskie",
    "etykieta": "wielkopolskie",
    "opis": "kod TERC 30"
   },
   {
    "kod": "zachodniopomorskie",
    "etykieta": "zachodniopomorskie",
    "opis": "kod TERC 32"
   }
  ],
  "licencja_rekordu": [
   {
    "kod": "CC0-1.0",
    "etykieta": "CC0 1.0",
    "opis": "Domena publiczna. Stosowana m.in. przez UM Krosno i UM Przemyśl na dane.gov.pl."
   },
   {
    "kod": "CC-BY-4.0",
    "etykieta": "CC BY 4.0",
    "opis": "Uznanie autorstwa. Stosowana m.in. przez UM Marki i UM st. Warszawy."
   }
  ]
 },
 "zrodla": [
  {
   "kod_zrodla": "DGP-3624",
   "nazwa_zrodla": "Defibrylatory zlokalizowane w Mieście Krosno",
   "dysponent": "Urząd Miasta Krosna",
   "typ_zrodla": "zbiór dane.gov.pl",
   "zasieg_terytorialny": "gmina miejska Krosno",
   "url": "https://dane.gov.pl/pl/dataset/3624",
   "format": "CSV, JSON-LD",
   "licencja": "CC0-1.0",
   "czestotliwosc_aktualizacji": "nie dotyczy",
   "pola_dostepne_wg_wzorca": "dlugosc/szerokosc, nazwa, opis_lokalizacji (Lokalizacja), adres, id_lokalne (Numer Id)",
   "glowne_braki": "dostępność, godziny, sposób dostępu, data weryfikacji",
   "problemy_jakosci": "adres w jednym polu (niezgodne ze Standardem technicznym); kolumna Nazwa zawsze „Defibrylator”",
   "priorytet_przy_konflikcie": 1,
   "status_weryfikacji": "zweryfikowano nagłówek CSV 2026-11-21"
  },
  {
   "kod_zrodla": "DGP-4581",
   "nazwa_zrodla": "Lokalizacje AED – Automatycznych Defibrylatorów Zewnętrznych w Przemyślu",
   "dysponent": "Urząd Miejski w Przemyślu",
   "typ_zrodla": "zbiór dane.gov.pl (dane dynamiczne)",
   "zasieg_terytorialny": "gmina miejska Przemyśl",
   "url": "https://dane.gov.pl/pl/dataset/4581",
   "format": "CSV, GeoJSON, JSON, XML (GML)",
   "licencja": "CC0-1.0",
   "czestotliwosc_aktualizacji": "codziennie",
   "pola_dostepne_wg_wzorca": "id_lokalne (id), nazwa (name), miejscowosc (city), ulica (street), numer_budynku (home_number), kod_pocztowy (postcode), telefon (phone), email, współrzędne (geometry)",
   "glowne_braki": "dostępność, godziny, opis dojścia",
   "problemy_jakosci": "CSV rozdzielany średnikiem; współrzędne jako GeoJSON wewnątrz kolumny; numer AED wpisany w nazwę; ogólny opis AED powtórzony w każdym rekordzie",
   "priorytet_przy_konflikcie": 1,
   "status_weryfikacji": "zweryfikowano nagłówek CSV 2026-11-21"
  },
  {
   "kod_zrodla": "DGP-4955",
   "nazwa_zrodla": "Defibrylatory zlokalizowane na terenie Miasta Marki",
   "dysponent": "Urząd Miasta Marki",
   "typ_zrodla": "zbiór dane.gov.pl",
   "zasieg_terytorialny": "gmina miejska Marki",
   "url": "https://dane.gov.pl/pl/dataset/4955",
   "format": "CSV, JSON-LD, XLSX",
   "licencja": "CC-BY-4.0",
   "czestotliwosc_aktualizacji": "jednorazowe udostępnienie",
   "pola_dostepne_wg_wzorca": "współrzędne, nazwa, opis_lokalizacji, adres, id_lokalne",
   "glowne_braki": "dostępność, godziny, sposób dostępu, data weryfikacji",
   "problemy_jakosci": "nagłówek „Długość, Szerokość” a wartości w kolejności szerokość, długość; każdy wiersz CSV ujęty w cudzysłów jako jedno pole",
   "priorytet_przy_konflikcie": 1,
   "status_weryfikacji": "zweryfikowano nagłówek CSV 2026-11-21"
  },
  {
   "kod_zrodla": "DGP-39512",
   "nazwa_zrodla": "Lokalizacja defibrylatorów (AED)",
   "dysponent": "Urząd m.st. Warszawy",
   "typ_zrodla": "zbiór dane.gov.pl (harwestowany z dane.um.warszawa.pl)",
   "zasieg_terytorialny": "m.st. Warszawa",
   "url": "https://dane.gov.pl/pl/dataset/39512",
   "format": "JSON",
   "licencja": "CC-BY-4.0",
   "czestotliwosc_aktualizacji": "codziennie",
   "pola_dostepne_wg_wzorca": "do weryfikacji",
   "glowne_braki": "do weryfikacji",
   "problemy_jakosci": "do weryfikacji (struktura JSON nieprzejrzana)",
   "priorytet_przy_konflikcie": 1,
   "status_weryfikacji": "metadane zweryfikowane przez API 2026-11-21; kolumny do weryfikacji"
  },
  {
   "kod_zrodla": "FORMULARZ",
   "nazwa_zrodla": "Formularz dysponenta (prototyp)",
   "dysponent": "dowolny dysponent",
   "typ_zrodla": "formularz w aplikacji",
   "zasieg_terytorialny": "cała Polska",
   "url": "—",
   "format": "CSV/JSON/XLSX generowany lokalnie",
   "licencja": "wybór dysponenta (domyślnie CC0-1.0)",
   "czestotliwosc_aktualizacji": "na żądanie",
   "pola_dostepne_wg_wzorca": "wszystkie pola wzorca",
   "glowne_braki": "—",
   "problemy_jakosci": "dane wprowadzane ręcznie, walidowane w formularzu",
   "priorytet_przy_konflikcie": 2,
   "status_weryfikacji": "propozycja zespołu"
  },
  {
   "kod_zrodla": "PLIK",
   "nazwa_zrodla": "Plik CSV/XLSX wgrany przez dysponenta",
   "dysponent": "dowolny dysponent",
   "typ_zrodla": "plik lokalny",
   "zasieg_terytorialny": "zależy od dysponenta",
   "url": "—",
   "format": "CSV, XLSX",
   "licencja": "wskazana przy imporcie",
   "czestotliwosc_aktualizacji": "zależy od dysponenta",
   "pola_dostepne_wg_wzorca": "zależy od pliku (mapowanie kolumn w aplikacji)",
   "glowne_braki": "—",
   "problemy_jakosci": "—",
   "priorytet_przy_konflikcie": 1,
   "status_weryfikacji": "propozycja zespołu"
  },
  {
   "kod_zrodla": "PRZYKLAD-PLIK / PRZYKLAD-DGP / PRZYKLAD-FORMULARZ",
   "nazwa_zrodla": "Rekordy przykładowe w tym pliku",
   "dysponent": "—",
   "typ_zrodla": "dane fikcyjne",
   "zasieg_terytorialny": "—",
   "url": "—",
   "format": "—",
   "licencja": "—",
   "czestotliwosc_aktualizacji": "—",
   "pola_dostepne_wg_wzorca": "—",
   "glowne_braki": "—",
   "problemy_jakosci": "usunąć przed publikacją",
   "priorytet_przy_konflikcie": "—",
   "status_weryfikacji": "—"
  }
 ],
 "formularzDysponenta": {
  "plikXlsx": "wzorzec/formularz_dysponenta_AED.xlsx",
  "plikCsv": "wzorzec/formularz_dysponenta_AED.csv",
  "arkusz": "Urządzenia",
  "znacznikPrzykladu": "PRZYKŁAD –",
  "kolumny": [
   {
    "pole": "nazwa",
    "naglowek": "Nazwa miejsca",
    "opis": "Budynek lub obiekt, np. „Szkoła Podstawowa nr 1 – hol”.",
    "obowiazkowe": true,
    "rodzaj": "tekst"
   },
   {
    "pole": "miejscowosc",
    "naglowek": "Miejscowość",
    "opis": "Np. Krosno.",
    "obowiazkowe": true,
    "rodzaj": "tekst"
   },
   {
    "pole": "ulica",
    "naglowek": "Ulica",
    "opis": "Np. ul. Szkolna, al. Jana Pawła II. Puste, gdy miejscowość nie ma ulic.",
    "obowiazkowe": false,
    "rodzaj": "tekst"
   },
   {
    "pole": "numer_budynku",
    "naglowek": "Nr budynku",
    "opis": "Np. 5A, 12/14.",
    "obowiazkowe": false,
    "rodzaj": "tekst"
   },
   {
    "pole": "kod_pocztowy",
    "naglowek": "Kod pocztowy",
    "opis": "Np. 30-001.",
    "obowiazkowe": false,
    "rodzaj": "tekst"
   },
   {
    "pole": "wojewodztwo",
    "naglowek": "Województwo",
    "opis": "Wybierz z listy.",
    "obowiazkowe": false,
    "rodzaj": "lista"
   },
   {
    "pole": "szerokosc_geograficzna",
    "naglowek": "Szerokość geograficzna",
    "opis": "Pierwsza liczba z mapy (49–55), np. 50.061430. Na mapie kliknij prawym przyciskiem miejsce AED.",
    "obowiazkowe": true,
    "rodzaj": "wspolrzedna_lat"
   },
   {
    "pole": "dlugosc_geograficzna",
    "naglowek": "Długość geograficzna",
    "opis": "Druga liczba z mapy (14–24), np. 19.936580.",
    "obowiazkowe": true,
    "rodzaj": "wspolrzedna_lon"
   },
   {
    "pole": "opis_lokalizacji",
    "naglowek": "Gdzie dokładnie wisi AED?",
    "opis": "Np. „hol główny, na lewo od wejścia, obok portierni”.",
    "obowiazkowe": true,
    "rodzaj": "tekst"
   },
   {
    "pole": "wewnatrz_budynku",
    "naglowek": "Czy AED jest wewnątrz budynku?",
    "opis": "Tak / Nie (Nie = na zewnątrz, np. w kapsule na ścianie).",
    "obowiazkowe": false,
    "rodzaj": "tak_nie"
   },
   {
    "pole": "kondygnacja",
    "naglowek": "Piętro",
    "opis": "0 = parter, -1 = piwnica, 1 = pierwsze piętro.",
    "obowiazkowe": false,
    "rodzaj": "liczba"
   },
   {
    "pole": "dostepnosc",
    "naglowek": "Kto i kiedy może skorzystać?",
    "opis": "Wybierz z listy.",
    "obowiazkowe": true,
    "rodzaj": "lista"
   },
   {
    "pole": "godziny_dostepnosci",
    "naglowek": "Godziny dostępu",
    "opis": "Gdy nie całą dobę, np. „pn-pt 7:00-17:00; sob 8:00-14:00”.",
    "obowiazkowe": false,
    "rodzaj": "tekst"
   },
   {
    "pole": "sposob_dostepu",
    "naglowek": "Jak zabezpieczony jest AED?",
    "opis": "Wybierz z listy.",
    "obowiazkowe": true,
    "rodzaj": "lista"
   },
   {
    "pole": "instrukcja_dostepu",
    "naglowek": "Gdzie jest klucz / kto otwiera?",
    "opis": "Gdy szafka jest zamknięta. NIE wpisuj samego kodu do szafki.",
    "obowiazkowe": false,
    "rodzaj": "tekst"
   },
   {
    "pole": "status",
    "naglowek": "Czy urządzenie działa?",
    "opis": "Wybierz z listy.",
    "obowiazkowe": true,
    "rodzaj": "lista"
   },
   {
    "pole": "typ_urzadzenia",
    "naglowek": "Typ urządzenia",
    "opis": "Wybierz z listy (jeśli wiesz).",
    "obowiazkowe": false,
    "rodzaj": "lista"
   },
   {
    "pole": "producent",
    "naglowek": "Producent",
    "opis": "Jeśli wiesz.",
    "obowiazkowe": false,
    "rodzaj": "tekst"
   },
   {
    "pole": "model",
    "naglowek": "Model",
    "opis": "Jeśli wiesz.",
    "obowiazkowe": false,
    "rodzaj": "tekst"
   },
   {
    "pole": "tryb_pediatryczny",
    "naglowek": "Czy są elektrody dla dzieci?",
    "opis": "Tak / Nie.",
    "obowiazkowe": false,
    "rodzaj": "tak_nie"
   },
   {
    "pole": "data_waznosci_elektrod",
    "naglowek": "Elektrody ważne do",
    "opis": "Data z opakowania elektrod, RRRR-MM-DD.",
    "obowiazkowe": false,
    "rodzaj": "data"
   },
   {
    "pole": "data_waznosci_baterii",
    "naglowek": "Bateria ważna do",
    "opis": "RRRR-MM-DD.",
    "obowiazkowe": false,
    "rodzaj": "data"
   },
   {
    "pole": "data_przegladu",
    "naglowek": "Data ostatniego przeglądu",
    "opis": "RRRR-MM-DD.",
    "obowiazkowe": false,
    "rodzaj": "data"
   },
   {
    "pole": "dysponent_nazwa",
    "naglowek": "Nazwa instytucji (dysponent)",
    "opis": "Pełna nazwa, np. „Urząd Miasta Krosna”.",
    "obowiazkowe": true,
    "rodzaj": "tekst"
   },
   {
    "pole": "dysponent_typ",
    "naglowek": "Rodzaj instytucji",
    "opis": "Wybierz z listy.",
    "obowiazkowe": false,
    "rodzaj": "lista"
   },
   {
    "pole": "dysponent_regon",
    "naglowek": "REGON",
    "opis": "9 lub 14 cyfr. Nie podawaj dla osoby prywatnej.",
    "obowiazkowe": false,
    "rodzaj": "tekst"
   },
   {
    "pole": "telefon_kontaktowy",
    "naglowek": "Telefon (portiernia, recepcja)",
    "opis": "Numer instytucji, nie prywatny. Np. 134743000.",
    "obowiazkowe": false,
    "rodzaj": "tekst"
   },
   {
    "pole": "email_kontaktowy",
    "naglowek": "E-mail do zgłaszania zmian",
    "opis": "Adres funkcyjny, np. sekretariat@…, nie imienny.",
    "obowiazkowe": false,
    "rodzaj": "tekst"
   },
   {
    "pole": "id_lokalne",
    "naglowek": "Twój numer urządzenia",
    "opis": "Numer inwentarzowy lub oznaczenie AED u Ciebie.",
    "obowiazkowe": false,
    "rodzaj": "tekst"
   },
   {
    "pole": "data_weryfikacji",
    "naglowek": "Kiedy sprawdzono, że AED jest na miejscu?",
    "opis": "Data, RRRR-MM-DD.",
    "obowiazkowe": true,
    "rodzaj": "data"
   },
   {
    "pole": "sposob_weryfikacji",
    "naglowek": "Jak sprawdzono?",
    "opis": "Wybierz z listy.",
    "obowiazkowe": false,
    "rodzaj": "lista"
   },
   {
    "pole": "uwagi",
    "naglowek": "Uwagi",
    "opis": "Np. „w serwisie do 15 grudnia”.",
    "obowiazkowe": false,
    "rodzaj": "tekst"
   }
  ],
  "slowniki": {
   "status": [
    {
     "kod": "aktywny",
     "etykieta": "Tak, działa i jest na miejscu"
    },
    {
     "kod": "tymczasowo_niedostepny",
     "etykieta": "Chwilowo nie (serwis, naprawa)"
    },
    {
     "kod": "wycofany",
     "etykieta": "Nie – urządzenie usunięto"
    }
   ],
   "dostepnosc": [
    {
     "kod": "publiczna_24_7",
     "etykieta": "Całodobowo, dla wszystkich"
    },
    {
     "kod": "publiczna_w_godzinach",
     "etykieta": "Dla wszystkich, w godzinach otwarcia"
    },
    {
     "kod": "dla_klientow",
     "etykieta": "Tylko dla klientów / użytkowników obiektu"
    },
    {
     "kod": "tylko_personel",
     "etykieta": "Wydaje personel (na prośbę)"
    },
    {
     "kod": "mobilny",
     "etykieta": "W pojeździe (np. OSP, policja)"
    }
   ],
   "sposob_dostepu": [
    {
     "kod": "otwarta_szafka",
     "etykieta": "Wisi w otwartej szafce / na uchwycie"
    },
    {
     "kod": "szafka_z_alarmem",
     "etykieta": "Szafka z alarmem, bez zamka"
    },
    {
     "kod": "szafka_na_kod",
     "etykieta": "Szafka zamknięta na kod"
    },
    {
     "kod": "szafka_na_klucz",
     "etykieta": "Szafka zamknięta na klucz"
    },
    {
     "kod": "u_personelu",
     "etykieta": "Trzeba poprosić personel"
    },
    {
     "kod": "nieznany",
     "etykieta": "Nie wiem"
    }
   ],
   "typ_urzadzenia": [
    {
     "kod": "polautomatyczny",
     "etykieta": "Półautomatyczny (trzeba nacisnąć przycisk)"
    },
    {
     "kod": "automatyczny",
     "etykieta": "Automatyczny (sam wykonuje wyładowanie)"
    },
    {
     "kod": "nieznany",
     "etykieta": "Nie wiem"
    }
   ],
   "dysponent_typ": [
    {
     "kod": "jst",
     "etykieta": "Samorząd (urząd gminy, miasta, powiatu)"
    },
    {
     "kod": "administracja_rzadowa",
     "etykieta": "Administracja rządowa"
    },
    {
     "kod": "podmiot_leczniczy",
     "etykieta": "Przychodnia / szpital"
    },
    {
     "kod": "placowka_oswiatowa",
     "etykieta": "Szkoła / przedszkole / uczelnia"
    },
    {
     "kod": "sluzby",
     "etykieta": "Służby (straż, policja, OSP)"
    },
    {
     "kod": "transport",
     "etykieta": "Transport (dworzec, lotnisko, metro)"
    },
    {
     "kod": "firma",
     "etykieta": "Firma / sklep / hotel"
    },
    {
     "kod": "organizacja_pozarzadowa",
     "etykieta": "Fundacja / stowarzyszenie / parafia"
    },
    {
     "kod": "inny",
     "etykieta": "Inny"
    }
   ],
   "sposob_weryfikacji": [
    {
     "kod": "wizja_lokalna",
     "etykieta": "Obejrzałem(-am) urządzenie na miejscu"
    },
    {
     "kod": "potwierdzenie_dysponenta",
     "etykieta": "Potwierdzam jako dysponent"
    },
    {
     "kod": "zdjecie",
     "etykieta": "Mam zdjęcie z datą"
    },
    {
     "kod": "import_bez_weryfikacji",
     "etykieta": "Nie sprawdzano"
    }
   ],
   "wojewodztwo": [
    {
     "kod": "dolnośląskie",
     "etykieta": "dolnośląskie"
    },
    {
     "kod": "kujawsko-pomorskie",
     "etykieta": "kujawsko-pomorskie"
    },
    {
     "kod": "lubelskie",
     "etykieta": "lubelskie"
    },
    {
     "kod": "lubuskie",
     "etykieta": "lubuskie"
    },
    {
     "kod": "łódzkie",
     "etykieta": "łódzkie"
    },
    {
     "kod": "małopolskie",
     "etykieta": "małopolskie"
    },
    {
     "kod": "mazowieckie",
     "etykieta": "mazowieckie"
    },
    {
     "kod": "opolskie",
     "etykieta": "opolskie"
    },
    {
     "kod": "podkarpackie",
     "etykieta": "podkarpackie"
    },
    {
     "kod": "podlaskie",
     "etykieta": "podlaskie"
    },
    {
     "kod": "pomorskie",
     "etykieta": "pomorskie"
    },
    {
     "kod": "śląskie",
     "etykieta": "śląskie"
    },
    {
     "kod": "świętokrzyskie",
     "etykieta": "świętokrzyskie"
    },
    {
     "kod": "warmińsko-mazurskie",
     "etykieta": "warmińsko-mazurskie"
    },
    {
     "kod": "wielkopolskie",
     "etykieta": "wielkopolskie"
    },
    {
     "kod": "zachodniopomorskie",
     "etykieta": "zachodniopomorskie"
    }
   ]
  }
 }
};
