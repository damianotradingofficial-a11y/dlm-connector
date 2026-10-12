# DLM Connector 0.6.0

Stato: **in sviluppo — non pubblicata, non compilata e non provata su MetaTrader. Non distribuire.**

## Contenuto
- **DLM Bridge EA 1.5.0** al posto della 1.4.8: protocollo di esecuzione 2.
  - **Registro degli ordini che sopravvive al riavvio** di MetaTrader e del computer.
  - **Riferimento dell'ordine nel commento della posizione** (`DLM:` + 26 cifre).
  - **Controllo dei doppioni prima di ogni apertura**: registro, posizioni aperte, storia del conto. Nel dubbio l'apertura non viene ripetuta.
  - **Conferma del server un istante prima dell'apertura**, con tempo massimo di 3 secondi. Senza un sì esplicito e in tempo la posizione non viene aperta.
  - **Esiti salvati e ritrasmessi** finché il server non conferma di averli ricevuti. Ritrasmettere non esegue nulla su MetaTrader.
  - **Stato più completo** inviato al server: per ogni posizione numero, mercato, direzione, volume, orario di apertura e riferimento dell'ordine.
  - **Chiusure e modifiche dello stop non chiedono conferma**: partono sempre, anche a operazioni ferme. Lo stop di emergenza non chiude nessuna posizione da solo.
- Rispetto alla 1.4.8 la EA ha solo aggiunte, più tredici righe sostituite (versione, tempo massimo delle richieste, apertura con riferimento, stato, intestazioni).
- Dopo un aggiornamento il Connector chiede al cliente di chiudere e riaprire MetaTrader.
- `version-manifest.json` allineato: Connector 0.6.0, EA 1.5.0.

## Limite dichiarato
La conferma del server riduce a pochi istanti il tempo in cui uno stop di emergenza può arrivare troppo tardi, ma non lo azzera: uno stop attivato dopo il sì del server e prima che il broker esegua non può più fermare quell'ordine. L'ordine viene comunque riportato correttamente.

## Compatibilità
- **Richiede il server aggiornato** (route di autorizzazione e nuove regole di consegna). Su un server non aggiornato la EA 1.5.0 non apre posizioni (chiusure e modifiche dello stop funzionano).
- Le EA precedenti continuano a ricevere chiusure e modifiche dello stop. Quando la regola di versione minima verrà attivata sul server, non riceveranno più nuove aperture sui conti reali.

## Piattaforme
- **Windows (x64): supportato.**
- **macOS: `CONNECTOR MAC = NOT YET SUPPORTED`.**

## Requisiti prima di qualunque distribuzione
- Compilazione della EA 1.5.0 in MetaEditor senza errori né avvisi.
- Prova reale su Windows con MetaTrader e **conto demo**: installazione, aggiornamento da 1.4.x, apertura, riavvio a metà, perdita di rete, stop di emergenza, chiusura.
- Server aggiornato e migration applicata (non ancora autorizzate).
- **Firma del codice Windows: obbligatoria** per i clienti.
- Link di produzione puntati a questa versione precisa, mai a "latest".

## Impronta SHA-256
EA incluso (`resources/DLM_Bridge_EA.mq5`):
`cbf331b4f49150a5da611742adadbd013441adfdafcaa6dc157f2214e36d5632`
