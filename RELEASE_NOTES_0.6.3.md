# DLM Connector 0.6.3

Stato: **in sviluppo, non pubblicata. Non distribuire.**

È la 0.6.2 con in più le **protezioni del ponte del 24/08/2026**, riportate dalla linea 0.4.5. Quella linea esisteva solo come copia locale mai salvata e non era mai entrata nella 0.5.x/0.6.x. **La EA inclusa resta la 1.5.0, identica byte per byte** a quella validata nell'app.

## Protezioni riportate
- **Guardia di allineamento** `scripts/verifica-allineamento-bridge.js`. Blocca se:
  - l'EA incluso diverge dal canonico dell'app (impronta SHA-256);
  - `bridgeEa` del manifest non corrisponde all'EA incluso;
  - `connector` non corrisponde a `package.json`;
  - la versione minima supera quella inclusa;
  - mancano `ticket_mt5_target` o l'intestazione della chiave;
  - la chiave viaggia nell'indirizzo.

  Il canonico si trova in `../mt5-bridge/` (Connector dentro l'app) oppure nel percorso indicato da `DLM_EA_CANONICO`. Senza canonico la guardia fallisce, a meno di `--consenti-canonico-assente`, che lo dichiara.
- **Versione minima del Bridge** `bridgeMinimoRichiesto` nel manifest: **1.5.0** (decisione di Damiano del 23/10/2026). È la versione distribuita e quella da cui parte il protocollo 2: un EA 1.4.x in esecuzione risulta «da aggiornare» e il Connector chiede di ripetere l'installazione e riavviare MetaTrader. Riguarda solo il Connector; la regola del server (EA minimo 1.5.0 prima di qualunque esecuzione reale) resta separata.
- **Compatibilità valutata sulla versione in esecuzione** (segnale del Bridge), non sul file su disco. Sotto il minimo il Connector lo dice per primo al cliente.
- **Confronto per verso** tra EA incluso ed EA installato: non propone mai di sovrascrivere un EA più recente con uno più vecchio.
- **Prima del pacchetto:** `predist`, `predist:win`, `predist:mac`, `prepack` eseguono la guardia.
- **Nella CI:** passo esplicito «Verifica allineamento Bridge EA» in entrambi i job, prima di costruire. Serve perché la costruzione senza tag usa `npx electron-builder`, che non esegue gli script `predist`.

## Test
- `test-release-checks.js`: sezione 8 per le protezioni del ponte.
- `test-guardia-allineamento.js` (nuovo): albero finto, la guardia deve **fallire** con un EA diverso, versioni incoerenti, minimo assente o troppo alto, `ticket_mt5_target` assente, canonico mancante senza flag.

## Invariato
EA 1.5.0, indirizzo del server `https://www.dlmtrading.com`, protocollo di esecuzione 2, funzioni della 0.6.2, requisiti prima della distribuzione (**firma del codice Windows**, prova reale su Windows pulito, link alla versione precisa, mai «latest»).

## Impronta SHA-256
EA incluso (`resources/DLM_Bridge_EA.mq5`):
`761651ed5669cdea16a2f259119e30ddab9e5f8a5aecdc72b1373d6cde5bfa21`
