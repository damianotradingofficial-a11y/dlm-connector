// DLM Auto Connector — motore di diagnosi (Blocco 1).
//
// Funzione PURA: prende in input ciò che è già stato osservato (rilevamento
// locale + stato remoto letto da Supabase) e restituisce una diagnosi
// leggibile. Nessuna chiamata di rete o al filesystem qui dentro — questo
// per poterla testare/riusare facilmente (anche, in futuro, da un eventuale
// DLM AI Assistant che legga lo stesso stato — vedi nota di Damiano
// sull'integrazione futura: tenere questa logica separata dalla UI serve
// esattamente a questo).
//
// Nessuna regola di trading qui dentro: solo interpretazione di stato
// tecnico (installazione/connessione), mai una singola riga relativa a
// setup/posizioni/rischio.
//
// v1.1 (Hardening Fase 4 — AI Troubleshooting contestuale, richiesta
// esplicita di Damiano "collegare problemi agli step corretti del wizard"):
// ogni problema ora porta anche `stepChiave`, una delle 5 chiavi di
// wizardState.js (rilevamento_sistema/rilevamento_mt5/installazione_bridge/
// configurazione_guidata/verifica_finale) — SOLO un tag di instradamento per
// la UI, nessuna modifica alla logica di rilevamento dei problemi stessi.

const MINUTI_HEARTBEAT_CONSIDERATO_STALE = 10;

function minutiTrascorsiDa(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

// Mappa best-effort da messaggi di errore già noti (generati dal Bridge EA,
// invariato) a un suggerimento comprensibile — non introduce nuovi codici di
// errore, si limita a spiegare meglio quelli che il bridge già riporta oggi.
function suggerimentoPerErrore(messaggio) {
  if (!messaggio) return null;
  const testo = messaggio.toLowerCase();
  if (testo.includes("webrequest")) {
    return 'Aggiungi l\'indirizzo dell\'API DLM alla whitelist: in MT5 vai su Strumenti → Opzioni → Expert Advisor → "Consenti WebRequest per le seguenti URL".';
  }
  if (testo.includes("trading non consentito") || testo.includes("autotrading") || testo.includes("algo")) {
    return 'Attiva "Trading Algoritmico" nella barra strumenti di MT5 (icona play in alto) e verifica che il tuo conto non sia in sola lettura.';
  }
  if (testo.includes("margine") || testo.includes("fondi")) {
    return "Verifica il margine disponibile sul tuo conto MT5 — potrebbe non essere sufficiente per l'operazione richiesta.";
  }
  return "Errore riportato direttamente dal Bridge — se persiste, contatta DLM Assistant con questo messaggio.";
}

/**
 * @param {{locale: object, remoto: {account: object|null, heartbeat: object|null}|null}} input
 * @returns {{statoGenerale: string, voci: Array, problemi: Array}}
 */
function calcolaDiagnosi({ locale, remoto }) {
  const voci = [];
  const problemi = [];

  // --- 1) MetaTrader 5 ---
  const infoMt5 = locale?.installazioniMt5;
  if (!infoMt5?.supportato) {
    voci.push({ chiave: "metatrader5", etichetta: "MetaTrader 5", stato: "info", dettaglio: infoMt5?.motivo || "Rilevamento non supportato su questo sistema operativo." });
  } else if ((infoMt5.installazioni || []).length === 0) {
    voci.push({ chiave: "metatrader5", etichetta: "MetaTrader 5", stato: "warn", dettaglio: "Nessuna installazione MT5 trovata sul PC." });
    problemi.push({
      titolo: "MetaTrader 5 non trovato",
      descrizione: "Non risulta nessuna installazione di MetaTrader 5 sul tuo computer.",
      soluzione: "Installa MetaTrader 5 dal sito del tuo broker, poi riapri il DLM Auto Connector e premi di nuovo Analizza.",
      stepChiave: "rilevamento_mt5",
    });
  } else {
    voci.push({
      chiave: "metatrader5",
      etichetta: "MetaTrader 5",
      stato: "ok",
      dettaglio: `${infoMt5.installazioni.length} installazione/i trovata/e${locale.processoMt5Attivo?.inEsecuzione ? " — in esecuzione ora" : " — non risulta aperto ora"}.`,
    });
    if (locale.processoMt5Attivo?.supportato && locale.processoMt5Attivo?.inEsecuzione === false) {
      problemi.push({
        titolo: "MT5 non è aperto",
        descrizione: "MetaTrader 5 è installato ma non risulta in esecuzione in questo momento.",
        soluzione: "Apri MetaTrader 5 e accedi al tuo conto prima di usare DLM.",
        stepChiave: "configurazione_guidata",
      });
    }
  }

  // --- 2) Bridge DLM (file EA presente) ---
  const bridgePresente = (infoMt5?.installazioni || []).some((i) => i.bridgeEaPresente);
  if (!infoMt5?.supportato) {
    voci.push({ chiave: "bridge_file", etichetta: "Bridge DLM (file)", stato: "info", dettaglio: "Non verificabile su questo sistema operativo in questa fase." });
  } else if (bridgePresente) {
    voci.push({ chiave: "bridge_file", etichetta: "Bridge DLM (file)", stato: "ok", dettaglio: "File del Bridge trovato nella cartella Experts di MT5." });
  } else {
    voci.push({ chiave: "bridge_file", etichetta: "Bridge DLM (file)", stato: "warn", dettaglio: "File del Bridge non trovato." });
    if ((infoMt5?.installazioni || []).length > 0) {
      problemi.push({
        titolo: "Bridge DLM non installato",
        descrizione: "MetaTrader 5 è presente ma il file del Bridge DLM non è ancora nella cartella Experts.",
        soluzione: 'Usa "Installa il collegamento" qui nel Connector per copiarlo automaticamente.',
        stepChiave: "installazione_bridge",
      });
    }
  }

  // --- 3) Account collegato (riga mt5_accounts) ---
  if (remoto === null) {
    voci.push({ chiave: "account", etichetta: "Account collegato", stato: "info", dettaglio: "Accedi con le tue credenziali DLM per verificare lo stato del collegamento." });
  } else if (!remoto.account) {
    voci.push({ chiave: "account", etichetta: "Account collegato", stato: "warn", dettaglio: "Nessuna chiave di collegamento generata ancora." });
    problemi.push({
      titolo: "Nessuna chiave di collegamento",
      descrizione: "Non hai ancora generato la tua chiave personale DLM.",
      soluzione: 'Genera la tua chiave qui nel Connector, allo step "Attivazione".',
      stepChiave: "configurazione_guidata",
    });
  } else {
    voci.push({
      chiave: "account",
      etichetta: "Account collegato",
      stato: remoto.account.status === "connesso" ? "ok" : remoto.account.status === "errore" ? "err" : "warn",
      dettaglio: `Stato: ${remoto.account.status}${remoto.account.broker ? " · " + remoto.account.broker : ""}`,
    });
  }

  // --- 4) Connessione (heartbeat) ---
  if (remoto === null) {
    voci.push({ chiave: "connessione", etichetta: "Connessione (heartbeat)", stato: "info", dettaglio: "Accedi per verificare." });
  } else if (!remoto.heartbeat) {
    voci.push({ chiave: "connessione", etichetta: "Connessione (heartbeat)", stato: remoto.account ? "warn" : "info", dettaglio: "Nessun heartbeat ricevuto finora." });
  } else {
    const minuti = minutiTrascorsiDa(remoto.heartbeat.ultimo_ping_at);
    const stale = minuti === null || minuti > MINUTI_HEARTBEAT_CONSIDERATO_STALE;
    voci.push({
      chiave: "connessione",
      etichetta: "Connessione (heartbeat)",
      stato: stale ? "warn" : "ok",
      dettaglio: minuti === null ? "Mai ricevuto." : `Ultimo aggiornamento ${minuti} minut${minuti === 1 ? "o" : "i"} fa (v${remoto.heartbeat.versione_ea || "?"}).`,
    });
    if (stale) {
      problemi.push({
        titolo: "Il Bridge non risponde",
        descrizione: `Nessun aggiornamento dal Bridge da ${minuti === null ? "un tempo indeterminato" : minuti + " minuti"}.`,
        soluzione: "Verifica che MT5 sia aperto, connesso a internet, e che il Bridge sia ancora attivo su un grafico con Trading Algoritmico acceso.",
        stepChiave: "verifica_finale",
      });
    }
    if (remoto.heartbeat.ultimo_errore_critico) {
      const minutiErrore = minutiTrascorsiDa(remoto.heartbeat.ultimo_errore_critico_at);
      problemi.push({
        titolo: "Errore critico riportato dal Bridge",
        descrizione: `"${remoto.heartbeat.ultimo_errore_critico}"${minutiErrore !== null ? ` (${minutiErrore} minuti fa)` : ""}`,
        soluzione: suggerimentoPerErrore(remoto.heartbeat.ultimo_errore_critico),
        stepChiave: "verifica_finale",
      });
    }
  }

  const statoGenerale = problemi.length === 0 ? (remoto === null ? "incompleto" : "ok") : problemi.some((p) => p.titolo.includes("critico")) ? "errore" : "attenzione";

  return { statoGenerale, voci, problemi };
}

module.exports = { calcolaDiagnosi };
