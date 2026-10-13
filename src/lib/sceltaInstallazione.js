// DLM Auto Connector — quale installazione di MetaTrader 5 è "quella del cliente".
//
// Funzione pura. Regole, nell'ordine:
//   1. quella scelta in questa sessione, se è ancora fra quelle rilevate;
//   2. se ne esiste una sola, quella (non c'è nulla da scegliere);
//   3. quella scelta in una sessione precedente, se è ancora rilevata;
//   4. altrimenti nessuna: con più installazioni decide il cliente.
// Ritorna sempre l'oggetto rilevato ORA, mai una copia vecchia.
function scegliInstallazione({ installazioni = [], selezionata = null, cartellaSalvata = null } = {}) {
  const trova = (cartella) => (cartella ? installazioni.find((i) => i.cartellaDati === cartella) || null : null);
  return trova(selezionata && selezionata.cartellaDati) || (installazioni.length === 1 ? installazioni[0] : null) || trova(cartellaSalvata);
}

module.exports = { scegliInstallazione };
