# QR Creator Tool

A static browser app for generating QR codes from web links or plain text.

Feel free to make pull requests to improve this education project.

## Features

- Generate QR codes from `http`/`https` links or plain text.
- Assume `https://` when a link is entered without a scheme.
- Choose square, rounded, or dotted module styling.
- Add a center logo from a local image or a CORS-enabled image URL.
- Export the generated QR code as PNG or as a centered A4 PDF.
- Switch between English, Dutch, and German UI text.
- Use light, dark, or automatic theme preference.

## Project Structure

- `index.html` is the maintained app entrypoint.
- `css/app.css` contains the app styling.
- `js/app-browser.js` wires the file-compatible browser app, validation, language/theme state, QR generation, and exports.
- `js/app.js` keeps the modular source version of the same app logic.
- `js/qr-render.js` renders QR matrices and optional logos onto canvas.
- `js/shorten.js` integrates with link-shortening providers.
- `js/qr-load.js` and `js/pdf-load.js` load local vendored ESM bundles for the modular source version.
- `vendor/` contains browser-ready QR and PDF libraries used at runtime.
- `app-single.html` is only a compatibility redirect back to `index.html`.

## Running Locally

You can open `index.html` directly from your local files, or serve the folder over HTTP.

```sh
npm start
```

Then open `http://localhost:4173`.

If npm is not available, run the same server directly:

```sh
python3 -m http.server 4173
```

## Testing

```sh
npm test
```

The test suite checks that the app has a single maintained entrypoint, local QR/PDF bundles are present and importable, runtime QR/PDF loading does not use CDNs, and a QR matrix can be generated for a known link.

## Privacy And Network Notes

QR and PDF generation run from local vendored JavaScript bundles. The app does not need a network request for normal QR generation or export, including when opened as a local `file://` page.

If "Shorten link first" is enabled, the entered URL is sent to `is.gd`. If that request fails, it is sent to `v.gd`. The shortening integration uses JSONP, which means a script from the shortening provider is executed in the page. Avoid enabling shortening for private or sensitive links.

Remote logo URLs are loaded into a canvas. PNG/PDF export can fail if the image host does not allow cross-origin canvas use. A local logo file avoids that issue.
