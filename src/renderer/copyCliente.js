// DLM Auto Connector — copia cliente (Fase 1, Hardening/UX Premium).
//
// UNICA fonte di verità per il testo mostrato al CLIENTE finale nel wizard.
// Separata deliberatamente dalla logica (wizardState.js, diagnostics.js,
// installBridge.js, aiTroubleshootingBase.js, tutti nel main process) e
// dai loro codici tecnici interni, che restano nei log e nella "vista
// diagnostica avanzata" (index.html) — mai duplicata qui, solo tradotta.
//
// File di RENDERER puro (nessun require, nessun Node): caricato come script
// normale in wizard.html, PRIMA di wizard.js. Attacca le funzioni su
// `window.DLM_COPY` invece di usare module.exports, perché il renderer gira
// con nodeIntegration:false/contextIsolation:true (niente CommonJS qui).
//
// Se domani cambia il tono di voce o la terminologia DLM, questo è l'UNICO
// file da rivedere per il linguaggio cliente — nessun altro file va toccato
// per un cambio di copy.
(function () {
  const ETICHETTE_STEP = {
    rilevamento_sistema: "Sistema",
    rilevamento_mt5: "MetaTrader 5",
    installazione_bridge: "Collegamento DLM",
    configurazione_guidata: "Attivazione",
    verifica_finale: "Verifica",
  };

  function testoStepRilevamentoSistema(supportoPiattaforma) {
    if (!supportoPiattaforma) return "Verifica del sistema in corso…";
    if (supportoPiattaforma.livelloSupporto === "completo") {
      return "Sistema riconosciuto: siamo pronti a cercare MetaTrader 5.";
    }
    if (supportoPiattaforma.livelloSupporto === "diagnostica_remota_solo") {
      return "Sei su Mac: puoi accedere e controllare lo stato del tuo collegamento — la ricerca automatica di MetaTrader 5 su Mac arriverà in una fase successiva.";
    }
    return "Il tuo sistema non è ancora stato testato nel dettaglio, ma puoi comunque accedere e controllare il tuo collegamento.";
  }

  // Euristica "best effort": prova a leggere un nome broker leggibile dal
  // percorso dell'eseguibile MT5 (es. "C:\...\ICMarkets MT5\terminal64.exe"
  // -> "ICMarkets"). MAI un dato certo — se non riesce a estrarre nulla di
  // distinguibile da "MetaTrader 5" generico, restituisce null e la UI
  // mostra semplicemente "MetaTrader 5" senza inventare un broker.
  function estraiNomeBrokerDaPercorso(percorsoEseguibile) {
    if (!percorsoEseguibile) return null;
    const normalizzato = percorsoEseguibile.replace(/\\/g, "/");
    const parti = normalizzato.split("/").filter(Boolean);
    const cartella = parti[parti.length - 2];
    if (!cartella) return null;
    const pulito = cartella
      .replace(/metatrader\s*5/gi, "")
      .replace(/\bmt5\b/gi, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (!pulito || pulito.length < 2) return null;
    return pulito;
  }

  function testoInstallazione(installazione) {
    const broker = estraiNomeBrokerDaPercorso(installazione.percorsoEseguibile);
    return broker ? `MetaTrader 5 — ${broker}` : "MetaTrader 5";
  }

  function testoStepRilevamentoMt5(stepInfo, supportoPiattaforma) {
    if (supportoPiattaforma && supportoPiattaforma.rilevamentoAutomatico === false) {
      return supportoPiattaforma.messaggio;
    }
    switch (stepInfo.stato) {
      case "in_attesa":
        return "Premi \"Aggiorna stato\" per cercare MetaTrader 5 sul tuo computer.";
      case "azione_richiesta":
        return "Non abbiamo ancora trovato MetaTrader 5. Installalo dal sito del tuo broker, poi torna qui.";
      case "completato": {
        const n = (stepInfo.installazioni || []).length;
        return n === 1
          ? "Abbiamo trovato MetaTrader 5: siamo pronti a configurare il collegamento."
          : `Abbiamo trovato ${n} installazioni di MetaTrader 5 — scegli quella da collegare a DLM.`;
      }
      default:
        return "";
    }
  }

  function testoStepInstallazioneBridge(stepInfo) {
    switch (stepInfo.stato) {
      case "non_disponibile":
        return "Prima troviamo MetaTrader 5.";
      case "in_attesa":
        return "Tutto pronto per installare il collegamento DLM.";
      case "completato":
        return "Il collegamento DLM è installato e pronto.";
      case "azione_richiesta":
        return "Il collegamento DLM ha bisogno di un piccolo intervento — trovi i dettagli qui sotto.";
      default:
        return "";
    }
  }

  function testoStepConfigurazione(stepInfo) {
    switch (stepInfo.stato) {
      case "non_disponibile":
        return "Prima installa il collegamento DLM.";
      case "in_corso":
        return "Segui i passaggi qui sotto per completare l'attivazione.";
      case "completato":
        return "Tutto attivo: MetaTrader 5 è collegato a DLM.";
      default:
        return "";
    }
  }

  function testoStepVerificaFinale(stepInfo) {
    switch (stepInfo.stato) {
      case "non_disponibile":
        return "Completa prima l'attivazione.";
      case "in_corso":
        return "In attesa del primo segnale dal tuo collegamento — di solito bastano pochi secondi.";
      case "completato":
        return "Il tuo conto è pronto: MetaTrader 5 è collegato a DLM.";
      default:
        return "";
    }
  }

  function testoStep5Pronto() {
    return "Il tuo account è pronto";
  }

  function testoStep(chiaveStep, stepInfo, contesto) {
    switch (chiaveStep) {
      case "rilevamento_sistema":
        return testoStepRilevamentoSistema(contesto.supportoPiattaforma);
      case "rilevamento_mt5":
        return testoStepRilevamentoMt5(stepInfo, contesto.supportoPiattaforma);
      case "installazione_bridge":
        return testoStepInstallazioneBridge(stepInfo);
      case "configurazione_guidata":
        return testoStepConfigurazione(stepInfo);
      case "verifica_finale":
        return testoStepVerificaFinale(stepInfo);
      default:
        return stepInfo.dettaglio || "";
    }
  }

  window.DLM_COPY = {
    marchio: { nome: "DLM Auto Connector", payoff: "Colleghiamo il tuo MetaTrader 5 a DLM, passo dopo passo." },
    // Step 1 — schermata di benvenuto (Fase 2). Testo unico richiesto da
    // Damiano: niente linguaggio tecnico, spiegazione semplice, un solo
    // pulsante d'azione.
    benvenuto: {
      titolo: "Configuriamo il tuo collegamento DLM in pochi minuti",
      testo: "Ti guidiamo passo dopo passo per collegare il tuo MetaTrader 5 a DLM: nessuna competenza tecnica richiesta.",
      pulsante: "Inizia",
    },
    etichetteStep: ETICHETTE_STEP,
    testoStep,
    testoStep5Pronto,
    testoInstallazione,
    estraiNomeBrokerDaPercorso,
  };
})();
