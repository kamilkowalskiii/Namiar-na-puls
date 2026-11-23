# -*- coding: utf-8 -*-
"""Namiar na puls – lokalny serwer aplikacji i baza zgłoszeń „wyniki.gov” (SYMULACJA wysyłki do gov.pl).

Uruchomienie (z katalogu projektu, tylko biblioteka standardowa Pythona 3.8+):
    python serwer.py [--port 8000] [--baza baza/wyniki.gov] [--host 127.0.0.1]
i wejście na http://127.0.0.1:8000

Serwuje pliki aplikacji (jak `python -m http.server`, ale bez listowania katalogów, bez plików ukrytych
i bez samej bazy) oraz API:
    GET  /api/status       -> {ok, tryb: "serwer", baza: "wyniki.gov", liczba}
    POST /api/zgloszenia   -> zapis NOWEGO zgłoszenia (JSON z 4 kroków) -> {id, numer, status, data_wyslania, liczba, statystyki}
    GET  /api/statystyki   -> statystyki bazy
    GET  /api/baza         -> spójna kopia pliku bazy (sqlite3 backup API) do pobrania jako „wyniki.gov”

To jest symulacja: dane nie opuszczają komputera – trafiają tylko do lokalnego pliku SQLite.
Schemat bazy: js/core/gov_schemat.sql (wspólny z trybem przeglądarkowym, sql.js).
"""
import argparse
import hashlib
import http.server
import json
import os
import sqlite3
import sys
import tempfile
import threading
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlsplit

KORZEN = Path(__file__).resolve().parent
PLIK_SCHEMATU = KORZEN / "js" / "core" / "gov_schemat.sql"
NAZWA_BAZY = "wyniki.gov"
STATUS = "zatwierdzono_gov"
MAKS_ROZMIAR = 50 * 1024 * 1024          # limit treści POST (50 MB – jak limit pliku w aplikacji)
MAKS_REKORDOW = 500_000
WERSJA_FORMATU = 1


class BladZgloszenia(ValueError):
    """Zgłoszenie o niepoprawnej strukturze (odpowiedź 400 z czytelnym komunikatem)."""


# ---------------------------------------------------------------- baza
class Baza:
    def __init__(self, sciezka):
        self.sciezka = Path(sciezka).resolve()
        self.schemat = PLIK_SCHEMATU.read_text(encoding="utf-8")
        self.blokada = threading.Lock()          # jeden zapis naraz (SQLite i tak serializuje zapisy)
        self.sciezka.parent.mkdir(parents=True, exist_ok=True)
        with self.polacz() as db:
            db.executescript(self.schemat)

    def polacz(self):
        db = sqlite3.connect(str(self.sciezka), timeout=30, isolation_level=None)  # transakcje jawnie (BEGIN/COMMIT)
        db.row_factory = sqlite3.Row
        # tryb DELETE (domyślny): po każdym COMMIT plik wyniki.gov jest kompletny – można go skopiować bez serwera
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("PRAGMA foreign_keys=ON")
        return _Zamykane(db)

    def liczba(self, db=None):
        if db is None:
            with self.polacz() as db2:
                return self.liczba(db2)
        return db.execute("SELECT COUNT(*) FROM zgloszenia").fetchone()[0]

    def zapisz(self, zgl, tryb="serwer"):
        """Nowy wiersz w zgloszenia + rekordy_aed w jednej transakcji. Nigdy nie nadpisuje."""
        kol = kolumny_zgloszenia(zgl)
        suma = suma_kontrolna(zgl)
        teraz = datetime.now().replace(microsecond=0).isoformat()
        with self.blokada, self.polacz() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                cur = db.execute(
                    "INSERT INTO zgloszenia (data_wyslania, status, tytul, obszar, liczba_zrodel, liczba_rekordow_wejsciowych,"
                    " liczba_rekordow, liczba_bledow, liczba_ostrzezen, liczba_scalonych, licencja, etap1_zrodla, etap2_mapowanie,"
                    " etap3_walidacja, etap4_wynik, suma_kontrolna, tryb, wersja_aplikacji)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (teraz, STATUS, kol["tytul"], kol["obszar"], kol["liczba_zrodel"], kol["liczba_rekordow_wejsciowych"],
                     kol["liczba_rekordow"], kol["liczba_bledow"], kol["liczba_ostrzezen"], kol["liczba_scalonych"], kol["licencja"],
                     _json(zgl["etap1_zrodla"]), _json(zgl["etap2_mapowanie"]), _json(zgl["etap3_walidacja"]), _json(zgl["etap4_wynik"]),
                     suma, tryb, kol["wersja_aplikacji"]))
                ident = cur.lastrowid
                numer = "GOV-%s-%06d" % (teraz[:4], ident)
                db.execute("UPDATE zgloszenia SET numer = ? WHERE id = ?", (numer, ident))
                db.executemany(
                    "INSERT INTO rekordy_aed (zgloszenie_id, id_aed, nazwa, miejscowosc, szerokosc, dlugosc, status, dane)"
                    " VALUES (?,?,?,?,?,?,?,?)",
                    (wiersz_rekordu(ident, r) for r in zgl["etap4_wynik"]["rekordy"]))
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise
            return {"id": ident, "numer": numer, "status": STATUS, "data_wyslania": teraz, "suma_kontrolna": suma,
                    "liczba": self.liczba(db), "statystyki": statystyki(db)}

    def statystyki(self):
        with self.polacz() as db:
            return statystyki(db)

    def lista(self):
        with self.polacz() as db:
            return [dict(r) for r in db.execute(
                "SELECT numer, data_wyslania, status, tytul, obszar, liczba_zrodel, liczba_rekordow, liczba_bledow, liczba_ostrzezen, licencja"
                " FROM zgloszenia ORDER BY id DESC LIMIT 200")]

    def zbior(self, numer):
        with self.polacz() as db:
            z = db.execute("SELECT id, numer, data_wyslania, status, tytul, obszar, liczba_zrodel, liczba_rekordow, liczba_bledow, liczba_ostrzezen, licencja"
                           " FROM zgloszenia WHERE numer = ?", (numer,)).fetchone()
            if z is None:
                return None
            o = dict(z)
            ident = o.pop("id")
            o["rekordy"] = [dict(r) for r in db.execute(
                "SELECT id_aed, nazwa, miejscowosc, szerokosc, dlugosc, status FROM rekordy_aed WHERE zgloszenie_id = ? ORDER BY id LIMIT 1000", (ident,))]
            return o

    def kopia(self):
        """Spójna kopia bazy (backup API) jako bajty – działa także w trakcie zapisów."""
        fd, tmp = tempfile.mkstemp(suffix=".gov")
        os.close(fd)
        try:
            with self.polacz() as zrodlo:
                cel = sqlite3.connect(tmp)
                try:
                    zrodlo.backup(cel)
                finally:
                    cel.close()
            return Path(tmp).read_bytes()
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass


class _Zamykane:
    """Połączenie sqlite3 jako menedżer kontekstu, który ZAMYKA połączenie (sqlite3.Connection tylko commituje)."""

    def __init__(self, db):
        self.db = db

    def __getattr__(self, n):
        return getattr(self.db, n)

    def __enter__(self):
        return self.db

    def __exit__(self, *a):
        self.db.close()


def _json(v):
    return json.dumps(v, ensure_ascii=False)


def kanoniczny_json(v):
    """Kanoniczny zapis JSON (klucze posortowane, bez spacji) – ten sam algorytm co AED.gov.kanoniczny w przeglądarce."""
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def suma_kontrolna(zgl):
    return hashlib.sha256(kanoniczny_json(zgl).encode("utf-8")).hexdigest()


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _tekst(v, maks=1000):
    return None if v is None else str(v)[:maks]


def kolumny_zgloszenia(zgl):
    """Kolumny podsumowania wyliczane z treści zgłoszenia (te same reguły co kolumnyZgloszenia w js/core/gov.js)."""
    e3, e4 = zgl["etap3_walidacja"], zgl["etap4_wynik"]
    pods = e3.get("podsumowanie") or {}
    meta = e4.get("metadane") or {}
    lic = e4.get("licencja") or {}
    raport = e4.get("raport_scalenia") or {}
    app = zgl.get("aplikacja") or {}
    return {
        "tytul": _tekst(meta.get("tytul") or zgl.get("tytul"), 300),
        "obszar": _tekst(zgl.get("obszar"), 300),
        "liczba_zrodel": len(zgl["etap1_zrodla"]),
        "liczba_rekordow_wejsciowych": _int(pods.get("rekordy")),
        "liczba_rekordow": len(e4["rekordy"]),
        "liczba_bledow": _int(pods.get("bledy")),
        "liczba_ostrzezen": _int(pods.get("ostrzezenia")),
        "liczba_scalonych": _int(raport.get("scalone")),
        "licencja": _tekst(lic.get("kod") if isinstance(lic, dict) else lic, 40),
        "wersja_aplikacji": _tekst(app.get("wersja"), 40),
    }


def _liczba(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def wiersz_rekordu(ident, r):
    return (ident, _tekst(r.get("id_aed"), 64), _tekst(r.get("nazwa"), 300), _tekst(r.get("miejscowosc"), 200),
            _liczba(r.get("szerokosc_geograficzna")), _liczba(r.get("dlugosc_geograficzna")), _tekst(r.get("status"), 40), _json(r))


def statystyki(db):
    p = db.execute("SELECT * FROM podsumowanie").fetchone()
    return {
        "liczba": db.execute("SELECT COUNT(*) FROM zgloszenia").fetchone()[0],
        "sumaRekordow": p["suma_rekordow"],
        "sumaBledow": p["suma_bledow"],
        "sumaOstrzezen": p["suma_ostrzezen"],
        "pierwsze": p["pierwsze_zgloszenie"],
        "ostatnieData": p["ostatnie_zgloszenie"],
        "wgStatusu": {r["status"]: r["liczba"] for r in db.execute("SELECT status, liczba FROM zgloszenia_wg_statusu")},
        "dzienne": [dict(dzien=r["dzien"], liczba=r["liczba_zgloszen"], rekordy=r["suma_rekordow"])
                    for r in db.execute("SELECT * FROM statystyki_dzienne ORDER BY dzien DESC LIMIT 30")],
        "ostatnie": [dict(numer=r["numer"], data_wyslania=r["data_wyslania"], tytul=r["tytul"], liczba_rekordow=r["liczba_rekordow"])
                     for r in db.execute("SELECT numer, data_wyslania, tytul, liczba_rekordow FROM zgloszenia ORDER BY id DESC LIMIT 5")],
        "baza": NAZWA_BAZY,
    }


def sprawdz_zgloszenie(zgl):
    """Walidacja struktury (nie treści merytorycznej – tę sprawdza aplikacja w krokach 1–4)."""
    if not isinstance(zgl, dict):
        raise BladZgloszenia("Zgłoszenie musi być obiektem JSON.")
    if zgl.get("wersja_formatu", WERSJA_FORMATU) != WERSJA_FORMATU:
        raise BladZgloszenia("Nieobsługiwana wersja formatu zgłoszenia: %r." % zgl.get("wersja_formatu"))
    for klucz, typ, opis in (("etap1_zrodla", list, "lista źródeł (krok 1)"), ("etap2_mapowanie", list, "mapowanie (krok 2)"),
                             ("etap3_walidacja", dict, "walidacja i duplikaty (krok 3)"), ("etap4_wynik", dict, "wynik (krok 4)")):
        if not isinstance(zgl.get(klucz), typ):
            raise BladZgloszenia("Brak pola „%s” – %s." % (klucz, opis))
    if not zgl["etap1_zrodla"]:
        raise BladZgloszenia("Zgłoszenie nie ma żadnego źródła danych (krok 1).")
    if not isinstance(zgl["etap3_walidacja"].get("podsumowanie"), dict):
        raise BladZgloszenia("Brak podsumowania walidacji (krok 3).")
    e4 = zgl["etap4_wynik"]
    if not isinstance(e4.get("metadane"), dict):
        raise BladZgloszenia("Brak metadanych zbioru (krok 4).")
    rek = e4.get("rekordy")
    if not isinstance(rek, list) or not rek:
        raise BladZgloszenia("Zgłoszenie nie zawiera rekordów wynikowych (krok 4).")
    if len(rek) > MAKS_REKORDOW:
        raise BladZgloszenia("Za dużo rekordów (%d, limit %d)." % (len(rek), MAKS_REKORDOW))
    if not all(isinstance(r, dict) for r in rek):
        raise BladZgloszenia("Każdy rekord wynikowy musi być obiektem JSON.")
    return zgl


# ---------------------------------------------------------------- HTTP
TYPY = {
    ".wasm": "application/wasm", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml", ".csv": "text/csv; charset=utf-8", ".sql": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
    ".xml": "application/xml; charset=utf-8", ".xsd": "application/xml; charset=utf-8", ".geojson": "application/geo+json",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".map": "application/json; charset=utf-8",
}


class Obsluga(http.server.SimpleHTTPRequestHandler):
    baza = None                  # ustawiane w utworz_serwer
    server_version = "NamiarNaPuls/1.0"
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **TYPY)

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(KORZEN), **k)

    # ---- pomocnicze
    def _wyslij_json(self, kod, obj):
        tresc = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(kod)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(tresc)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(tresc)

    def _blad(self, kod, komunikat):
        self._wyslij_json(kod, {"ok": False, "blad": komunikat})

    def _sciezka(self):
        return unquote(urlsplit(self.path).path)

    def _zabroniona(self, sciezka):
        """Pliki, których nie serwujemy: ukryte (.git, .github…), baza i jej pliki pomocnicze, kod serwera i testy Pythona."""
        czesci = [c for c in sciezka.replace("\\", "/").split("/") if c]
        if any(c.startswith(".") or c == "__pycache__" for c in czesci):
            return True
        nazwa = czesci[-1].lower() if czesci else ""
        if nazwa.endswith((".gov", ".gov-journal", ".gov-wal", ".gov-shm", "-wal", "-shm", "-journal", ".pyc", ".db", ".sqlite")):
            return True
        try:
            cel = (KORZEN / "/".join(czesci)).resolve()
            if cel == self.baza.sciezka or str(cel).startswith(str(self.baza.sciezka)):
                return True
        except (OSError, ValueError):
            return True
        return False

    def _ten_sam_origin(self):
        """Ochrona przed zapisem z obcych stron (żądanie z przeglądarki ma nagłówek Origin)."""
        origin = self.headers.get("Origin")
        if not origin or origin == "null":
            return origin is None
        return urlsplit(origin).netloc == self.headers.get("Host", "")

    # ---- pliki
    def list_directory(self, path):
        self.send_error(404, "Brak pliku")
        return None

    def send_head(self):
        if self._zabroniona(self._sciezka()):
            self.send_error(404, "Brak pliku")
            return None
        return super().send_head()

    def end_headers(self):
        # znacznik dla AED.gov.tryb(): HEAD na stronę wystarcza, by wykryć API bazy (bez 404 na serwerze statycznym)
        self.send_header("X-Namiar-Serwer", "1")
        if not self._sciezka().startswith("/api/"):
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # ---- API
    def do_GET(self):
        s = self._sciezka()
        if not s.startswith("/api/"):
            return super().do_GET()
        try:
            if s == "/api/status":
                return self._wyslij_json(200, {"ok": True, "tryb": "serwer", "baza": NAZWA_BAZY, "liczba": self.baza.liczba(),
                                               "aplikacja": "Namiar na puls", "symulacja": True})
            if s == "/api/statystyki":
                return self._wyslij_json(200, self.baza.statystyki())
            if s == "/api/zgloszenia":
                return self._wyslij_json(200, {"zbiory": self.baza.lista()})
            if s.startswith("/api/zgloszenia/"):
                z = self.baza.zbior(s[len("/api/zgloszenia/"):])
                return self._wyslij_json(200, z) if z else self._blad(404, "Nie ma takiego zgłoszenia.")
            if s == "/api/baza":
                tresc = self.baza.kopia()
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.sqlite3")
                self.send_header("Content-Disposition", 'attachment; filename="%s"' % NAZWA_BAZY)
                self.send_header("Content-Length", str(len(tresc)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(tresc)
                return None
            return self._blad(404, "Nieznany adres API.")
        except sqlite3.Error as e:
            return self._blad(500, "Błąd bazy danych: %s" % e)

    def do_HEAD(self):
        if self._sciezka().startswith("/api/"):
            return self._blad(405, "Użyj GET lub POST.")
        return super().do_HEAD()

    def do_POST(self):
        s = self._sciezka()
        if s != "/api/zgloszenia":
            return self._blad(404, "Nieznany adres API.")
        try:
            dl = int(self.headers.get("Content-Length") or "")
        except ValueError:
            self.close_connection = True
            return self._blad(411, "Brak nagłówka Content-Length.")
        if dl > MAKS_ROZMIAR:
            self.close_connection = True
            return self._blad(413, "Zgłoszenie ma %.1f MB – limit to %d MB." % (dl / 1048576, MAKS_ROZMIAR // 1048576))
        tresc = self.rfile.read(dl) if dl > 0 else b""   # treść czytamy zawsze – klient dostaje odpowiedź, nie zerwane połączenie
        if not self._ten_sam_origin():
            return self._blad(403, "Zapis dozwolony tylko z aplikacji uruchomionej na tym serwerze.")
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self._blad(415, "Wymagany nagłówek Content-Type: application/json.")
        if not tresc:
            return self._blad(400, "Puste zgłoszenie.")
        try:
            zgl = json.loads(tresc.decode("utf-8"))
            sprawdz_zgloszenie(zgl)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._blad(400, "Treść nie jest poprawnym JSON w UTF-8.")
        except BladZgloszenia as e:
            return self._blad(400, str(e))
        try:
            wynik = self.baza.zapisz(zgl, "serwer")
        except sqlite3.Error as e:
            return self._blad(500, "Nie udało się zapisać zgłoszenia: %s" % e)
        wynik["tryb"] = "serwer"
        return self._wyslij_json(201, wynik)

    def log_message(self, fmt, *args):
        if os.environ.get("NAMIAR_CICHO"):
            return
        super().log_message(fmt, *args)


def utworz_serwer(host="127.0.0.1", port=8000, baza=NAZWA_BAZY):
    sciezka = Path(baza)
    if not sciezka.is_absolute():
        sciezka = Path.cwd() / sciezka
    b = Baza(sciezka)
    klasa = type("ObslugaNamiar", (Obsluga,), {"baza": b})
    srv = http.server.ThreadingHTTPServer((host, port), klasa)
    srv.daemon_threads = True
    return srv, b


def main(argv=None):
    p = argparse.ArgumentParser(description="Namiar na puls – lokalny serwer aplikacji i baza zgłoszeń wyniki.gov (symulacja gov.pl).")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--host", default="127.0.0.1", help="adres nasłuchu (domyślnie tylko ten komputer: 127.0.0.1)")
    p.add_argument("--baza", default=str(KORZEN / "baza" / NAZWA_BAZY), help="ścieżka pliku bazy SQLite (domyślnie baza/wyniki.gov w katalogu projektu)")
    a = p.parse_args(argv)
    srv, b = utworz_serwer(a.host, a.port, a.baza)
    print("Namiar na puls: http://%s:%d/  (baza: %s, zgłoszeń: %d) – Ctrl+C kończy" % (a.host, srv.server_address[1], b.sciezka, b.liczba()),
          flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    sys.exit(main())
