#!/usr/bin/env node
// CONTROLLI DI RILASCIO — DLM Connector 0.5.0 (08/10/2026).
// Solo moduli Node builtin: si esegue con `npm test` su qualunque sistema,
// senza `npm install`. Bloccano la costruzione del pacchetto se:
//   - l'EA incluso non è la versione attesa, o non è il file approvato;
//   - nel pacchetto compare il vecchio dominio;
//   - nell'EA compare un numero di conto o di ticket reale;
//   - l'EA scrive la chiave di collegamento nel registro di MetaTrader;
//   - la versione non è allineata, o la pubblicazione non è "di prova".
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Valori attesi di QUESTA versione. Cambiano solo con una nuova versione approvata.
const CONNECTOR_ATTESO = "0.5.0";
const EA_ATTESO = "1.4.8";
const EA_PROPERTY_ATTESA = "1.48";
const SERVER_ATTESO = "https://www.dlmtrading.com";
// Impronta SHA-256 dell'EA 1.4.8 approvato (patch di sicurezza della 1.4.7 verificata).
const EA_SHA256_ATTESO = "665ff3c3d2ba713fddef01dafb0f0369f5b409933f26a96867f339dfe54296bb";

let ok = 0, ko = 0;
const verifica = (nome, cond, dettaglio = "") => { if (cond) { ok++; console.log(`  ✓ ${nome}`); } else { ko++; console.log(`  ✗ ${nome} ${dettaglio}`); } };
const leggi = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");
const pkg = JSON.parse(leggi("package.json"));
const manifest = JSON.parse(leggi("version-manifest.json"));
const ea = leggi("resources/DLM_Bridge_EA.mq5");

// I file che finiscono nel pacchetto (build.files di package.json), più quelli di rilascio.
function elenca(dir) {
  return fs.readdirSync(path.join(__dirname, dir), { withFileTypes: true }).flatMap((v) => (v.isDirectory() ? elenca(path.join(dir, v.name)) : [path.join(dir, v.name)]));
}
const NEL_PACCHETTO = ["main.js", "preload.js", "package.json", "version-manifest.json", ...elenca("src"), ...elenca("resources")];
const DI_RILASCIO = [...NEL_PACCHETTO, "README.md", ".github/workflows/release.yml", ...fs.readdirSync(__dirname).filter((f) => /^RELEASE_NOTES_.*\.md$/.test(f))];
const testuali = (lista) => lista.filter((f) => /\.(js|json|html|mq5|md|yml|css)$/.test(f));

console.log("1 — versione");
verifica(`Connector ${CONNECTOR_ATTESO} in package.json`, pkg.version === CONNECTOR_ATTESO, pkg.version);
verifica("version-manifest.json allineato (Connector, EA, indirizzo)", manifest.connector === CONNECTOR_ATTESO && manifest.bridgeEa === EA_ATTESO && manifest.apiBaseUrl === SERVER_ATTESO, JSON.stringify(manifest));
verifica(`note di rilascio presenti per la ${CONNECTOR_ATTESO}`, fs.existsSync(path.join(__dirname, `RELEASE_NOTES_${CONNECTOR_ATTESO}.md`)));

console.log("2 — EA incluso");
verifica(`EA ${EA_ATTESO} (define e property)`, new RegExp(`#define\\s+EA_VERSIONE\\s+"${EA_ATTESO.replace(/\./g, "\\.")}"`).test(ea) && new RegExp(`#property\\s+version\\s+"${EA_PROPERTY_ATTESA.replace(".", "\\.")}"`).test(ea));
const impronta = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "resources/DLM_Bridge_EA.mq5"))).digest("hex");
verifica("l'EA incluso è esattamente il file approvato (impronta SHA-256)", impronta === EA_SHA256_ATTESO, impronta);
verifica("lo stesso metodo del Connector legge la versione attesa", (ea.match(/#define\s+EA_VERSIONE\s+"([\d.]+)"/) || [])[1] === EA_ATTESO);
verifica(`indirizzo del server nell'EA: ${SERVER_ATTESO}`, new RegExp(`input string ApiBaseUrl\\s+= "${SERVER_ATTESO.replace(/[./]/g, "\\$&")}";`).test(ea));

console.log("3 — vecchio dominio");
const conVecchioDominio = testuali(DI_RILASCIO).filter((f) => /dlmcapitalpartners\.com/i.test(leggi(f)));
verifica("nessun file del pacchetto o del rilascio contiene il vecchio dominio", conVecchioDominio.length === 0, conVecchioDominio.join(", "));

console.log("4 — numero di conto");
const commenti = ea.split("\n").filter((r) => r.trimStart().startsWith("//"));
verifica("nessun commento dell'EA indica un numero di conto", !commenti.some((r) => /\b(conto|account|login)\b[^\n]{0,40}\d{6,}/i.test(r)), commenti.filter((r) => /\b(conto|account|login)\b[^\n]{0,40}\d{6,}/i.test(r)).length + " righe");
verifica("nessun numero di conto fra i valori di ingresso dell'EA", !/input\s+(long|int|ulong|string)\s+\w*(Login|Account|Conto)\w*\s*=\s*"?\d{6,}/i.test(ea));

const numeriLunghi = [...new Set(ea.match(/\d{6,}/g) || [])];
const numeroTecnico = (ea.match(/#define MAGIC_NUMBER\s+(\d+)/) || [])[1];
verifica("nessun identificativo reale: l'unico numero lungo nell'EA è il suo numero tecnico (MAGIC_NUMBER)", numeriLunghi.length === 1 && numeriLunghi[0] === numeroTecnico, `${numeriLunghi.length} numeri lunghi distinti`);
verifica("nessun commento dell'EA cita un numero di ticket", !commenti.some((r) => /ticket[^\n]{0,20}\d{6,}/i.test(r)) && commenti.filter((r) => r.includes("[omesso]")).length === 3);

console.log("5 — chiave di collegamento nel registro");
const scritture = [...ea.matchAll(/\b(Print|PrintFormat|Log[A-Z][A-Za-z]*|Alert|Comment)\s*\(([\s\S]*?)\);/g)].map((m) => m[0]);
const conChiave = scritture.filter((c) => /[,(+]\s*ConnectionReference\b/.test(c));
verifica("nessuna scrittura nel registro contiene la chiave di collegamento", scritture.length > 20 && conChiave.length === 0, conChiave.map((c) => c.slice(0, 80)).join(" | "));
verifica("la chiave viene ancora inviata al server (funzione invariata)", /"X-DLM-Connection-Reference: " \+ ConnectionReference/.test(ea));
const sorgentiConnector = testuali(NEL_PACCHETTO).filter((f) => f.endsWith(".js"));
const logChiaveConnector = sorgentiConnector.filter((f) => /console\.(log|info|warn|error)\([^)]*(connection_?reference|connectionReference)\b/i.test(leggi(f)));
verifica("nemmeno il Connector scrive la chiave nei propri registri", logChiaveConnector.length === 0, logChiaveConnector.join(", "));

console.log("6 — istruzioni al cliente");
verifica("il wizard nomina l'indirizzo esatto da autorizzare in MetaTrader", leggi("src/renderer/wizard.html").includes(SERVER_ATTESO) && leggi("src/lib/diagnostics.js").includes(SERVER_ATTESO));

console.log("7 — pubblicazione");
const flusso = leggi(".github/workflows/release.yml");
verifica("la pubblicazione automatica crea solo una versione di prova (prerelease)", pkg.build?.publish?.provider === "github" && pkg.build.publish.releaseType === "prerelease");
verifica("il flusso esegue questi controlli prima di costruire", /npm test/.test(flusso) && flusso.indexOf("npm test") < flusso.indexOf("npm run dist:win"));
verifica("il flusso pubblica le impronte SHA-256", /SHA256SUMS\.txt/.test(flusso) && /Get-FileHash|sha256sum|shasum/.test(flusso));
verifica("Mac non ancora supportato: il flusso non costruisce il pacchetto Mac", /build-mac:[\s\S]*?\n\s+if:\s*\$\{\{\s*false\s*\}\}/.test(flusso) && !/needs:\s*build-mac/.test(flusso));
verifica("nessun aggiornamento automatico dentro il Connector", !/electron-updater|autoUpdater/.test(sorgentiConnector.map(leggi).join("\n")) && !("electron-updater" in (pkg.dependencies || {})));
verifica("le istruzioni di rilascio vietano i link 'latest' in produzione", /releases\/download\/v0\.5\.0\//.test(leggi("README.md")) && /non usare .*latest/i.test(leggi("README.md")));

console.log(`\nRISULTATO: ${ok} superati, ${ko} falliti`);
process.exit(ko ? 1 : 0);
