# Imres Toolkit

Kleines Modul für Foundry VTT (v13/v14) mit dem D&D-5e-System (ab 5.0).

- **Inspiration am Wurf:** Bei einem misslungenen Angriff, Rettungswurf oder einer Probe erscheint in der Chatnachricht ein Knopf, um die Inspiration zu verbrauchen und neu zu würfeln.
- **Bardische Inspiration:** Wer einen Barden spielt, bekommt an den Würfen der anderen einen Knopf, um einen Inspirationswürfel beizusteuern.
- **Konzentration:** Icon über der Makroleiste für jeden Konzentrationszauber (Klick beendet sie); bei misslungenem Konzentrationswurf endet sie automatisch.
- **Gruppen-Leiste:** Verschiebbare Übersicht aller Helden mit Trefferpunkten, Inspiration und Konzentration. Klick auf die Sonne eines Mitspielers gibt die eigene Inspiration weiter; der Spielleiter vergibt sie per Klick.
- **Marschformation (Spielleiter):** Zwei Knöpfe in den Token-Werkzeugen: markierte Tokens als Formation speichern und mit einem Klick auf der Karte platzieren.

## Installation

In Foundry unter „Add-on-Module" → „Modul installieren" unten diese Manifest-URL einfügen:

```
https://raw.githubusercontent.com/gansklebrig/Foundry-addon/main/module.json
```

Danach in der Welt unter „Module verwalten" aktivieren.

## Neue Version veröffentlichen

1. `version` in `module.json` erhöhen
2. `./build.sh` ausführen (baut `imres-toolkit.zip` neu)
3. committen und pushen
