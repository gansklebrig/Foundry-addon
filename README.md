# Imres Toolkit

Kleines Modul für Foundry VTT (v13/v14) mit dem D&D-5e-System (ab 5.0).

- **Inspiration am Wurf:** Bei einem misslungenen Angriff, Rettungswurf oder einer Probe erscheint in der Chatnachricht ein Knopf, um die Inspiration zu verbrauchen und neu zu würfeln.
- **Konzentrations-Leiste:** Über der Makroleiste erscheint ein Icon für jeden Konzentrationszauber; ein Klick beendet die Konzentration.

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
