#!/usr/bin/env node
// PROVA — stato reale del collegamento (0.6.2).
// Dal collaudo su Windows reale del 13/10/2026: riaprendo il Connector 0.6.1
// compariva "Tutto pronto per installare" anche con il collegamento installato.
// Lo stato si legge dal disco a ogni avvio; qui su una cartella finta.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { verificaStatoInstallazione, PERCORSO_SORGENTE_BUNDLATO } = require("./src/lib/installBridge.js");
const { calcolaStatoWizard } = require("./src/lib/wizardState.js");
const { scegliInstallazione } = require("./src/lib/sceltaInstallazione.js");

let ok = 0, ko = 0;
const verifica = (nome, cond, dettaglio = "") => { if (cond) { ok++; console.log(`  ✓ ${nome}`); } else { ko++; console.log(`  ✗ ${nome} ${dettaglio}`); } };

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-stato-"));
  const programma = path.join(base, "MetaTrader 5");
  const dati = path.join(base, "Terminal", "D0E8209F77C8CF37AD8BF550E51FF075");
  const experts = path.join(dati, "MQL5", "Experts");
  fs.mkdirSync(programma, { recursive: true }); fs.mkdirSync(experts, { recursive: true });
  fs.writeFileSync(path.join(programma, "terminal64.exe"), "");
  const ins = { cartellaDati: dati, cartellaInstallazione: programma, percorsoEseguibile: path.join(programma, "terminal64.exe") };
  const mq5 = path.join(experts, "DLM_Bridge_EA.mq5"), ex5 = path.join(experts, "DLM_Bridge_EA.ex5");
  const ora = Date.now() / 1000;
  const installa = () => { fs.copyFileSync(PERCORSO_SORGENTE_BUNDLATO, mq5); fs.utimesSync(mq5, ora - 600, ora - 600); fs.writeFileSync(ex5, "compilato"); fs.utimesSync(ex5, ora, ora); };
  const supporto = { rilevamentoAutomatico: true };
  const locale = { installazioniMt5: { supportato: true, installazioni: [ins] } };
  const passo3 = (stato, report = null) => calcolaStatoWizard({ supportoPiattaforma: supporto, locale, installazioneReport: report, statoInstallazione: stato }).step.installazione_bridge;

  console.log("1 — mai installato");
  let s = await verificaStatoInstallazione(ins);
  verifica("nessun file: non installato, nessun allarme", s.stato === "non_installato" && s.motivi.length === 0);
  verifica("il Connector propone di installare", passo3(s).stato === "in_attesa");

  console.log("2 — installato, Connector riaperto (nessun ricordo della sessione precedente)");
  installa();
  s = await verificaStatoInstallazione(ins);
  verifica("letto dal disco: installato, versione 1.5.0", s.stato === "installato" && s.versioneInstallata === "1.5.0" && s.versioneAttesa === "1.5.0", JSON.stringify(s));
  let p = passo3(s, null);
  verifica("il passo è completato senza alcun esito ricordato", p.stato === "completato" && /Collegamento DLM installato/.test(p.dettaglio));
  verifica("il riquadro dice 'Collegamento DLM installato' con la versione", /Collegamento DLM installato/.test(p.report.messaggio) && /1\.5\.0/.test(p.report.messaggio) && p.report.bridge.stato === "installato_e_compilato");
  verifica("non compare più 'Tutto pronto per installare'", p.stato !== "in_attesa");
  verifica("i passi successivi si sbloccano", calcolaStatoWizard({ supportoPiattaforma: supporto, locale, statoInstallazione: s }).step.configurazione_guidata.stato === "in_corso");

  console.log("3 — qualcosa manca o non corrisponde: riparazione");
  fs.unlinkSync(ex5); s = await verificaStatoInstallazione(ins); p = passo3(s);
  verifica("file compilato mancante", s.stato === "da_riparare" && s.motivi.some((m) => /file compilato/.test(m)) && p.stato === "azione_richiesta" && p.daRiparare === true && /Ripara/.test(p.report.messaggio));
  installa(); fs.utimesSync(ex5, ora - 5000, ora - 5000); s = await verificaStatoInstallazione(ins);
  verifica("file compilato più vecchio della EA", s.stato === "da_riparare" && s.motivi.some((m) => /più vecchio/.test(m)));
  installa(); fs.writeFileSync(mq5, fs.readFileSync(mq5, "utf8").replace('#define EA_VERSIONE "1.5.0"', '#define EA_VERSIONE "1.4.7"')); fs.utimesSync(mq5, ora - 600, ora - 600); s = await verificaStatoInstallazione(ins);
  verifica("EA di un'altra versione", s.stato === "da_riparare" && s.versioneInstallata === "1.4.7" && s.motivi.some((m) => /1\.4\.7/.test(m) && /1\.5\.0/.test(m)));
  installa(); fs.appendFileSync(mq5, "\n// modificato\n"); fs.utimesSync(mq5, ora - 600, ora - 600); s = await verificaStatoInstallazione(ins);
  verifica("EA con la versione giusta ma contenuto diverso da quello incluso", s.stato === "da_riparare" && s.motivi.some((m) => /diverso/.test(m)));
  installa(); fs.unlinkSync(mq5); s = await verificaStatoInstallazione(ins);
  verifica("EA mancante con il solo file compilato", s.stato === "da_riparare" && s.motivi.some((m) => /Manca il file del collegamento/.test(m)));
  installa(); fs.unlinkSync(path.join(programma, "terminal64.exe")); s = await verificaStatoInstallazione(ins);
  verifica("MetaTrader 5 disinstallato", s.stato === "da_riparare" && s.motivi.some((m) => /non risulta più installato/.test(m)));
  fs.writeFileSync(path.join(programma, "terminal64.exe"), "");
  verifica("nessun motivo propone la compilazione a mano", !/\bF7\b|manualmente/i.test(JSON.stringify(s)));

  console.log("4 — esito di questa sessione e stato sul disco");
  installa(); s = await verificaStatoInstallazione(ins);
  const fallito = { messaggio: "La compilazione non è riuscita", azioniRichieste: ["errore reale"], bridge: { stato: "sorgente_copiato_compilazione_fallita" } };
  fs.unlinkSync(ex5); const rotto = await verificaStatoInstallazione(ins);
  p = passo3(rotto, fallito);
  verifica("installazione appena fallita: resta l'errore reale, non un generico 'ripara'", p.stato === "azione_richiesta" && p.report === fallito);
  const riuscito = { messaggio: "ok", azioniRichieste: [], bridge: { stato: "installato_e_compilato", versioneSorgenteCopiata: "1.5.0" } };
  verifica("un esito 'riuscito' ricordato NON basta se sul disco manca il file compilato", passo3(rotto, riuscito).stato === "azione_richiesta");
  verifica("la verifica non scrive nulla", fs.readdirSync(experts).join() === "DLM_Bridge_EA.mq5");

  console.log("5 — quale installazione");
  const altra = { cartellaDati: path.join(base, "Terminal", "A".repeat(32)) };
  verifica("una sola installazione: è quella, senza premere 'Seleziona'", scegliInstallazione({ installazioni: [ins] }) === ins);
  verifica("due installazioni e nessuna scelta: decide il cliente", scegliInstallazione({ installazioni: [ins, altra] }) === null);
  verifica("due installazioni: vale la scelta ricordata, se esiste ancora", scegliInstallazione({ installazioni: [ins, altra], cartellaSalvata: altra.cartellaDati }) === altra && scegliInstallazione({ installazioni: [ins, altra], cartellaSalvata: "C:\\sparita" }) === null);
  verifica("la scelta di questa sessione prevale, ma solo se è ancora rilevata", scegliInstallazione({ installazioni: [ins, altra], selezionata: { cartellaDati: ins.cartellaDati }, cartellaSalvata: altra.cartellaDati }) === ins && scegliInstallazione({ installazioni: [altra], selezionata: { cartellaDati: ins.cartellaDati } }) === altra);
  const main = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  verifica("su disco il Connector ricorda solo il percorso scelto, mai lo stato", /JSON\.stringify\(\{ cartellaDati \}\)/.test(main) && (main.match(/fs\.writeFile\(/g) || []).length === 1);
  verifica("lo stato viene riletto a ogni aggiornamento della schermata", /verificaStatoInstallazione\(installazioneSelezionata\)/.test(main));

  fs.rmSync(base, { recursive: true, force: true });
  console.log(`\nRISULTATO: ${ok} superati, ${ko} falliti`);
  process.exit(ko ? 1 : 0);
})();
