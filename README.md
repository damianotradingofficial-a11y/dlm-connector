# DLM Auto Connector

Progetto Electron **separato** da `damiano-app-3`: vive nella sua sottocartella, ha il suo `package.json`, e il build di Next.js non lo tocca. Non modifica e non richiede modifiche a: DLM AI Engine, Trading Engine, Risk Engine, Execution Engine, MT5 Bridge EA canonico (`mt5-bridge/DLM_Bridge_EA.mq5`, invariato — questo progetto ne distribuisce solo una copia, vedi §Version Manager).

Stato: Blocco 1 (Rilevamento + Diagnostica) ✅, Blocco 2 (Installazione Assistita) ✅, Blocco 3 (Wizard cliente) ✅, Blocco 4 (base AI Troubleshooting) ✅, Hardening Fase 1 (Branding UX + copyCliente.js) ✅, Fase 2 (Wizard cliente definitivo) ✅, Fase 3 (Installer electron-builder) ✅, Fase 4 (AI Troubleshooting contestuale + Version Management del Connector) ✅, Fase 5 (checklist test finale) ✅. Nessun test reale su Windows/macOS ancora eseguito (solo sintassi + logica pura testate nel sandbox) — da fare sulla tua macchina prima del lancio.

**Chiusura beta (feature freeze)**: il Connector non riceve nuove funzionalità finché non arriva l'esito del collaudo reale (build electron-builder + test Windows/macOS). Eventuali bug emersi dal collaudo verranno corretti; nessuna nuova feature in questa fase. In parallelo, il download del Connector viene collegato alla pagina "Collega MT5" dell'app principale (vedi `AURORA_AI_CHIUSURA_BETA_CONNECTOR_E_INTEGRAZIONE_COLLEGA_MT5.md` nella root del progetto).

## Cosa fa

**Wizard guidato (schermata principale, `wizard.html`)** — 5 step:
1. **Sistema**: rileva Windows/macOS/altro, mostra un messaggio onesto sul livello di supporto (Windows: completo; macOS: solo diagnostica remota in questa fase, MT5-su-Wine non ha rilevamento/installazione automatica — non eliminato, solo rimandato a una fase dedicata; altri OS: non testato).
2. **MT5**: installazioni trovate (solo Windows), con selezione esplicita se più di una — mai una scelta automatica.
3. **Bridge**: installazione con backup obbligatorio, copia, tentativo di compilazione via MetaEditor, verifica REALE (mai assunta) del `.ex5` risultante.
4. **Configurazione guidata**: apertura di MT5 (un click, lancia l'eseguibile), generazione della chiave di collegamento (connection reference, stessa logica della pagina web `collega-mt5`), istruzioni per Trading Algoritmico/WebRequest (non automatizzabili da MT5 — nessuna API ufficiale) verificate poi in automatico dalla presenza di un heartbeat reale.
5. **Verifica finale**: MT5 trovato, Bridge installato, connessione, heartbeat, stato online.

**Vista diagnostica avanzata (`index.html`, Blocco 1, invariata)**: raggiungibile da un link nel wizard, mostra i dati grezzi di rilevamento/diagnosi per chi vuole vedere il dettaglio tecnico.

**AI Troubleshooting (Blocco 4 + Fase 4 contestuale)**: i problemi rilevati vengono arricchiti con severità/spiegazione estesa/passi (deterministico, nessuna chiamata a modelli linguistici). Oltre al riepilogo generale in stile "Ho analizzato il Connector. Il problema è X. Ti guido nella soluzione.", ogni problema è ora anche collegato allo step specifico del wizard a cui si riferisce (`stepChiave`) e mostrato direttamente dentro la card di quello step — non solo in un box generico in cima alla pagina.

**Version Manager**: distingue e confronta 3 versioni del Bridge che possono divergere — quella bundlata nel Connector, quella scritta su disco, e quella che l'istanza IN ESECUZIONE sta davvero usando (da heartbeat) — segnala sia "il Connector ha una versione più recente di quella installata" sia "il file è stato aggiornato ma l'EA in esecuzione va riavviato per usarlo". Controlla anche la versione del **Connector stesso** contro l'ultima disponibile (manifest locale `version-manifest.json`, o un endpoint remoto opzionale via `DLM_CONNECTOR_UPDATE_CHECK_URL` se in futuro DLM ne pubblica uno) e mostra una notifica quando c'è una versione più recente — solo notifica, nessun download o installazione automatica.

## Sicurezza

Il Connector non legge e non scrive MAI: password broker, credenziali trading, file account/configurazione MT5 sensibili (`servers.dat`, `accounts.dat`, ecc.). Le uniche scritture possibili sul PC del cliente sono, per costruzione (allowlist in `installBridge.js`, non solo per disciplina): `MQL5/Experts/DLM_Bridge_EA.mq5`, `MQL5/Experts/DLM_Bridge_EA.ex5`, e i loro backup con suffisso data — qualunque altro percorso viene rifiutato dalla funzione di scrittura stessa.

## Setup (da fare sulla propria macchina — non nel sandbox Claude)

```bash
cd dlm-connector
npm install
cp config.example.json config.json
```

Apri `config.json` e incolla la stessa `NEXT_PUBLIC_SUPABASE_ANON_KEY` già usata nel progetto principale (`.env.local` di `damiano-app-3`) — è una chiave pubblica per design, la sicurezza reale è la RLS lato database. `config.json` è già escluso da git.

In alternativa, invece del file, puoi impostare le variabili d'ambiente `DLM_SUPABASE_URL` e `DLM_SUPABASE_ANON_KEY`.

## Avvio

```bash
npm start
```

## Creare il pacchetto installabile (electron-builder)

```bash
cd dlm-connector
npm install          # scarica anche electron-builder (devDependency)
npm run dist:mac     # -> dist/DLM Connector.dmg
npm run dist:win     # -> dist/DLM Connector Setup.exe
npm run dist         # entrambi (o solo quello del sistema corrente, a seconda dei target disponibili)
```

**Windows (NSIS)**: installazione guidata (non "one-click": l'utente può scegliere la cartella), collegamento sul Desktop, voce nel menu Start, avvio automatico dell'app a fine installazione. electron-builder include un `makensis` precompilato anche per macOS/Linux, quindi puoi generare `DLM Connector Setup.exe` anche dal tuo Mac, senza Wine.

**macOS (DMG)**: immagine disco con l'app trascinabile, struttura compatibile con la firma/notarizzazione futura.

**Non ancora attivo, per scelta esplicita di Damiano in questa fase**:
- Firma del codice (Windows/macOS) — rimandata alla fase pre-lancio commerciale. Senza firma, Windows SmartScreen e macOS Gatekeeper mostreranno un avviso "sviluppatore non verificato/riconosciuto" al primo avvio — atteso, non un bug.
- Auto-update — nessun meccanismo di aggiornamento automatico del Connector stesso (il Version Manager già presente riguarda solo il Bridge EA, non l'app).
- Icona definitiva — `build/icon.png` è un **placeholder** (mark "DLM" nei colori del brand, 1024×1024). electron-builder lo usa per generare automaticamente sia l'icona Windows (.ico) sia quella macOS (.icns) da questo unico file: quando arriva l'icona definitiva, basta sostituire `build/icon.png` con lo stesso nome, nessuna modifica alla configurazione.

Il file `resources/DLM_Bridge_EA.mq5` viene escluso dalla compressione asar (`asarUnpack`) così resta un file reale sul disco del cliente dopo l'installazione, leggibile/copiabile da `installBridge.js` esattamente come in sviluppo.

## Test isolato (senza Electron, senza npm install)

```bash
cd dlm-connector
node test-install-bridge.js            # mostra le installazioni MT5 trovate
node test-install-bridge.js 0          # installa davvero sulla installazione [0]
```

Nessuna dipendenza esterna per questo script: solo Node.js.

## Stato di verifica in questa sessione

Tutti i file `.js` verificati con `node --check` (sintassi). Logica pura testata nel sandbox (Mac, non Windows):
- Allowlist di scrittura (`installBridge.js`): 8 casi positivi/negativi, tutti corretti.
- Installazione simulata (cartella Experts fittizia): copia, versione letta, backup al secondo run, errore chiaro su cartella mancante — tutti corretti.
- Version Manager: rilevati correttamente sia il caso "bundle più recente del file installato" sia "file aggiornato ma istanza in esecuzione ancora vecchia".
- `wizardState.js`: 7 scenari (da "niente rilevato" a "tutto configurato con heartbeat fresco/vecchio") — progressione dei 5 step corretta in tutti i casi.
- `aiTroubleshootingBase.js`: arricchimento e messaggio in linguaggio naturale generati correttamente su casi con 0/1/2 problemi.

**Non ancora testato** (richiede Windows/macOS reali, il sandbox non può eseguire Electron): l'intera UI (wizard.html/wizard.js) non è mai stata renderizzata realmente; il tentativo vero di compilazione con `metaeditor64.exe`, incluso il caso di fallimento silenzioso segnalato da fonti esterne; l'apertura reale di MT5 via `apriMt5`; il flusso Mac (login + diagnostica remota, senza rilevamento locale).

## Prossimo passo

Test reale end-to-end su Windows (rilevamento → installazione → wizard → heartbeat) e su macOS (login + diagnostica, verifica che i messaggi "non disponibile" siano chiari e non blocchino l'uso del Connector per quello che è già disponibile su Mac).
