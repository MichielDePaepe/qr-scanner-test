# QR Lab · Scanner benchmark

Een statische, mobielvriendelijke testsite die vijf echte QR-decoders met dezelfde iPhone-camera vergelijkt. Scans en instellingen blijven lokaal in de geopende pagina; er is geen backend, database of RAM-koppeling. De camera vereist HTTPS (behalve op `localhost`) en toestemming van de gebruiker.

## Lokaal starten

Vereist Node.js 18 of nieuwer. Er zijn geen npm-pakketten te installeren.

```sh
npm start
```

Open `http://localhost:8080`. De shell en styles worden door de service worker gecachet voor installatie als PWA. De scannerbibliotheken worden bij gebruik van hun CDN geladen; voor scannen is dus een internetverbinding nodig.

## Op een iPhone via HTTPS

1. Installeer [mkcert](https://github.com/FiloSottile/mkcert) en voer eenmalig `mkcert -install` uit.
2. Zoek het LAN-IP-adres van de Mac die de website serveert, bijvoorbeeld `192.168.1.24`.
3. Maak in deze projectmap een map `certs` en genereer een certificaat voor localhost en dat IP:

   ```sh
   mkdir -p certs
   mkcert -cert-file certs/dev.pem -key-file certs/dev-key.pem localhost 127.0.0.1 192.168.1.24
   ```

   Vervang `192.168.1.24` door het echte IP-adres. Certificaatbestanden zijn uitgesloten van Git.
4. Exporteer de lokale mkcert-rootcertificaat vanaf het pad dat `mkcert -CAROOT` toont. Zet `rootCA.pem` over naar de iPhone (bijvoorbeeld via AirDrop), open het certificaat om het profiel te installeren en schakel daarna volledige vertrouwensverlening in via **Instellingen → Algemeen → Info → Vertrouw certificaten**. Verwijder het profiel na het testen als je dit certificaat niet meer gebruikt.
5. Start de HTTPS-server:

   ```sh
   npm run start:https
   ```

6. Zorg dat Mac en iPhone op hetzelfde wifi-netwerk zitten. Open op de iPhone `https://192.168.1.24:8443`, geef Safari cameratoegang en kies **Zet op beginscherm** in het Deel-menu om de PWA te installeren.

Een netwerkfirewall kan inkomende verbindingen op poort 8443 blokkeren. De Mac moet draaien zolang de iPhone de lokale site gebruikt. iOS pauzeert camera's wanneer Safari naar de achtergrond gaat; bij terugkeer start de actieve scanner opnieuw.

## Publiceren met GitHub Pages

De applicatie is volledig statisch: GitHub Pages serveert de bestanden rechtstreeks, zonder buildstap, backend of geheimen.

1. Commit de projectbestanden en push ze naar de `main`-branch van een GitHub-repository.
2. Open in GitHub **Settings → Pages**.
3. Kies bij **Build and deployment** voor **Deploy from a branch**, selecteer `main` en map `/ (root)`, en klik **Save**.
4. Wacht tot GitHub Pages de site heeft gepubliceerd en open de getoonde URL. Een projectrepository krijgt doorgaans een URL als `https://gebruikersnaam.github.io/repositorynaam/`.
5. Open die HTTPS-link in Safari op de iPhone en sta cameratoegang toe. Gebruik **Deel → Zet op beginscherm** voor de PWA.

De app gebruikt relatieve asset-, manifest- en serviceworkerpaden; daardoor blijft alles werken onder de repository-subdirectory. GitHub Pages levert HTTPS automatisch aan. Updates publiceer je door opnieuw naar de ingestelde branch te pushen. De scannerbibliotheken worden van hun vastgepinde CDN-versies geladen; daarvoor is internettoegang nodig.

## Scanners en vergelijkbaarheid

| Scanner | Versie | Onderhoud en iOS-opmerking |
| --- | --- | --- |
| html5-qrcode | 2.3.8 | Onderhoudsstabiele release; upstream documenteert Safari/iOS. Geen release sinds 2023. |
| @zxing/browser | 0.2.1 | Recente upstream-release (2026); gebruikt camera-controls uit de browserlaag. |
| qr-scanner (Nimiq) | 1.4.2 | Worker-gebaseerde scanner, camera-API inbegrepen; release uit 2022. |
| jsQR | 1.4.0 | Onderhoudsstabiele decoder; camera-frames worden door deze site via Canvas aangeleverd. Release uit 2021. |
| BarcodeDetector API | Browser-native | Experimenteel en niet op alle browsers beschikbaar. De app toont dit als niet ondersteund als de API of QR-indeling ontbreekt. |

Versie- en compatibiliteitscontrole geraadpleegd op 14 oktober 2026. Bronnen: [html5-qrcode npm](https://www.npmjs.com/package/html5-qrcode), [html5-qrcode README](https://github.com/mebjas/html5-qrcode), [@zxing/browser npm](https://www.npmjs.com/package/@zxing/browser), [@zxing/browser README](https://github.com/zxing-js/browser), [qr-scanner npm](https://www.npmjs.com/package/qr-scanner), [qr-scanner README](https://github.com/nimiq/qr-scanner), [jsQR npm](https://www.npmjs.com/package/jsqr), [jsQR README](https://github.com/cozmo/jsQR), [BarcodeDetector documentatie](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector).

De app vraagt bij iedere scanner zo veel mogelijk dezelfde achtercamera en minimaal 1280 × 720 aan. Sommige bibliotheken kiezen hun eigen camera-instellingen en niet elke iPhone accepteert de resolutievoorkeur. De werkelijke trackresolutie, continue autofocus, torch en zoom worden daarom uit de cameratrack gelezen en als ondersteund of niet ondersteund getoond. Het native BarcodeDetector-pad werkt alleen in browsers die deze experimentele API aanbieden.

De FPS-instelling begrenst de decodepogingen waar de adapter dat ondersteunt; de camera zelf blijft doorlopen. html5-qrcode en ZXing bieden geen betrouwbare verwerkingstijd per frame via hun scan-callbacks. Alleen jsQR en BarcodeDetector rapporteren gemeten decodeverwerkingstijd; het benchmarkpaneel laat voor de overige adapters `n.v.t.` zien. Scanintervallen, unieke codes en fouten zijn gemeten door de site. De cooldown van twee seconden geldt per identieke code binnen dezelfde scanner, zodat je een code direct met de volgende bibliotheek kunt vergelijken.

## Gegevens en export

De scanhistoriek is alleen beschikbaar zolang deze pagina geopend blijft. CSV exporteert de gescande tekst, tijd, bibliotheek en waar meetbaar de gemiddelde frameverwerkingstijd tot dat moment. Wees voorzichtig met codes die persoonlijke gegevens bevatten; exportbestanden worden door de browser aangemaakt.

## Probleem melden

Open **Camera-diagnostiek** onder de camera-instellingen en kies **Kopieer diagnose**. Het rapport bevat appversie, browser, geselecteerde scanner, video-afmetingen, cameratrackmogelijkheden en recente foutmeldingen. Het neemt geen gescande QR-inhoud op. Plak dat rapport bij een probleemmelding. Na een update kan het nodig zijn de pagina te herladen; de diagnostiek toont appversie `2026.10.14.2`.
