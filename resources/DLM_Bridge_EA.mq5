//+------------------------------------------------------------------+
//|                                              DLM_Bridge_EA.mq5   |
//|                                   DLM Capital Partners Ltd       |
//+------------------------------------------------------------------+
//
// DLM Bridge EA v1.2.0 — Fase Demo MT5, Blocco 3 (30/07/2026, Magic Number
// aggiunto il 31/07/2026, fix heartbeat/errore critico aggiunto il 31/07/2026).
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
// una seconda posizione XAUUSD (ticket 82684201, "dlm bot scalping") non
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
#property link      "https://dlmcapitalpartners.com"
#property version    "1.20"
#property strict

#include <Trade\Trade.mqh>

//------------------------------------------------------------------------
// INPUT — parametri configurabili dell'EA, mai hardcoded nel corpo del file
//------------------------------------------------------------------------
input string ConnectionReference   = "";                          // Chiave personale del cliente (da Collega MT5) — MAI una password
input string ApiBaseUrl            = "https://dlmcapitalpartners.com"; // Es. http://127.0.0.1:3002 in sviluppo locale
input int    IntervalloPollingSecondi = 3;                         // Ogni quanto controlla pending-orders
input int    IntervalloStatusSecondi  = 30;                        // Ogni quanto invia equity/margine (heartbeat)
input int    WebRequestTimeoutMs      = 5000;                      // Timeout singola chiamata HTTP

//------------------------------------------------------------------------
// COSTANTI
//------------------------------------------------------------------------
#define EA_VERSIONE "1.3.0"          // DLM Bridge EA v1.3.0 — riportata a ogni chiamata status
#define SIMBOLO_UNICO "XAUUSD"       // Fase Demo Pilot: solo XAUUSD, hardcoded per disciplina (stesso principio gia' in uso lato server)
#define MAGIC_NUMBER 26073101        // Identifica le posizioni aperte da QUESTO bridge — mai un altro EA/bot sullo stesso conto (vedi nota Magic Number in testa al file)

//------------------------------------------------------------------------
// STATO GLOBALE
//------------------------------------------------------------------------
CTrade   trade;
int      g_secondiTrascorsi          = 0;   // contatore interno, incrementato ogni secondo da OnTimer
int      g_fallimentiWebRequestConsecutivi = 0;
bool     g_erroreCriticoGiaRiportato  = false; // evita di spammare lo stesso errore critico a ogni timer

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

//+------------------------------------------------------------------+
//| HTTP — wrapper unico per tutte le chiamate al backend             |
//+------------------------------------------------------------------+

// Esegue una chiamata HTTP (GET o POST) verso il backend. Ritorna true se
// la richiesta e' arrivata a destinazione con HTTP 200/altro status HTTP
// valido (anche 4xx/5xx sono "arrivate", solo un errore di trasporto/rete
// e' considerato fallimento). Il corpo della risposta viene scritto in
// rispostaOut.
bool EseguiChiamataHttp(string metodo, string url, string corpoJson, string &rispostaOut)
{
   uchar datiInvio[];
   if(corpoJson != "")
      StringToCharArray(corpoJson, datiInvio, 0, StringLen(corpoJson));

   uchar datiRisposta[];
   string headerRisposta;
   string headerRichiesta = "Content-Type: application/json\r\n";

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
//| RILEVAMENTO ERRORE CRITICO                                       |
//+------------------------------------------------------------------+

// Verifica le condizioni gia' definite nella specifica del Blocco 3 come
// "errore bridge critico" — la DECISIONE di attivare il kill switch resta
// SEMPRE lato server (Blocco 5): questo EA si limita a rilevare e riportare.
bool RilevaErroreCritico(string &descrizioneOut)
{
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
   // specifiche del simbolo unico (SIMBOLO_UNICO), sincronizzate a ogni
   // heartbeat periodico — dati quasi statici (cambiano solo se il broker
   // modifica le condizioni), ma il payload resta piccolo e non serve una
   // logica di invio a frequenza separata. Alimentano il Gate 7 lato server
   // (process-cycle/route.js) — riskEngine.js resta invariato, questi dati
   // servono solo a validare che il volume calcolato sia eseguibile per
   // davvero su questo broker.
   long leva = AccountInfoInteger(ACCOUNT_LEVERAGE);
   double contractSize = SymbolInfoDouble(SIMBOLO_UNICO, SYMBOL_TRADE_CONTRACT_SIZE);
   double volumeMin = SymbolInfoDouble(SIMBOLO_UNICO, SYMBOL_VOLUME_MIN);
   double volumeMax = SymbolInfoDouble(SIMBOLO_UNICO, SYMBOL_VOLUME_MAX);
   double volumeStep = SymbolInfoDouble(SIMBOLO_UNICO, SYMBOL_VOLUME_STEP);

   string corpo = StringFormat(
      "{\"connection_reference\":\"%s\",\"equity_corrente\":%.2f,\"margine_disponibile\":%.2f,\"margine_utilizzato\":%.2f,\"versione_ea\":\"%s\""
      ",\"leverage\":%d,\"symbol\":\"%s\",\"contract_size\":%.2f,\"volume_min\":%.2f,\"volume_max\":%.2f,\"volume_step\":%.2f",
      ConnectionReference, equity, margineDisponibile, margineUtilizzato, EA_VERSIONE,
      (int)leva, SIMBOLO_UNICO, contractSize, volumeMin, volumeMax, volumeStep
   );

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
      LogHeartbeat(StringFormat("Inviato: equity=%.2f margine_disponibile=%.2f margine_utilizzato=%.2f leva=1:%d contract_size=%.2f volume_min=%.2f volume_max=%.2f volume_step=%.2f%s",
                                 equity, margineDisponibile, margineUtilizzato, (int)leva, contractSize, volumeMin, volumeMax, volumeStep,
                                 erroreCritico ? " [ERRORE CRITICO SEGNALATO]" : ""));
   else
      LogErrore("Invio status/heartbeat fallito.");
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
ulong TrovaTicketNostraPosizione()
{
   int totale = PositionsTotal();
   for(int i = 0; i < totale; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == SIMBOLO_UNICO && PositionGetInteger(POSITION_MAGIC) == MAGIC_NUMBER)
         return ticket;
   }
   return 0;
}

//+------------------------------------------------------------------+
//| ESECUZIONE ORDINI — mappatura tipoOrdine -> funzione MT5          |
//+------------------------------------------------------------------+

void EseguiApri(string executionOrderId, string direzione, double volumeRichiesto)
{
   if(volumeRichiesto <= 0.0)
   {
      LogErrore(StringFormat("Ordine APRI %s senza volumeRichiesto valido — non eseguito, riportato ERROR.", executionOrderId));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, "volumeRichiesto mancante o non valido: il Risk Engine non ha calcolato un volume.");
      return;
   }

   bool successo;
   if(direzione == "long")
      successo = trade.Buy(volumeRichiesto, SIMBOLO_UNICO);
   else if(direzione == "short")
      successo = trade.Sell(volumeRichiesto, SIMBOLO_UNICO);
   else
   {
      LogErrore(StringFormat("Ordine APRI %s con direzione sconosciuta: '%s'.", executionOrderId, direzione));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, StringFormat("Direzione sconosciuta: %s", direzione));
      return;
   }

   if(!successo)
   {
      string descrizioneErrore = trade.ResultRetcodeDescription();
      LogErrore(StringFormat("Esecuzione APRI %s fallita: %s", executionOrderId, descrizioneErrore));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, descrizioneErrore);
      return;
   }

   // Il ticket appena aperto porta gia' il nostro Magic Number (impostato
   // una volta sola su "trade" in OnInit con SetExpertMagicNumber), quindi
   // la ricerca filtrata lo trova senza ambiguita' anche se sul conto
   // esistono altre posizioni XAUUSD di altri EA/bot.
   ulong ticket = TrovaTicketNostraPosizione();

   string ticketStr = (ticket > 0) ? IntegerToString(ticket) : "";
   double volumeEseguito = trade.ResultVolume();
   double livelloEseguito = trade.ResultPrice();

   LogOrdine(StringFormat("APRI eseguito per ordine %s: ticket=%s volume=%.2f livello=%.2f", executionOrderId, ticketStr, volumeEseguito, livelloEseguito));
   InviaOrderResult(executionOrderId, "FILLED", ticketStr, volumeEseguito, livelloEseguito, "");
}

void EseguiModificaSl(string executionOrderId, double nuovoSl)
{
   ulong ticket = TrovaTicketNostraPosizione();
   if(ticket == 0 || !PositionSelectByTicket(ticket))
   {
      LogErrore(StringFormat("MODIFICA_SL %s: nessuna posizione nostra (Magic %d) aperta su %s da modificare.", executionOrderId, MAGIC_NUMBER, SIMBOLO_UNICO));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, "Nessuna posizione aperta da modificare.");
      return;
   }
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

void EseguiChiudiParziale(string executionOrderId, double frazioneRichiesta)
{
   ulong ticket = TrovaTicketNostraPosizione();
   if(ticket == 0 || !PositionSelectByTicket(ticket))
   {
      LogErrore(StringFormat("CHIUDI_PARZIALE %s: nessuna posizione nostra (Magic %d) aperta su %s.", executionOrderId, MAGIC_NUMBER, SIMBOLO_UNICO));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, "Nessuna posizione aperta da chiudere parzialmente.");
      return;
   }
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

   double livelloEseguito = trade.ResultPrice();
   LogOrdine(StringFormat("CHIUDI_PARZIALE eseguita per ordine %s: ticket=%I64u volume chiuso=%.2f", executionOrderId, ticket, volumeDaChiudere));
   InviaOrderResult(executionOrderId, "PARTIAL", IntegerToString(ticket), volumeDaChiudere, livelloEseguito, "");
}

void EseguiChiudiTotale(string executionOrderId)
{
   ulong ticket = TrovaTicketNostraPosizione();
   if(ticket == 0 || !PositionSelectByTicket(ticket))
   {
      LogErrore(StringFormat("CHIUDI_TOTALE %s: nessuna posizione nostra (Magic %d) aperta su %s.", executionOrderId, MAGIC_NUMBER, SIMBOLO_UNICO));
      InviaOrderResult(executionOrderId, "ERROR", "", 0, 0, "Nessuna posizione aperta da chiudere.");
      return;
   }
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

   double livelloEseguito = trade.ResultPrice();
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

   LogOrdine(StringFormat("Ricevuto ordine %s: tipo=%s direzione=%s livello=%.2f frazione=%.4f volume=%.2f",
                           id, tipoOrdine, direzione, livelloRichiesto, frazioneRichiesta, volumeRichiesto));

   if(tipoOrdine == "APRI")
      EseguiApri(id, direzione, volumeRichiesto);
   else if(tipoOrdine == "MODIFICA_SL")
      EseguiModificaSl(id, livelloRichiesto);
   else if(tipoOrdine == "CHIUDI_PARZIALE")
      EseguiChiudiParziale(id, frazioneRichiesta);
   else if(tipoOrdine == "CHIUDI_TOTALE")
      EseguiChiudiTotale(id);
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
   string risposta;
   string url = ApiBaseUrl + "/api/mt5/pending-orders?connection_reference=" + ConnectionReference;
   bool ok = EseguiChiamataHttp("GET", url, "", risposta);
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

   trade.SetTypeFillingBySymbol(SIMBOLO_UNICO);
   trade.SetExpertMagicNumber(MAGIC_NUMBER); // ogni posizione aperta da qui in poi porta questo Magic — vedi nota in testa al file

   EventSetTimer(1); // granularita' 1 secondo, i cicli reali sono scanditi dai contatori sotto
   g_secondiTrascorsi = 0;

   LogConnessione(StringFormat("DLM Bridge EA v%s avviato. Backend=%s ConnectionReference=%s Simbolo=%s Magic=%d",
                                EA_VERSIONE, ApiBaseUrl, ConnectionReference, SIMBOLO_UNICO, MAGIC_NUMBER));

   // Primo heartbeat immediato, per verificare subito la connessione al
   // backend senza aspettare il primo intervallo completo.
   InviaStatus(false, "");

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
