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

  const cartellaMetaQuotes = path.join(process.env.APPDATA || "", "MetaQuotes", "Terminal");
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
  for (const hash of sottocartelle) {
    const percorsoTerminal = path.join(cartellaMetaQuotes, hash);
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

    // origin.txt (se presente) contiene il percorso reale dell'eseguibile
    // MT5 collegato a questa cartella dati — utile per capire quale
    // installazione/broker corrisponde, best-effort (non tutte le versioni
    // MT5 lo scrivono).
    let percorsoEseguibile = null;
    try {
      const origin = await fs.readFile(path.join(percorsoTerminal, "origin.txt"), "utf16le");
      percorsoEseguibile = origin.trim() || null;
    } catch {
      percorsoEseguibile = null;
    }

    installazioni.push({
      cartellaDati: percorsoTerminal,
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

module.exports = { rilevaInstallazioniMt5, rilevaProcessoMt5InEsecuzione, rilevaSupportoPiattaforma };
