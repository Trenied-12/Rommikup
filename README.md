# Rummikub Online

Ein vollständiges Online-Rummikub für **genau zwei Spieler** – als statische
Webseite (GitHub Pages) mit **Firebase / Cloud Firestore** als Echtzeit-Backend.
Kein Build-Schritt, keine Frameworks: reines HTML5, CSS3 und modernes
JavaScript (ES-Module).

- 🎲 Vollständige Regel- und Validierungslogik (Reihen, Gruppen, Joker, 30-Punkte-Erstauslage, Gewinn- und Nachziehregeln)
- 🔄 Echtzeit-Synchronisation über Firestore-Snapshot-Listener
- 🖱️ Drag & Drop auf Desktop **und** Tablet (Pointer Events)
- 🧩 Saubere, modulare Architektur mit strikter Trennung von Spiellogik, Backend, UI, Rendering, Drag-and-Drop und Validierung
- ✅ Unit-Tests für die gesamte Spiellogik

---

## Inhaltsverzeichnis

1. [Schnellstart](#schnellstart)
2. [Firebase einrichten](#firebase-einrichten)
3. [Auf GitHub Pages veröffentlichen](#auf-github-pages-veröffentlichen)
4. [Lokale Entwicklung](#lokale-entwicklung)
5. [Tests](#tests)
6. [Projektstruktur](#projektstruktur)
7. [Architektur](#architektur)
8. [Spielregeln](#spielregeln)
9. [Sicherheits- und Vertrauensmodell](#sicherheits--und-vertrauensmodell)

---

## Schnellstart

1. Firebase-Projekt anlegen und Werte in [`js/firebase/firebase-config.js`](js/firebase/firebase-config.js) eintragen (siehe unten).
2. Anonyme Anmeldung und Firestore aktivieren, Sicherheitsregeln veröffentlichen.
3. Repository auf GitHub Pages deployen.
4. Spiel erstellen → Code teilen → Gegner tritt bei → losspielen.

---

## Firebase einrichten

> Die Web-Konfigurationswerte von Firebase **sind keine Geheimnisse** – sie
> gehören in den Browser. Geschützt wird der Zugriff über die
> Firestore-Sicherheitsregeln, nicht über das Verstecken der Keys.

1. **Projekt erstellen** in der [Firebase Console](https://console.firebase.google.com).
2. **Web-App hinzufügen** (`</>`-Symbol). Die angezeigte `firebaseConfig` kopieren.
3. Werte in [`js/firebase/firebase-config.js`](js/firebase/firebase-config.js) einsetzen:
   ```js
   export const firebaseConfig = {
     apiKey: '…',
     authDomain: 'DEIN_PROJEKT.firebaseapp.com',
     projectId: 'DEIN_PROJEKT_ID',
     storageBucket: 'DEIN_PROJEKT.appspot.com',
     messagingSenderId: '…',
     appId: '…',
   };
   ```
4. **Authentication → Sign-in method → Anonym** aktivieren.
5. **Firestore Database → Datenbank erstellen** (Produktionsmodus genügt).
6. **Sicherheitsregeln veröffentlichen**: Inhalt von [`firestore.rules`](firestore.rules)
   in den Reiter *Firestore → Regeln* kopieren und **Veröffentlichen** klicken.
7. **Autorisierte Domains** (Authentication → Settings → Authorized domains):
   deine GitHub-Pages-Domain hinzufügen, z. B. `dein-name.github.io`.

Solange die Platzhalter in `firebase-config.js` nicht ersetzt wurden, zeigt die
App einen freundlichen Konfigurationshinweis statt einer Fehlermeldung.

---

## Auf GitHub Pages veröffentlichen

Da es keinen Build-Schritt gibt, wird das Repository unverändert ausgeliefert.

1. Repository zu GitHub pushen.
2. **Settings → Pages → Build and deployment → Source: „Deploy from a branch“**.
3. Branch `main`, Ordner `/ (root)` wählen, speichern.
4. Nach kurzer Zeit ist das Spiel unter
   `https://DEIN-NAME.github.io/DEIN-REPO/` erreichbar.

> Die Datei [`.nojekyll`](.nojekyll) sorgt dafür, dass GitHub Pages alle Dateien
> unverändert ausliefert. Alle Pfade im Projekt sind relativ, daher funktioniert
> das Spiel auch in einem Unterpfad (`/DEIN-REPO/`).

---

## Lokale Entwicklung

ES-Module benötigen einen HTTP-Server (kein `file://`). Beliebiger statischer
Server genügt:

```bash
npx http-server -p 8123 -c-1 .
# dann http://localhost:8123 öffnen
```

**UI-Sandbox ohne Firebase:** [`dev/sandbox.html`](dev/sandbox.html) rendert
Spielfeld, Ablagebrett, Drag & Drop und die Live-Validierung mit Beispiel­daten –
ideal zum Testen der Oberfläche ohne Backend.

---

## Tests

Reine Spiellogik (keine Browser-/Firebase-Abhängigkeiten) wird mit dem
eingebauten Test-Runner von Node geprüft:

```bash
npm test          # entspricht: node --test
```

Abgedeckt sind u. a.: Reihen-/Gruppen-/Joker-Validierung, Punkteberechnung,
Steinerhaltung, 30-Punkte-Erstauslage, Joker-Regeln, Ziehen und Gewinnbedingung.

---

## Projektstruktur

```
.
├── index.html                 # App-Shell (Lobby, Warten, Spiel, Overlays)
├── css/
│   ├── main.css               # Design-Tokens, Buttons, Toasts, Overlay
│   ├── lobby.css              # Lobby & Warten-Bildschirm
│   ├── tiles.css              # Aussehen der Spielsteine
│   └── board.css              # Statusleiste, Spielfeld, Ablagebrett, Controls
├── js/
│   ├── main.js                # Einstiegspunkt: Setup, Auth, Lobby, Routing
│   ├── app/
│   │   └── game-controller.js # Orchestriert Zustand, Rendering, Aktionen, DnD
│   ├── game/                  # Reine Spiellogik (kein DOM, kein Firebase)
│   │   ├── constants.js       # Alle Konstanten an einem Ort (keine Magic Numbers)
│   │   ├── tile-factory.js    # 106 Steine erzeugen, mischen, austeilen
│   │   ├── validation.js      # Reihen-/Gruppen-/Brett-Validierung
│   │   ├── scoring.js         # Endwertung
│   │   └── game-engine.js     # Zugübergänge & vollständige Zugvalidierung
│   ├── models/                # Serialisierbare Datenmodelle
│   │   ├── tile.js
│   │   ├── game-state.js      # Genau das, was in Firestore liegt
│   │   └── working-turn.js    # Lokale Arbeitskopie während des eigenen Zugs
│   ├── firebase/              # Einzige Schicht, die mit Firebase spricht
│   │   ├── firebase-config.js # ← hier deine Projektdaten eintragen
│   │   ├── firebase-init.js
│   │   ├── auth.js            # Anonyme Anmeldung
│   │   └── game-repository.js # Firestore-CRUD + Snapshot-Listener
│   ├── ui/                    # Reines Rendering
│   │   ├── dom.js             # DOM-Hilfsfunktionen
│   │   ├── tile-view.js
│   │   ├── board-view.js
│   │   ├── rack-view.js
│   │   ├── status-bar.js
│   │   └── notifications.js   # Toasts
│   ├── dnd/
│   │   └── drag-drop.js       # Pointer-basiertes Drag & Drop (Maus + Touch)
│   └── utils/
│       └── random.js          # IDs, Raumcodes, Fisher–Yates-Shuffle
├── tests/                     # Node-Unit-Tests
│   ├── validation.test.js
│   └── engine.test.js
├── dev/
│   └── sandbox.html           # Offline-UI-Testumgebung
├── firestore.rules            # Firestore-Sicherheitsregeln
└── package.json
```

---

## Architektur

Die Schichten sind strikt getrennt und in genau einer Richtung gekoppelt:

```
        UI / DnD  ──►  Controller  ──►  Engine (reine Logik)
                           │
                           ▼
                  Firebase-Repository  ──►  Cloud Firestore
```

- **`game/` (Engine):** vollständig pure Funktionen. Jede Zugfunktion gibt einen
  *neuen* Zustand zurück und mutiert nie ihre Eingabe. Dadurch ist die Logik
  isoliert testbar und „Zug zurücksetzen“ ist trivial.
- **`firebase/`:** kapselt sämtliche Persistenz und den Echtzeit-Transport.
  Hier liegen **keine** Spielregeln.
- **`ui/` + `dnd/`:** ausschließlich Darstellung und Eingabe. Drag & Drop kennt
  keine Regeln, sondern meldet nur ein *semantisches Ziel* (Ablagebrett,
  Position in einer Kombination oder neue Kombination) an den Controller.
- **`app/game-controller.js`:** verbindet alles, hält die lokale Arbeitskopie
  des Zuges und schreibt erst nach erfolgreicher Validierung nach Firestore.

**Zugablauf:** Während des Zuges verändert der Spieler nur eine lokale
Arbeitskopie (`working-turn.js`). Ungültige Zwischenzustände sind erlaubt. Erst
beim Klick auf **„Zug beenden“** prüft die Engine alles (Steinerhaltung,
gültige Kombinationen, Joker-Regeln, ggf. 30-Punkte-Erstauslage). Nur ein
vollständig gültiger Zug wird gespeichert und an den Gegner übertragen.

---

## Spielregeln

- **104 Zahlensteine** (1–13 in Rot, Blau, Gelb, Schwarz, je doppelt) + **2 Joker** = 106.
- Jeder Spieler startet mit **14 Steinen**, der Rest ist der Nachziehstapel.
- **Reihe:** mind. 3 aufeinanderfolgende Zahlen **derselben** Farbe.
- **Gruppe:** mind. 3 gleiche Zahlen in **verschiedenen** Farben (jede Farbe höchstens einmal).
- **Erstauslage:** mindestens **30 Punkte** ausschließlich aus eigenen Steinen,
  ohne bereits liegende Kombinationen zu verändern.
- **Joker:** ersetzt jeden Stein; ein vom Brett genommener Joker muss im selben
  Zug wieder ausgelegt werden und darf nie zurück auf das eigene Brett.
- **Sieg:** wer zuerst alle Steine ablegt. Ist der Stapel leer und kein Zug mehr
  möglich, entscheidet die Punktewertung (niedrigster Handwert gewinnt).

---

## Sicherheits- und Vertrauensmodell

- **Anonyme Authentifizierung** unterscheidet die beiden Spieler.
- Die [`firestore.rules`](firestore.rules) erlauben nur angemeldeten Nutzern den
  Zugriff, nur den beiden Teilnehmern Schreibzugriff und nur einem neuen Spieler
  das Besetzen des freien Gastplatzes. Das Auflisten aller Spiele ist verboten,
  damit Raumcodes nicht erraten werden können.
- **Regel-Durchsetzung** geschieht clientseitig in der Engine, weil GitHub Pages
  keinen Server ausführt und Firestore ohne Cloud Functions keine Spiellogik
  kennt. Das Modell ist daher auf **faires Spiel zwischen zwei kooperativen
  Spielern** ausgelegt.
- **Verdeckte Steine:** Die Oberfläche zeigt jedem Spieler ausschließlich seine
  eigenen Steine. Da im aktuellen Datenmodell das gesamte Spiel in einem
  Dokument liegt, könnte ein technisch versierter Spieler das Rohdokument lesen.
  Für echte kryptografische Geheimhaltung müsste man die Hände in separate,
  per Regel geschützte Unterdokumente auslagern oder Cloud Functions einsetzen –
  ein bewusst offen gelassener, klar abgegrenzter Erweiterungspunkt.

---

## Lizenz

[MIT](LICENSE)
