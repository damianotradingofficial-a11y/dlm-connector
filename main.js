// DLM Auto Connector — processo principale Electron.
//
// Blocco 1 (Rilevamento + Diagnostica) + Blocco 2 (Installazione Assistita)
// + Blocco 3 (Wizard) + Blocco 4 (base AI Troubleshooting), tutti nello
// stesso main.js: resta comunque un singolo ponte sicuro (ipcMain.handle)
// tra la UI (renderer, sandboxed, nessun accesso diretto a Node) e i moduli
// che leggono/scrivono il filesystem locale o parlano con Supabase.
//
// NESSUNA modifica al motore DLM, al Trading/Risk/Execution Engine né al
// Bridge EA canonico (mt5-bridge/DLM_Bridge_EA.mq5, invariato, fuori da
// questo progetto — questo file ne distribuisce solo una copia via
// installBridge.js). Le uniche scritture sul PC del cliente restano quelle
// esplicitamente elencate nel piano Blocco 2 (allowlist in installBridge.js).
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { execFile } = require("child_process");

const { rilevaInstallazioniMt5, rilevaProcessoMt5InEsecuzione, rilevaSupportoPiattaforma } = require("./src/lib/detectMt5");
const { accediCliente, leggiStatoRemoto, generaConnectionReference } = require("./src/lib/supabaseClient");
const { calcolaDiagnosi } = require("./src/lib/diagnostics");
const { installaBridge } = require("./src/lib/installBridge");
const { calcolaStatoWizard } = require("./src/lib/wizardState");
const { analizzaVersioni } = require("./src/lib/versionManager");
const { arricchisciDiagnosi, formattaMessaggioAssistente } = require("./src/lib/aiTroubleshootingBase");

let finestraPrincipale = null;
let autenticato = false; // flag locale — la sessione vera vive nel client Supabase singleton

// Stato del wizard che vive SOLO in memoria di questo processo (mai
// persistito su disco, mai inviato a Supabase se non tramite le funzioni già
// previste): quale installazione MT5 l'utente ha scelto (se più di una) e
// l'ultimo report di installazione ottenuto, così statoWizard() può
// ricalcolare lo stato completo senza dover reinstallare ogni volta.
let installazioneSelezionata = null;
let ultimoReportInstallazione = null;

function creaFinestra() {
  finestraPrincipale = new BrowserWindow({
    width: 960,
    height: 760,
    title: "DLM Auto Connector",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Il wizard (Blocco 3) è ora la schermata principale — la vista
  // diagnostica "grezza" del Blocco 1 resta raggiungibile da un link dentro
  // wizard.html, non è stata rimossa.
  finestraPrincipale.loadFile(path.join(__dirname, "src", "renderer", "wizard.html"));
}

app.whenReady().then(creaFinestra);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) creaFinestra();
});

// --- IPC: login/logout (Blocco 1, invariato) ---
ipcMain.handle("dlm:login", async (_evt, { email, password }) => {
  try {
    const { session, error } = await accediCliente(email, password);
    if (error) return { ok: false, errore: error };
    autenticato = true;
    return { ok: true, email: session.user.email };
  } catch (e) {
    return { ok: false, errore: e.message };
  }
});

ipcMain.handle("dlm:logout", async () => {
  autenticato = false;
  return { ok: true };
});

// --- IPC: rilevamento locale grezzo (Blocco 1, invariato — usato dalla vista diagnostica) ---
ipcMain.handle("dlm:analizza", async () => {
  const locale = {
    piattaforma: process.platform,
    installazioniMt5: await rilevaInstallazioniMt5(),
    processoMt5Attivo: await rilevaProcessoMt5InEsecuzione(),
  };

  let remoto = null;
  let erroreRemoto = null;
  if (autenticato) {
    try {
      remoto = await leggiStatoRemoto();
    } catch (e) {
      erroreRemoto = e.message;
    }
  }

  const diagnosi = calcolaDiagnosi({ locale, remoto });
  return { autenticato, locale, remoto, erroreRemoto, diagnosi };
});

// --- IPC: selezione dell'installazione MT5 target (Blocco 2/3) ---
// Mai scelta automaticamente se ce n'è più di una (vedi piano Blocco 2) —
// l'utente sceglie esplicitamente dalla lista mostrata nello Step 2.
ipcMain.handle("dlm:selezionaInstallazione", async (_evt, { indice }) => {
  const info = await rilevaInstallazioniMt5();
  const scelta = info.installazioni?.[indice];
  if (!scelta) return { ok: false, errore: "Indice installazione non valido." };
  installazioneSelezionata = scelta;
  // Cambiando installazione, l'eventuale report di una installazione
  // precedente non ha più senso: azzerato per evitare di mostrare uno stato
  // "installato" riferito alla cartella sbagliata.
  ultimoReportInstallazione = null;
  return { ok: true, installazione: scelta };
});

// --- IPC: installazione Bridge (Blocco 2) ---
ipcMain.handle("dlm:installaBridge", async () => {
  if (!installazioneSelezionata) {
    return { ok: false, errore: "Nessuna installazione MT5 selezionata (Step 2 non completato)." };
  }
  try {
    const report = await installaBridge(installazioneSelezionata);
    ultimoReportInstallazione = report;
    return { ok: true, report };
  } catch (e) {
    return { ok: false, errore: e.message };
  }
});

// --- IPC: generazione connection reference (Blocco 2/3) ---
ipcMain.handle("dlm:generaConnectionReference", async () => {
  try {
    const risultato = await generaConnectionReference();
    return { ok: true, ...risultato };
  } catch (e) {
    return { ok: false, errore: e.message };
  }
});

// --- IPC: apertura di MT5 (Step 3 del wizard, Blocco 3) ---
// Lancia SOLO l'eseguibile già rilevato (nessuna azione sull'account, nessun
// login automatico: MT5 si apre come farebbe un doppio click manuale).
ipcMain.handle("dlm:apriMt5", async () => {
  const percorso = installazioneSelezionata?.percorsoEseguibile;
  if (!percorso) {
    return { ok: false, errore: "Percorso di MetaTrader 5 non disponibile per l'installazione selezionata." };
  }
  try {
    execFile(percorso, [], { detached: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, errore: e.message };
  }
});

// --- IPC: gestione versioni (Blocco 2 estensione — Version Manager) ---
ipcMain.handle("dlm:versioni", async () => {
  let remoto = null;
  if (autenticato) {
    try {
      remoto = await leggiStatoRemoto();
    } catch {
      remoto = null;
    }
  }
  const versioni = await analizzaVersioni({
    cartellaDati: installazioneSelezionata?.cartellaDati || null,
    versioneRemotaHeartbeat: remoto?.heartbeat?.versione_ea || null,
  });
  return { ok: true, versioni };
});

// --- IPC: stato completo del wizard (Blocco 3), con AI Troubleshooting base (Blocco 4) ---
ipcMain.handle("dlm:statoWizard", async () => {
  const supportoPiattaforma = rilevaSupportoPiattaforma();

  const locale = {
    piattaforma: process.platform,
    installazioniMt5: await rilevaInstallazioniMt5(),
    processoMt5Attivo: await rilevaProcessoMt5InEsecuzione(),
  };

  let remoto = null;
  let erroreRemoto = null;
  if (autenticato) {
    try {
      remoto = await leggiStatoRemoto();
    } catch (e) {
      erroreRemoto = e.message;
    }
  }

  const wizard = calcolaStatoWizard({
    supportoPiattaforma,
    locale,
    remoto,
    installazioneReport: ultimoReportInstallazione,
  });

  const diagnosi = calcolaDiagnosi({ locale, remoto });
  const diagnosiArricchita = arricchisciDiagnosi(diagnosi);
  const messaggioAssistente = formattaMessaggioAssistente(diagnosiArricchita);

  return {
    autenticato,
    supportoPiattaforma,
    locale,
    remoto,
    erroreRemoto,
    installazioneSelezionata,
    wizard,
    diagnosi,
    diagnosiArricchita,
    messaggioAssistente,
  };
});
