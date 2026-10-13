# DLM Connector 0.6.1

Stato: **in sviluppo — non pubblicata. Non distribuire.**

Correzioni emerse dal collaudo della 0.6.0 su Windows reale (13/10/2026). La EA inclusa resta la **1.5.0**, identica byte per byte a quella della 0.6.0.

## Correzioni
- **Compilazione automatica della EA.** Il Connector cercava il compilatore di MetaTrader una cartella più in alto di quella giusta e, non trovandolo, rinunciava senza dirlo. Ora lo cerca nella cartella della installazione scelta, compila, legge l'esito scritto dal compilatore e controlla che il file compilato esista e sia stato creato in quel momento.
- **Esito sempre visibile.** Dopo l'installazione compare un riquadro con il successo verificato oppure con l'errore reale: compilatore non trovato (con la cartella in cui è stato cercato), errori del compilatore, file compilato non creato.
- **Rilevamento di MetaTrader 5.** Le cartelle di servizio (`Common`, `Community`, `Help`), le cartelle di terminali disinstallati e quelle senza `MQL5\Experts` non vengono più proposte come installazioni.
- **Pulsante "Apri MetaTrader 5".** Usava lo stesso percorso sbagliato: ora avvia il programma giusto.
- **Riquadri vuoti.** I riquadri "account pronto" e "nuova versione disponibile" restavano visibili anche quando non avevano nulla da dire. Ora compaiono solo con un messaggio.

## Invariato
- EA 1.5.0, indirizzo del server `https://www.dlmtrading.com`, regole di scrittura (solo i due file del collegamento e i loro salvataggi dentro `MQL5\Experts`).
- Il registro della compilazione viene scritto in una cartella temporanea e cancellato subito dopo.

## Piattaforme
- **Windows (x64): supportato.**
- **macOS: `CONNECTOR MAC = NOT YET SUPPORTED`.**

## Requisiti prima di qualunque distribuzione
Gli stessi della 0.6.0: prova completa su Windows pulito con conto demo, server aggiornato, **firma del codice Windows**, link di produzione puntati a questa versione precisa.

## Impronta SHA-256
EA incluso (`resources/DLM_Bridge_EA.mq5`):
`761651ed5669cdea16a2f259119e30ddab9e5f8a5aecdc72b1373d6cde5bfa21`
