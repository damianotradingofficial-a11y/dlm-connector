// DLM Auto Connector — rilevamento locale MT5 (Blocco 1: SOLA LETTURA).
//
// Windows è la piattaforma target confermata per la v1 (vedi
// AURORA_AI_DLM_AUTO_CONNECTOR_FATTIBILITA.md — MT5 su Mac gira sempre
// dentro un wrapper Wine, percorsi non standard, fase separata). Su
// piattaforme diverse da Windows queste funzioni restituiscono un risultato
// onesto ("non supportato in questa fase"), non un errore e non un falso
// positivo — così l'app resta utilizzabile (es. per test della UI) anche
// sul Mac di sviluppo, senza fingere di aver trovato qualcosa che non c'è.
//
// Nessuna scrittura, nessuna modifica di file: solo lettura di cartelle e
// interrogazione dei processi in esecuzione.
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const NOME_FILE_EA = ["DLM_Bridge_EA.ex5", "DLM_Bridge_EA.mq5"];

/** Vero solo per le cartelle dati di un terminale (32 cifre esadecimali). */
function cartellaDatiValida(nome) {
  return /^[0-9A-Fa-f]{32}$/.test(String(nome || ""));
}

/**
 * origin.txt contiene la cartella di installazione di MetaTrader. Per
 * prudenza accetta anche il percorso completo di terminal64.exe.
 */
function cartellaInstallazioneDaOrigin(contenuto) {
  const pulito = String(contenuto || "").replace(/^\uFEFF/, "").replace(/\0/g, "").trim().replace(/[\\/]+$/, "");
  if (!pulito) return null;
  return /\.exe$/i.test(pulito) ? pulito.replace(/[\\/][^\\/]+$/, "") : pulito;
}

async function esiste(percorso) {
  try {
    await fs.access(percorso);
    return true;
  } catch {
    return false;
  }
}

/**
 * Enumera le installazioni MT5 trovate su Windows, cercando in
 * %APPDATA%\MetaQuotes\Terminal\<hash> (una cartella per ogni
 * installazione/broker). Per ciascuna verifica se esiste MQL5\Experts e se
 * il Bridge EA DLM è già presente lì.
 */
async function rilevaInstallazioniMt5() {
  if (process.platform !== "win32") {
    return {
      supportato: false,
      motivo: "Rilevamento automatico disponibile solo su Windows in questa fase (vedi piano DLM Auto Connector).",
      installazioni: [],
    };
  }

  return enumeraInstallazioni(path.join(process.env.APPDATA || "", "MetaQuotes", "Terminal"));
}

/**
 * Elenca i terminali MetaTrader 5 realmente utilizzabili dentro la cartella
 * MetaQuotes\Terminal indicata. Separata dal controllo della piattaforma per
 * poterla provare su una cartella finta.
 */
async function enumeraInstallazioni(cartellaMetaQuotes) {
  let sottocartelle = [];
  try {
    const voci = await fs.readdir(cartellaMetaQuotes, { withFileTypes: true });
    sottocartelle = voci.filter((v) => v.isDirectory()).map((v) => v.name);
  } catch (e) {
    // Cartella non trovata: MT5 probabilmente non è mai stato installato per
    // l'utente corrente — non è un errore applicativo, è un esito valido.
    return { supportato: true, installazioni: [], erroreLettura: e.code === "ENOENT" ? null : e.message };
  }

  const installazioni = [];
  for (const nome of sottocartelle) {
    // Solo le cartelle dati vere: MetaTrader le chiama con 32 cifre
    // esadecimali. "Common", "Community", "Help" sono cartelle di servizio,
    // non installazioni.
    if (!cartellaDatiValida(nome)) continue;
    const percorsoTerminal = path.join(cartellaMetaQuotes, nome);
    const percorsoExperts = path.join(percorsoTerminal, "MQL5", "Experts");

    let expertsEsiste = false;
    let fileEaTrovati = [];
    try {
      const fileExperts = await fs.readdir(percorsoExperts);
      expertsEsiste = true;
      fileEaTrovati = fileExperts.filter((f) => NOME_FILE_EA.includes(f));
    } catch {
      expertsEsiste = false;
    }
    // Senza MQL5\Experts non è un MetaTrader 5 utilizzabile (mai avviato,
    // oppure cartella di un MetaTrader 4).
    if (!expertsEsiste) continue;

    // origin.txt contiene la CARTELLA in cui MetaTrader è installato (non il
    // file del programma). Da lì si ricavano il programma e il compilatore.
    let contenutoOrigin = null;
    try {
      contenutoOrigin = await fs.readFile(path.join(percorsoTerminal, "origin.txt"), "utf16le");
    } catch {
      contenutoOrigin = null;
    }
    const cartellaInstallazione = cartellaInstallazioneDaOrigin(contenutoOrigin);
    const percorsoEseguibile = cartellaInstallazione ? path.join(cartellaInstallazione, "terminal64.exe") : null;
    // Un terminale disinstallato lascia la cartella dati: non va proposto.
    if (!percorsoEseguibile || !(await esiste(percorsoEseguibile))) continue;

    installazioni.push({
      cartellaDati: percorsoTerminal,
      cartellaInstallazione,
      percorsoEseguibile,
      mql5ExpertsTrovata: expertsEsiste,
      bridgeEaPresente: fileEaTrovati.length > 0,
      fileEaTrovati,
    });
  }

  return { supportato: true, installazioni };
}

/**
 * Verifica se il terminale MT5 (terminal64.exe) risulta in esecuzione,
 * tramite `tasklist` (comando nativo Windows, sola lettura dei processi —
 * nessuna azione sul sistema).
 */
async function rilevaProcessoMt5InEsecuzione() {
  if (process.platform !== "win32") {
    return { supportato: false, inEsecuzione: null };
  }
  try {
    const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq terminal64.exe", "/FO", "CSV"]);
    const inEsecuzione = stdout.toLowerCase().includes("terminal64.exe");
    return { supportato: true, inEsecuzione };
  } catch (e) {
    return { supportato: true, inEsecuzione: false, erroreLettura: e.message };
  }
}

/**
 * Livello di supporto della piattaforma corrente — usato dal wizard (Blocco
 * 3) per mostrare un messaggio onesto e specifico invece di un generico
 * "non supportato". Non elimina il Mac dal Connector (richiesta esplicita
 * di Damiano): su macOS il rilevamento/installazione automatica non sono
 * disponibili in questa fase (MT5 gira sempre dentro Wine, percorsi non
 * standard — vedi AURORA_AI_DLM_AUTO_CONNECTOR_FATTIBILITA.md), ma login,
 * lettura stato remoto/heartbeat e diagnostica restano pienamente
 * utilizzabili: un cliente Mac può comunque vedere lo stato del proprio
 * collegamento, solo non tramite rilevamento/installazione locale automatica.
 */
function rilevaSupportoPiattaforma() {
  if (process.platform === "win32") {
    return {
      piattaforma: "win32",
      livelloSupporto: "completo",
      rilevamentoAutomatico: true,
      installazioneAutomatica: true,
      messaggio: "Windows: rilevamento e installazione automatica del Bridge disponibili.",
    };
  }
  if (process.platform === "darwin") {
    return {
      piattaforma: "darwin",
      livelloSupporto: "diagnostica_remota_solo",
      rilevamentoAutomatico: false,
      installazioneAutomatica: false,
      messaggio:
        "macOS: il rilevamento e l'installazione automatica del Bridge non sono ancora disponibili (MetaTrader 5 su Mac gira dentro Wine, con percorsi non standard). Puoi comunque accedere e vedere lo stato del tuo collegamento (connessione, heartbeat) — l'installazione guidata locale arriverà in una fase futura dedicata.",
    };
  }
  return {
    piattaforma: process.platform,
    livelloSupporto: "non_testato",
    rilevamentoAutomatico: false,
    installazioneAutomatica: false,
    messaggio: `Sistema operativo "${process.platform}" non ancora testato con DLM Auto Connector. Puoi comunque accedere e vedere lo stato del tuo collegamento.`,
  };
}

module.exports = {
  rilevaInstallazioniMt5,
  enumeraInstallazioni,
  rilevaProcessoMt5InEsecuzione,
  rilevaSupportoPiattaforma,
  cartellaDatiValida,
  cartellaInstallazioneDaOrigin,
};
