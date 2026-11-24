#!/bin/sh
# Baut imres-toolkit.zip neu (nach jeder Aenderung ausfuehren und Version in module.json erhoehen)
cd "$(dirname "$0")" && rm -f imres-toolkit.zip && zip -qr imres-toolkit.zip module.json scripts styles
