# Fingerprint Label Preview (HTML + Canvas)

Static web app that parses a subset of Intermec/Honeywell Fingerprint label commands and renders a 4×6 shipping-label style preview.

## Supported

- `!F T S` text
- `!F B N/E` line segments (north/east)
- `!F C S` barcode placeholders (simulated bars)

Ignored: `!Y`, `!C`, `!V`, `!P`, and comment lines starting with `//`.

## Run

Just open `index.html` in a browser.

If you prefer a local server (recommended for consistent file loading), from this folder run either:

```powershell
node server.js
```

or (if you have Python installed):

```powershell
python -m http.server 8000
```

Then open:

- http://localhost:8000

## Notes

The preview assumes a 4×6 label at 406 dpi: 1624×2436 dots, with origin at the bottom-left (common in Fingerprint scripts).
