// Shared wording for static markup and dynamically created controls.
// Each row is [English, Dutch, German]. Placeholders remain unchanged.
(() => {
  const rows = [
    ["QR dot colour", "Kleur van de QR-blokjes", "Farbe der QR-Module"],
    ["Background colour", "Achtergrondkleur", "Hintergrundfarbe"],
    ["Dot shape", "Vorm van de blokjes", "Form der Module"],
    ["Corner shape", "Vorm van de hoekmarkeringen", "Form der Eckmarkierungen"],
    ["Square", "Vierkant", "Quadratisch"],
    ["Rounded", "Afgerond", "Abgerundet"],
    ["Circular", "Rond", "Kreisförmig"],
    ["Save to Recents", "Opslaan bij recente codes", "Unter den letzten Codes speichern"],
    ["Saved to Recents.", "Opgeslagen bij recente codes.", "Unter den letzten Codes gespeichert."],
    ["Back to generator", "Terug naar de generator", "Zurück zum Generator"],
    ["Camera", "Camera", "Kamera"],
    ["Default camera", "Standaardcamera", "Standardkamera"],
    ["Wi-Fi network", "Wifi-netwerk", "WLAN-Netzwerk"],
    ["Contact (vCard)", "Contactpersoon (vCard)", "Kontakt (vCard)"],
    ["Email", "E-mail", "E-Mail"],
    ["Phone call", "Telefoongesprek", "Telefonanruf"],
    ["SMS message", "Sms-bericht", "SMS-Nachricht"],
    ["Calendar event", "Agenda-afspraak", "Kalendertermin"],
    ["Location", "Locatie", "Standort"],
    ["Network name", "Netwerknaam", "Netzwerkname"],
    ["Wi-Fi password", "Wifi-wachtwoord", "WLAN-Passwort"],
    ["Network security", "Netwerkbeveiliging", "Netzwerksicherheit"],
    ["My network is hidden", "Mijn netwerk is verborgen", "Mein Netzwerk ist ausgeblendet"],
    ["Password protected (WPA / WPA2)", "Beveiligd met een wachtwoord (WPA / WPA2)", "Passwortgeschützt (WPA / WPA2)"],
    ["Older network (WEP)", "Ouder netwerk (WEP)", "Älteres Netzwerk (WEP)"],
    ["No password (open network)", "Geen wachtwoord (open netwerk)", "Ohne Passwort (offenes Netzwerk)"],
    ["Most home and school networks use the first option. Check your router settings if unsure.", "De meeste thuis- en schoolnetwerken gebruiken de eerste optie. Controleer bij twijfel de instellingen van je router.", "Die meisten Heim- und Schulnetzwerke verwenden die erste Option. Prüfe im Zweifelsfall die Einstellungen deines Routers."],
    ["Leave unchecked unless your network is deliberately hidden from the Wi-Fi list.", "Laat dit uitgevinkt, tenzij je netwerk bewust niet in de lijst met wifi-netwerken wordt weergegeven.", "Lass diese Option deaktiviert, sofern dein Netzwerk nicht absichtlich in der WLAN-Liste ausgeblendet ist."],
    ["Full name", "Volledige naam", "Vollständiger Name"],
    ["Organisation", "Organisatie", "Organisation"],
    ["Phone", "Telefoon", "Telefon"],
    ["Website", "Website", "Website"],
    ["Recipient", "Ontvanger", "Empfänger"],
    ["Subject", "Onderwerp", "Betreff"],
    ["Message", "Bericht", "Nachricht"],
    ["Phone number", "Telefoonnummer", "Telefonnummer"],
    ["Event title", "Titel van de afspraak", "Termintitel"],
    ["Start", "Begintijd", "Beginn"],
    ["End", "Eindtijd", "Ende"],
    ["Latitude", "Breedtegraad", "Breitengrad"],
    ["Longitude", "Lengtegraad", "Längengrad"],
    ["QR quality and appearance", "Kwaliteit en uiterlijk van de QR-code", "Qualität und Aussehen des QR-Codes"],
    ["Error correction", "Foutcorrectie", "Fehlerkorrektur"],
    ["Automatic", "Automatisch", "Automatisch"],
    ["Quiet zone (modules)", "Witte rand (aantal blokjes)", "Ruhezone (Anzahl der Module)"],
    ["Foreground", "Voorgrondkleur", "Vordergrundfarbe"],
    ["Background", "Achtergrondkleur", "Hintergrundfarbe"],
    ["Download SVG", "SVG downloaden", "SVG herunterladen"],
    ["Copy image", "Afbeelding kopiëren", "Bild kopieren"],
    ["Share", "Delen", "Teilen"],
    ["Reset", "Beginwaarden herstellen", "Zurücksetzen"],
    ["Recent codes (stored only on this device)", "Recente codes (alleen op dit apparaat opgeslagen)", "Letzte Codes (nur auf diesem Gerät gespeichert)"],
    ["No recent codes yet.", "Nog geen recente codes.", "Noch keine Codes vorhanden."],
    ["Scan history", "Scangeschiedenis", "Scanverlauf"],
    ["No scans yet.", "Nog geen codes gescand.", "Noch keine Codes gescannt."],
    ["Sound", "Geluid", "Ton"],
    ["Vibrate", "Trillen", "Vibration"],
    ["Continuous scanning", "Doorlopend scannen", "Fortlaufend scannen"],
    ["Torch", "Zaklamp aan", "Taschenlampe einschalten"],
    ["Torch off", "Zaklamp uit", "Taschenlampe ausschalten"],
    ["Torch is unavailable on this camera.", "Deze camera ondersteunt geen zaklamp.", "Diese Kamera unterstützt keine Taschenlampe."],
    ["Click or tap to place a pin. Drag to move the map.", "Klik of tik om een speld te plaatsen. Versleep de kaart om een andere plek te bekijken.", "Klicke oder tippe, um eine Markierung zu setzen. Ziehe die Karte, um den Ausschnitt zu verschieben."],
    ["Use my location", "Mijn locatie gebruiken", "Meinen Standort verwenden"],
    ["Map needs an internet connection. You can also enter coordinates above.", "Voor de kaart heb je internet nodig. Je kunt de coördinaten ook hierboven invullen.", "Für die Karte ist eine Internetverbindung erforderlich. Du kannst die Koordinaten auch oben eingeben."],
    ["Map unavailable. Enter coordinates above or try again when online.", "De kaart is niet beschikbaar. Vul de coördinaten hierboven in of probeer het opnieuw zodra je internet hebt.", "Die Karte ist nicht verfügbar. Gib die Koordinaten oben ein oder versuche es erneut, sobald du online bist."],
    ["Finding your location…", "Je locatie wordt bepaald…", "Dein Standort wird ermittelt…"],
    ["Could not get your location. Place a pin or enter coordinates instead.", "Je locatie kon niet worden bepaald. Plaats een speld op de kaart of vul de coördinaten in.", "Dein Standort konnte nicht ermittelt werden. Setze eine Markierung auf der Karte oder gib die Koordinaten ein."],
    ["Zoom in", "Inzoomen", "Vergrößern"],
    ["Zoom out", "Uitzoomen", "Verkleinern"],
    ["Selected location", "Geselecteerde locatie", "Ausgewählter Standort"],
    ["Location picker. Arrow keys move the map, Enter places a pin at the centre.", "Locatie kiezen. Verplaats de kaart met de pijltjestoetsen en druk op Enter om een speld in het midden te plaatsen.", "Standort auswählen. Verschiebe die Karte mit den Pfeiltasten und drücke die Eingabetaste, um eine Markierung in der Mitte zu setzen."],
    ["Screen calibration", "Scherm kalibreren", "Bildschirm kalibrieren"],
    ["Drag the bar's right edge to 5 cm on your ruler", "Sleep de rechterrand van de balk naar 5 cm op je liniaal", "Ziehe den rechten Rand des Balkens auf 5 cm auf deinem Lineal"],
    ["QR outer size in cm", "Buitenmaat van de QR-code in cm", "Außenmaß des QR-Codes in cm"],
    ["QR code preview", "Voorbeeld van de QR-code", "QR-Code-Vorschau"],
    ["Live camera feed", "Live camerabeeld", "Live-Kamerabild"],
    ["App info", "App-informatie", "App-Informationen"],
    ["Settings changed — preview is updating…", "Instellingen gewijzigd — het voorbeeld wordt bijgewerkt…", "Einstellungen geändert – die Vorschau wird aktualisiert…"],
    ["Code generated and ready to download.", "De code is klaar om te downloaden.", "Der Code wurde erstellt und kann heruntergeladen werden."],
    ["PNG downloaded.", "PNG gedownload.", "PNG heruntergeladen."],
    ["SVG downloaded.", "SVG gedownload.", "SVG heruntergeladen."],
    ["Image copied to clipboard.", "Afbeelding naar het klembord gekopieerd.", "Bild in die Zwischenablage kopiert."],
    ["Could not copy the image in this browser.", "De afbeelding kon niet worden gekopieerd in deze browser.", "Das Bild konnte in diesem Browser nicht kopiert werden."],
    ["Sharing failed.", "Delen is mislukt.", "Teilen fehlgeschlagen."],
    ["Reset all generator settings and local history?", "Alle instellingen en de lokaal opgeslagen geschiedenis wissen?", "Alle Einstellungen und den lokal gespeicherten Verlauf zurücksetzen?"],
    ["Settings reset.", "De beginwaarden zijn hersteld.", "Die Einstellungen wurden zurückgesetzt."],
    ["Shortening sends this URL to CleanURI and may fall back to is.gd or v.gd. Do not shorten private or sensitive links. Continue?", "Bij het inkorten wordt deze link naar CleanURI gestuurd en zo nodig naar is.gd of v.gd. Gebruik dit niet voor privélinks of vertrouwelijke informatie. Doorgaan?", "Beim Kürzen wird dieser Link an CleanURI und gegebenenfalls an is.gd oder v.gd gesendet. Verwende diese Funktion nicht für private oder vertrauliche Links. Fortfahren?"],
    ["URL shortening cancelled.", "Het inkorten van de link is geannuleerd.", "Das Kürzen des Links wurde abgebrochen."],
    ["modules may be too small for reliable print scanning", "de blokjes zijn mogelijk te klein om de afdruk betrouwbaar te scannen", "die Module sind möglicherweise zu klein, um den gedruckten Code zuverlässig zu scannen"],
    ["use a 4-module quiet zone", "gebruik een witte rand van minstens vier blokjes", "verwende eine Ruhezone von mindestens vier Modulen"],
    ["increase colour contrast", "vergroot het kleurcontrast", "erhöhe den Farbkontrast"],
    ["Good scan profile.", "De instellingen zijn geschikt om te scannen.", "Die Einstellungen eignen sich gut zum Scannen."],
    ["Something went wrong.", "Er is iets misgegaan.", "Ein Fehler ist aufgetreten."],
    ["Shortening failed.", "De link kon niet worden ingekort.", "Der Link konnte nicht gekürzt werden."],
    ["Unexpected response from shortening service.", "De inkortdienst gaf een onverwacht antwoord.", "Der Kurzlink-Dienst hat eine unerwartete Antwort gesendet."],
    ["Shortening request timed out.", "De inkortdienst reageerde niet op tijd. Probeer het opnieuw.", "Der Kurzlink-Dienst hat nicht rechtzeitig geantwortet. Versuche es erneut."],
    ["Could not reach shortening service.", "De inkortdienst is niet bereikbaar.", "Der Kurzlink-Dienst ist nicht erreichbar."],
    ["Could not load the local QR code library.", "De QR-codefunctie kon niet worden geladen. Vernieuw de pagina.", "Die QR-Code-Funktion konnte nicht geladen werden. Lade die Seite neu."],
    ["Could not load the local jsPDF library.", "De PDF-functie kon niet worden geladen. Vernieuw de pagina.", "Die PDF-Funktion konnte nicht geladen werden. Lade die Seite neu."],
    ["Could not load the local JsBarcode library.", "De barcodefunctie kon niet worden geladen. Vernieuw de pagina.", "Die Barcode-Funktion konnte nicht geladen werden. Lade die Seite neu."],
    ["Could not load logo from that URL. Prefer https; the image host must send CORS headers so PNG export is not blocked.", "Het online logo kon niet worden geladen. Upload de afbeelding als bestand en probeer het opnieuw.", "Das Online-Logo konnte nicht geladen werden. Lade das Bild als Datei hoch und versuche es erneut."],
    ["Unable to get 2D canvas context.", "Het voorbeeld kon niet worden getekend. Probeer een andere browser.", "Die Vorschau konnte nicht gezeichnet werden. Versuche es mit einem anderen Browser."],
  ];
  const patterns = [
    [/^Pin placed at (.+)\.$/, ["Pin placed at $1.", "Speld geplaatst op $1.", "Markierung bei $1 gesetzt."]],
    [/^Open (.+)\?\n\n([\s\S]+)$/, ["Open $1?\n\n$2", "$1 openen?\n\n$2", "$1 öffnen?\n\n$2"]],
    [/^Barcode rendered at (.+) cm\. Validate the printed result with a representative scanner\.$/, ["Barcode rendered at $1 cm. Test the printed code with the scanner you intend to use.", "Barcode gemaakt op $1 cm. Test de afdruk met de scanner die je wilt gebruiken.", "Barcode mit einer Breite von $1 cm erstellt. Teste den Ausdruck mit dem vorgesehenen Scanner."]],
    [/^QR (.+)×(.+) modules · (.+) mm\/module · ECC (.+) · quiet zone (.+)\. (.*)$/, ["QR $1×$2 modules · $3 mm/module · error correction $4 · quiet zone $5. $6", "QR $1×$2 blokjes · $3 mm per blokje · foutcorrectie $4 · witte rand $5. $6", "QR $1×$2 Module · $3 mm je Modul · Fehlerkorrektur $4 · Ruhezone $5. $6"]],
  ];
  function language() { return document.documentElement.lang === "nl" ? 1 : document.documentElement.lang === "de" ? 2 : 0; }
  window.localizeUi = (value) => {
    const i = language();
    const row = rows.find((entry) => entry[0] === value);
    if (row) return row[i];
    let patterned = value;
    for (const [pattern, versions] of patterns) if (pattern.test(value)) { patterned = value.replace(pattern, versions[i]); break; }
    // Composite quality messages contain a fixed set of translatable fragments.
    let result = patterned;
    for (const entry of rows) if (entry[0].length > 15 && result.includes(entry[0])) result = result.split(entry[0]).join(entry[i]);
    result = result.replace("Warning: ", ["Warning: ", "Let op: ", "Hinweis: "][i]);
    return result;
  };
  const originals = new WeakMap();
  const attributes = new WeakMap();
  function translateText(node) {
    if (node.parentElement && node.parentElement.closest('script, style, #scanner-result-text, #generation-history button, #scan-history button, input, textarea')) return;
    const old = originals.get(node);
    const source = old && node.nodeValue === old.output ? old.source : node.nodeValue;
    const trimmed = source.trim();
    const translated = window.localizeUi(trimmed);
    const output = source.replace(trimmed, translated);
    originals.set(node, { source, output });
    if (node.nodeValue !== output) node.nodeValue = output;
  }
  function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) return translateText(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) translateText(walk.currentNode);
    [root, ...root.querySelectorAll('[aria-label], [title]')].forEach((el) => {
      for (const attr of ["aria-label", "title"]) {
        const value = el.getAttribute(attr); if (!value) continue;
        const saved = attributes.get(el) || {};
        const old = saved[attr];
        const source = old && old.output === value ? old.source : value;
        const translated = window.localizeUi(source);
        saved[attr] = { source, output: translated }; attributes.set(el, saved);
        if (value !== translated) el.setAttribute(attr, translated);
      }
    });
  }
  window.refreshUiTranslations = () => translateTree(document.body);
  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === "characterData") translateText(change.target);
      else for (const node of change.addedNodes) translateTree(node);
    }
  }).observe(document.body, { childList: true, characterData: true, subtree: true });
})();
