# DLM Connector 0.5.0

Stato: **versione di prova (prerelease) — non ancora approvata per i clienti.**

## Contenuto
- **DLM Bridge EA 1.4.8** al posto della 1.3.0.
  `EA 1.4.8 = SECURITY PATCH OF VERIFIED 1.4.7 — REVERIFICATION REQUIRED`: è la 1.4.7 verificata con quattro sole differenze — tolto un numero di conto da un commento, tolti tre numeri di ticket dai commenti, la chiave di collegamento non viene più scritta nel registro di MetaTrader all'avvio, numero di versione. Nessuna modifica funzionale. Non è ancora dichiarata verificata.
- **Indirizzo del server: `https://www.dlmtrading.com`.** Il vecchio dominio non compare più in nessun file.
- Il wizard indica l'indirizzo esatto da autorizzare in MetaTrader (Strumenti → Opzioni → Expert Advisor → "Consenti WebRequest per le seguenti URL").
- `version-manifest.json` allineato: Connector 0.5.0, EA 1.4.8.
- Controlli di rilascio automatici (`npm test`) eseguiti prima di ogni costruzione.

## Piattaforme
- **Windows (x64): supportato.**
- **macOS: `CONNECTOR MAC = NOT YET SUPPORTED`.** Su Mac il Connector non installa ancora il Bridge: il pacchetto Mac non viene costruito né offerto. Il codice resta nel progetto per il futuro.

## Requisiti prima della distribuzione ai clienti (`PRODUCTION CUSTOMER RELEASE`)
- Prova reale di installazione e collegamento su un Windows pulito, con MetaTrader e conto demo, senza operazioni reali.
- Nuova verifica dell'EA 1.4.8.
- **Firma del codice Windows: obbligatoria.** Un `.exe` non firmato non è pronto per i clienti.
- In futuro, per Mac: firma Apple e notarizzazione obbligatorie.
- Link di produzione puntati a questa versione precisa, mai a "latest".

## Impronte SHA-256
Pubblicate insieme ai file nel documento `SHA256SUMS.txt`.

EA incluso (`resources/DLM_Bridge_EA.mq5`):
`665ff3c3d2ba713fddef01dafb0f0369f5b409933f26a96867f339dfe54296bb`
