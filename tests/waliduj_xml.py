"""Walidacja pliku XML z metadanymi względem schematu harvestera dane.gov.pl (otwarte_dane_latest.xsd).

Użycie:  python tests/waliduj_xml.py plik.xml [kolejny.xml ...]
Wymaga:  pip install lxml
Kody wyjścia: 0 – wszystkie pliki zgodne, 1 – co najmniej jeden niezgodny, 2 – brak biblioteki lxml.
"""
import os
import sys

try:
    from lxml import etree
except ImportError:
    print('BRAK_LXML: zainstaluj bibliotekę poleceniem: pip install lxml')
    sys.exit(2)

KORZEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XSD = os.path.join(KORZEN, 'otwarte_dane_latest.xsd')


def main(pliki):
    schemat = etree.XMLSchema(etree.parse(XSD))
    wynik = 0
    for p in pliki:
        try:
            dok = etree.parse(p)
        except etree.XMLSyntaxError as e:
            print('NIEPOPRAWNY_XML %s: %s' % (p, e))
            wynik = 1
            continue
        if schemat.validate(dok):
            print('ZGODNY %s' % p)
        else:
            wynik = 1
            print('NIEZGODNY %s' % p)
            for b in schemat.error_log:
                print('  wiersz %d: %s' % (b.line, b.message))
    return wynik


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1:]))
