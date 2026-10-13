# DLM Connector 0.6.2

Stato: **in sviluppo — non pubblicata. Non distribuire.**

Una sola correzione rispetto alla 0.6.1, emersa dal collaudo su Windows reale (13/10/2026). La EA inclusa resta la **1.5.0**, identica byte per byte.

## Correzione
- **Stato del collegamento riconosciuto a ogni avvio.** La 0.6.1 ricordava l'esito dell'installazione solo finché restava aperta: alla riapertura mostrava di nuovo "Tutto pronto per installare" anche con il collegamento installato. Ora lo stato viene riletto dal disco ogni volta, senza ricordare nulla:
  - MetaTrader 5 ancora installato;
  - EA nella cartella giusta, della versione di questo Connector e identica a quella inclusa;
  - file compilato presente e non più vecchio della EA.
  Se tutto corrisponde: "Collegamento DLM installato". Se qualcosa manca o non corrisponde: il motivo e il pulsante "Ripara il collegamento". Se non c'è nulla: "Installa il collegamento".
- Con una sola installazione di MetaTrader 5 non serve più premere "Seleziona". Con più installazioni resta ricordata la scelta del cliente (solo il percorso della cartella).

## Da fare, non bloccante
`CONNECTOR UNINSTALL CLEANUP POLISH`: la disinstallazione lascia una cartella vuota del programma e i dati interni dell'app (nessuna chiave). La EA resta in MetaTrader di proposito.

## Invariato
EA 1.5.0, indirizzo del server `https://www.dlmtrading.com`, regole di scrittura, requisiti prima della distribuzione (server aggiornato, **firma del codice Windows**, link alla versione precisa).

## Impronta SHA-256
EA incluso (`resources/DLM_Bridge_EA.mq5`):
`761651ed5669cdea16a2f259119e30ddab9e5f8a5aecdc72b1373d6cde5bfa21`
