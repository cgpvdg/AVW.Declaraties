# AVW Trainersdeclaraties

Mobiele Vue-app voor maanddeclaraties van Atletiekvereniging Wieringermeer e.o.

## Lokaal starten

1. Installeer Node.js 24 en voer `npm install` uit.
2. Kopieer `.env.example` naar `.env.local` en vul de vier waarden in met de configuratie van je Firebase-webapp.
3. Start met `npm run dev`. Maak een productiebuild met `npm run build`.

## Firebase inrichten

1. Registreer een webapp in je Firebase-project en activeer de aanmeldmethode **E-mail/wachtwoord** in Authentication. Voeg het GitHub Pages-domein toe aan de geautoriseerde domeinen voor wachtwoordlinks.
2. Maak in Cloud Firestore een database met ID `avw-declarations` in productiemodus.
3. Publiceer de regels met de Firebase CLI: `firebase deploy --only firestore:rules --project JOUW_PROJECT_ID`.
4. Maak de gebruikers aan in Authentication. Maak in de genoemde Firestore-database voor ieder account handmatig een document `profiles/<auth-uid>` aan. Gebruik deze velden:

   | Veld | Type | Waarde |
   | --- | --- | --- |
   | `name` | string | Volledige naam |
   | `role` | string | `trainer` of `beheerder` |
   | `level` | number | 1 t/m 4 voor trainers |

5. Log als beheerder in en sla de vergoedingenstaffel op. De voorgestelde bedragen komen uit het Excel-voorbeeld. Controleer ze vóór het eerste gebruik.

Rollen en niveaus worden beheerd in de Firebase-console. Firestore-regels beperken trainers tot hun eigen declaraties en geven beheerders leesrechten op declaraties en schrijfrechten op de staffel. Bij de eerste regel van elke maand wordt de dan geldende staffel samen met de naam en het niveau van de trainer vastgelegd.

## Gebruik

Per dag is één regel beschikbaar. Bij een nieuwe regel staat de datum op vandaag in de huidige maand, of op de eerste dag van een andere geselecteerde maand. Tijden worden in decimale uren ingevoerd. De niveauvergoeding geldt voor voorbereiding en training, begeleiding en kilometers hebben elk een eigen tarief en onkosten worden tegen het ingevoerde bedrag meegenomen.

De Excel-export gebruikt een opgeschoonde kopie van het aangeleverde formulier met de oorspronkelijke opmaak, afdrukinstellingen en handtekeningvakken. De selectieknoppen uit het sjabloon zijn overbodig doordat de app trainer en maand al invult. De onkostensom neemt ook de laatste drie dagrijen mee.

## GitHub Pages

Push de broncode naar een GitHub-repository met hoofdbranch `main`. Kies **Settings → Pages → Source → GitHub Actions**. Voeg onder **Settings → Secrets and variables → Actions → Variables** de vier variabelen uit `.env.example` toe. Draai daarna de workflow **GitHub Pages**. De productiebuild gebruikt relatieve assetpaden zodat ook een project-URL met een repositorypad werkt.
