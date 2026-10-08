//+------------------------------------------------------------------+
//|                                              DLM_Bridge_EA.mq5   |
//|                                   DLM Capital Partners Ltd       |
//+------------------------------------------------------------------+
//
// DLM Bridge EA — Fase Demo MT5, Blocco 3 (30/07/2026, Magic Number
//
// LA VERSIONE VERA E' UNA SOLA, ed e' #define EA_VERSIONE piu' sotto (con
// #property version che la accompagna). Qui sopra c'era un numero scritto a
// mano che era rimasto fermo alla 1.4.0 mentre il file era gia' alla 1.4.2:
// il 24/08/2026 ha fatto sbagliare una verifica, perche' un controllo
// cercava "DLM Bridge EA v" e trovava PRIMA questo commento. Il numero e'
// stato tolto: una riga descrittiva non deve poter essere scambiata per la
// fonte della versione.
// aggiunto il 31/07/2026, fix heartbeat/errore critico aggiunto il 31/07/2026,
// MT5 Position Ticket Targeting aggiunto il 23/08/2026).
//
// TICKET TARGETING (23/08/2026, approvato da Damiano dopo proposta tecnica
// separata): fino a questa versione, MODIFICA_SL/CHIUDI_PARZIALE/
// CHIUDI_TOTALE risolvevano sempre "la nostra posizione" con
// TrovaTicketNostraPosizione() (filtro solo simbolo+Magic), corretto SOLO
// con al più una posizione nostra per simbolo — vedi nota storica su quella
// funzione. Ora ogni ordine può portare un campo opzionale
// "ticket_mt5_target": se presente, l'EA seleziona ESATTAMENTE quella
// posizione con PositionSelectByTicket() — mai una ricerca per simbolo. Se
// il ticket indicato non corrisponde a nessuna posizione aperta (già
// chiusa, o disallineamento), l'EA riporta ERROR esplicito e NON tenta
// alcun fallback su TrovaTicketNostraPosizione: agire sulla posizione
// sbagliata per errore sarebbe peggio di un ordine non eseguito. Se il
// campo è assente (ordini di gestione generati da flussi che non lo
// popolano, o storico prima di questa versione), il comportamento resta
// IDENTICO a prima — compatibilità piena con l'ipotesi "una posizione per
// simbolo" tuttora in uso da altri flussi (es. pilota AI Trader). Vedi
// SelezionaPosizioneTarget() più sotto per l'unico punto di questa logica.
//
// FIX HEARTBEAT ERRORE CRITICO (31/07/2026): l'heartbeat periodico in
// OnTimer inviava sempre errore_critico=false a prescindere dallo stato
// reale, sovrascrivendo mt5_bridge_heartbeat.stato da "errore" a "online"
// pochi secondi dopo una segnalazione critica corretta, mentre la
// condizione (es. AutoTrading disabilitato) era ancora attiva. Corretto
// calcolando la condizione critica una sola volta per tick in OnTimer e
// riusandola sia per l'heartbeat periodico sia per la notifica di
// transizione (vedi commenti su OnTimer/GestisciTransizioneErroreCritico).
//
// RISOLUZIONE SIMBOLO BROKER (23/09/2026, richiesta esplicita e
// specificata da Damiano dopo diagnosi read-only del mismatch simbolo su
// Axi PRO — conto live): fino a questa versione SIMBOLO_UNICO
// ("XAUUSD") veniva usato letteralmente in ogni chiamata SymbolInfoDouble/
// SymbolInfoInteger/trade.Buy/trade.Sell, senza mai verificare che il
// broker esponesse davvero un simbolo con quel nome esatto. Su Axi PRO il
// simbolo reale e' "XAUUSD.pa": SymbolInfoDouble("XAUUSD", ...) restituiva
// silenziosamente 0.00 per contract_size/volume_min/volume_max/volume_step
// (mai un dato reale zero: un simbolo che quella stringa non trovava),
// senza log e senza distinguere "zero vero" da "simbolo inesistente". Il
// rischio non era solo la telemetria: EseguiApri() usava la STESSA stringa
// per trade.Buy/trade.Sell, quindi l'apertura di una posizione reale
// sarebbe quasi certamente fallita per "simbolo sconosciuto".
//
// Il fix mantiene "XAUUSD" come simbolo LOGICO/CANONICO — e' quello che il
// server continua a vedere nel campo "symbol" dell'heartbeat, cosi' il
// backend non viene mai contaminato da suffissi/prefissi broker. SOLO
// questo Bridge risolve, una volta sola in OnInit(), il simbolo REALE del
// broker (g_simboloBroker) tramite RisolviSimboloBroker(): prima un match
// esatto, poi — se assente — una scansione di TUTTI i simboli noti al
// terminale alla ricerca di uno che inizi esattamente con "XAUUSD" seguito
// da un separatore non alfanumerico (".pa", ".a", "+", ecc.), MAI un match
// permissivo per sottostringa (accetterebbe anche "XAUUSDMICRO"). Se la
// scansione trova zero o piu' di un candidato, o se una qualunque
// proprieta' necessaria (contract size, volume min/max/step, digits) non è
// leggibile, la risoluzione FALLISCE esplicitamente: g_simboloValido resta
// false, GetLastError() viene loggato per ogni lettura fallita, l'EA resta
// acceso (per continuare a riportare lo stato al server, ora come
// condizione critica — vedi RilevaErroreCritico) ma EseguiApri() rifiuta
// ogni apertura finche' il simbolo non e' risolto. Mai un'apertura su un
// simbolo incerto, mai uno zero spacciato per dato valido.
//
// UNICO SCOPO: fare da postino tra il DLM Trading Engine (server) e questo
// terminale MT5. Questo EA NON DECIDE MAI NULLA — non calcola se aprire un
// trade, non decide un livello, non applica nessuna regola di trading.
// Riceve ordini gia' approvati dal Risk Engine (server), li esegue con le
// funzioni native MT5, e riporta il risultato reale. Qualunque futura
// modifica alla LOGICA di trading va fatta lato server
// (lib/dlm-engine/aiSetupGenerator.js, riskEngine.js, aiTradeManager.js) —
// MAI in questo file.
//
// MAGIC NUMBER (31/07/2026): il conto e' un conto Hedge, dove piu'
// posizioni sullo stesso simbolo possono coesistere (es. altri bot/EA gia'
// presenti sul conto). Durante il test del 30/07/2026 e' rimasta aperta
// una seconda posizione XAUUSD (ticket [omesso], "dlm bot scalping") non
// riconducibile a questo bridge: PositionSelect(symbol) da solo non
// distingue tra posizioni diverse sullo stesso simbolo. Da qui in poi ogni
// posizione aperta da questo EA porta MAGIC_NUMBER, e ogni ricerca di una
// posizione da modificare/chiudere filtra ESPLICITAMENTE per simbolo E
// magic — mai piu' solo per simbolo.
//
// Ciclo:
//   1) ogni IntervalloPollingSecondi: GET /api/mt5/pending-orders
//   2) per ogni ordine ricevuto: esegue con CTrade, poi POST /api/mt5/order-result
//   3) ogni IntervalloStatusSecondi: POST /api/mt5/status (equity/margine/heartbeat)
//   4) se rileva una condizione critica: POST /api/mt5/status con errore_critico=true
//
// SICUREZZA: l'unico dato sensibile e' ConnectionReference (non e' una
// password, e' rigenerabile/revocabile dal cliente in dashboard). Questo EA
// non riceve, non vede, non salva mai la password del broker.
//
// REQUISITO MT5: il dominio in ApiBaseUrl deve essere aggiunto in
// Strumenti -> Opzioni -> Expert Advisor -> "Consenti WebRequest per le
// seguenti URL", altrimenti WebRequest() fallisce sempre con errore 4060.
//
#property copyright "DLM Capital Partners Ltd"
#property link      "https://www.dlmtrading.com"
#property version    "1.48"
#property strict

#include <Trade\Trade.mqh>

//------------------------------------------------------------------------
// INPUT — parametri configurabili dell'EA, mai hardcoded nel corpo del file
//------------------------------------------------------------------------
input string ConnectionReference   = "";                          // Chiave personale del cliente (da Collega MT5) — MAI una password
input string ApiBaseUrl            = "https://www.dlmtrading.com"; // Es. http://127.0.0.1:3002 in sviluppo locale
input int    IntervalloPollingSecondi = 3;                         // Ogni quanto controlla pending-orders
input int    IntervalloStatusSecondi  = 30;                        // Ogni quanto invia equity/margine (heartbeat)
input int    WebRequestTimeoutMs      = 5000;                      // Timeout singola chiamata HTTP

//------------------------------------------------------------------------
// COSTANTI
//------------------------------------------------------------------------
#define EA_VERSIONE "1.4.8"          // DLM Bridge EA v1.4.8 — identica alla 1.4.7 verificata + patch di sicurezza (08/10/2026): tolto un numero di conto da un commento, la chiave di collegamento non viene piu' scritta nel registro all'avvio. Nessuna modifica funzionale.
#define SIMBOLO_UNICO "XAUUSD"       // Simbolo LOGICO/CANONICO — e' quello che il server vede sempre (campo "symbol" dell'heartbeat). Il simbolo REALE del broker viene risolto a runtime in g_simboloBroker, vedi RisolviSimboloBroker().
#define MAGIC_NUMBER 26073101        // Identifica le posizioni aperte da QUESTO bridge — mai un altro EA/bot sullo stesso conto (vedi nota Magic Number in testa al file)

//------------------------------------------------------------------------
// STATO GLOBALE
//------------------------------------------------------------------------
CTrade   trade;
int      g_secondiTrascorsi          = 0;   // contatore interno, incrementato ogni secondo da OnTimer
int      g_fallimentiWebRequestConsecutivi = 0;
bool     g_erroreCriticoGiaRiportato  = false; // evita di spammare lo stesso errore critico a ogni timer
string   g_simboloBroker             = "";   // simbolo REALE risolto sul broker (es. "XAUUSD.pa") — popolato una sola volta in OnInit da RisolviSimboloBroker()
bool     g_simboloValido             = false; // false finche' RisolviSimboloBroker() non ha successo — gate esplicito per EseguiApri()

//+------------------------------------------------------------------+
//| LOG — wrapper per messaggi leggibili e coerenti                  |
//+------------------------------------------------------------------+
void LogConnessione(string messaggio)
{
   Print("[DLM Bridge EA v" + EA_VERSIONE + "] [CONNESSIONE] " + messaggio);
}
void LogHeartbeat(string messaggio)
{
   Print("[DLM Bridge EA v" + EA_VERSIONE + "] [HEARTBEAT] " + messaggio);
}
void LogOrdine(string messaggio)
{
   Print("[DLM Bridge EA v" + EA_VERSIONE + "] [ORDINE] " + messaggio);
}
void LogTicket(string messaggio)
{
   Print("[DLM Bridge EA v" + EA_VERSIONE + "] [TICKET] " + messaggio);
}
void LogErrore(string messaggio)
{
   Print("[DLM Bridge EA v" + EA_VERSIONE + "] [ERRORE] " + messaggio);
}

//+------------------------------------------------------------------+
//| JSON — parser/costruttore MINIMALE, scritto su misura per le      |
//| risposte FISSE e semplici delle nostre route (mai un JSON         |
//| generico/annidato). Se il formato delle route cambia, queste      |
//| funzioni vanno aggiornate insieme.                                |
//+------------------------------------------------------------------+

// Estrae il valore stringa associato a "chiave":"valore" — restituisce ""
// se la chiave non esiste o il valore e' null.
string JsonGetString(string json, string chiave)
{
   string cercaChiave = "\"" + chiave + "\":\"";
   int pos = StringFind(json, cercaChiave);
   if(pos < 0) return "";
   int inizio = pos + StringLen(cercaChiave);
   int fine = StringFind(json, "\"", inizio);
   if(fine < 0) return "";
   return StringSubstr(json, inizio, fine - inizio);
}

// Estrae il valore numerico associato a "chiave":123.45 — restituisce
// EMPTY_VALUE (0 con trovato=false) se la chiave non esiste o e' null.
double JsonGetNumber(string json, string chiave, bool &trovato)
{
   trovato = false;
   string cercaChiave = "\"" + chiave + "\":";
   int pos = StringFind(json, cercaChiave);
   if(pos < 0) return 0.0;
   int inizio = pos + StringLen(cercaChiave);
   // Valore null esplicito -> non trovato, MAI convertito in 0 silenzioso
   if(StringSubstr(json, inizio, 4) == "null")
      return 0.0;
   int fine = inizio;
   int lunghezza = StringLen(json);
   while(fine < lunghezza)
   {
      ushort c = StringGetCharacter(json, fine);
      if((c >= '0' && c <= '9') || c == '.' || c == '-')
         fine++;
      else
         break;
   }
   if(fine == inizio) return 0.0;
   trovato = true;
   return StringToDouble(StringSubstr(json, inizio, fine - inizio));
}

// Divide il contenuto di un array JSON piatto "[{...},{...}]" nei singoli
// oggetti "{...}" — valido solo per oggetti SENZA parentesi graffe annidate
// (esattamente il caso dei nostri ordini: chiavi solo stringa/numero/null).
int JsonSplitObjects(string arrayContent, string &oggetti[])
{
   int trovati = 0;
   int lunghezza = StringLen(arrayContent);
   int profondita = 0;
   int inizioOggetto = -1;
   for(int i = 0; i < lunghezza; i++)
   {
      ushort c = StringGetCharacter(arrayContent, i);
      if(c == '{')
      {
         if(profondita == 0) inizioOggetto = i;
         profondita++;
      }
      else if(c == '}')
      {
         profondita--;
         if(profondita == 0 && inizioOggetto >= 0)
         {
            ArrayResize(oggetti, trovati + 1);
            oggetti[trovati] = StringSubstr(arrayContent, inizioOggetto, i - inizioOggetto + 1);
            trovati++;
            inizioOggetto = -1;
         }
      }
   }
   return trovati;
}

// Estrae il contenuto dell'array "ordini":[...] dalla risposta completa di
// pending-orders. Restituisce "" se la chiave non esiste (risposta vuota o
// malformata).
string JsonEstraiArrayOrdini(string rispostaCompleta)
{
   string cercaChiave = "\"ordini\":[";
   int pos = StringFind(rispostaCompleta, cercaChiave);
   if(pos < 0) return "";
   int inizio = pos + StringLen(cercaChiave);
   int fine = StringFind(rispostaCompleta, "]", inizio);
   if(fine < 0) return "";
   return StringSubstr(rispostaCompleta, inizio, fine - inizio);
}

// Converte la stringa ricevuta dal payload ("ticket_mt5_target") in ulong —
// 0 se assente/vuota (JsonGetString restituisce "" sia per chiave mancante
// sia per valore null, coerente con il resto di questo file). Nessuna
// libreria esterna: StringToInteger nativo MQL5, stesso principio del resto
// del parser JSON minimale sopra.
ulong ParseTicketOpzionale(string valoreStringa)
{
   if(valoreStringa == "") return 0;
   long valore = StringToInteger(valoreStringa);
   if(valore <= 0) return 0;
   return (ulong)valore;
}

//+------------------------------------------------------------------+
//| HTTP — wrapper unico per tutte le chiamate al backend             |
//+------------------------------------------------------------------+

// Esegue una chiamata HTTP (GET o POST) verso il backend. Ritorna true se
// la richiesta e' arrivata a destinazione con HTTP 200/altro status HTTP
// valido (anche 4xx/5xx sono "arrivate", solo un errore di trasporto/rete
// e' considerato fallimento). Il corpo della risposta viene scritto in
// rispostaOut.
// headerExtra (24/08/2026, v1.4.1): header aggiuntivi, gia' terminati da
// \r\n dal chiamante. Introdotto per poter mandare la connection_reference
// in un header invece che in query string sulle chiamate GET — vedi nota in
// testa a EseguiCicloPendingOrders(). Parametro con valore di default: le
// chiamate POST esistenti restano identiche, byte per byte.
bool EseguiChiamataHttp(string metodo, string url, string corpoJson, string &rispostaOut, string headerExtra = "")
{
   uchar datiInvio[];
   if(corpoJson != "")
      StringToCharArray(corpoJson, datiInvio, 0, StringLen(corpoJson));

   uchar datiRisposta[];
   string headerRisposta;
   string headerRichiesta = "Content-Type: application/json\r\n";
   if(headerExtra != "")
      headerRichiesta += headerExtra;

   ResetLastError();
   int codiceHttp = WebRequest(metodo, url, headerRichiesta, WebRequestTimeoutMs, datiInvio, datiRisposta, headerRisposta);

   if(codiceHttp == -1)
   {
      int erroreMt5 = GetLastError();
      LogErrore(StringFormat("WebRequest fallita (errore MT5 %d) verso %s — verificare la whitelist URL in Strumenti > Opzioni > Expert Advisor.", erroreMt5, url));
      g_fallimentiWebRequestConsecutivi++;
      rispostaOut = "";
      return false;
   }

   g_fallimentiWebRequestConsecutivi = 0;
   // -1 (non WHOLE_ARRAY, che in MQL5 vale 0) e' il valore documentato per
   // "converti fino alla fine dell'array" in CharArrayToString().
   rispostaOut = CharArrayToString(datiRisposta, 0, -1, CP_UTF8);

   if(codiceHttp < 200 || codiceHttp >= 300)
   {
      LogErrore(StringFormat("Risposta HTTP %d da %s: %s", codiceHttp, url, rispostaOut));
      return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| RISOLUZIONE SIMBOLO BROKER — vedi nota estesa in testa al file.  |
//+------------------------------------------------------------------+

// True se nomeSimbolo inizia ESATTAMENTE con logico e, se prosegue oltre,
// il carattere successivo NON e' alfanumerico (".", "+", "_", "-", spazio,
// ecc.). Accetta "XAUUSD.pa", "XAUUSD+", "XAUUSD_i"; RIFIUTA "XAUUSDMICRO"
// o "XAUUSDX" — mai un match per sola sottostringa.
bool SimboloIniziaConLogicoESeparatore(string nomeSimbolo, string logico)
{
   int lunghezzaLogico = StringLen(logico);
   if(StringLen(nomeSimbolo) < lunghezzaLogico) return false;
   if(StringSubstr(nomeSimbolo, 0, lunghezzaLogico) != logico) return false;
   if(StringLen(nomeSimbolo) == lunghezzaLogico) return true; // match esatto — gia' gestito a parte, ma innocuo qui
   ushort prossimoCarattere = StringGetCharacter(nomeSimbolo, lunghezzaLogico);
   bool alfanumerico = (prossimoCarattere >= '0' && prossimoCarattere <= '9')
                     || (prossimoCarattere >= 'A' && prossimoCarattere <= 'Z')
                     || (prossimoCarattere >= 'a' && prossimoCarattere <= 'z');
   return !alfanumerico;
}

// Legge le proprieta' del simbolo necessarie all'esecuzione, ognuna con
// GetLastError() esplicito se la lettura fallisce. Uno zero letto senza
// controllo NON e' mai considerato un dato valido: contract size e volumi
// devono essere positivi per qualunque simbolo tradabile reale.
bool LeggiProprietaSimbolo(string simbolo, double &contractSize, double &volumeMin, double &volumeMax, double &volumeStep, int &digitsOut)
{
   ResetLastError();
   contractSize = SymbolInfoDouble(simbolo, SYMBOL_TRADE_CONTRACT_SIZE);
   if(contractSize <= 0.0)
   {
      LogErrore(StringFormat("Risoluzione simbolo: SYMBOL_TRADE_CONTRACT_SIZE non valido per '%s' (letto=%.4f, GetLastError=%d).", simbolo, contractSize, GetLastError()));
      return false;
   }
   ResetLastError();
   volumeMin = SymbolInfoDouble(simbolo, SYMBOL_VOLUME_MIN);
   if(volumeMin <= 0.0)
   {
      LogErrore(StringFormat("Risoluzione simbolo: SYMBOL_VOLUME_MIN non valido per '%s' (letto=%.4f, GetLastError=%d).", simbolo, volumeMin, GetLastError()));
      return false;
   }
   ResetLastError();
   volumeMax = SymbolInfoDouble(simbolo, SYMBOL_VOLUME_MAX);
   if(volumeMax <= 0.0)
   {
      LogErrore(StringFormat("Risoluzione simbolo: SYMBOL_VOLUME_MAX non valido per '%s' (letto=%.4f, GetLastError=%d).", simbolo, volumeMax, GetLastError()));
      return false;
   }
   ResetLastError();
   volumeStep = SymbolInfoDouble(simbolo, SYMBOL_VOLUME_STEP);
   if(volumeStep <= 0.0)
   {
      LogErrore(StringFormat("Risoluzione simbolo: SYMBOL_VOLUME_STEP non valido per '%s' (letto=%.4f, GetLastError=%d).", simbolo, volumeStep, GetLastError()));
      return false;
   }
   ResetLastError();
   digitsOut = (int)SymbolInfoInteger(simbolo, SYMBOL_DIGITS);
   int erroreDigits = GetLastError();
   if(erroreDigits != 0)
   {
      LogErrore(StringFormat("Risoluzione simbolo: SYMBOL_DIGITS non leggibile per '%s' (GetLastError=%d).", simbolo, erroreDigits));
      return false;
   }
   return true;
}

// Risolve UNA SOLA VOLTA (chiamata da OnInit) il simbolo reale del broker
// a partire dal simbolo logico/canonico. Passi:
//   1) match esatto — se il broker espone proprio "XAUUSD", e' quello;
//   2) altrimenti, scansione di TUTTI i simboli noti al terminale
//      (SymbolsTotal(false)/SymbolName(i,false) — non solo Market Watch)
//      alla ricerca di simboli compatibili (vedi SimboloIniziaConLogicoESeparatore);
//   3) esattamente UN candidato -> quello e' il simbolo risolto. Zero ->
//      risoluzione FALLITA. Piu' di uno (v1.4.5, 05/10/2026 — Axi espone
//      sia "XAUUSD.pa" sia "XAUUSD-PERP") -> spareggio col simbolo del
//      grafico su cui l'EA e' montato (_Symbol): se e' uno dei candidati
//      si usa quello, altrimenti risoluzione FALLITA come prima, nessuna
//      scommessa;
//   4) SymbolSelect() esplicito + verifica SYMBOL_EXIST + lettura/validazione
//      delle proprieta' necessarie all'esecuzione.
bool RisolviSimboloBroker(string simboloLogico, string &simboloRisoltoOut)
{
   // Passo 1 — match esatto.
   ResetLastError();
   if(SymbolSelect(simboloLogico, true) && (bool)SymbolInfoInteger(simboloLogico, SYMBOL_EXIST))
   {
      double cs, vmin, vmax, vstep; int dig;
      if(LeggiProprietaSimbolo(simboloLogico, cs, vmin, vmax, vstep, dig))
      {
         LogConnessione(StringFormat("Simbolo risolto (match esatto): logico='%s' -> broker='%s' (contract_size=%.2f volume_min=%.2f volume_max=%.2f volume_step=%.2f digits=%d).",
                                      simboloLogico, simboloLogico, cs, vmin, vmax, vstep, dig));
         simboloRisoltoOut = simboloLogico;
         return true;
      }
      LogErrore(StringFormat("Simbolo '%s' esiste ma le proprieta' non sono valide — provo la scansione suffissi broker.", simboloLogico));
   }

   // Passo 2 — scansione di tutti i simboli noti al terminale.
   string candidati[];
   int trovatiCandidati = 0;
   int totaleSimboli = SymbolsTotal(false); // false = TUTTI i simboli disponibili, non solo Market Watch
   for(int i = 0; i < totaleSimboli; i++)
   {
      string nome = SymbolName(i, false);
      if(nome == simboloLogico) continue; // gia' provato al passo 1
      if(!SimboloIniziaConLogicoESeparatore(nome, simboloLogico)) continue;
      ArrayResize(candidati, trovatiCandidati + 1);
      candidati[trovatiCandidati] = nome;
      trovatiCandidati++;
   }

   if(trovatiCandidati == 0)
   {
      LogErrore(StringFormat("Risoluzione simbolo FALLITA: nessun simbolo broker compatibile con '%s' trovato tra %d simboli disponibili sul terminale.", simboloLogico, totaleSimboli));
      return false;
   }
   if(trovatiCandidati > 1)
   {
      string elenco = "";
      for(int i = 0; i < trovatiCandidati; i++)
         elenco += (i > 0 ? ", " : "") + candidati[i];
      bool graficoTraCandidati = false;
      for(int i = 0; i < trovatiCandidati; i++)
         if(candidati[i] == _Symbol) { graficoTraCandidati = true; break; }
      if(!graficoTraCandidati)
      {
         LogErrore(StringFormat("Risoluzione simbolo FALLITA: %d candidati AMBIGUI compatibili con '%s' (%s) — nessuna scommessa su quale usare (simbolo del grafico '%s' non tra i candidati).", trovatiCandidati, simboloLogico, elenco, _Symbol));
         return false;
      }
      LogConnessione(StringFormat("Risoluzione simbolo: %d candidati compatibili con '%s' (%s) — spareggio col simbolo del grafico '%s'.", trovatiCandidati, simboloLogico, elenco, _Symbol));
   }

   string candidato = (trovatiCandidati > 1 ? _Symbol : candidati[0]);
   ResetLastError();
   if(!SymbolSelect(candidato, true))
   {
      LogErrore(StringFormat("Risoluzione simbolo: SymbolSelect('%s', true) fallita (GetLastError=%d).", candidato, GetLastError()));
      return false;
   }
   if(!(bool)SymbolInfoInteger(candidato, SYMBOL_EXIST))
   {
      LogErrore(StringFormat("Risoluzione simbolo: '%s' selezionato ma SYMBOL_EXIST=false.", candidato));
      return false;
   }

   double cs, vmin, vmax, vstep; int dig;
   if(!LeggiProprietaSimbolo(candidato, cs, vmin, vmax, vstep, dig))
   {
      LogErrore(StringFormat("Risoluzione simbolo: '%s' trovato ma proprieta' non tutte leggibili — risoluzione FALLITA.", candidato));
      return false;
   }

   LogConnessione(StringFormat("Simbolo risolto (scansione suffissi): logico='%s' -> broker='%s' (contract_size=%.2f volume_min=%.2f volume_max=%.2f volume_step=%.2f digits=%d).",
                                simboloLogico, candidato, cs, vmin, vmax, vstep, dig));
   simboloRisoltoOut = candidato;
   return true;
}

//+------------------------------------------------------------------+
//| RILEVAMENTO ERRORE CRITICO                                       |
//+------------------------------------------------------------------+

// Verifica le condizioni gia' definite nella specifica del Blocco 3 come
// "errore bridge critico" — la DECISIONE di attivare il kill switch resta
// SEMPRE lato server (Blocco 5): questo EA si limita a rilevare e riportare.
bool RilevaErroreCritico(string &descrizioneOut)
{
   // Risoluzione simbolo (23/09/2026): senza un simbolo broker risolto,
   // nessuna apertura puo' essere eseguita in sicurezza — condizione
   // critica al pari di AutoTrading disabilitato o account in sola lettura.
   if(!g_simboloValido)
   {
      descrizioneOut = StringFormat("Simbolo broker non risolto per il simbolo logico '%s': impossibile eseguire ordini in sicurezza (vedi log Experts per il dettaglio della risoluzione).", SIMBOLO_UNICO);
      return true;
   }
   if(!(bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
   {
      descrizioneOut = "AutoTrading disabilitato nel terminale MT5.";
      return true;
   }
   if(!(bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
   {
      descrizioneOut = "Trading non consentito per questo account (account in sola lettura o restrizione broker).";
      return true;
   }
   if(g_fallimentiWebRequestConsecutivi >= 3)
   {
      descrizioneOut = StringFormat("Bridge non raggiungibile: %d chiamate consecutive fallite verso il backend.", g_fallimentiWebRequestConsecutivi);
      return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| STATUS / HEARTBEAT — POST /api/mt5/status                        |
//+------------------------------------------------------------------+
void InviaStatus(bool erroreCritico, string descrizioneErrore)
{
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double margineDisponibile = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double margineUtilizzato = AccountInfoDouble(ACCOUNT_MARGIN);

   // MT5 Symbol Specification Sync (31/07/2026, v1.3.0): leva account e
   // specifiche del simbolo, sincronizzate a ogni heartbeat periodico —
   // dati quasi statici (cambiano solo se il broker modifica le
   // condizioni), ma il payload resta piccolo e non serve una logica di
   // invio a frequenza separata. Alimentano il Gate 7 lato server
   // (process-cycle/route.js) — riskEngine.js resta invariato, questi dati
   // servono solo a validare che il volume calcolato sia eseguibile per
   // davvero su questo broker.
   //
   // Le proprieta' vengono lette dal simbolo REALE del broker
   // (g_simboloBroker, risolto in OnInit — vedi RisolviSimboloBroker), MAI
   // dal simbolo logico letterale: e' esattamente il mismatch che causava
   // gli zero silenziosi prima di questo fix. Il campo "symbol" spedito al
   // server resta invece SIMBOLO_UNICO (il logico "XAUUSD"): il backend
   // continua a ragionare solo nel simbolo canonico, la traduzione verso il
   // simbolo broker resta un dettaglio interno a questo Bridge.
   long leva = AccountInfoInteger(ACCOUNT_LEVERAGE);
   double contractSize = 0.0, volumeMin = 0.0, volumeMax = 0.0, volumeStep = 0.0;
   if(g_simboloValido)
   {
      contractSize = SymbolInfoDouble(g_simboloBroker, SYMBOL_TRADE_CONTRACT_SIZE);
      volumeMin = SymbolInfoDouble(g_simboloBroker, SYMBOL_VOLUME_MIN);
      volumeMax = SymbolInfoDouble(g_simboloBroker, SYMBOL_VOLUME_MAX);
      volumeStep = SymbolInfoDouble(g_simboloBroker, SYMBOL_VOLUME_STEP);
   }

   string corpo = StringFormat(
      "{\"connection_reference\":\"%s\",\"equity_corrente\":%.2f,\"margine_disponibile\":%.2f,\"margine_utilizzato\":%.2f,\"versione_ea\":\"%s\""
      ",\"leverage\":%d,\"symbol\":\"%s\",\"contract_size\":%.2f,\"volume_min\":%.2f,\"volume_max\":%.2f,\"volume_step\":%.2f",
      ConnectionReference, equity, margineDisponibile, margineUtilizzato, EA_VERSIONE,
      (int)leva, SIMBOLO_UNICO, contractSize, volumeMin, volumeMax, volumeStep
   );

   // v1.4.7 — vedi JsonTicketAperti()/JsonChiusureRecenti(): due campi in
   // piu' nello stesso messaggio, nessuna chiamata HTTP aggiuntiva. Inviati
   // solo a simbolo risolto: senza simbolo non si sa quali posizioni
   // guardare, e il server senza questi campi non riconcilia nulla.
   if(g_simboloValido)
      corpo += ",\"posizioni_aperte\":" + JsonTicketAperti() + ",\"chiusure_recenti\":" + JsonChiusureRecenti();

   if(erroreCritico)
   {
      // Escape minimo delle virgolette nel messaggio, per non rompere il JSON
      string descrizioneEscaped = descrizioneErrore;
      StringReplace(descrizioneEscaped, "\"", "'");
      corpo += StringFormat(",\"errore_critico\":true,\"last_error\":\"%s\"", descrizioneEscaped);
   }
   corpo += "}";

   string risposta;
   string url = ApiBaseUrl + "/api/mt5/status";
   bool ok = EseguiChiamataHttp("POST", url, corpo, risposta);

   if(ok)
      LogHeartbeat(StringFormat("Inviato: equity=%.2f margine_disponibile=%.2f margine_utilizzato=%.2f leva=1:%d contract_size=%.2f volume_min=%.2f volume_max=%.2f volume_step=%.2f simbolo_broker=%s%s",
                                 equity, margineDisponibile, margineUtilizzato, (int)leva, contractSize, volumeMin, volumeMax, volumeStep,
                                 (g_simboloValido ? g_simboloBroker : "NON RISOLTO"),
                                 erroreCritico ? " [ERRORE CRITICO SEGNALATO]" : ""));
   else
      LogErrore("Invio status/heartbeat fallito.");
}

//+------------------------------------------------------------------+
//| RICONCILIAZIONE CHIUSURE BROKER (v1.4.7, 06/10/2026)             |
//+------------------------------------------------------------------+
// Test live reale, ticket [omesso]: la posizione e' stata chiusa dal broker
// per stop loss e il server non l'ha mai saputo, perche' questo EA
// riportava solo l'esito degli ordini ricevuti. Ora lo status porta anche:
//   - posizioni_aperte : i ticket delle posizioni aperte in questo momento
//                        sul simbolo del Bridge;
//   - chiusure_recenti : le operazioni di USCITA delle ultime 24 ore sullo
//                        stesso simbolo, lette dalla storia del conto.
// Solo lettura: nessun ordine, nessuna modifica a volumi, SL/TP, simbolo.
// L'EA non decide nulla: e' il server a riconciliare, e solo le posizioni
// che conosce per ticket su questo stesso conto. Per questo qui non si
// filtra per Magic: un deal di uscita generato dal broker (stop/target) non
// porta sempre il Magic dell'ordine di apertura.
#define ORE_FINESTRA_CHIUSURE   24
#define MAX_CHIUSURE_RIPORTATE  20

string JsonTicketAperti()
{
   string json = "[";
   bool primo = true;
   int totale = PositionsTotal();
   for(int i = 0; i < totale; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != g_simboloBroker) continue;
      if(!primo) json += ",";
      json += "\"" + IntegerToString(ticket) + "\"";
      primo = false;
   }
   return json + "]";
}

string MotivoChiusuraDeal(long motivoDeal)
{
   if(motivoDeal == DEAL_REASON_SL) return "SL";
   if(motivoDeal == DEAL_REASON_TP) return "TP";
   if(motivoDeal == DEAL_REASON_SO) return "STOP_OUT";
   if(motivoDeal == DEAL_REASON_EXPERT) return "EXPERT";
   if(motivoDeal == DEAL_REASON_CLIENT || motivoDeal == DEAL_REASON_MOBILE || motivoDeal == DEAL_REASON_WEB) return "MANUALE_BROKER";
   return "ALTRO";
}

string JsonChiusureRecenti()
{
   string json = "[";
   datetime adesso = TimeCurrent();
   if(!HistorySelect(adesso - ORE_FINESTRA_CHIUSURE * 3600, adesso + 3600))
      return json + "]";

   // DEAL_TIME e' in ora del server di trading: lo si riporta in UTC
   // togliendo lo scarto corrente tra ora server e ora GMT.
   long scartoServerGmt = (long)TimeTradeServer() - (long)TimeGMT();
   int cifre = (int)SymbolInfoInteger(g_simboloBroker, SYMBOL_DIGITS);
   int riportate = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0 && riportate < MAX_CHIUSURE_RIPORTATE; i--)
   {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      if(HistoryDealGetString(deal, DEAL_SYMBOL) != g_simboloBroker) continue;
      long ingresso = HistoryDealGetInteger(deal, DEAL_ENTRY);
      if(ingresso != DEAL_ENTRY_OUT && ingresso != DEAL_ENTRY_OUT_BY) continue;
      long posizione = HistoryDealGetInteger(deal, DEAL_POSITION_ID);
      double prezzo = HistoryDealGetDouble(deal, DEAL_PRICE);
      if(posizione <= 0 || prezzo <= 0) continue;

      double risultato = HistoryDealGetDouble(deal, DEAL_PROFIT) + HistoryDealGetDouble(deal, DEAL_SWAP) + HistoryDealGetDouble(deal, DEAL_COMMISSION);
      long tempoUtc = (long)HistoryDealGetInteger(deal, DEAL_TIME) - scartoServerGmt;
      if(riportate > 0) json += ",";
      json += StringFormat("{\"ticket\":\"%I64d\",\"prezzo\":%.*f,\"time_utc\":%I64d,\"volume\":%.2f,\"risultato\":%.2f,\"motivo\":\"%s\"}",
                           posizione, cifre, prezzo, tempoUtc, HistoryDealGetDouble(deal, DEAL_VOLUME), risultato,
                           MotivoChiusuraDeal(HistoryDealGetInteger(deal, DEAL_REASON)));
      riportate++;
   }
   return json + "]";
}

//+------------------------------------------------------------------+
//| ORDER RESULT — POST /api/mt5/order-result                        |
//+------------------------------------------------------------------+
void InviaOrderResult(string executionOrderId, string esito, string ticketMt5, double volumeEseguito, double livelloEseguito, string erroreMessaggio)
{
   string corpo = StringFormat(
      "{\"connection_reference\":\"%s\",\"execution_order_id\":\"%s\",\"esito\":\"%s\"",
      ConnectionReference, executionOrderId, esito
   );
   if(ticketMt5 != "")
      corpo += StringFormat(",\"ticket_mt5\":\"%s\"", ticketMt5);
   if(esito != "ERROR")
   {
      corpo += StringFormat(",\"volume_eseguito\":%.2f,\"livello_eseguito\":%.2f", volumeEseguito, livelloEseguito);
   }
   else
   {
      string erroreEscaped = erroreMessaggio;
      StringReplace(erroreEscaped, "\"", "'");
      corpo += StringFormat(",\"error\":\"%s\"", erroreEscaped);
   }
   corpo += "}";

   string risposta;
   string url = ApiBaseUrl + "/api/mt5/order-result";
   bool ok = EseguiChiamataHttp("POST", url, corpo, risposta);

   if(ok)
      LogTicket(StringFormat("Esito riportato per ordine %s: %s (ticket=%s, volume=%.2f, livello=%.2f)",
                              executionOrderId, esito, ticketMt5, volumeEseguito, livelloEseguito));
   else
      LogErrore(StringFormat("Impossibile riportare l'esito per ordine %s (esito locale: %s).", executionOrderId, esito));
}

//+------------------------------------------------------------------+
//| RICERCA POSIZIONE — filtro simbolo + Magic Number                 |
//+------------------------------------------------------------------+

// Cerca, tra TUTTE le posizioni aperte sul conto, quella sul nostro simbolo
// E con il nostro Magic Number. Necessario su conto Hedge (piu' posizioni
// sullo stesso simbolo possono coesistere): PositionSelect(symbol) da solo
// selezionerebbe una posizione qualunque su quel simbolo, anche di un
// altro EA/bot. Restituisce 0 se nessuna posizione nostra e' aperta.
// DEMO PILOT ONLY — assume al massimo una posizione nostra per simbolo
// (stessa ipotesi "un simbolo, un ciclo attivo" gia' in uso altrove in
// questo file); da rivedere insieme a un'eventuale estensione multi-posizione.
//
// Filtra per g_simboloBroker (simbolo REALE, es. "XAUUSD.pa") e non per
// SIMBOLO_UNICO: le posizioni aperte su MT5 portano sempre il nome broker
// reale in POSITION_SYMBOL, mai il logico. Se il simbolo non e' stato
// risolto (g_simboloBroker == ""), nessuna posizione puo' corrispondere —
// comportamento sicuro per costruzione, nessun guard aggiuntivo necessario.
//
// Quante posizioni aperte sono nostre (stesso simbolo, stesso Magic).
// Serve a distinguere "scelta obbligata" da "scommessa" nel percorso senza
// ticket target — vedi SelezionaPosizioneTarget.
int ContaNostrePosizioni()
{
   int quante = 0;
   int totale = PositionsTotal();
   for(int i = 0; i < totale; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == g_simboloBroker && PositionGetInteger(POSITION_MAGIC) == MAGIC_NUMBER)
         quante++;
   }
   return quante;
}

ulong TrovaTicketNostraPosizione()
{
   int totale = PositionsTotal();
   for(int i = 0; i < totale; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == g_simboloBroker && PositionGetInteger(POSITION_MAGIC) == MAGIC_NUMBER)
         return ticket;
   }
   return 0;
}

// TICKET TARGETING (23/08/2026) — UNICO punto in cui MODIFICA_SL/
// CHIUDI_PARZIALE/CHIUDI_TOTALE decidono su quale posizione agire. Se
// ticketTarget > 0, seleziona ESATTAMENTE quel ticket — mai una ricerca per
// simbolo, e MAI un fallback su TrovaTicketNostraPosizione se quel ticket
// non esiste piu' (posizione gia' chiusa, o disallineamento): in quel caso
// riporta ERROR esplicito e restituisce false, senza toccare nessun'altra
// posizione. Se ticketTarget == 0 (campo assente nel payload), ricade sul
// comportamento storico (TrovaTicketNostraPosizione) — identico a prima di
// questa versione, per piena compatibilita' con la modalita' a singola
// posizione per simbolo tuttora in uso da altri flussi.
bool SelezionaPosizioneTarget(ulong ticketTarget, string executionOrderId, string operazione, ulong &ticketSelezionato)
{
   if(ticketTarget > 0)
   {
      if(!PositionSelectByTicket(ticketTarget))
      {
         LogErrore(StringFormat("%s %s: ticket target %I64u non corrisponde a nessuna posizione aperta (gia' chiusa o disallineata) — NESSUN fallback su ricerca per simbolo.",
                                 operazione, executionOrderId, ticketTarget));
         InviaOrderResult(executionOrderId, "ERROR", IntegerToString(ticketTarget), 0, 0,
                           "Ticket target non trovato tra le posizioni aperte — posizione gia' chiusa o disallineata.");
         return false;
      }
      ticketSelezionato = ticketTarget;
      return true;
   }

   // Nessun ticket target nel payload: percorso legacy.
   //
   // v1.4.2 — qui c'era l'ultimo punto in cui l'EA poteva ancora tirare a
   // indovinare. Con UNA sola posizione nostra aperta la scelta e' obbligata
   // e il comportamento resta identico a prima. Con DUE o piu', "la prima
   // che trovo" e' una scommessa su quale posizione modificare: adesso
   // rifiuta invece di scommettere.
   //
   // In condizioni normali questo ramo non scatta piu': dalla 1.4.2 ogni
   // apertura registra il ticket esatto, quindi ogni ordine di gestione
   // arriva con il suo bersaglio. Se scatta, c'e' un problema a monte — ed
   // e' meglio che si veda come errore che come operazione sulla posizione
   // sbagliata.
   //
   // Se il simbolo broker non e' risolto (g_simboloBroker == ""),
   // ContaNostrePosizioni()/TrovaTicketNostraPosizione() non trovano
   // corrispondenze per costruzione — qui aggiungiamo solo un messaggio di
   // errore piu' chiaro invece del generico "nessuna posizione aperta".
   if(!g_simboloValido)
   {
      LogErrore(StringFormat("%s %s: simbolo broker non risolto — impossibile cercare la posizione per simbolo (nessun ticket target nel payload).", operazione, executionOrderId));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, "Simbolo broker non risolto: impossibile determinare la posizione senza un ticket target esplicito.");
      return false;
   }

   int nostrePosizioni = ContaNostrePosizioni();
   if(nostrePosizioni > 1)
   {
      LogErrore(StringFormat("%s %s: nessun ticket target e %d posizioni nostre aperte su %s — RIFIUTATO. Scegliere 'la prima' sarebbe una scommessa su quale posizione modificare.",
                              operazione, executionOrderId, nostrePosizioni, g_simboloBroker));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0,
                        StringFormat("Ordine senza ticket target con %d posizioni aperte: impossibile determinare il bersaglio senza ambiguita'.", nostrePosizioni));
      return false;
   }

   ulong ticket = TrovaTicketNostraPosizione();
   if(ticket == 0 || !PositionSelectByTicket(ticket))
   {
      LogErrore(StringFormat("%s %s: nessuna posizione nostra (Magic %d) aperta su %s.", operazione, executionOrderId, MAGIC_NUMBER, g_simboloBroker));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, "Nessuna posizione aperta da modificare/chiudere.");
      return false;
   }
   ticketSelezionato = ticket;
   return true;
}

//+------------------------------------------------------------------+
//| ESECUZIONE ORDINI — mappatura tipoOrdine -> funzione MT5          |
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| Ticket ESATTO della posizione appena aperta (v1.4.2, 24/08/2026)  |
//+------------------------------------------------------------------+
//
// Fino alla 1.4.1 EseguiApri chiamava TrovaTicketNostraPosizione(), che
// scorre le posizioni e restituisce LA PRIMA che combacia per simbolo e
// magic number. Con una posizione sola non fa differenza. Con DUE posizioni
// DLM sullo stesso simbolo, la seconda apertura registrava sul server il
// ticket della PRIMA: da quel momento il server credeva che la posizione B
// avesse il ticket di A, e ogni modifica destinata a B partiva con il
// bersaglio sbagliato — che l'EA, onorando correttamente ticket_mt5_target,
// eseguiva fedelmente sulla posizione sbagliata.
//
// Avevamo sistemato la consegna e lasciato rotto l'indirizzo. E il difetto
// era invisibile con una posizione sola, esattamente come quello che il
// ticket targeting doveva eliminare.
//
// Il deal appena eseguito porta con se' l'identita' della posizione che ha
// creato: DEAL_POSITION_ID. Nessuna ricerca, nessuna ambiguita' possibile,
// nemmeno con dieci posizioni aperte sullo stesso simbolo. E' anche il
// principio gia' dichiarato in testa a questo file ("mai una ricerca per
// simbolo") che EseguiApri era l'unico punto a violare.
ulong TicketPosizioneDalDeal(ulong deal)
{
   if(deal == 0) return 0;

   // HistoryDealSelect() da solo basta quasi sempre; se lo storico non e'
   // ancora caricato in memoria si forza una selezione sulla finestra
   // recente e si riprova. Due tentativi, nessun terzo: se falliscono
   // entrambi il chiamante deve saperlo, non ricevere un ticket inventato.
   if(!HistoryDealSelect(deal))
   {
      HistorySelect(TimeCurrent() - 300, TimeCurrent() + 60);
      if(!HistoryDealSelect(deal)) return 0;
   }
   return (ulong)HistoryDealGetInteger(deal, DEAL_POSITION_ID);
}

//+------------------------------------------------------------------+
//| FALLBACK ticket via posizioni aperte (11/09/2026, Bug Duplicazione |
//| Ordini, specifica esplicita di Damiano — FIX 3)                   |
//+------------------------------------------------------------------+
//
// TicketPosizioneDalDeal() (sopra) e' il metodo primario e resta invariato.
// Su conto Hedging si e' osservato in produzione ResultDeal()=0 nonostante
// la posizione fosse davvero aperta (deal non ancora nello storico al
// momento della chiamata, o non riportato dal broker per quella esecuzione
// specifica) — root cause del Bug Duplicazione Ordini insieme al rifiuto
// HTTP 400 lato server, gia' corretto separatamente in /api/mt5/order-result.
//
// Questo fallback NON sostituisce TicketPosizioneDalDeal(): viene provato
// SOLO quando quello ha gia' fallito (deal=0 o storico non risolvibile).
// Combina piu' segnali per restare stretto ed evitare di scegliere la
// posizione sbagliata (stesso principio gia' dichiarato per
// SelezionaPosizioneTarget — "mai una scommessa su quale posizione"):
//   - simbolo (g_simboloBroker — simbolo REALE, non il logico)
//   - Magic Number (MAGIC_NUMBER)
//   - direzione (POSITION_TYPE_BUY per "long", POSITION_TYPE_SELL per "short")
//   - volume, con tolleranza di mezzo VOLUME_STEP per arrotondamenti broker
//   - tempo di apertura della posizione (POSITION_TIME) entro una finestra
//     stretta (SECONDI_FINESTRA_FALLBACK_TICKET) dall'istante della chiamata
//     — l'apertura e' appena avvenuta nello stesso ciclo OnTimer
//
// Se PIU' DI UNA posizione soddisfa tutti i criteri, l'ambiguita' e' reale
// (es. due aperture quasi simultanee sullo stesso simbolo/direzione/volume)
// e la funzione restituisce 0 — MAI un "la prima che trovo": il chiamante
// (EseguiApri) tratta questo come "ticket non determinabile" e riporta
// FILLED_PENDING_RECONCILIATION, mai una nuova apertura.
#define SECONDI_FINESTRA_FALLBACK_TICKET 120

ulong TicketPosizioneFallbackMultiSegnale(string direzione, double volumeEseguito)
{
   // Chiamata solo da EseguiApri, che gia' rifiuta l'apertura se
   // !g_simboloValido — qui g_simboloBroker e' quindi sempre risolto.
   ENUM_POSITION_TYPE tipoAtteso = (direzione == "long") ? POSITION_TYPE_BUY : POSITION_TYPE_SELL;
   double volumeStep = SymbolInfoDouble(g_simboloBroker, SYMBOL_VOLUME_STEP);
   double tolleranzaVolume = (volumeStep > 0.0) ? (volumeStep / 2.0) : 0.001;
   datetime adesso = TimeCurrent();

   ulong ticketTrovato = 0;
   int corrispondenze = 0;
   int totale = PositionsTotal();
   for(int i = 0; i < totale; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != g_simboloBroker) continue;
      if(PositionGetInteger(POSITION_MAGIC) != MAGIC_NUMBER) continue;
      if((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) != tipoAtteso) continue;
      if(MathAbs(PositionGetDouble(POSITION_VOLUME) - volumeEseguito) > tolleranzaVolume) continue;
      datetime aperturaPosizione = (datetime)PositionGetInteger(POSITION_TIME);
      if((adesso - aperturaPosizione) > SECONDI_FINESTRA_FALLBACK_TICKET) continue;

      corrispondenze++;
      ticketTrovato = ticket;
   }

   // Esattamente una corrispondenza: unica scelta non ambigua. Zero o piu'
   // di una: nessun ticket restituito, mai un'euristica piu' ampia.
   return (corrispondenze == 1) ? ticketTrovato : 0;
}

//+------------------------------------------------------------------+
//| APERTURA — la posizione nasce gia' protetta (v1.4.2)              |
//+------------------------------------------------------------------+
//
// Fino alla 1.4.1: trade.Buy(volume, simbolo), senza stop e senza target.
// Lo stop arrivava dopo, come MODIFICA_SL separata, sul ciclo di polling
// successivo. Su demo e' una curiosita'; su un conto reale e' una finestra
// — secondi, ma reale — in cui la posizione e' scoperta. Se in quel momento
// cade la rete, si chiude MT5 o fallisce il ciclo server, la posizione resta
// aperta senza protezione.
//
// Ora SL e TP viaggiano nello stesso OrderSend dell'apertura. Se il broker
// rifiuta i livelli (stop troppo vicino al prezzo), l'apertura FALLISCE e
// viene riportato ERROR: e' voluto. Meglio nessuna posizione che una
// posizione scoperta — e il rifiuto rende visibile un problema di distanza
// dello stop invece di nasconderlo.
//
// RISOLUZIONE SIMBOLO (23/09/2026): primo controllo della funzione, prima
// di qualunque altra validazione — senza un simbolo broker risolto non si
// tenta MAI un'apertura, indipendentemente da quanto sia valido il resto
// dell'ordine.
// PREZZO DI ESECUZIONE REALE (v1.4.6, 06/10/2026) — test live reale, ticket
// [omesso] su Axi: l'ordine e' stato eseguito a 4141.63 ma
// trade.ResultPrice() ha restituito 0 (ResultDeal()=0, esecuzione a
// mercato), quindi al server e' arrivato livello_eseguito=0. Queste due
// funzioni NON cambiano nulla dell'esecuzione (volume, SL/TP, simbolo,
// ticket): correggono SOLO il prezzo riportato, e solo quando quello di
// CTrade e' <= 0. Se nemmeno la fonte alternativa e' disponibile,
// restituiscono il valore originale: il server tratta un prezzo <= 0 come
// "da riconciliare", mai come prezzo valido.
double PrezzoAperturaReale(ulong ticket, double prezzoRiportato)
{
   if(prezzoRiportato > 0)
      return prezzoRiportato;
   if(ticket > 0 && PositionSelectByTicket(ticket))
   {
      double prezzoPosizione = PositionGetDouble(POSITION_PRICE_OPEN);
      if(prezzoPosizione > 0)
         return prezzoPosizione;
   }
   return prezzoRiportato;
}

double PrezzoChiusuraReale(ulong ticketPosizione, double prezzoRiportato)
{
   if(prezzoRiportato > 0)
      return prezzoRiportato;

   // 1) il deal dell'operazione appena eseguita, se CTrade lo conosce.
   ulong deal = trade.ResultDeal();
   if(deal > 0 && HistoryDealSelect(deal))
   {
      double prezzoDeal = HistoryDealGetDouble(deal, DEAL_PRICE);
      if(prezzoDeal > 0)
         return prezzoDeal;
   }

   // 2) la storia della posizione: l'ultimo deal di USCITA (su conto
   //    Hedging l'identificativo della posizione coincide col suo ticket).
   if(ticketPosizione > 0 && HistorySelectByPosition(ticketPosizione))
   {
      for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
      {
         ulong dealStorico = HistoryDealGetTicket(i);
         if(dealStorico == 0)
            continue;
         long tipoIngresso = HistoryDealGetInteger(dealStorico, DEAL_ENTRY);
         if(tipoIngresso != DEAL_ENTRY_OUT && tipoIngresso != DEAL_ENTRY_OUT_BY)
            continue;
         double prezzoUscita = HistoryDealGetDouble(dealStorico, DEAL_PRICE);
         if(prezzoUscita > 0)
            return prezzoUscita;
      }
   }
   return prezzoRiportato;
}

void EseguiApri(string executionOrderId, string direzione, double volumeRichiesto, double stopLoss, double takeProfit)
{
   if(!g_simboloValido)
   {
      LogErrore(StringFormat("Ordine APRI %s rifiutato: simbolo broker non risolto per il simbolo logico '%s' — nessuna apertura possibile finche' il problema non e' risolto.", executionOrderId, SIMBOLO_UNICO));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, "Simbolo broker non risolto: apertura rifiutata per sicurezza (vedi log Experts del Bridge).");
      return;
   }

   if(volumeRichiesto <= 0.0)
   {
      LogErrore(StringFormat("Ordine APRI %s senza volumeRichiesto valido — non eseguito, riportato ERROR.", executionOrderId));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, "volumeRichiesto mancante o non valido: il Risk Engine non ha calcolato un volume.");
      return;
   }

   if(stopLoss <= 0.0)
   {
      LogErrore(StringFormat("Ordine APRI %s senza stopLoss — non eseguito. Una posizione non deve nascere senza protezione.", executionOrderId));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, "stopLoss mancante: l'apertura senza protezione non e' consentita.");
      return;
   }

   int cifre = (int)SymbolInfoInteger(g_simboloBroker, SYMBOL_DIGITS);
   double sl = NormalizeDouble(stopLoss, cifre);
   // TP opzionale: se il piano non ha un target finale si apre con il solo
   // stop. La gestione dei target intermedi resta del Trade Manager, via
   // chiusure parziali — questo TP e' una rete di sicurezza, non una regola
   // operativa nuova.
   double tp = (takeProfit > 0.0) ? NormalizeDouble(takeProfit, cifre) : 0.0;

   bool successo;
   if(direzione == "long")
      successo = trade.Buy(volumeRichiesto, g_simboloBroker, 0.0, sl, tp);
   else if(direzione == "short")
      successo = trade.Sell(volumeRichiesto, g_simboloBroker, 0.0, sl, tp);
   else
   {
      LogErrore(StringFormat("Ordine APRI %s con direzione sconosciuta: '%s'.", executionOrderId, direzione));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, StringFormat("Direzione sconosciuta: %s", direzione));
      return;
   }

   if(!successo)
   {
      string descrizioneErrore = trade.ResultRetcodeDescription();
      LogErrore(StringFormat("Esecuzione APRI %s fallita (sl=%.*f tp=%.*f): %s", executionOrderId, cifre, sl, cifre, tp, descrizioneErrore));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, descrizioneErrore);
      return;
   }

   double volumeEseguito = trade.ResultVolume();
   double livelloEseguito = trade.ResultPrice();

   // FIX 3 (11/09/2026, Bug Duplicazione Ordini) — metodo primario invariato
   // (TicketPosizioneDalDeal via DEAL_POSITION_ID); se fallisce (osservato
   // su conto Hedging con ResultDeal()=0), si tenta il fallback
   // multi-segnale sopra PRIMA di arrendersi. Mai una ricerca "la prima che
   // trovo": il fallback stesso rifiuta se trova piu' di una corrispondenza.
   ulong ticket = TicketPosizioneDalDeal(trade.ResultDeal());
   bool viaFallback = false;
   if(ticket == 0)
   {
      ticket = TicketPosizioneFallbackMultiSegnale(direzione, volumeEseguito);
      viaFallback = (ticket > 0);
   }

   string ticketStr = (ticket > 0) ? IntegerToString(ticket) : "";

   if(ticket == 0)
   {
      // La posizione E' aperta — e ora e' protetta dallo stop — ma il
      // ticket non e' determinabile con certezza ne' dal deal ne' dal
      // fallback multi-segnale. PRIMA di questo fix si riportava comunque
      // "FILLED" con ticket vuoto: il server rifiutava il riporto con HTTP
      // 400 (ticket_mt5 obbligatorio), l'ordine restava per sempre in SENT
      // e veniva ri-consegnato a ogni polling, causando aperture duplicate
      // (Bug Duplicazione Ordini, 11/09/2026). ORA si riporta l'esito
      // esplicito FILLED_PENDING_RECONCILIATION: il server (order-result,
      // gia' aggiornato) lo accetta come stato TERMINALE — l'ordine non
      // viene mai piu' consegnato, nessuna riapertura possibile per questo
      // execution_order_id, e la posizione resta in attesa di
      // riconciliazione manuale del ticket.
      LogErrore(StringFormat("APRI %s: posizione aperta ma ticket NON determinabile (ne' da deal %I64u ne' da fallback multi-segnale). Riportato FILLED_PENDING_RECONCILIATION — nessuna ri-consegna.", executionOrderId, trade.ResultDeal()));
      InviaOrderResult(executionOrderId, "FILLED_PENDING_RECONCILIATION", "", volumeEseguito, livelloEseguito, "Ticket posizione non determinabile con certezza: posizione protetta, in attesa di riconciliazione.");
      return;
   }
   if(viaFallback)
   {
      LogOrdine(StringFormat("APRI %s: ticket %I64u determinato via fallback multi-segnale (deal=%I64u non risolvibile).", executionOrderId, ticket, trade.ResultDeal()));
   }

   // v1.4.6 — vedi PrezzoAperturaReale(): solo il prezzo riportato.
   livelloEseguito = PrezzoAperturaReale(ticket, livelloEseguito);

   LogOrdine(StringFormat("APRI eseguito per ordine %s: ticket=%s volume=%.2f livello=%.2f sl=%.*f tp=%.*f",
                          executionOrderId, ticketStr, volumeEseguito, livelloEseguito, cifre, sl, cifre, tp));
   InviaOrderResult(executionOrderId, "FILLED", ticketStr, volumeEseguito, livelloEseguito, "");
}

void EseguiModificaSl(string executionOrderId, double nuovoSl, ulong ticketMt5Target)
{
   ulong ticket;
   if(!SelezionaPosizioneTarget(ticketMt5Target, executionOrderId, "MODIFICA_SL", ticket))
      return; // errore gia' riportato dentro SelezionaPosizioneTarget
   double tpAttuale = PositionGetDouble(POSITION_TP);

   // Overload per ticket (non per simbolo): su conto Hedge, con piu'
   // posizioni sullo stesso simbolo, l'overload per simbolo non
   // garantisce di agire sulla posizione appena trovata.
   bool successo = trade.PositionModify(ticket, nuovoSl, tpAttuale);
   if(!successo)
   {
      string descrizioneErrore = trade.ResultRetcodeDescription();
      LogErrore(StringFormat("MODIFICA_SL %s fallita su ticket %I64u: %s", executionOrderId, ticket, descrizioneErrore));
      InviaOrderResult(executionOrderId, "ERROR", IntegerToString(ticket), 0, 0, descrizioneErrore);
      return;
   }

   LogOrdine(StringFormat("MODIFICA_SL eseguita per ordine %s: ticket=%I64u nuovo SL=%.2f", executionOrderId, ticket, nuovoSl));
   InviaOrderResult(executionOrderId, "FILLED", IntegerToString(ticket), 0, nuovoSl, "");
}

void EseguiChiudiParziale(string executionOrderId, double frazioneRichiesta, ulong ticketMt5Target)
{
   ulong ticket;
   if(!SelezionaPosizioneTarget(ticketMt5Target, executionOrderId, "CHIUDI_PARZIALE", ticket))
      return; // errore gia' riportato dentro SelezionaPosizioneTarget
   double volumeOriginale = PositionGetDouble(POSITION_VOLUME);
   double volumeDaChiudere = NormalizeDouble(volumeOriginale * frazioneRichiesta, 2);

   if(volumeDaChiudere <= 0.0)
   {
      LogErrore(StringFormat("CHIUDI_PARZIALE %s: volume calcolato non valido (frazione=%.4f, volume originale=%.2f).", executionOrderId, frazioneRichiesta, volumeOriginale));
      InviaOrderResult(executionOrderId, "ERROR", IntegerToString(ticket), 0, 0, "Volume di chiusura parziale calcolato non valido.");
      return;
   }

   // Overload per ticket — stesso motivo di EseguiModificaSl.
   bool successo = trade.PositionClosePartial(ticket, volumeDaChiudere);
   if(!successo)
   {
      string descrizioneErrore = trade.ResultRetcodeDescription();
      LogErrore(StringFormat("CHIUDI_PARZIALE %s fallita su ticket %I64u: %s", executionOrderId, ticket, descrizioneErrore));
      InviaOrderResult(executionOrderId, "ERROR", IntegerToString(ticket), 0, 0, descrizioneErrore);
      return;
   }

   double livelloEseguito = PrezzoChiusuraReale(ticket, trade.ResultPrice()); // v1.4.6
   LogOrdine(StringFormat("CHIUDI_PARZIALE eseguita per ordine %s: ticket=%I64u volume chiuso=%.2f", executionOrderId, ticket, volumeDaChiudere));
   InviaOrderResult(executionOrderId, "PARTIAL", IntegerToString(ticket), volumeDaChiudere, livelloEseguito, "");
}

void EseguiChiudiTotale(string executionOrderId, ulong ticketMt5Target)
{
   ulong ticket;
   if(!SelezionaPosizioneTarget(ticketMt5Target, executionOrderId, "CHIUDI_TOTALE", ticket))
      return; // errore gia' riportato dentro SelezionaPosizioneTarget
   double volumeOriginale = PositionGetDouble(POSITION_VOLUME);

   // Overload per ticket — stesso motivo di EseguiModificaSl.
   bool successo = trade.PositionClose(ticket);
   if(!successo)
   {
      string descrizioneErrore = trade.ResultRetcodeDescription();
      LogErrore(StringFormat("CHIUDI_TOTALE %s fallita su ticket %I64u: %s", executionOrderId, ticket, descrizioneErrore));
      InviaOrderResult(executionOrderId, "ERROR", IntegerToString(ticket), 0, 0, descrizioneErrore);
      return;
   }

   double livelloEseguito = PrezzoChiusuraReale(ticket, trade.ResultPrice()); // v1.4.6
   LogOrdine(StringFormat("CHIUDI_TOTALE eseguita per ordine %s: ticket=%I64u volume chiuso=%.2f", executionOrderId, ticket, volumeOriginale));
   InviaOrderResult(executionOrderId, "CLOSED", IntegerToString(ticket), volumeOriginale, livelloEseguito, "");
}

// Dispatcher — unico punto che legge tipoOrdine e decide QUALE funzione
// MT5 chiamare. Nessuna logica di trading qui: solo instradamento.
void EseguiOrdine(string oggettoJson)
{
   string id = JsonGetString(oggettoJson, "id");
   string tipoOrdine = JsonGetString(oggettoJson, "tipoOrdine");
   string direzione = JsonGetString(oggettoJson, "direzione");

   bool trovatoLivello, trovatoFrazione, trovatoVolume;
   double livelloRichiesto = JsonGetNumber(oggettoJson, "livelloRichiesto", trovatoLivello);
   double frazioneRichiesta = JsonGetNumber(oggettoJson, "frazioneRichiesta", trovatoFrazione);
   double volumeRichiesto = JsonGetNumber(oggettoJson, "volumeRichiesto", trovatoVolume);

   // TICKET TARGETING (23/08/2026) — campo opzionale, assente/vuoto per APRI
   // e per qualunque flusso legacy: ParseTicketOpzionale restituisce 0 in
   // quel caso, che fa ricadere EseguiModificaSl/EseguiChiudiParziale/
   // EseguiChiudiTotale sul comportamento storico (vedi SelezionaPosizioneTarget).
   string ticketMt5TargetStr = JsonGetString(oggettoJson, "ticketMt5Target");
   ulong ticketMt5Target = ParseTicketOpzionale(ticketMt5TargetStr);

   // APERTURA PROTETTA (24/08/2026, v1.4.2) — stop e target arrivano ora
   // insieme all'ordine di apertura, non su un ciclo successivo. Campi
   // presenti solo per APRI: per gli altri tipi restano 0 e non vengono usati.
   bool trovatoSl, trovatoTp;
   double stopLoss = JsonGetNumber(oggettoJson, "stopLoss", trovatoSl);
   double takeProfit = JsonGetNumber(oggettoJson, "takeProfit", trovatoTp);
   if(!trovatoSl) stopLoss = 0.0;
   if(!trovatoTp) takeProfit = 0.0;

   LogOrdine(StringFormat("Ricevuto ordine %s: tipo=%s direzione=%s livello=%.2f frazione=%.4f volume=%.2f sl=%.2f tp=%.2f ticketTarget=%I64u",
                           id, tipoOrdine, direzione, livelloRichiesto, frazioneRichiesta, volumeRichiesto, stopLoss, takeProfit, ticketMt5Target));

   if(tipoOrdine == "APRI")
      EseguiApri(id, direzione, volumeRichiesto, stopLoss, takeProfit);
   else if(tipoOrdine == "MODIFICA_SL")
      EseguiModificaSl(id, livelloRichiesto, ticketMt5Target);
   else if(tipoOrdine == "CHIUDI_PARZIALE")
      EseguiChiudiParziale(id, frazioneRichiesta, ticketMt5Target);
   else if(tipoOrdine == "CHIUDI_TOTALE")
      EseguiChiudiTotale(id, ticketMt5Target);
   else
   {
      LogErrore(StringFormat("tipoOrdine sconosciuto per ordine %s: '%s' — non eseguito.", id, tipoOrdine));
      InviaOrderResult(id, "ERROR", "", 0, 0, StringFormat("tipoOrdine sconosciuto: %s", tipoOrdine));
   }
}

//+------------------------------------------------------------------+
//| CICLO PRINCIPALE — GET /api/mt5/pending-orders                   |
//+------------------------------------------------------------------+
void EseguiCicloPendingOrders()
{
   // v1.4.1 (24/08/2026) — la connection_reference viaggia in un HEADER, non
   // piu' in query string. Motivo: e' l'unica credenziale che autentica
   // questo Bridge, e una query string finisce nei log del server, in quelli
   // di ogni proxy intermedio e — cosa che si nota meno — anche nel log
   // Esperti locale di MT5, perche' EseguiChiamataHttp stampa l'URL quando
   // una chiamata fallisce. Le altre due rotte (status, order-result) la
   // mandavano gia' nel corpo: questa era l'unica incoerente.
   //
   // COMPATIBILITA': il lato server accetta ancora la query string durante
   // la finestra di migrazione (vedi ACCETTA_REFERENCE_IN_QUERY nella route),
   // quindi un EA 1.4.0 gia' installato continua a funzionare mentre il
   // cliente aggiorna. Nessuna finestra di disservizio in nessuno dei due
   // ordini di deploy.
   string risposta;
   string url = ApiBaseUrl + "/api/mt5/pending-orders";
   string headerRef = "X-DLM-Connection-Reference: " + ConnectionReference + "\r\n";
   bool ok = EseguiChiamataHttp("GET", url, "", risposta, headerRef);
   if(!ok)
      return; // gia' loggato in EseguiChiamataHttp

   string arrayOrdini = JsonEstraiArrayOrdini(risposta);
   if(arrayOrdini == "")
      return; // nessun ordine in coda, ciclo silenzioso (comportamento normale, non un errore)

   string oggetti[];
   int numeroOrdini = JsonSplitObjects(arrayOrdini, oggetti);
   if(numeroOrdini == 0)
      return;

   LogOrdine(StringFormat("%d ordine/i in coda dal backend.", numeroOrdini));
   for(int i = 0; i < numeroOrdini; i++)
      EseguiOrdine(oggetti[i]);
}

//+------------------------------------------------------------------+
//| CICLO CRITICO — gestisce solo la TRANSIZIONE (notifica una volta  |
//| sola quando la condizione critica inizia/finisce). Lo stato       |
//| critico stesso viene calcolato UNA VOLTA per tick in OnTimer e    |
//| passato qui — vedi nota su GestisciTransizioneErroreCritico.      |
//+------------------------------------------------------------------+
void GestisciTransizioneErroreCritico(bool critico, string descrizione)
{
   if(critico && !g_erroreCriticoGiaRiportato)
   {
      LogErrore("Condizione critica rilevata: " + descrizione);
      InviaStatus(true, descrizione);
      g_erroreCriticoGiaRiportato = true;
   }
   else if(!critico && g_erroreCriticoGiaRiportato)
   {
      // La condizione critica e' rientrata (es. AutoTrading riattivato) —
      // segnalazione immediata (non aspetta il prossimo heartbeat
      // periodico), stesso principio di simmetria della segnalazione
      // d'ingresso qui sopra.
      LogConnessione("Condizione critica rientrata, torno a heartbeat normale.");
      InviaStatus(false, "");
      g_erroreCriticoGiaRiportato = false;
   }
}

//+------------------------------------------------------------------+
//| EVENTI MT5                                                       |
//+------------------------------------------------------------------+
int OnInit()
{
   if(ConnectionReference == "")
   {
      LogErrore("ConnectionReference non impostata — impossibile avviare l'EA. Inseriscila nei parametri di input (dalla pagina Collega MT5 della tua dashboard).");
      return(INIT_PARAMETERS_INCORRECT);
   }

   // RISOLUZIONE SIMBOLO BROKER (23/09/2026) — una sola volta qui, mai
   // ripetuta durante il ciclo di vita dell'EA. Se fallisce, l'EA NON si
   // ferma (deve continuare a riportare lo stato al server, vedi
   // RilevaErroreCritico piu' sotto): g_simboloValido resta false e
   // EseguiApri() rifiuta esplicitamente ogni apertura finche' il problema
   // non e' risolto (tipicamente riavviando l'EA dopo aver verificato il
   // simbolo nel Market Watch del terminale).
   g_simboloValido = RisolviSimboloBroker(SIMBOLO_UNICO, g_simboloBroker);
   if(!g_simboloValido)
   {
      g_simboloBroker = ""; // esplicitamente vuoto: ogni punto che lo usa lo tratta come "nessun simbolo valido"
      LogErrore(StringFormat("Simbolo broker NON risolto per '%s' — l'EA resta attivo per riportare l'errore al server, ma NON tentera' alcuna apertura finche' il problema non e' risolto.", SIMBOLO_UNICO));
   }
   else
   {
      trade.SetTypeFillingBySymbol(g_simboloBroker);
   }
   trade.SetExpertMagicNumber(MAGIC_NUMBER); // ogni posizione aperta da qui in poi porta questo Magic — vedi nota in testa al file

   EventSetTimer(1); // granularita' 1 secondo, i cicli reali sono scanditi dai contatori sotto
   g_secondiTrascorsi = 0;

   LogConnessione(StringFormat("DLM Bridge EA v%s avviato. Backend=%s SimboloLogico=%s SimboloBroker=%s Magic=%d",
                                EA_VERSIONE, ApiBaseUrl, SIMBOLO_UNICO,
                                (g_simboloValido ? g_simboloBroker : "NON RISOLTO"), MAGIC_NUMBER));

   // Primo heartbeat immediato, per verificare subito la connessione al
   // backend senza aspettare il primo intervallo completo. Calcola la
   // condizione critica come farebbe OnTimer, cosi' un simbolo non risolto
   // e' segnalato gia' dal primo heartbeat, non solo da quelli successivi.
   string descrizioneCriticaIniziale;
   bool criticoIniziale = RilevaErroreCritico(descrizioneCriticaIniziale);
   InviaStatus(criticoIniziale, criticoIniziale ? descrizioneCriticaIniziale : "");
   g_erroreCriticoGiaRiportato = criticoIniziale;

   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   LogConnessione(StringFormat("DLM Bridge EA v%s fermato (motivo=%d).", EA_VERSIONE, reason));
}

void OnTimer()
{
   g_secondiTrascorsi++;

   if(g_secondiTrascorsi % IntervalloPollingSecondi == 0)
      EseguiCicloPendingOrders();

   // BUG REALE TROVATO E CORRETTO (31/07/2026, test simulazione errore
   // critico): prima di questa versione l'heartbeat periodico sotto
   // inviava SEMPRE errore_critico=false, a prescindere dallo stato reale.
   // Risultato: pochi secondi dopo che una condizione critica (es.
   // AutoTrading disabilitato) veniva correttamente rilevata e riportata
   // una prima volta, il primo heartbeat periodico successivo sovrascriveva
   // mt5_bridge_heartbeat.stato da "errore" a "online" — mentre la
   // condizione era ANCORA attiva (verificato: rimasta "online" per oltre
   // 2 minuti con AutoTrading spento). ultimo_errore_critico/_at restavano
   // corretti (scritti solo quando errore_critico e' vero), ma il campo
   // "stato" mentiva. Corretto calcolando la condizione critica UNA VOLTA
   // per tick e riusandola sia qui sia nella gestione della transizione,
   // cosi' i due canali non possono piu' raccontare due verita' diverse.
   string descrizioneCritica;
   bool critico = RilevaErroreCritico(descrizioneCritica);

   if(g_secondiTrascorsi % IntervalloStatusSecondi == 0)
      InviaStatus(critico, critico ? descrizioneCritica : "");

   // Notifica di transizione (rilevamento/rientro immediato, non aspetta
   // il prossimo ciclo status/polling) — vedi GestisciTransizioneErroreCritico.
   GestisciTransizioneErroreCritico(critico, descrizioneCritica);
}

// OnTick() intenzionalmente vuoto/assente: questo EA non reagisce mai al
// prezzo, solo al tempo (OnTimer) — coerente con "non decide mai nulla in
// base al mercato", quella e' competenza esclusiva del DLM AI Engine lato
// server.
//+------------------------------------------------------------------+
