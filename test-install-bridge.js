#!/usr/bin/env node
// Script di TEST ISOLATO per installBridge.js — richiesto esplicitamente da
// Damiano prima di costruire il wizard UI ("prima voglio testare la logica
// installazione in modo isolato"). Nessun Electron, nessuna dipendenza
// esterna (detectMt5.js e installBridge.js usano solo moduli Node builtin):
// basta avere Node.js installato sulla macchina Windows di test, NIENTE
// `npm install` necessario per questo script.
//
// Uso:
//   node test-install-bridge.js            -> mostra le installazioni trovate ed esce
//   node test-install-bridge.js 0           -> installa sulla installazione [0] della lista
//
// Cosa fa (in ordine, tutto stampato a schermo):
//   1. Rileva le installazioni MT5 (stesso codice del Blocco 1, invariato).
//   2. Se non passi un indice, si ferma qui e mostra solo l'elenco — così
//      puoi verificare il rilevamento da solo prima di scrivere qualunque
//      file.
//   3. Se passi un indice, esegue installaBridge() sull'installazione scelta
//      (backup obbligatorio + copia + tentativo compilazione + verifica
//      reale) e stampa il report leggibile risultante.
const { rilevaInstallazioniMt5 } = require("./src/lib/detectMt5");
const { installaBridge } = require("./src/lib/installBridge");

async function main() {
  const argIndice = process.argv[2];

  console.log("=== DLM Auto Connector — test isolato installBridge.js ===\n");
  console.log("Rilevamento installazioni MT5...\n");

  const info = await rilevaInstallazioniMt5();

  if (!info.supportato) {
    console.log(`Rilevamento non supportato su questo sistema operativo: ${info.motivo}`);
    console.log("Questo script va eseguito su Windows per un test reale.");
    process.exit(1);
  }

  if (info.installazioni.length === 0) {
    console.log("Nessuna installazione MT5 trovata in %APPDATA%\\MetaQuotes\\Terminal.");
    process.exit(1);
  }

  console.log(`Trovate ${info.installazioni.length} installazione/i:\n`);
  info.installazioni.forEach((ins, i) => {
    console.log(`  [${i}] ${ins.cartellaDati}`);
    console.log(`      eseguibile: ${ins.percorsoEseguibile || "(non determinato)"}`);
    console.log(`      Experts trovata: ${ins.mql5ExpertsTrovata ? "sì" : "no"}`);
    console.log(`      Bridge DLM già presente: ${ins.bridgeEaPresente ? "sì (" + ins.fileEaTrovati.join(", ") + ")" : "no"}`);
    console.log("");
  });

  if (argIndice === undefined) {
    console.log("Nessun indice passato: mi fermo qui (nessuna scrittura eseguita).");
    console.log("Per installare, rilancia con: node test-install-bridge.js <indice>");
    return;
  }

  const indiceScelto = parseInt(argIndice, 10);
  const installazioneScelta = info.installazioni[indiceScelto];
  if (!installazioneScelta) {
    console.log(`Indice ${argIndice} non valido (installazioni disponibili: 0-${info.installazioni.length - 1}).`);
    process.exit(1);
  }

  console.log(`Installo il Bridge su: ${installazioneScelta.cartellaDati}\n`);
  const report = await installaBridge(installazioneScelta);

  console.log("=== Report installazione ===");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error("\nERRORE:", e.message);
  process.exit(1);
});
