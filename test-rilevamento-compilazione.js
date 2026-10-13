#!/usr/bin/env node
// PROVA — rilevamento di MetaTrader 5 e ricerca del compilatore (0.6.1).
// Nasce dal collaudo su Windows reale del 13/10/2026: con un solo MetaTrader
// installato il Connector 0.6.0 mostrava 3 installazioni e non compilava mai
// la EA, perché cercava metaeditor64.exe una cartella più in alto.
// Usa una cartella finta con la stessa forma di quella vera. Solo moduli builtin.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { enumeraInstallazioni, cartellaDatiValida, cartellaInstallazioneDaOrigin } = require("./src/lib/detectMt5.js");
const { cercaMetaEditor, trovaMetaEditor, interpretaRegistroCompilazione, generaReportInstallazione, installaBridge } = require("./src/lib/installBridge.js");

let ok = 0, ko = 0;
const verifica = (nome, cond, dettaglio = "") => { if (cond) { ok++; console.log(`  ✓ ${nome}`); } else { ko++; console.log(`  ✗ ${nome} ${dettaglio}`); } };
const origin = (cartella, testo) => fs.writeFileSync(path.join(cartella, "origin.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(testo, "utf16le")]));

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dlm-rilevamento-"));
  const terminali = path.join(base, "MetaQuotes", "Terminal");
  const programma = path.join(base, "Program Files", "MetaTrader 5");
  fs.mkdirSync(programma, { recursive: true });
  fs.writeFileSync(path.join(programma, "terminal64.exe"), "");
  fs.writeFileSync(path.join(programma, "metaeditor64.exe"), "");
  const HASH = "D0E8209F77C8CF37AD8BF550E51FF075";
  // Come su Windows vero: una cartella dati più le cartelle di servizio.
  fs.mkdirSync(path.join(terminali, HASH, "MQL5", "Experts"), { recursive: true });
  origin(path.join(terminali, HASH), programma);
  fs.mkdirSync(path.join(terminali, "Common", "Files"), { recursive: true });
  fs.mkdirSync(path.join(terminali, "Community"), { recursive: true });
  fs.mkdirSync(path.join(terminali, "Help"), { recursive: true });

  console.log("1 — rilevamento");
  let r = await enumeraInstallazioni(terminali);
  verifica("con un solo MetaTrader 5 viene proposta 1 installazione", r.installazioni.length === 1, `${r.installazioni.length}`);
  const ins = r.installazioni[0] || {};
  verifica("è la cartella dati vera", path.basename(ins.cartellaDati || "") === HASH);
  verifica("la cartella di installazione viene da origin.txt", ins.cartellaInstallazione === programma, ins.cartellaInstallazione);
  verifica("il programma è terminal64.exe dentro quella cartella (non la cartella)", ins.percorsoEseguibile === path.join(programma, "terminal64.exe"), ins.percorsoEseguibile);
  verifica("Common, Community e Help non sono nomi di cartelle dati", !cartellaDatiValida("Common") && !cartellaDatiValida("Community") && !cartellaDatiValida("Help") && cartellaDatiValida(HASH));

  // Terminale disinstallato: resta la cartella dati, il programma non c'è più.
  const HASH2 = "A".repeat(32);
  fs.mkdirSync(path.join(terminali, HASH2, "MQL5", "Experts"), { recursive: true });
  origin(path.join(terminali, HASH2), path.join(base, "Program Files", "Rimosso"));
  // Cartella dati senza MQL5\Experts (mai avviato, oppure MetaTrader 4).
  const HASH3 = "B".repeat(32);
  fs.mkdirSync(path.join(terminali, HASH3, "MQL4", "Experts"), { recursive: true });
  origin(path.join(terminali, HASH3), programma);
  // Cartella dati senza origin.txt.
  const HASH4 = "C".repeat(32);
  fs.mkdirSync(path.join(terminali, HASH4, "MQL5", "Experts"), { recursive: true });
  r = await enumeraInstallazioni(terminali);
  verifica("terminale disinstallato, senza MQL5\\Experts o senza origine: non proposti", r.installazioni.length === 1 && path.basename(r.installazioni[0].cartellaDati) === HASH, r.installazioni.map((i) => path.basename(i.cartellaDati)).join(","));
  r = await enumeraInstallazioni(path.join(base, "non-esiste"));
  verifica("MetaTrader mai installato: elenco vuoto, nessun errore", r.installazioni.length === 0 && !r.erroreLettura);

  console.log("2 — origin.txt");
  verifica("cartella con spazi, BOM e a capo finale", cartellaInstallazioneDaOrigin("\uFEFFC:\\Program Files\\MetaTrader 5\r\n") === "C:\\Program Files\\MetaTrader 5");
  verifica("accetta anche il percorso del programma", cartellaInstallazioneDaOrigin("C:\\Program Files\\Axi MT5\\terminal64.exe") === "C:\\Program Files\\Axi MT5");
  verifica("vuoto: nessuna cartella", cartellaInstallazioneDaOrigin("") === null && cartellaInstallazioneDaOrigin(null) === null);

  console.log("3 — ricerca del compilatore");
  const atteso = path.join(programma, "metaeditor64.exe");
  verifica("trovato a partire dall'installazione rilevata", (await trovaMetaEditor(ins)) === atteso);
  verifica("trovato anche dal solo percorso di terminal64.exe", (await trovaMetaEditor(path.join(programma, "terminal64.exe"))) === atteso);
  verifica("trovato anche se viene passata la cartella (il caso che falliva nella 0.6.0)", (await trovaMetaEditor(programma)) === atteso);
  const assente = await cercaMetaEditor({ cartellaInstallazione: path.join(base, "Program Files", "Rimosso") });
  verifica("se manca, dice dove ha cercato", assente.percorso === null && assente.cercatoIn.length === 1 && assente.cercatoIn[0].endsWith("metaeditor64.exe"));

  console.log("4 — esito scritto dal compilatore");
  const buono = interpretaRegistroCompilazione("\uFEFFC:\\x\\DLM_Bridge_EA.mq5 : information: compiling\r\nResult: 0 errors, 0 warnings, 2890 msec elapsed\r\n");
  verifica("0 errori, 0 avvisi", buono.errori === 0 && buono.avvisi === 0 && buono.righeErrore.length === 0);
  const rotto = interpretaRegistroCompilazione("DLM_Bridge_EA.mq5(12,3) : error 149: 'x' - undeclared identifier\r\nResult: 1 errors, 0 warnings\r\n");
  verifica("errore riportato così com'è", rotto.errori === 1 && rotto.righeErrore.length === 1 && /undeclared identifier/.test(rotto.righeErrore[0]));

  console.log("5 — cosa vede il cliente");
  const comune = { cartellaExperts: "X", backupMq5: null, backupEx5: null, versioneInstallata: "1.5.0" };
  const nonTrovato = generaReportInstallazione({ ...comune, percorsoMetaEditorTrovato: null, metaEditorCercatoIn: ["C:\\Program Files\\MetaTrader 5\\metaeditor64.exe"], esitoCompilazione: { tentata: false, righeErrore: [] }, compilazioneRiuscita: false, ex5Presente: false });
  verifica("compilatore non trovato: detto esplicitamente, con la cartella", nonTrovato.bridge.stato !== "installato_e_compilato" && /non trovato/i.test(nonTrovato.messaggio) && nonTrovato.azioniRichieste.some((a) => a.includes("C:\\Program Files\\MetaTrader 5\\metaeditor64.exe")));
  const vecchioEx5 = generaReportInstallazione({ ...comune, percorsoMetaEditorTrovato: null, esitoCompilazione: { tentata: false, righeErrore: [] }, compilazioneRiuscita: false, ex5Presente: true });
  verifica("un file compilato vecchio non fa dichiarare riuscita l'installazione", vecchioEx5.bridge.stato === "sorgente_copiato_compilazione_non_disponibile");
  const fallita = generaReportInstallazione({ ...comune, percorsoMetaEditorTrovato: atteso, esitoCompilazione: { tentata: true, errori: 1, avvisi: 0, righeErrore: rotto.righeErrore }, compilazioneRiuscita: false, ex5Presente: false });
  verifica("compilazione fallita: mostra l'errore reale del compilatore", fallita.bridge.stato === "sorgente_copiato_compilazione_fallita" && fallita.azioniRichieste.some((a) => /undeclared identifier/.test(a)));
  const nessunFile = generaReportInstallazione({ ...comune, percorsoMetaEditorTrovato: atteso, esitoCompilazione: { tentata: true, errori: 0, avvisi: 0, righeErrore: [] }, compilazioneRiuscita: false, ex5Presente: false });
  verifica("compilatore eseguito ma file compilato assente: non è un successo", nessunFile.bridge.stato === "sorgente_copiato_compilazione_fallita" && nessunFile.azioniRichieste.some((a) => /non è stato creato/.test(a)));
  const riuscita = generaReportInstallazione({ ...comune, percorsoMetaEditorTrovato: atteso, esitoCompilazione: { tentata: true, errori: 0, avvisi: 0, righeErrore: [] }, compilazioneRiuscita: true, ex5Presente: true });
  verifica("successo: stato, versione e messaggio chiari, nessuna azione richiesta", riuscita.bridge.stato === "installato_e_compilato" && /1\.5\.0/.test(riuscita.messaggio) && /verificato/.test(riuscita.messaggio) && riuscita.azioniRichieste.length === 0);
  const tutti = [nonTrovato, vecchioEx5, fallita, nessunFile, riuscita];
  verifica("nessun messaggio propone la compilazione a mano come procedura", !tutti.some((t) => /F7|manualmente/i.test(JSON.stringify(t))));
  verifica("ogni esito ha un messaggio non vuoto", tutti.every((t) => typeof t.messaggio === "string" && t.messaggio.trim().length > 10));

  console.log("6 — installazione su cartella finta (compilatore finto che non produce nulla)");
  const rep = await installaBridge(ins).catch((e) => ({ errore: e.message }));
  verifica("la EA viene copiata e l'esito non è un falso successo", !rep.errore && fs.existsSync(path.join(ins.cartellaDati, "MQL5", "Experts", "DLM_Bridge_EA.mq5")) && rep.bridge.stato !== "installato_e_compilato" && rep.compilazione.metaEditorTrovato === true, JSON.stringify(rep).slice(0, 200));
  verifica("nella cartella Experts c'è solo il file del collegamento (nessun registro lasciato)", fs.readdirSync(path.join(ins.cartellaDati, "MQL5", "Experts")).join() === "DLM_Bridge_EA.mq5");

  console.log("7 — riquadri");
  const html = fs.readFileSync(path.join(__dirname, "src/renderer/wizard.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "src/renderer/wizard.js"), "utf8");
  verifica("un riquadro nascosto resta nascosto anche se la sua classe imposta 'display'", /\.nascosto\s*\{\s*display:\s*none\s*!important;/.test(html));
  verifica("il riquadro dell'esito compare solo con un testo", /righe\.length === 0[\s\S]{0,80}classList\.add\("nascosto"\)/.test(js));
  verifica("il Connector apre MetaTrader con il programma, non con la cartella", /execFile\(percorso, \[\]/.test(fs.readFileSync(path.join(__dirname, "main.js"), "utf8")));

  fs.rmSync(base, { recursive: true, force: true });
  console.log(`\nRISULTATO: ${ok} superati, ${ko} falliti`);
  process.exit(ko ? 1 : 0);
})();
