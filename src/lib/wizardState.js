// DLM Auto Connector — logica pura del wizard a 5 step (Blocco 3).
//
// Nessuna UI qui, nessuna azione (non installa, non genera chiavi, non fa
// chiamate di rete): prende in input ciò che è già stato osservato altrove
// (rilevamento locale, stato remoto, report di installazione) e calcola
// SOLO qual è lo stato di ciascuno dei 5 step e quale mostrare come
// "corrente". Stessa disciplina di diagnostics.js — separare la logica
// dalla UI per poterla testare da sola e, in futuro, riusarla da un DLM AI
// Assistant che debba sapere "a che punto è" un cliente senza dover
// reimplementare questa logica.
//
// I 5 step, nell'ordine richiesto esplicitamente da Damiano:
//   1. rilevamento_sistema     — Windows/macOS/altro, sempre "noto" subito
//   2. rilevamento_mt5         — installazioni trovate, broker, percorso
//   3. installazione_bridge    — copia, backup, verifica compilazione
//   4. configurazione_guidata  — apertura MT5, Algo Trading, WebRequest,
//                                 Connection Reference
//   5. verifica_finale         — MT5 trovato, Bridge installato, heartbeat
//                                 fresco, stato online
//
// Nota importante su Step 4: MT5 non offre un modo di verificare da fuori se
// "Trading Algoritmico" e l'autorizzazione WebRequest sono attivi (vedi
// piano Blocco 2) — ma se un heartbeat arriva DAVVERO dal Bridge, questo è
// di per sé una prova che ENTRAMBI sono a posto: l'EA non potrebbe
// contattare l'API DLM altrimenti. Questa deduzione, non una lettura
// diretta, è quello che sottoStep.algoTradingEWebRequestOk rappresenta.

const CHIAVI_STEP = [
  "rilevamento_sistema",
  "rilevamento_mt5",
  "installazione_bridge",
  "configurazione_guidata",
  "verifica_finale",
];

const MINUTI_HEARTBEAT_FRESCO = 10;

/**
 * @param {{
 *   supportoPiattaforma?: object|null,
 *   locale?: { installazioniMt5?: object, processoMt5Attivo?: object }|null,
 *   remoto?: { account: object|null, heartbeat: object|null }|null,
 *   installazioneReport?: object|null,
 * }} input
 */
function calcolaStatoWizard({ supportoPiattaforma = null, locale = null, remoto = null, installazioneReport = null } = {}) {
  const step = {};

  // --- Step 1: rilevamento sistema — sempre noto immediatamente ---
  step.rilevamento_sistema = {
    stato: "completato",
    dettaglio: supportoPiattaforma?.messaggio || "Sistema rilevato.",
  };

  // --- Step 2: rilevamento MT5 ---
  const infoMt5 = locale?.installazioniMt5;
  if (supportoPiattaforma && supportoPiattaforma.rilevamentoAutomatico === false) {
    step.rilevamento_mt5 = { stato: "non_disponibile", dettaglio: supportoPiattaforma.messaggio, installazioni: [] };
  } else if (!infoMt5) {
    step.rilevamento_mt5 = { stato: "in_attesa", dettaglio: "Premi Analizza per rilevare MetaTrader 5.", installazioni: [] };
  } else if ((infoMt5.installazioni || []).length === 0) {
    step.rilevamento_mt5 = {
      stato: "azione_richiesta",
      dettaglio: "Nessuna installazione MT5 trovata. Installa MetaTrader 5 e riprova.",
      installazioni: [],
    };
  } else {
    step.rilevamento_mt5 = {
      stato: "completato",
      dettaglio: `${infoMt5.installazioni.length} installazione/i trovata/e.`,
      installazioni: infoMt5.installazioni,
    };
  }

  // --- Step 3: installazione Bridge ---
  if (step.rilevamento_mt5.stato !== "completato") {
    step.installazione_bridge = { stato: "non_disponibile", dettaglio: "Completa prima il rilevamento MT5." };
  } else if (!installazioneReport) {
    step.installazione_bridge = { stato: "in_attesa", dettaglio: "Premi \"Installa Bridge\" per procedere." };
  } else if (installazioneReport.bridge?.stato === "installato_e_compilato") {
    step.installazione_bridge = {
      stato: "completato",
      dettaglio: `Bridge installato e compilato (v${installazioneReport.bridge.versioneSorgenteCopiata}).`,
      report: installazioneReport,
    };
  } else {
    step.installazione_bridge = {
      stato: "azione_richiesta",
      dettaglio: (installazioneReport.azioniRichieste && installazioneReport.azioniRichieste[0]) || "Verifica il report di installazione.",
      report: installazioneReport,
    };
  }

  // --- Step 4: configurazione guidata ---
  const mt5Aperto = locale?.processoMt5Attivo?.inEsecuzione === true;
  const connectionReferenceGenerata = Boolean(remoto?.account?.connection_reference);
  const heartbeatPresente = Boolean(remoto?.heartbeat);
  const sottoStep = {
    apriMt5: mt5Aperto,
    connectionReferenceGenerata,
    // Dedotto, non verificato direttamente (vedi nota in cima al file).
    algoTradingEWebRequestOk: heartbeatPresente,
  };
  const tuttiOkStep4 = Object.values(sottoStep).every(Boolean);

  if (step.installazione_bridge.stato !== "completato") {
    step.configurazione_guidata = { stato: "non_disponibile", dettaglio: "Completa prima l'installazione del Bridge.", sottoStep };
  } else if (tuttiOkStep4) {
    step.configurazione_guidata = { stato: "completato", dettaglio: "MT5 aperto, chiave generata, Bridge connesso.", sottoStep };
  } else {
    step.configurazione_guidata = { stato: "in_corso", dettaglio: "Segui i passaggi rimanenti.", sottoStep };
  }

  // --- Step 5: verifica finale ---
  let heartbeatFresco = false;
  let minutiUltimoPing = null;
  if (remoto?.heartbeat?.ultimo_ping_at) {
    minutiUltimoPing = Math.round((Date.now() - new Date(remoto.heartbeat.ultimo_ping_at).getTime()) / 60000);
    heartbeatFresco = minutiUltimoPing <= MINUTI_HEARTBEAT_FRESCO;
  }

  if (step.configurazione_guidata.stato !== "completato") {
    step.verifica_finale = { stato: "non_disponibile", dettaglio: "Completa prima la configurazione guidata." };
  } else if (heartbeatFresco) {
    step.verifica_finale = {
      stato: "completato",
      dettaglio: "Connessione attiva, tutto configurato correttamente.",
      minutiUltimoPing,
    };
  } else {
    step.verifica_finale = {
      stato: "in_corso",
      dettaglio: "In attesa del primo heartbeat recente dal Bridge.",
      minutiUltimoPing,
    };
  }

  const stepCorrente = CHIAVI_STEP.find((k) => step[k].stato !== "completato") || CHIAVI_STEP[CHIAVI_STEP.length - 1];
  const stepCompletati = CHIAVI_STEP.filter((k) => step[k].stato === "completato").length;
  const percentualeCompletamento = Math.round((stepCompletati / CHIAVI_STEP.length) * 100);

  return {
    step,
    stepCorrente,
    stepCompletati,
    stepTotali: CHIAVI_STEP.length,
    percentualeCompletamento,
    generatoAt: new Date().toISOString(),
  };
}

module.exports = { calcolaStatoWizard, CHIAVI_STEP };
