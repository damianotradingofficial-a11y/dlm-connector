// DLM Auto Connector — logica UI del wizard (renderer, sandboxed).
//
// Usa SOLO window.dlmConnector (esposto da preload.js) — nessun accesso
// diretto a Node/filesystem da qui. Questo file si limita a: chiamare
// statoWizard() per sapere cosa mostrare, e inoltrare i click dell'utente
// alle azioni corrispondenti (selezionaInstallazione, installaBridge,
// generaConnectionReference, apriMt5). Tutta la LOGICA di cosa è
// "completato"/"in corso"/"bloccato" vive in wizardState.js (main process),
// qui si fa solo rendering.

const CHIAVI_STEP = ["rilevamento_sistema", "rilevamento_mt5", "installazione_bridge", "configurazione_guidata", "verifica_finale"];
// Etichette ed testi cliente: UNICA fonte in copyCliente.js (window.DLM_COPY),
// caricato prima di questo script — vedi wizard.html. Nessun testo cliente
// hardcoded qui, per poter rivedere tono/lingua in un solo file.
const ETICHETTE_STEP = window.DLM_COPY.etichetteStep;
const ICONE_STATO = {
  completato: "✅",
  in_corso: "🟡",
  azione_richiesta: "⚠️",
  in_attesa: "⏳",
  non_disponibile: "•",
};

let installazioniCorrenti = [];

function el(id) {
  return document.getElementById(id);
}

async function aggiorna() {
  el("statoGenerale").textContent = "Aggiornamento…";
  try {
    const stato = await window.dlmConnector.statoWizard();
    renderTutto(stato);
    el("statoGenerale").textContent = `Ultimo aggiornamento: ${new Date(stato.wizard.generatoAt).toLocaleTimeString("it-IT")}`;
  } catch (e) {
    el("statoGenerale").textContent = `Errore: ${e.message}`;
  }
}

function renderTutto(stato) {
  renderBarraStep(stato.wizard);
  renderElencoStep(stato);
  renderAssistente(stato);
  renderLogin(stato);
  renderStep2(stato);
  renderStep3(stato);
  renderStep4(stato);
  renderStep5(stato);
  renderVersioni(stato);
}

function renderBarraStep(wizard) {
  const barra = el("barraStep");
  barra.innerHTML = "";
  for (const chiave of CHIAVI_STEP) {
    const pallino = document.createElement("div");
    pallino.className = `pallino-step ${wizard.step[chiave].stato}`;
    barra.appendChild(pallino);
  }
}

function renderElencoStep(stato) {
  const wizard = stato.wizard;
  const elenco = el("elencoStep");
  elenco.innerHTML = "";
  for (const chiave of CHIAVI_STEP) {
    const info = wizard.step[chiave];
    const riga = document.createElement("div");
    riga.className = "voce-step" + (chiave === wizard.stepCorrente ? " corrente" : "");
    const icona = document.createElement("span");
    icona.className = "icona-step";
    icona.textContent = ICONE_STATO[info.stato] || "•";
    const testo = document.createElement("span");
    const testoCliente = window.DLM_COPY.testoStep(chiave, info, { supportoPiattaforma: stato.supportoPiattaforma });
    testo.textContent = `${ETICHETTE_STEP[chiave]} — ${testoCliente}`;
    riga.appendChild(icona);
    riga.appendChild(testo);
    elenco.appendChild(riga);
  }
}

function renderAssistente(stato) {
  const card = el("cardAssistente");
  const box = el("assistenteBox");
  if (!stato.diagnosiArricchita || stato.diagnosiArricchita.riepilogo.totale === 0) {
    card.classList.add("nascosto");
    return;
  }
  card.classList.remove("nascosto");
  box.className = "assistente-box" + (stato.diagnosiArricchita.riepilogo.bloccanti > 0 ? " bloccante" : "");
  box.textContent = stato.messaggioAssistente;
}

// Fase 4 — AI Troubleshooting CONTESTUALE: oltre al riepilogo generale sopra
// (tutti i problemi insieme), ogni card di step mostra SOLO i problemi
// collegati a quello step specifico (stepChiave, da diagnostics.js), col
// messaggio breve già pronto in `messaggio` (aiTroubleshootingBase.js) — non
// ricalcolato qui, solo mostrato.
function renderNotaAssistenteStep(stato, chiaveStep, idElemento) {
  const contenitore = el(idElemento);
  const problemi = (stato.diagnosiArricchita?.problemiArricchiti || []).filter((p) => p.stepChiave === chiaveStep);
  if (problemi.length === 0) {
    contenitore.classList.add("nascosto");
    contenitore.innerHTML = "";
    return;
  }
  contenitore.classList.remove("nascosto");
  contenitore.className = "nota-assistente" + (problemi.some((p) => p.livelloSeverita === "bloccante") ? " bloccante" : "");
  contenitore.innerHTML = "";
  for (const p of problemi) {
    const riga = document.createElement("div");
    riga.style.marginBottom = "4px";
    riga.textContent = p.messaggio;
    contenitore.appendChild(riga);
  }
}

function renderLogin(stato) {
  el("cardLogin").classList.toggle("nascosto", stato.autenticato);
}

function renderStep2(stato) {
  renderNotaAssistenteStep(stato, "rilevamento_mt5", "notaAssistenteStep2");
  installazioniCorrenti = stato.locale?.installazioniMt5?.installazioni || [];
  const contenitore = el("listaInstallazioni");
  contenitore.innerHTML = "";

  if (stato.supportoPiattaforma && stato.supportoPiattaforma.rilevamentoAutomatico === false) {
    contenitore.textContent = stato.supportoPiattaforma.messaggio;
    return;
  }
  if (installazioniCorrenti.length === 0) {
    contenitore.textContent = "Nessuna installazione trovata finora. Installa MetaTrader 5 e premi \"Aggiorna stato\".";
    return;
  }
  installazioniCorrenti.forEach((ins, i) => {
    const riga = document.createElement("div");
    riga.className = "installazione-riga";
    const selezionata = stato.installazioneSelezionata && stato.installazioneSelezionata.cartellaDati === ins.cartellaDati;
    const testoCliente = window.DLM_COPY.testoInstallazione(ins);
    riga.innerHTML = `
      <span>
        ${testoCliente}${ins.bridgeEaPresente ? " · collegamento già presente" : ""}<br />
        <span class="mono" style="color:var(--dim);font-size:11px;">${ins.cartellaDati}</span>
      </span>
      <span></span>
    `;
    const btn = document.createElement("button");
    btn.className = "secondario";
    btn.textContent = selezionata ? "Selezionata ✓" : "Seleziona";
    btn.disabled = selezionata;
    btn.addEventListener("click", async () => {
      await window.dlmConnector.selezionaInstallazione(i);
      await aggiorna();
    });
    riga.lastElementChild.replaceWith(btn);
    contenitore.appendChild(riga);
  });
}

function renderStep3(stato) {
  renderNotaAssistenteStep(stato, "installazione_bridge", "notaAssistenteStep3");
  const info = stato.wizard.step.installazione_bridge;
  el("dettaglioStep3").textContent = window.DLM_COPY.testoStep("installazione_bridge", info, stato);
  const btn = el("btnInstallaBridge");
  btn.disabled = info.stato === "non_disponibile";
  btn.textContent = info.stato === "completato" ? "Reinstalla il collegamento" : "Installa il collegamento";
}

function renderStep4(stato) {
  renderNotaAssistenteStep(stato, "configurazione_guidata", "notaAssistenteStep4");
  const info = stato.wizard.step.configurazione_guidata;
  el("dettaglioStep4").textContent = window.DLM_COPY.testoStep("configurazione_guidata", info, stato);
  const lista = el("checklistStep4");
  lista.innerHTML = "";
  const voci = [
    ["MetaTrader 5 aperto", info.sottoStep?.apriMt5],
    ["Chiave di collegamento generata", info.sottoStep?.connectionReferenceGenerata],
    ["Trading Algoritmico e connessione autorizzati", info.sottoStep?.algoTradingEWebRequestOk],
  ];
  for (const [testo, ok] of voci) {
    const li = document.createElement("li");
    li.className = ok ? "ok" : "";
    li.textContent = `${ok ? "✅" : "◻"} ${testo}`;
    lista.appendChild(li);
  }

  el("btnApriMt5").disabled = info.stato === "non_disponibile";
  el("btnGeneraChiave").disabled = info.stato === "non_disponibile" || !stato.autenticato;

  const chiave = stato.remoto?.account?.connection_reference;
  el("chiaveBox").classList.toggle("nascosto", !chiave);
  if (chiave) el("chiaveTesto").textContent = chiave;
}

function renderStep5(stato) {
  renderNotaAssistenteStep(stato, "verifica_finale", "notaAssistenteStep5");
  const info = stato.wizard.step.verifica_finale;
  const lista = el("checklistStep5");
  lista.innerHTML = "";
  // Formato richiesto da Damiano: esattamente questi 4 elementi, poi il
  // banner "Il tuo account è pronto" separato — non la vecchia lista tecnica
  // a 5 voci (che mischiava "Connessione"/"Heartbeat" in modo ridondante).
  const voci = [
    ["MetaTrader 5", stato.wizard.step.rilevamento_mt5.stato === "completato"],
    ["Bridge DLM", stato.wizard.step.installazione_bridge.stato === "completato"],
    ["Configurazione", stato.wizard.step.configurazione_guidata.stato === "completato"],
    ["Connessione", Boolean(stato.remoto?.heartbeat)],
  ];
  for (const [testo, ok] of voci) {
    const li = document.createElement("li");
    li.className = ok ? "ok" : "";
    li.textContent = `${ok ? "✅" : "◻"} ${testo}`;
    lista.appendChild(li);
  }
  const pronto = info.stato === "completato";
  el("bannerPronto").classList.toggle("nascosto", !pronto);
  if (pronto) el("testoBannerPronto").textContent = window.DLM_COPY.testoStep5Pronto();
}

async function renderVersioni(stato) {
  if (!stato.installazioneSelezionata) {
    el("cardVersioni").classList.add("nascosto");
    return;
  }
  try {
    const risultato = await window.dlmConnector.versioni();
    if (!risultato.ok) return;
    const v = risultato.versioni;
    el("cardVersioni").classList.remove("nascosto");
    const div = el("dettaglioVersioni");
    div.innerHTML = "";
    const righe = [
      ["Connector", v.versioneConnector],
      ["Bridge (bundlato nel Connector)", v.versioneBundlata],
      ["Bridge (installato sul PC)", v.versioneInstallata || "—"],
      ["Bridge (in esecuzione ora, da heartbeat)", v.versioneRemotaHeartbeat || "—"],
    ];
    for (const [etichetta, valore] of righe) {
      const riga = document.createElement("div");
      riga.className = "versioni-riga";
      riga.innerHTML = `<span>${etichetta}</span><span class="mono">${valore}</span>`;
      div.appendChild(riga);
    }
    for (const azione of v.azioniRichieste) {
      const p = document.createElement("div");
      // Nota: "--warn" non esiste nella palette di questo file (era un
      // refuso, la variabile reale qui si chiama "--wait") — corretto qui,
      // nessun altro punto del file la usava.
      p.style.cssText = "margin-top:8px;font-size:12px;color:var(--wait);";
      p.textContent = azione;
      div.appendChild(p);
    }

    // Fase 4 — notifica "nuova versione Connector disponibile" (SOLO
    // notifica: nessun download/installazione automatica, come richiesto).
    const nuovaVersione = v.connector?.aggiornamento === "nuova_versione_disponibile";
    el("bannerAggiornamentoConnector").classList.toggle("nascosto", !nuovaVersione);
    if (nuovaVersione) {
      el("testoAggiornamentoConnector").textContent =
        `È disponibile DLM Connector ${v.connector.versioneDisponibile} (hai la ${v.connector.versioneInstallata}). Scarica e installa manualmente la nuova versione quando puoi.`;
    }
  } catch {
    // Silenzioso: le versioni sono un'informazione accessoria, un errore qui
    // non deve interrompere il resto del wizard.
  }
}

// --- Eventi ---

el("btnLogin").addEventListener("click", async () => {
  el("erroreLogin").classList.add("nascosto");
  el("statoLogin").textContent = "Accesso in corso…";
  const email = el("email").value.trim();
  const password = el("password").value;
  const risultato = await window.dlmConnector.login(email, password);
  el("statoLogin").textContent = "";
  if (!risultato.ok) {
    el("erroreLogin").textContent = risultato.errore || "Accesso non riuscito.";
    el("erroreLogin").classList.remove("nascosto");
    return;
  }
  el("password").value = "";
  await aggiorna();
});

el("btnInstallaBridge").addEventListener("click", async () => {
  el("statoInstallazione").textContent = "Installazione in corso…";
  const risultato = await window.dlmConnector.installaBridge();
  el("statoInstallazione").textContent = risultato.ok ? "" : `Errore: ${risultato.errore}`;
  await aggiorna();
});

el("btnApriMt5").addEventListener("click", async () => {
  el("statoApriMt5").textContent = "Apertura in corso…";
  const risultato = await window.dlmConnector.apriMt5();
  el("statoApriMt5").textContent = risultato.ok ? "MT5 avviato." : `Errore: ${risultato.errore}`;
  setTimeout(aggiorna, 3000);
});

el("btnGeneraChiave").addEventListener("click", async () => {
  el("statoChiave").textContent = "Generazione…";
  const risultato = await window.dlmConnector.generaConnectionReference();
  el("statoChiave").textContent = risultato.ok ? "" : `Errore: ${risultato.errore}`;
  await aggiorna();
});

el("btnCopiaChiave").addEventListener("click", async () => {
  await navigator.clipboard.writeText(el("chiaveTesto").textContent);
  el("btnCopiaChiave").textContent = "Copiata ✓";
  setTimeout(() => (el("btnCopiaChiave").textContent = "Copia"), 1500);
});

el("btnAggiorna").addEventListener("click", aggiorna);

// --- Step 1: schermata di benvenuto ---
// Gate puro di UI (non fa parte di wizardState.js): finché non si preme
// "Inizia" non chiamiamo statoWizard() né avviamo il polling, per non fare
// lavoro nel main process mentre l'utente guarda ancora il benvenuto.
(function inizializzaBenvenuto() {
  const copy = window.DLM_COPY.benvenuto;
  el("titoloBenvenuto").textContent = copy.titolo;
  el("testoBenvenuto").textContent = copy.testo;
  el("btnInizia").textContent = copy.pulsante;
  el("btnInizia").addEventListener("click", () => {
    el("cardBenvenuto").classList.add("nascosto");
    el("contenutoWizard").classList.remove("nascosto");
    // Primo caricamento + aggiornamento periodico (utile soprattutto in
    // attesa dell'heartbeat allo Step 5, senza dover premere "Aggiorna" a mano).
    aggiorna();
    setInterval(aggiorna, 8000);
  });
})();
