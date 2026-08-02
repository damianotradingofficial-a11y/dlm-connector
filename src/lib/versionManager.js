// DLM Connector Version Manager — evita che un cliente resti con una
// versione vecchia del Bridge senza saperlo.
//
// Distingue TRE versioni diverse, che possono divergere tra loro:
//   1. bundlata    — quella che il Connector porta con sé (resources/DLM_Bridge_EA.mq5)
//   2. installata   — quella scritta su disco nella cartella Experts del cliente
//   3. in_esecuzione — quella che il Bridge sta USANDO ORA, riportata dal suo
//                      stesso heartbeat (mt5_bridge_heartbeat.versione_ea)
//
// Perché serve distinguerle: sovrascrivere il file su disco (2) NON aggiorna
// automaticamente l'istanza già in esecuzione in MT5 (3) — il cliente deve
// rimuovere e riattaccare l'EA al grafico (o riavviare MT5) perché la nuova
// versione venga davvero eseguita. Un Version Manager che guardasse solo il
// file su disco darebbe un falso senso di sicurezza ("è aggiornato") anche
// quando l'istanza realmente attiva è ancora quella vecchia.
//
// Sola lettura: nessuna scrittura qui, nessuna decisione di installazione
// (quella è installBridge.js). Nessuna modifica al Bridge EA stesso.
//
// v2.0 (Hardening Fase 4 — richiesta esplicita di Damiano: "completare
// controllo versione Connector", "predisporre notifiche aggiornamento"):
// fino ad ora questo file confrontava solo le 3 versioni del BRIDGE EA
// (bundlata/installata/in esecuzione). Aggiunto un quarto confronto,
// distinto: la versione del CONNECTOR stesso (questa app) contro l'ultima
// versione disponibile. SOLO NOTIFICA — nessun download, nessuna
// installazione automatica, nessun auto-update (scelta esplicita di
// Damiano). "Predisposizione" perché DLM non ha ancora un endpoint
// pubblico che pubblica le versioni: la funzione prova PRIMA un endpoint
// remoto opzionale (DLM_CONNECTOR_UPDATE_CHECK_URL, non ancora impostato in
// nessun ambiente), e in sua assenza (o in caso di errore/rete assente —
// mai bloccante) ricade su un manifest locale bundlato
// (version-manifest.json, allineato manualmente a ogni release, di default
// uguale alla versione corrente = "nessun aggiornamento" finché DLM non
// pubblica un vero endpoint o non si aggiorna questo file a mano).
const fs = require("fs/promises");
const path = require("path");
const { leggiVersioneSorgente, PERCORSO_SORGENTE_BUNDLATO, NOME_MQ5 } = require("./installBridge");

/** Versione del Connector stesso, da package.json (sola lettura). */
async function leggiVersioneConnector() {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(__dirname, "..", "..", "package.json"), "utf8"));
    return pkg.version || null;
  } catch {
    return null;
  }
}

/**
 * Confronto semver minimale (solo "x.y.z" numerici, coerente con
 * EA_VERSIONE del Bridge e "version" di package.json — nessuna libreria
 * esterna necessaria per un confronto così semplice). Ritorna 1 se a > b,
 * -1 se a < b, 0 se uguali, null se uno dei due manca o non è parsabile.
 */
function confrontaVersioni(a, b) {
  if (!a || !b) return null;
  const pa = String(a).split(".").map((n) => parseInt(n, 10));
  const pb = String(b).split(".").map((n) => parseInt(n, 10));
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/**
 * Ultima versione disponibile del Connector — vedi nota v2.0 sopra per la
 * strategia "endpoint remoto opzionale, altrimenti manifest locale". Non
 * lancia mai un errore: in assenza totale di informazioni ritorna
 * `{ versione: null, fonte: "sconosciuto" }`, mai un'ipotesi.
 */
async function leggiUltimaVersioneDisponibileConnector() {
  const url = process.env.DLM_CONNECTOR_UPDATE_CHECK_URL || null;
  if (url) {
    try {
      // Electron 31 include Node ≥ 20: fetch globale disponibile nel
      // processo main, nessuna dipendenza aggiuntiva. Timeout breve: un
      // controllo versione non deve mai far percepire il Connector come
      // lento o bloccato.
      const risposta = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (risposta.ok) {
        const dati = await risposta.json();
        if (dati?.connector) return { versione: dati.connector, fonte: "remoto" };
      }
    } catch {
      // Silenzioso per design: nessuna connessione o endpoint non ancora
      // pubblicato non deve mai bloccare né mostrare un errore al cliente,
      // si ricade sul manifest locale sotto.
    }
  }
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(__dirname, "..", "..", "version-manifest.json"), "utf8"));
    return { versione: manifest.connector || null, fonte: "locale" };
  } catch {
    return { versione: null, fonte: "sconosciuto" };
  }
}

/**
 * Confronta le versioni disponibili in un dato momento. Ognuno dei 3
 * argomenti può essere null (es. nessuna installazione scelta ancora, o
 * cliente non loggato quindi nessun heartbeat remoto) — la funzione non
 * assume mai la presenza di un dato che non ha, riporta "sconosciuto" invece
 * di indovinare.
 *
 * @param {{ cartellaDati?: string|null, versioneRemotaHeartbeat?: string|null }} opzioni
 */
async function analizzaVersioni({ cartellaDati = null, versioneRemotaHeartbeat = null } = {}) {
  const versioneConnector = await leggiVersioneConnector();
  const versioneBundlata = await leggiVersioneSorgente(PERCORSO_SORGENTE_BUNDLATO);

  let versioneInstallata = null;
  if (cartellaDati) {
    const percorsoInstallato = path.join(cartellaDati, "MQL5", "Experts", NOME_MQ5);
    versioneInstallata = await leggiVersioneSorgente(percorsoInstallato);
  }

  const bundlataVsInstallata =
    versioneBundlata == null || versioneInstallata == null
      ? "sconosciuto"
      : versioneBundlata === versioneInstallata
        ? "allineate"
        : "bundle_piu_recente_di_installata";

  const installataVsEsecuzione =
    versioneInstallata == null || versioneRemotaHeartbeat == null
      ? "sconosciuto"
      : versioneInstallata === versioneRemotaHeartbeat
        ? "allineate"
        : "file_diverso_da_istanza_in_esecuzione";

  // v2.0 — quarto confronto, indipendente dai 3 sopra: il Connector stesso
  // (questa app) contro l'ultima versione disponibile. Vedi
  // leggiUltimaVersioneDisponibileConnector() per come viene ottenuta.
  const ultimaDisponibile = await leggiUltimaVersioneDisponibileConnector();
  const cmpConnector = confrontaVersioni(ultimaDisponibile.versione, versioneConnector);
  const connectorAggiornamento = cmpConnector == null ? "sconosciuto" : cmpConnector > 0 ? "nuova_versione_disponibile" : "aggiornato";

  const azioniRichieste = [];
  if (bundlataVsInstallata === "bundle_piu_recente_di_installata") {
    azioniRichieste.push(
      `Il Connector ha una versione del Bridge (${versioneBundlata}) più recente di quella installata sul PC (${versioneInstallata}). Esegui di nuovo l'installazione guidata per aggiornarla.`
    );
  }
  if (installataVsEsecuzione === "file_diverso_da_istanza_in_esecuzione") {
    azioniRichieste.push(
      `Il file su disco (${versioneInstallata}) è diverso da quello che il Bridge sta usando ora (${versioneRemotaHeartbeat}). Rimuovi e riattacca l'Expert Advisor al grafico (o riavvia MT5) perché la nuova versione venga davvero eseguita.`
    );
  }
  if (connectorAggiornamento === "nuova_versione_disponibile") {
    azioniRichieste.push(
      `È disponibile una nuova versione di DLM Connector (${ultimaDisponibile.versione} — hai la ${versioneConnector}). Scarica e installa manualmente il nuovo pacchetto quando puoi: nessun aggiornamento automatico in questa fase.`
    );
  }

  return {
    versioneConnector,
    versioneBundlata,
    versioneInstallata,
    versioneRemotaHeartbeat,
    confronto: { bundlataVsInstallata, installataVsEsecuzione },
    // v2.0 — sotto-oggetto dedicato al Connector stesso, separato dal
    // confronto sui 3 valori del Bridge sopra (concetti diversi: qui parliamo
    // dell'app, non dell'Expert Advisor).
    connector: {
      versioneInstallata: versioneConnector,
      versioneDisponibile: ultimaDisponibile.versione,
      fonteVersioneDisponibile: ultimaDisponibile.fonte,
      aggiornamento: connectorAggiornamento,
    },
    azioniRichieste,
    generatoAt: new Date().toISOString(),
  };
}

module.exports = { analizzaVersioni, leggiVersioneConnector, leggiUltimaVersioneDisponibileConnector, confrontaVersioni };
