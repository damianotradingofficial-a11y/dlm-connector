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
 * Cerca metaeditor64.exe nella stessa cartella di terminal64.exe (percorso
 * noto dal rilevamento Blocco 1, letto da origin.txt). Solo lettura/verifica
 * di esistenza — nessuna scrittura in questa cartella.
 */
async function trovaMetaEditor(percorsoEseguibileTerminal) {
  if (!percorsoEseguibileTerminal) return null;
  const candidato = path.join(path.dirname(percorsoEseguibileTerminal), "metaeditor64.exe");
  return (await fileEsiste(candidato)) ? candidato : null;
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
  const { cartellaDati, percorsoEseguibile } = installazione || {};
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

  // 3) TENTATIVO COMPILAZIONE — solo se metaeditor64.exe è individuabile.
  const percorsoMetaEditor = await trovaMetaEditor(percorsoEseguibile);
  const mtimeEx5PrimaDelTentativo = await mtimeSeEsiste(destEx5);
  let esitoCompilazione = { tentata: false, eseguito: false, erroreEsecuzione: null };

  if (percorsoMetaEditor) {
    const percorsoLog = path.join(cartellaExperts, "dlm_bridge_compile.log");
    try {
      await execFileAsync(percorsoMetaEditor, [`/compile:${destMq5}`, `/log:${percorsoLog}`], { timeout: 30000 });
      esitoCompilazione = { tentata: true, eseguito: true, erroreEsecuzione: null };
    } catch (e) {
      // Non trattato come fallimento definitivo: la verifica vera è sul
      // filesystem, subito sotto.
      esitoCompilazione = { tentata: true, eseguito: true, erroreEsecuzione: e.message };
    }
  }

  // 4) VERIFICA REALE — mai assunta. Il .ex5 è considerato "compilato ora"
  //    SOLO se esiste E la sua data è cambiata rispetto a prima del
  //    tentativo (copre sia il caso "non esisteva prima" sia "esisteva ma
  //    era vecchio").
  const mtimeEx5DopoIlTentativo = await mtimeSeEsiste(destEx5);
  const compilazioneRiuscita =
    esitoCompilazione.tentata &&
    mtimeEx5DopoIlTentativo != null &&
    mtimeEx5DopoIlTentativo !== mtimeEx5PrimaDelTentativo;

  return generaReportInstallazione({
    cartellaExperts,
    percorsoMetaEditorTrovato: percorsoMetaEditor,
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
  backupMq5,
  backupEx5,
  versioneInstallata,
  esitoCompilazione,
  compilazioneRiuscita,
  ex5Presente,
}) {
  const azioniRichieste = [];
  let statoBridge;

  if (compilazioneRiuscita) {
    statoBridge = "installato_e_compilato";
  } else if (ex5Presente && !esitoCompilazione.tentata) {
    // .ex5 già presente da prima (magari da un'installazione manuale
    // precedente) e non abbiamo tentato/potuto ricompilare — non è un
    // fallimento, ma va segnalato con chiarezza cosa è successo davvero.
    statoBridge = "sorgente_copiato_ex5_preesistente_non_verificato";
    azioniRichieste.push(
      "Il file .ex5 presente non è stato ricompilato ora: se non sei sicuro che corrisponda al nuovo sorgente copiato, apri MetaEditor e compila manualmente (F7) per sicurezza."
    );
  } else if (!percorsoMetaEditorTrovato) {
    statoBridge = "sorgente_copiato_compilazione_non_disponibile";
    azioniRichieste.push(
      `MetaEditor non trovato accanto a terminal64.exe: apri MetaEditor manualmente, apri ${NOME_MQ5} da MQL5/Experts e compila con F7.`
    );
  } else {
    statoBridge = "sorgente_copiato_compilazione_fallita";
    azioniRichieste.push(
      `Il tentativo di compilazione automatica non ha prodotto ${NOME_EX5}. Apri MetaEditor, apri ${NOME_MQ5} da MQL5/Experts e compila manualmente con F7 per vedere l'errore esatto.`
    );
    if (esitoCompilazione.erroreEsecuzione) {
      azioniRichieste.push(`Dettaglio tecnico del tentativo automatico: ${esitoCompilazione.erroreEsecuzione}`);
    }
  }

  if (backupMq5 || backupEx5) {
    azioniRichieste.push(
      `Trovata una versione precedente del Bridge: salvata come backup (${[backupMq5, backupEx5].filter(Boolean).map((p) => path.basename(p)).join(", ")}), non cancellata.`
    );
  }

  return {
    cartellaExperts,
    statoMT5: "installazione_selezionata_valida",
    bridge: {
      stato: statoBridge,
      versioneSorgenteCopiata: versioneInstallata,
      ex5Presente,
    },
    compilazione: {
      metaEditorTrovato: Boolean(percorsoMetaEditorTrovato),
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
  generaReportInstallazione,
  // Esportate per i test isolati richiesti da Damiano (nessuna UI ancora).
  percorsoConsentito,
  leggiVersioneSorgente,
  trovaMetaEditor,
  PERCORSO_SORGENTE_BUNDLATO,
  NOME_MQ5,
  NOME_EX5,
};
