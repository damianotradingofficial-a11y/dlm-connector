#!/usr/bin/env node
// PROVA DI AGGIORNAMENTO del collegamento — DLM Connector 0.6.0 (13/10/2026).
// Esegue la VERA funzione di installazione su una cartella finta che imita la
// cartella dati di MetaTrader con una EA precedente già installata. Solo moduli
// Node builtin, gira su qualunque sistema. NON sostituisce la prova su Windows:
// qui MetaEditor non c'è, quindi la compilazione non viene tentata.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { installaBridge } = require("./src/lib/installBridge");

let ok = 0, ko = 0;
const verifica = (nome, cond, dettaglio = "") => { if (cond) { ok++; console.log(`  ✓ ${nome}`); } else { ko++; console.log(`  ✗ ${nome} ${dettaglio}`); } };
const impronta = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

(async () => {
  const dati = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-agg-"));
  const experts = path.join(dati, "MQL5", "Experts");
  fs.mkdirSync(experts, { recursive: true });
  const VECCHIO_MQ5 = '#property version "1.47"\n#define EA_VERSIONE "1.4.7"\n// EA precedente (finta, per la prova)\n';
  const VECCHIO_EX5 = Buffer.from("ex5-compilato-della-versione-precedente");
  fs.writeFileSync(path.join(experts, "DLM_Bridge_EA.mq5"), VECCHIO_MQ5);
  fs.writeFileSync(path.join(experts, "DLM_Bridge_EA.ex5"), VECCHIO_EX5);
  fs.writeFileSync(path.join(experts, "AltroRobotDelCliente.mq5"), "// non nostro");
  fs.mkdirSync(path.join(experts, "Advisors"));

  console.log("1 — aggiornamento da una versione precedente");
  const report = await installaBridge({ cartellaDati: dati, percorsoEseguibile: null });
  const file = fs.readdirSync(experts).sort();
  const backupMq5 = file.find((f) => /^DLM_Bridge_EA\.mq5\.backup-/.test(f)), backupEx5 = file.find((f) => /^DLM_Bridge_EA\.ex5\.backup-/.test(f));
  verifica("il sorgente installato è esattamente la EA inclusa nel Connector", impronta(path.join(experts, "DLM_Bridge_EA.mq5")) === impronta(path.join(__dirname, "resources/DLM_Bridge_EA.mq5")));
  verifica("la versione letta dal file installato è la 1.5.0", JSON.stringify(report).includes('"1.5.0"'), JSON.stringify(report).slice(0, 300));
  verifica("la versione precedente è stata salvata, non cancellata (sorgente e compilato)", !!backupMq5 && !!backupEx5 && fs.readFileSync(path.join(experts, backupMq5), "utf8") === VECCHIO_MQ5 && fs.readFileSync(path.join(experts, backupEx5)).equals(VECCHIO_EX5), file.join(", "));
  verifica("senza MetaEditor il Connector NON dichiara riuscita la compilazione", !/installato_e_compilato/.test(JSON.stringify(report)) && /MetaEditor/.test(JSON.stringify(report)));
  verifica("il vecchio file compilato NON viene spacciato per quello nuovo: resta l'avviso di compilare", fs.readFileSync(path.join(experts, "DLM_Bridge_EA.ex5")).equals(VECCHIO_EX5) && /compila/i.test(JSON.stringify(report)));
  verifica("al cliente viene detto di chiudere e riaprire MetaTrader e che le posizioni aperte non vengono toccate", /chiudi e riapri MetaTrader/.test(JSON.stringify(report)) && /posizioni già aperte non vengono toccate/.test(JSON.stringify(report)));
  verifica("nessun altro file della cartella è stato toccato o aggiunto", fs.readFileSync(path.join(experts, "AltroRobotDelCliente.mq5"), "utf8") === "// non nostro" && file.filter((f) => !/^DLM_Bridge_EA\.|^dlm_bridge_compile\.log$/.test(f)).join() === "Advisors,AltroRobotDelCliente.mq5", file.join(", "));

  console.log("2 — secondo aggiornamento di seguito");
  await new Promise((r) => setTimeout(r, 1100));
  await installaBridge({ cartellaDati: dati, percorsoEseguibile: null });
  const dopo = fs.readdirSync(experts);
  verifica("un secondo passaggio non sovrascrive i salvataggi precedenti", dopo.filter((f) => /^DLM_Bridge_EA\.mq5\.backup-/.test(f)).length === 2 && fs.readFileSync(path.join(experts, backupMq5), "utf8") === VECCHIO_MQ5, dopo.join(", "));

  console.log("3 — prima installazione");
  const nuovo = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-nuovo-"));
  fs.mkdirSync(path.join(nuovo, "MQL5", "Experts"), { recursive: true });
  const r3 = await installaBridge({ cartellaDati: nuovo, percorsoEseguibile: null });
  verifica("su una cartella pulita: sorgente copiato, nessun salvataggio, nessun avviso di aggiornamento", fs.readdirSync(path.join(nuovo, "MQL5", "Experts")).join() === "DLM_Bridge_EA.mq5" && !/chiudi e riapri MetaTrader/.test(JSON.stringify(r3)));
  let rifiutata = false; try { await installaBridge({ cartellaDati: path.join(nuovo, "non-esiste"), percorsoEseguibile: null }); } catch { rifiutata = true; }
  verifica("cartella di MetaTrader inesistente: errore chiaro, nessun file creato", rifiutata && !fs.existsSync(path.join(nuovo, "non-esiste")));

  fs.rmSync(dati, { recursive: true, force: true }); fs.rmSync(nuovo, { recursive: true, force: true });
  console.log(`\nRISULTATO: ${ok} superati, ${ko} falliti`);
  process.exit(ko ? 1 : 0);
})();
