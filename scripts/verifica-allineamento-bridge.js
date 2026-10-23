#!/usr/bin/env node
/* ============================================================================
 * GUARDIA DI ALLINEAMENTO — Bridge EA canonico ↔ copia distribuita
 * ============================================================================
 *
 * PERCHE' ESISTE
 * --------------
 * Il 24/08/2026 l'audit del ponte Cliente → Connector → MT5 ha trovato che
 * dlm-connector/resources/DLM_Bridge_EA.mq5 era fermo alla v1.3.0 mentre il
 * canonico mt5-bridge/DLM_Bridge_EA.mq5 era alla v1.4.0. Il Connector
 * installava sul PC del cliente un Bridge con ZERO occorrenze di
 * ticket_mt5_target contro le 14 del canonico: un Bridge che riceve dal
 * server il ticket della posizione da modificare e lo ignora, scegliendo da
 * solo. Con due posizioni aperte sullo stesso simbolo puo' agire su quella
 * sbagliata.
 *
 * Nessuno aveva sbagliato. Il commento in installBridge.js diceva "questa
 * copia va risincronizzata a mano": era vero, era scritto, ed e' stato
 * dimenticato lo stesso. La lezione e' che una convenzione mantenuta dalla
 * disciplina prima o poi cede, mentre un controllo che fa fallire il build
 * no. Questo file e' quel controllo.
 *
 * COSA VERIFICA
 * -------------
 *   1. le due copie del .mq5 sono identiche byte per byte (sha256)
 *   2. la versione dichiarata nel .mq5 bundlato == version-manifest.json/bridgeEa
 *      (dalla 0.6.x il campo si chiama bridgeEa; fino alla 0.4.5 era bridgeBundlato)
 *   3. version-manifest.json/connector == package.json/version
 *   4. bridgeMinimoRichiesto <= bridgeEa (non si puo' richiedere piu'
 *      di quello che si distribuisce)
 *   5. il .mq5 bundlato onora ticket_mt5_target      — guardia di regressione
 *   6. il .mq5 bundlato NON mette la connection_reference in query string
 *                                                     — guardia di regressione
 *
 * IL CASO "CANONICO ASSENTE"
 * --------------------------
 * dlm-connector e' un repository git SEPARATO. Quando la sua CI fa il
 * checkout, ../../mt5-bridge/ non esiste e il controllo 1 e' impossibile.
 * Una guardia che in quel caso passasse in silenzio sarebbe peggio di niente:
 * darebbe un verde che non verifica la cosa piu' importante. Quindi il
 * canonico mancante e' un ERRORE, a meno che il chiamante non dichiari
 * esplicitamente --consenti-canonico-assente. Cosi' la limitazione e'
 * scritta nel workflow, visibile a chi lo legge, invece di essere nascosta
 * qui dentro.
 *
 * DOVE STA IL CANONICO
 * --------------------
 * Di default ../mt5-bridge/DLM_Bridge_EA.mq5 (Connector dentro il repository
 * dell'app, come sottomodulo). Se il Connector e' in una cartella a parte, la
 * variabile DLM_EA_CANONICO indica il percorso del canonico (23/10/2026,
 * riportato nella linea 0.6.x).
 *
 * USO
 *   node scripts/verifica-allineamento-bridge.js
 *   DLM_EA_CANONICO=/percorso/app/mt5-bridge/DLM_Bridge_EA.mq5 node scripts/verifica-allineamento-bridge.js
 *   node scripts/verifica-allineamento-bridge.js --consenti-canonico-assente
 *
 * Esce 0 se tutto e' allineato, 1 altrimenti.
 * ==========================================================================*/

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RADICE_CONNECTOR = path.join(__dirname, "..");
const PERCORSO_BUNDLATO = path.join(RADICE_CONNECTOR, "resources", "DLM_Bridge_EA.mq5");
const PERCORSO_CANONICO = process.env.DLM_EA_CANONICO || path.join(RADICE_CONNECTOR, "..", "mt5-bridge", "DLM_Bridge_EA.mq5");
const PERCORSO_MANIFEST = path.join(RADICE_CONNECTOR, "version-manifest.json");
const PERCORSO_PACKAGE = path.join(RADICE_CONNECTOR, "package.json");

const consentiCanonicoAssente = process.argv.includes("--consenti-canonico-assente");

const problemi = [];
const esiti = [];

function ok(messaggio, dettaglio = "") {
  esiti.push(`  OK   ${messaggio}${dettaglio ? `  — ${dettaglio}` : ""}`);
}
function ko(messaggio, dettaglio = "") {
  esiti.push(`  FAIL ${messaggio}${dettaglio ? `  — ${dettaglio}` : ""}`);
  problemi.push(messaggio);
}

function sha256(percorso) {
  return crypto.createHash("sha256").update(fs.readFileSync(percorso)).digest("hex");
}

/** Legge EA_VERSIONE da un sorgente .mq5. Null se il #define non c'e'. */
function versioneEa(percorso) {
  const m = fs.readFileSync(percorso, "utf8").match(/#define\s+EA_VERSIONE\s+"([0-9.]+)"/);
  return m ? m[1] : null;
}

/** Confronto semver minimale x.y.z — stesso criterio di versionManager.js. */
function confrontaVersioni(a, b) {
  if (!a || !b) return null;
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/* ── 1 · le due copie sono identiche ─────────────────────────────────────── */

if (!fs.existsSync(PERCORSO_BUNDLATO)) {
  ko("Il Bridge EA bundlato non esiste", PERCORSO_BUNDLATO);
} else if (!fs.existsSync(PERCORSO_CANONICO)) {
  if (consentiCanonicoAssente) {
    esiti.push(
      "  SALTATO  confronto con il canonico: mt5-bridge/ non e' in questo checkout (repository separato).\n           I controlli 2-6 sono comunque stati eseguiti sulla copia bundlata."
    );
  } else {
    ko(
      "Il Bridge EA canonico non e' raggiungibile e il confronto piu' importante non e' stato fatto",
      `atteso in ${PERCORSO_CANONICO} — se il checkout e' volutamente parziale, passare --consenti-canonico-assente`
    );
  }
} else {
  const hashBundlato = sha256(PERCORSO_BUNDLATO);
  const hashCanonico = sha256(PERCORSO_CANONICO);
  if (hashBundlato === hashCanonico) {
    ok("Copia distribuita identica al canonico", `sha256 ${hashBundlato.slice(0, 16)}…`);
  } else {
    ko(
      "La copia distribuita DIVERGE dal Bridge canonico",
      `canonico ${versioneEa(PERCORSO_CANONICO)} (${hashCanonico.slice(0, 16)}…) vs distribuita ${versioneEa(
        PERCORSO_BUNDLATO
      )} (${hashBundlato.slice(0, 16)}…). Risincronizzare: cp mt5-bridge/DLM_Bridge_EA.mq5 dlm-connector/resources/`
    );
  }
}

/* ── 2-4 · coerenza delle versioni dichiarate ────────────────────────────── */

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(PERCORSO_MANIFEST, "utf8"));
} catch (e) {
  ko("version-manifest.json illeggibile", e.message);
}

const versioneBundlata = fs.existsSync(PERCORSO_BUNDLATO) ? versioneEa(PERCORSO_BUNDLATO) : null;

if (manifest) {
  if (!versioneBundlata) {
    ko("Nessun #define EA_VERSIONE nel .mq5 bundlato");
  } else if (manifest.bridgeEa === versioneBundlata) {
    ok("version-manifest.bridgeEa allineato al .mq5", versioneBundlata);
  } else {
    ko(
      "version-manifest.bridgeEa non corrisponde al .mq5 distribuito",
      `manifest ${manifest.bridgeEa} vs sorgente ${versioneBundlata}`
    );
  }

  let versionePackage = null;
  try {
    versionePackage = JSON.parse(fs.readFileSync(PERCORSO_PACKAGE, "utf8")).version;
  } catch (e) {
    ko("package.json illeggibile", e.message);
  }
  if (versionePackage) {
    if (manifest.connector === versionePackage) {
      ok("version-manifest.connector allineato a package.json", versionePackage);
    } else {
      ko(
        "version-manifest.connector non corrisponde a package.json — il canale aggiornamenti resterebbe muto",
        `manifest ${manifest.connector} vs package ${versionePackage}`
      );
    }
  }

  const cmpMinimo = confrontaVersioni(manifest.bridgeMinimoRichiesto, versioneBundlata);
  if (cmpMinimo == null) {
    ko("bridgeMinimoRichiesto assente o non confrontabile", String(manifest.bridgeMinimoRichiesto));
  } else if (cmpMinimo <= 0) {
    ok(
      "bridgeMinimoRichiesto coerente con la versione distribuita",
      `richiesto ≥ ${manifest.bridgeMinimoRichiesto}, distribuito ${versioneBundlata}`
    );
  } else {
    ko(
      "bridgeMinimoRichiesto e' PIU' ALTO della versione distribuita: il Connector installerebbe un Bridge che dichiara lui stesso incompatibile",
      `richiesto ${manifest.bridgeMinimoRichiesto} > distribuito ${versioneBundlata}`
    );
  }
}

/* ── 5-6 · guardie di regressione sul contenuto distribuito ──────────────── */

if (fs.existsSync(PERCORSO_BUNDLATO)) {
  const sorgente = fs.readFileSync(PERCORSO_BUNDLATO, "utf8");

  // Non basta che la parola compaia in un commento: deve comparire nel
  // codice. Si tolgono i commenti prima di cercare — lezione imparata a caro
  // prezzo su questo stesso progetto, dove un controllo verde stava leggendo
  // l'intestazione di un file invece del codice.
  const codice = sorgente
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/\/\/.*$/gm, " ");

  const occorrenzeTicket = (codice.match(/ticket_mt5_target|ticketMt5Target/gi) || []).length;
  if (occorrenzeTicket > 0) {
    ok("Il Bridge distribuito onora ticket_mt5_target", `${occorrenzeTicket} occorrenze nel codice`);
  } else {
    ko(
      "Il Bridge distribuito NON contiene ticket_mt5_target: tornerebbe a scegliere da solo quale posizione modificare",
      "e' esattamente il difetto trovato il 24/08/2026"
    );
  }

  if (/connection_reference=/.test(codice)) {
    ko(
      "Il Bridge distribuito manda la connection_reference in QUERY STRING",
      "deve viaggiare nell'header X-DLM-Connection-Reference"
    );
  } else {
    ok("Nessuna connection_reference in query string nel Bridge distribuito");
  }

  if (/X-DLM-Connection-Reference/i.test(codice)) {
    ok("Il Bridge distribuito manda la connection_reference nell'header");
  } else {
    ko("Il Bridge distribuito non manda l'header X-DLM-Connection-Reference");
  }
}

/* ── esito ───────────────────────────────────────────────────────────────── */

console.log("\nAllineamento Bridge EA — Connector\n");
console.log(esiti.join("\n"));

if (problemi.length === 0) {
  console.log("\nTutto allineato. Il Connector distribuisce esattamente il Bridge validato.\n");
  process.exit(0);
}

console.log(`\n${problemi.length} problema/i. Il pacchetto NON va pubblicato in questo stato.\n`);
process.exit(1);
