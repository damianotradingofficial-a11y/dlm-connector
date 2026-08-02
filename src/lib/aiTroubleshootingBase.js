// DLM Auto Connector — AI Troubleshooting, BASE (Blocco 4).
//
// Questo NON è un'intelligenza artificiale vera: è la predisposizione
// dichiarata da Damiano ("preparare la base... collegamento futuro DLM AI
// Assistant") — arricchisce in modo deterministico (nessuna chiamata a un
// modello linguistico) i problemi già calcolati da diagnostics.js con
// severità, una spiegazione un po' più estesa, e passi concreti — nello
// STESSO formato che un giorno un vero DLM AI Assistant potrebbe leggere e
// arricchire ulteriormente (o semplicemente riusare così com'è).
//
// Nessuna logica di diagnosi duplicata qui: prende in input l'output già
// calcolato da calcolaDiagnosi() (diagnostics.js) e lo trasforma, non lo
// ricalcola. Se diagnostics.js cambia, questo file si adatta automaticamente
// finché la forma { titolo, descrizione, soluzione } resta la stessa.
//
// v1.1 (Hardening Fase 4 — richiesta esplicita di Damiano: "collegare
// problemi agli step corretti del wizard", "migliorare messaggi soluzione"):
// 1) ogni problema arricchito porta ora anche `stepChiave` (passato invariato
//    da diagnostics.js) e `messaggio`, una versione breve e autonoma pensata
//    per essere mostrata DENTRO la card dello step interessato (a differenza
//    di formattaMessaggioAssistente(), che riassume TUTTI i problemi insieme
//    per il riepilogo generale in cima al wizard — i due restano entrambi
//    disponibili, usi diversi). 2) rimossi due residui di linguaggio tecnico
//    ("connection reference" tra parentesi, riferimenti a "Blocco 2"/pagine
//    del sito non più il percorso principale ora che il Connector fa tutto
//    da sé) dai testi rivolti al cliente.

// Arricchimento noto per i problemi già previsti da diagnostics.js. Chiave =
// titolo esatto del problema. Se in futuro diagnostics.js aggiunge nuovi
// problemi non presenti qui, FALLBACK_GENERICO sotto garantisce comunque un
// risultato strutturato e onesto, mai un errore.
const ARRICCHIMENTO_NOTO = {
  "MetaTrader 5 non trovato": {
    codice: "mt5_non_trovato",
    livelloSeverita: "bloccante",
    spiegazioneEstesa:
      "Il Connector non ha trovato nessuna cartella dati di MetaTrader 5 sul tuo computer. Questo succede quasi sempre perché MT5 non è ancora installato, oppure perché non è mai stato avviato almeno una volta (MT5 crea la sua cartella dati al primo avvio, non all'installazione).",
    passiSuggeriti: [
      "Installa MetaTrader 5 dal sito del tuo broker (o da metatrader5.com se non hai ancora scelto un broker).",
      "Aprilo almeno una volta, anche senza fare login.",
      "Torna qui e premi di nuovo Analizza.",
    ],
  },
  "MT5 non è aperto": {
    codice: "mt5_non_aperto",
    livelloSeverita: "attenzione",
    spiegazioneEstesa:
      "MetaTrader 5 è installato ma non risulta in esecuzione in questo momento. Il Bridge funziona solo mentre MT5 è aperto e collegato al tuo conto.",
    passiSuggeriti: ["Apri MetaTrader 5.", "Accedi al tuo conto.", "Lascialo aperto mentre usi DLM."],
  },
  "Bridge DLM non installato": {
    codice: "bridge_non_installato",
    livelloSeverita: "bloccante",
    spiegazioneEstesa:
      "MetaTrader 5 è presente ma il file del Bridge DLM non è ancora nella cartella Experts. Senza il Bridge, DLM non può leggere lo stato del tuo conto né (in futuro) inviare ordini.",
    passiSuggeriti: [
      'Usa "Installa il collegamento" qui nel Connector, allo step "Collegamento DLM", per copiarlo automaticamente.',
    ],
  },
  "Nessuna chiave di collegamento": {
    codice: "connection_reference_mancante",
    livelloSeverita: "attenzione",
    spiegazioneEstesa:
      "Non hai ancora una chiave personale DLM. Questa chiave collega il Bridge sul tuo PC al tuo account DLM — senza di essa il Bridge non sa a quale cliente appartiene.",
    passiSuggeriti: ["Genera la tua chiave qui nel Connector, allo step \"Attivazione\".", "Incollala quando richiesta durante il collegamento in MT5."],
  },
  "Il Bridge non risponde": {
    codice: "heartbeat_assente",
    livelloSeverita: "bloccante",
    spiegazioneEstesa:
      "Non arriva nessun aggiornamento recente dal Bridge. Le cause più comuni sono: MT5 chiuso, Trading Algoritmico disattivato, l'EA non è più attaccato al grafico, oppure l'URL dell'API DLM non è autorizzato in WebRequest.",
    passiSuggeriti: [
      "Verifica che MT5 sia aperto e connesso a internet.",
      "Verifica che l'icona \"Trading Algoritmico\" sia attiva (verde) nella barra strumenti.",
      "Verifica che l'Expert Advisor sia ancora attaccato a un grafico (angolo in alto a destra del grafico, faccina sorridente = attivo).",
    ],
  },
  "Errore critico riportato dal Bridge": {
    codice: "errore_critico_bridge",
    livelloSeverita: "bloccante",
    spiegazioneEstesa:
      "Il Bridge stesso ha segnalato un errore che impedisce il suo corretto funzionamento — il messaggio esatto riportato sotto viene direttamente da MT5/dal Bridge, non è un'ipotesi del Connector.",
    passiSuggeriti: [], // la soluzione specifica arriva già da diagnostics.js (suggerimentoPerErrore) — qui non aggiungiamo passi generici che potrebbero confondere.
  },
};

const FALLBACK_GENERICO = {
  codice: "problema_non_catalogato",
  livelloSeverita: "attenzione",
  spiegazioneEstesa: null, // usa descrizione originale, vedi arricchisciProblema
  passiSuggeriti: null, // usa soluzione originale come unico passo, vedi arricchisciProblema
};

/**
 * Messaggio breve e autonomo per UN SOLO problema — pensato per essere
 * mostrato dentro la card dello step del wizard a cui il problema è
 * collegato (v1.1), non nel riepilogo generale (quello resta
 * formattaMessaggioAssistente, più sotto, che parla di TUTTI i problemi
 * insieme). Stesso principio dichiarato di formattaMessaggioAssistente:
 * nessuna invenzione, solo i dati già calcolati.
 */
function formattaMessaggioProblema({ titolo, spiegazioneEstesa, passiSuggeriti }) {
  const passi = passiSuggeriti && passiSuggeriti.length > 0 ? ` ${passiSuggeriti.join(" ")}` : "";
  return `${titolo}. ${spiegazioneEstesa}${passi}`;
}

/**
 * Arricchisce un singolo problema (forma { titolo, descrizione, soluzione }
 * da diagnostics.js) con severità/spiegazione estesa/passi. Mai perde
 * l'informazione originale: descrizione e soluzione restano sempre presenti
 * nel risultato, anche quando non c'è un arricchimento noto per quel titolo.
 */
function arricchisciProblema(problema) {
  const noto = ARRICCHIMENTO_NOTO[problema.titolo] || FALLBACK_GENERICO;
  const spiegazioneEstesa = noto.spiegazioneEstesa || problema.descrizione;
  const passiSuggeriti = noto.passiSuggeriti && noto.passiSuggeriti.length > 0 ? noto.passiSuggeriti : [problema.soluzione].filter(Boolean);
  return {
    titolo: problema.titolo,
    // v1.1 — instradamento verso lo step corretto del wizard (vedi
    // diagnostics.js), passato invariato: null se un problema futuro non lo
    // avesse ancora impostato, mai un errore.
    stepChiave: problema.stepChiave ?? null,
    descrizioneOriginale: problema.descrizione,
    soluzioneOriginale: problema.soluzione,
    codice: noto.codice,
    livelloSeverita: noto.livelloSeverita,
    spiegazioneEstesa,
    passiSuggeriti,
    // v1.1 — versione breve per la visualizzazione contestuale dentro la
    // card dello step (vedi formattaMessaggioProblema più sotto: stessa
    // logica, incapsulata qui per non doverla ricalcolare nel renderer).
    messaggio: formattaMessaggioProblema({ titolo: problema.titolo, spiegazioneEstesa, passiSuggeriti }),
    prontoPerAiAssistant: true,
  };
}

/**
 * Arricchisce l'intero array problemi di calcolaDiagnosi(). Pura funzione di
 * trasformazione, nessun effetto collaterale.
 */
function arricchisciDiagnosi(diagnosi) {
  const problemiArricchiti = (diagnosi?.problemi || []).map(arricchisciProblema);
  const bloccanti = problemiArricchiti.filter((p) => p.livelloSeverita === "bloccante").length;
  return {
    statoGenerale: diagnosi?.statoGenerale ?? null,
    problemiArricchiti,
    riepilogo: {
      totale: problemiArricchiti.length,
      bloccanti,
      attenzione: problemiArricchiti.length - bloccanti,
    },
  };
}

/**
 * Genera un messaggio in linguaggio naturale, template deterministico (NON
 * generato da un modello) — pensato per essere esattamente il tipo di
 * risposta che un futuro DLM AI Assistant darebbe leggendo lo stesso stato,
 * come descritto esplicitamente da Damiano: "Ho analizzato il Connector. Il
 * problema è X. Ti guido nella soluzione." Nessuna invenzione: usa solo i
 * dati già calcolati, mai un'ipotesi su cause non diagnosticate.
 */
function formattaMessaggioAssistente(diagnosiArricchita) {
  const { problemiArricchiti, riepilogo } = diagnosiArricchita;

  if (problemiArricchiti.length === 0) {
    return "Ho analizzato il Connector: non risultano problemi. Tutto configurato correttamente.";
  }

  const piuGrave =
    problemiArricchiti.find((p) => p.livelloSeverita === "bloccante") || problemiArricchiti[0];

  const intro =
    riepilogo.totale === 1
      ? "Ho analizzato il Connector. Ho trovato un problema."
      : `Ho analizzato il Connector. Ho trovato ${riepilogo.totale} problemi (${riepilogo.bloccanti} bloccant${riepilogo.bloccanti === 1 ? "e" : "i"}).`;

  const dettaglio = `Il più importante: ${piuGrave.titolo}. ${piuGrave.spiegazioneEstesa}`;
  const passi = piuGrave.passiSuggeriti.length > 0 ? ` Ti guido nella soluzione: ${piuGrave.passiSuggeriti.join(" ")}` : "";

  return `${intro} ${dettaglio}${passi}`;
}

module.exports = { arricchisciDiagnosi, formattaMessaggioAssistente, formattaMessaggioProblema };
