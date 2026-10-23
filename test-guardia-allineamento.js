#!/usr/bin/env node
// PROVA — la guardia di allineamento del Bridge sa FALLIRE (0.6.3, 23/10/2026).
// Un controllo che non sa fallire non è un controllo: si costruisce un albero finto (app con mt5-bridge/ + Connector),
// si rompe l'allineamento di proposito in ogni modo che conta e si pretende che la guardia esca con errore.
// Solo moduli Node builtin; tutto in una cartella temporanea, cancellata alla fine. Nessun file reale toccato.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

let ok = 0, ko = 0;
const verifica = (nome, cond, dettaglio = "") => { if (cond) { ok++; console.log(`  ✓ ${nome}`); } else { ko++; console.log(`  ✗ ${nome} ${dettaglio}`); } };

const QUI = __dirname;
const EA = fs.readFileSync(path.join(QUI, "resources", "DLM_Bridge_EA.mq5"));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(QUI, "version-manifest.json"), "utf8"));
const PKG = fs.readFileSync(path.join(QUI, "package.json"));
const GUARDIA = fs.readFileSync(path.join(QUI, "scripts", "verifica-allineamento-bridge.js"));

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-guardia-"));
const app = path.join(sandbox, "app"), conn = path.join(app, "dlm-connector");

function albero({ ea = EA, canonico = EA, manifest = MANIFEST, conCanonico = true } = {}) {
  fs.rmSync(app, { recursive: true, force: true });
  fs.mkdirSync(path.join(conn, "resources"), { recursive: true });
  fs.mkdirSync(path.join(conn, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(conn, "scripts", "verifica-allineamento-bridge.js"), GUARDIA);
  fs.writeFileSync(path.join(conn, "resources", "DLM_Bridge_EA.mq5"), ea);
  fs.writeFileSync(path.join(conn, "version-manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(conn, "package.json"), PKG);
  if (conCanonico) { fs.mkdirSync(path.join(app, "mt5-bridge"), { recursive: true }); fs.writeFileSync(path.join(app, "mt5-bridge", "DLM_Bridge_EA.mq5"), canonico); }
}
const guardia = (...arg) => {
  const env = { ...process.env }; delete env.DLM_EA_CANONICO; // il canonico dell'albero finto, mai quello vero
  return spawnSync(process.execPath, [path.join(conn, "scripts", "verifica-allineamento-bridge.js"), ...arg], { encoding: "utf8", env });
};

try {
  console.log("1 — albero intatto");
  albero();
  let r = guardia();
  verifica("EA identico, versioni coerenti: la guardia passa", r.status === 0, r.stdout.slice(-300));

  console.log("2 — EA diverso da quello validato");
  albero({ ea: Buffer.concat([EA, Buffer.from("\n// modifica non approvata\n")]) });
  r = guardia();
  verifica("una sola riga in più nell'EA incluso: la guardia BLOCCA", r.status === 1 && /DIVERGE/.test(r.stdout), r.stdout.slice(-300));
  albero({ ea: Buffer.from(EA.toString("utf8").replace(/#define\s+EA_VERSIONE\s+"[0-9.]+"/, '#define EA_VERSIONE "1.4.4"')) });
  r = guardia();
  verifica("EA incluso di un'altra versione (1.4.4): la guardia BLOCCA", r.status === 1 && /DIVERGE/.test(r.stdout) && /bridgeEa non corrisponde/.test(r.stdout), r.stdout.slice(-300));

  console.log("3 — versioni dichiarate");
  albero({ manifest: { ...MANIFEST, bridgeEa: "1.4.4" } });
  r = guardia();
  verifica("manifest.bridgeEa diverso dall'EA incluso: BLOCCA", r.status === 1 && /bridgeEa non corrisponde/.test(r.stdout));
  albero({ manifest: { ...MANIFEST, connector: "0.0.1" } });
  r = guardia();
  verifica("manifest.connector diverso da package.json: BLOCCA", r.status === 1 && /connector non corrisponde/.test(r.stdout));
  albero({ manifest: { ...MANIFEST, bridgeMinimoRichiesto: "9.9.9" } });
  r = guardia();
  verifica("versione minima più alta di quella inclusa: BLOCCA", r.status === 1 && /PIU' ALTO/.test(r.stdout));
  const senzaMinimo = { ...MANIFEST }; delete senzaMinimo.bridgeMinimoRichiesto;
  albero({ manifest: senzaMinimo });
  r = guardia();
  verifica("versione minima assente: BLOCCA", r.status === 1 && /bridgeMinimoRichiesto assente/.test(r.stdout));

  console.log("4 — contenuto dell'EA (regressioni del 24/08)");
  albero({ ea: Buffer.from(EA.toString("utf8").replace(/ticket_mt5_target|ticketMt5Target/gi, "tkt")), canonico: null, conCanonico: false });
  r = guardia("--consenti-canonico-assente");
  verifica("EA senza ticket_mt5_target: BLOCCA anche senza canonico", r.status === 1 && /NON contiene ticket_mt5_target/.test(r.stdout));

  console.log("5 — canonico assente");
  albero({ conCanonico: false });
  r = guardia();
  verifica("senza canonico e senza flag: BLOCCA (mai un verde che non ha verificato)", r.status === 1 && /non e' raggiungibile/.test(r.stdout));
  r = guardia("--consenti-canonico-assente");
  verifica("con il flag: passa, ma dichiara il confronto SALTATO", r.status === 0 && /SALTATO/.test(r.stdout));
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\nRISULTATO: ${ok} superati, ${ko} falliti`);
process.exit(ko ? 1 : 0);
