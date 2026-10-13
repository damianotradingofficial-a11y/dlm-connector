// DLM Auto Connector — Blocco 2: installazione guidata del Bridge (SOLA
// SCRITTURA CONTROLLATA, allowlist esplicito).
//
// Responsabilità di questo file, e SOLO queste: backup dell'eventuale Bridge
// già presente, copia del sorgente .mq5 bundlato (resources/DLM_Bridge_EA.mq5,
// copia di mt5-bridge/DLM_Bridge_EA.mq5 — se il Bridge canonico viene
// aggiornato, questa copia va risincronizzata a mano, vedi
// AURORA_AI_DLM_AUTO_CONNECTOR_BLOCCO2_PIANO.md §2 "rischio di allineamento"),
// tentativo di compilazione via MetaEditor da riga di comando, verifica REALE
// (mai assunta) della creazione del .ex5, lettura della versione dal sorgente.
//
// NESSUNA UI in questo file (richiesto esplicitamente da Damiano: prima
// testare la logica isolata). NESSUN accesso a password broker, file
// account o configurazioni sensibili — l'unica interazione col filesystem
// MT5 è scrivere i 2 file elencati sotto (o i loro backup), mai altro.
//
// SICUREZZA (allowlist per costruzione, non per disciplina): ogni scrittura
// passa da scriviFileConsentito(), che rifiuta qualunque percorso non sia
// ESATTAMENTE dentro la cartella MQL5\Experts rilevata e non abbia uno dei
// nomi consentiti (i 2 file del Bridge o un loro backup con suffisso data).
// Se in futuro un bug altrove nel codice provasse a scrivere altrove, questa
// funzione lo blocca comunque.
const fs = require("fs/promises");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const NOME_MQ5 = "DLM_Bridge_EA.mq5";
const NOME_EX5 = "DLM_Bridge_EA.ex5";
const PATTERN_BACKUP = /^DLM_Bridge_EA\.(mq5|ex5)\.backup-[0-9TZ-]+$/;

const PERCORSO_SORGENTE_BUNDLATO = path.join(__dirname, "..", "..", "resources", NOME_MQ5);

/**
 * Vero SOLO se percorsoAssoluto è direttamente dentro cartellaExperts (nessun
 * attraversamento di sottocartelle, nessun "..") e il nome file è uno dei 2
 * file del Bridge oppure un loro backup con suffisso data riconoscibile.
 * Questa è l'unica porta di scrittura permessa in tutto il modulo.
 */
function percorsoConsentito(percorsoAssoluto, cartellaExperts) {
  const dir = path.resolve(path.dirname(percorsoAssoluto));
  const expertsRisolta = path.resolve(cartellaExperts);
  if (dir !== expertsRisolta) return false;
  const base = path.basename(percorsoAssoluto);
  return base === NOME_MQ5 || base === NOME_EX5 || PATTERN_BACKUP.test(base);
}

async function scriviFileConsentito(percorsoOrigine, percorsoDestinazione, cartellaExperts) {
  if (!percorsoConsentito(percorsoDestinazione, cartellaExperts)) {
    throw new Error(
      `Scrittura rifiutata: "${percorsoDestinazione}" non è un percorso consentito (solo ${NOME_MQ5}/${NOME_EX5} o loro backup, dentro ${cartellaExperts}).`
    );
  }
  await fs.copyFile(percorsoOrigine, percorsoDestinazione);
}

function suffissoBackup() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function fileEsiste(percorso) {
  try {
    await fs.access(percorso);
    return true;
  } catch {
    return false;
  }
}

async function mtimeSeEsiste(percorso) {
  try {
    const stat = await fs.stat(percorso);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

/** Estrae EA_VERSIONE dal sorgente .mq5 (es. `#define EA_VERSIONE "1.3.0"`). */
async function leggiVersioneSorgente(percorsoMq5) {
  try {
    const contenuto = await fs.readFile(percorsoMq5, "utf8");
    const match = contenuto.match(/#define\s+EA_VERSIONE\s+"([\d.]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Backup dell'eventuale file già presente in cartellaExperts/nomeFile, PRIMA
 * di qualunque sovrascrittura. Mai una cancellazione: se il file non esiste,
 * non fa nulla e ritorna null (nessun backup necessario).
 */
async function backupSeEsiste(cartellaExperts, nomeFile) {
  const percorso = path.join(cartellaExperts, nomeFile);
  if (!(await fileEsiste(percorso))) return null;
  const percorsoBackup = path.join(cartellaExperts, `${nomeFile}.backup-${suffissoBackup()}`);
  await scriviFileConsentito(percorso, percorsoBackup, cartellaExperts);
  return percorsoBackup;
}

/**
 * Cerca metaeditor64.exe nella cartella in cui MetaTrader è installato.
 * Accetta l'installazione rilevata (cartellaInstallazione / percorsoEseguibile)
 * oppure, per compatibilità, un percorso: sia la cartella sia terminal64.exe.
 * Solo verifica di esistenza — nessuna scrittura in questa cartella.
 * Ritorna sempre dove ha cercato, così un esito negativo si può spiegare.
 */
async function cercaMetaEditor(installazioneOPercorso) {
  const ins = typeof installazioneOPercorso === "string" ? { percorsoEseguibile: installazioneOPercorso } : installazioneOPercorso || {};
  const cartelle = [];
  const aggiungi = (c) => {
    if (c && !cartelle.includes(c)) cartelle.push(c);
  };
  aggiungi(ins.cartellaInstallazione);
  if (ins.percorsoEseguibile) {
    // Se è il file del programma si guarda accanto; se è una cartella, dentro.
    aggiungi(/\.exe$/i.test(ins.percorsoEseguibile) ? path.dirname(ins.percorsoEseguibile) : ins.percorsoEseguibile);
  }
  const cercatoIn = cartelle.map((c) => path.join(c, "metaeditor64.exe"));
  for (const candidato of cercatoIn) {
    if (await fileEsiste(candidato)) return { percorso: candidato, cercatoIn };
  }
  return { percorso: null, cercatoIn };
}

async function trovaMetaEditor(installazioneOPercorso) {
  return (await cercaMetaEditor(installazioneOPercorso)).percorso;
}

/**
 * Legge il registro scritto da MetaEditor (UTF-16) e ne ricava l'esito:
 * numero di errori e di avvisi e le righe di errore, così come le scrive
 * il compilatore. Se il registro manca o non è leggibile ritorna null.
 */
async function leggiEsitoCompilazione(percorsoLog) {
  let testo;
  try {
    const grezzo = await fs.readFile(percorsoLog);
    testo = grezzo.length >= 2 && grezzo[0] === 0xff && grezzo[1] === 0xfe ? grezzo.toString("utf16le") : grezzo.includes(0) ? grezzo.toString("utf16le") : grezzo.toString("utf8");
  } catch {
    return null;
  }
  return interpretaRegistroCompilazione(testo);
}

function interpretaRegistroCompilazione(testo) {
  const righe = String(testo || "").replace(/^\uFEFF/, "").split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  let errori = null;
  let avvisi = null;
  for (const r of righe) {
    const m = r.match(/(\d+)\s+errors?,\s*(\d+)\s+warnings?/i);
    if (m) {
      errori = Number(m[1]);
      avvisi = Number(m[2]);
    }
  }
  const righeErrore = righe.filter((r) => /:\s*error\s/i.test(r)).slice(0, 5);
  return { errori, avvisi, righeErrore };
}

async function improntaFile(percorso) {
  try {
    return crypto.createHash("sha256").update(await fs.readFile(percorso)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Stato REALE del collegamento per una installazione, letto dal disco in quel
 * momento (sola lettura). Nessun ricordo di installazioni passate: serve a
 * sapere, anche dopo un riavvio del Connector o del computer, se il
 * collegamento c'è davvero ed è quello di questa versione.
 *
 *  - "installato"      MetaTrader presente, EA di questa versione nella cartella
 *                       giusta, identica a quella inclusa, file compilato presente
 *                       e non più vecchio della EA;
 *  - "non_installato"  nessun file del collegamento;
 *  - "da_riparare"     qualcosa manca o non corrisponde (con i motivi).
 */
async function verificaStatoInstallazione(installazione, percorsoSorgente = PERCORSO_SORGENTE_BUNDLATO) {
  const { cartellaDati, percorsoEseguibile } = installazione || {};
  const versioneAttesa = await leggiVersioneSorgente(percorsoSorgente);
  const base = { stato: "non_installato", motivi: [], versioneAttesa, versioneInstallata: null, cartellaExperts: null };
  if (!cartellaDati) return { ...base, stato: "da_riparare", motivi: ["Installazione di MetaTrader 5 non indicata."] };

  const cartellaExperts = path.join(cartellaDati, "MQL5", "Experts");
  const mq5 = path.join(cartellaExperts, NOME_MQ5);
  const ex5 = path.join(cartellaExperts, NOME_EX5);
  const motivi = [];

  if (!(await fileEsiste(cartellaExperts))) motivi.push(`La cartella di MetaTrader 5 non c'è più: ${cartellaExperts}.`);
  if (percorsoEseguibile && !(await fileEsiste(percorsoEseguibile))) motivi.push(`MetaTrader 5 non risulta più installato in ${path.dirname(percorsoEseguibile)}.`);

  const mq5Presente = await fileEsiste(mq5);
  const mtimeEx5 = await mtimeSeEsiste(ex5);
  const mtimeMq5 = await mtimeSeEsiste(mq5);
  const versioneInstallata = mq5Presente ? await leggiVersioneSorgente(mq5) : null;

  if (!mq5Presente && mtimeEx5 == null && motivi.length === 0) {
    return { ...base, cartellaExperts };
  }
  if (!mq5Presente) {
    motivi.push(`Manca il file del collegamento (${NOME_MQ5}).`);
  } else if (versioneInstallata !== versioneAttesa) {
    motivi.push(`La versione installata è la ${versioneInstallata || "sconosciuta"}, questa versione del Connector installa la ${versioneAttesa}.`);
  } else if ((await improntaFile(mq5)) !== (await improntaFile(percorsoSorgente))) {
    motivi.push(`Il file del collegamento (${NOME_MQ5}) è diverso da quello incluso nel Connector.`);
  }
  if (mtimeEx5 == null) {
    motivi.push(`Manca il file compilato (${NOME_EX5}).`);
  } else if (mtimeMq5 != null && mtimeEx5 < mtimeMq5) {
    motivi.push(`Il file compilato (${NOME_EX5}) è più vecchio del collegamento: non è stato ricompilato.`);
  }

  return {
    stato: motivi.length === 0 ? "installato" : "da_riparare",
    motivi,
    versioneAttesa,
    versioneInstallata,
    cartellaExperts,
  };
}

/**
 * Installa (con backup obbligatorio) il Bridge nella cartella Experts
 * dell'installazione MT5 indicata, tenta la compilazione, verifica
 * REALMENTE la creazione del .ex5 (mai assunta dal solo esito del comando).
 *
 * @param {{ cartellaDati: string, percorsoEseguibile: string|null }} installazione
 *   Oggetto restituito da detectMt5.js per l'installazione MT5 scelta
 *   dall'utente (mai scelta automaticamente se ce n'è più di una).
 * @returns {Promise<object>} report installazione, vedi generaReportInstallazione.
 */
async function installaBridge(installazione) {
  const { cartellaDati } = installazione || {};
  if (!cartellaDati) {
    throw new Error("installaBridge richiede installazione.cartellaDati (percorso della cartella dati MT5 scelta).");
  }

  const cartellaExperts = path.join(cartellaDati, "MQL5", "Experts");
  if (!(await fileEsiste(cartellaExperts))) {
    throw new Error(`Cartella Experts non trovata: ${cartellaExperts}. Verifica che MT5 sia stato avviato almeno una volta.`);
  }

  const destMq5 = path.join(cartellaExperts, NOME_MQ5);
  const destEx5 = path.join(cartellaExperts, NOME_EX5);

  // 1) BACKUP OBBLIGATORIO — sempre prima di qualunque scrittura, sia per il
  //    .mq5 sia per l'eventuale .ex5 già presente.
  const backupMq5 = await backupSeEsiste(cartellaExperts, NOME_MQ5);
  const backupEx5 = await backupSeEsiste(cartellaExperts, NOME_EX5);

  // 2) COPIA del sorgente bundlato.
  await scriviFileConsentito(PERCORSO_SORGENTE_BUNDLATO, destMq5, cartellaExperts);
  const versioneInstallata = await leggiVersioneSorgente(destMq5);

  // 3) COMPILAZIONE — con il MetaEditor della stessa installazione scelta.
  const ricerca = await cercaMetaEditor(installazione);
  const percorsoMetaEditor = ricerca.percorso;
  const mtimeEx5PrimaDelTentativo = await mtimeSeEsiste(destEx5);
  let esitoCompilazione = { tentata: false, eseguito: false, erroreEsecuzione: null, errori: null, avvisi: null, righeErrore: [] };

  if (percorsoMetaEditor) {
    // Il registro va in una cartella temporanea: in MQL5\Experts il Connector
    // scrive soltanto i due file del collegamento e i loro salvataggi.
    const percorsoLog = path.join(os.tmpdir(), `dlm_bridge_compile_${Date.now()}.log`);
    let erroreEsecuzione = null;
    try {
      // MetaEditor vuole i percorsi tra virgolette dopo i due punti; il suo
      // codice di uscita non indica l'esito (esce con 1 anche quando riesce).
      await execFileAsync(percorsoMetaEditor, [`/compile:"${destMq5}"`, `/log:"${percorsoLog}"`], {
        timeout: 90000,
        // Riga di comando esatta, come da documentazione di MetaEditor:
        // "…\metaeditor64.exe" /compile:"…" /log:"…"
        argv0: `"${percorsoMetaEditor}"`,
        windowsVerbatimArguments: true,
        windowsHide: true,
      });
    } catch (e) {
      if (e.killed || e.code === "ENOENT" || e.code === "EACCES" || e.code === "EPERM") erroreEsecuzione = e.message;
    }
    const letto = await leggiEsitoCompilazione(percorsoLog);
    await fs.unlink(percorsoLog).catch(() => {});
    esitoCompilazione = {
      tentata: true,
      eseguito: true,
      erroreEsecuzione,
      errori: letto ? letto.errori : null,
      avvisi: letto ? letto.avvisi : null,
      righeErrore: letto ? letto.righeErrore : [],
    };
  }

  // 4) VERIFICA REALE — mai assunta. Il .ex5 è considerato "compilato ora"
  //    SOLO se esiste, la sua data è cambiata rispetto a prima del tentativo
  //    e il compilatore non ha segnalato errori.
  const mtimeEx5DopoIlTentativo = await mtimeSeEsiste(destEx5);
  const compilazioneRiuscita =
    esitoCompilazione.tentata &&
    mtimeEx5DopoIlTentativo != null &&
    mtimeEx5DopoIlTentativo !== mtimeEx5PrimaDelTentativo &&
    !(esitoCompilazione.errori > 0);

  return generaReportInstallazione({
    cartellaExperts,
    percorsoMetaEditorTrovato: percorsoMetaEditor,
    metaEditorCercatoIn: ricerca.cercatoIn,
    backupMq5,
    backupEx5,
    versioneInstallata,
    esitoCompilazione,
    compilazioneRiuscita,
    ex5Presente: mtimeEx5DopoIlTentativo != null,
  });
}

/**
 * Report leggibile dell'installazione — stato MT5/Bridge/compilazione/
 * versione/azioni richieste, come esplicitamente richiesto da Damiano.
 * Funzione pura: non scrive nulla, si limita a interpretare i risultati già
 * ottenuti da installaBridge().
 */
function generaReportInstallazione({
  cartellaExperts,
  percorsoMetaEditorTrovato,
  metaEditorCercatoIn = [],
  backupMq5,
  backupEx5,
  versioneInstallata,
  esitoCompilazione,
  compilazioneRiuscita,
  ex5Presente,
}) {
  const azioniRichieste = [];
  let statoBridge;

  let messaggio;

  if (compilazioneRiuscita) {
    statoBridge = "installato_e_compilato";
    messaggio = `Collegamento DLM ${versioneInstallata || ""} installato e compilato. File compilato verificato.`.replace("  ", " ");
  } else if (!percorsoMetaEditorTrovato) {
    statoBridge = "sorgente_copiato_compilazione_non_disponibile";
    const dove = metaEditorCercatoIn.length > 0 ? metaEditorCercatoIn.join(" ; ") : "cartella di installazione di MetaTrader 5 non determinata";
    messaggio = "Compilatore di MetaTrader 5 non trovato: il collegamento DLM è stato copiato ma NON è utilizzabile.";
    azioniRichieste.push(
      `MetaEditor (metaeditor64.exe) non trovato. Cercato in: ${dove}. Controlla che MetaTrader 5 sia installato completamente, poi premi di nuovo "Installa il collegamento". Se il problema resta, contatta l'assistenza DLM.`
    );
  } else {
    statoBridge = "sorgente_copiato_compilazione_fallita";
    messaggio = "La compilazione del collegamento DLM non è riuscita: il collegamento NON è utilizzabile.";
    if (esitoCompilazione.erroreEsecuzione) {
      azioniRichieste.push(`MetaEditor non è stato eseguito correttamente: ${esitoCompilazione.erroreEsecuzione}`);
    } else if (esitoCompilazione.errori > 0) {
      azioniRichieste.push(
        `Il compilatore ha segnalato ${esitoCompilazione.errori} errore/i.${esitoCompilazione.righeErrore.length > 0 ? " " + esitoCompilazione.righeErrore.join(" | ") : ""}`
      );
    } else {
      azioniRichieste.push(
        `MetaEditor è stato eseguito (${percorsoMetaEditorTrovato}) ma il file ${NOME_EX5} non è stato creato in ${cartellaExperts}.`
      );
    }
    azioniRichieste.push('Premi di nuovo "Installa il collegamento". Se il problema resta, contatta l\'assistenza DLM riportando questo messaggio.');
  }

  if (backupMq5 || backupEx5) {
    azioniRichieste.push(
      `Trovata una versione precedente del Bridge: salvata come backup (${[backupMq5, backupEx5].filter(Boolean).map((p) => path.basename(p)).join(", ")}), non cancellata.`
    );
    // Dalla 0.6.0 (EA 1.5.0): dopo un aggiornamento il cliente deve vedere la
    // versione nuova sul grafico. Finché MetaTrader usa ancora quella
    // precedente, il server può non consegnare le nuove aperture sui conti
    // reali; chiusure e modifiche dello stop arrivano comunque.
    azioniRichieste.push(
      "Aggiornamento del collegamento: chiudi e riapri MetaTrader, poi controlla che il collegamento sia attivo sul grafico. Le posizioni già aperte non vengono toccate."
    );
  }

  return {
    cartellaExperts,
    statoMT5: "installazione_selezionata_valida",
    messaggio,
    bridge: {
      stato: statoBridge,
      versioneSorgenteCopiata: versioneInstallata,
      ex5Presente,
    },
    compilazione: {
      metaEditorTrovato: Boolean(percorsoMetaEditorTrovato),
      percorsoMetaEditor: percorsoMetaEditorTrovato || null,
      metaEditorCercatoIn,
      errori: esitoCompilazione.errori ?? null,
      avvisi: esitoCompilazione.avvisi ?? null,
      tentata: esitoCompilazione.tentata,
      riuscita: compilazioneRiuscita,
      erroreEsecuzione: esitoCompilazione.erroreEsecuzione,
    },
    backup: {
      mq5: backupMq5,
      ex5: backupEx5,
    },
    azioniRichieste,
    generatoAt: new Date().toISOString(),
  };
}

module.exports = {
  installaBridge,
  verificaStatoInstallazione,
  generaReportInstallazione,
  // Esportate per i test isolati richiesti da Damiano (nessuna UI ancora).
  percorsoConsentito,
  leggiVersioneSorgente,
  trovaMetaEditor,
  cercaMetaEditor,
  interpretaRegistroCompilazione,
  PERCORSO_SORGENTE_BUNDLATO,
  NOME_MQ5,
  NOME_EX5,
};
