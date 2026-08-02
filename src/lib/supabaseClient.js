// DLM Auto Connector — client Supabase (SOLA LETTURA in questo blocco).
//
// Stesso identico pattern del sito (lib/supabaseClient.js in damiano-app-3):
// un client Supabase con l'URL pubblico del progetto e la ANON KEY pubblica
// (per design — la sicurezza vera è la RLS lato database, non la segretezza
// di questa chiave). Il Connector NON usa mai la Service Role Key: legge
// solo le righe del cliente che ha appena fatto login, protette dalle
// stesse policy RLS già in produzione (mt5_accounts_select_own,
// mt5_bridge_heartbeat_select_own) — nessuna nuova policy, nessuna
// modifica lato server necessaria per questo blocco.
//
// Config: URL/ANON KEY non sono hardcoded qui (anche se pubblici, restano
// fuori dal codice sorgente per coerenza con il resto del progetto) — letti
// da config.json (creato da Damiano copiando config.example.json, mai
// committato) o da variabili d'ambiente DLM_SUPABASE_URL/DLM_SUPABASE_ANON_KEY.
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function leggiConfig() {
  const percorsoConfig = path.join(__dirname, "..", "..", "config.json");
  let daFile = {};
  try {
    daFile = JSON.parse(fs.readFileSync(percorsoConfig, "utf8"));
  } catch {
    daFile = {};
  }
  return {
    url: process.env.DLM_SUPABASE_URL || daFile.supabaseUrl || null,
    anonKey: process.env.DLM_SUPABASE_ANON_KEY || daFile.supabaseAnonKey || null,
  };
}

let clienteSingleton = null;

function creaClienteSupabase() {
  if (clienteSingleton) return clienteSingleton;
  const { url, anonKey } = leggiConfig();
  if (!url || !anonKey) {
    throw new Error(
      "Configurazione Supabase mancante: crea dlm-connector/config.json (vedi config.example.json) con supabaseUrl/supabaseAnonKey, oppure imposta DLM_SUPABASE_URL/DLM_SUPABASE_ANON_KEY."
    );
  }
  clienteSingleton = createClient(url, anonKey);
  return clienteSingleton;
}

/** Login cliente con le stesse credenziali del sito (Supabase Auth). */
async function accediCliente(email, password) {
  const supabase = creaClienteSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { session: null, error: "Email o password non corretti." };
  return { session: data.session, error: null };
}

// Stesso alfabeto/formato di app/dashboard/collega-mt5/page.js (generaChiave)
// — RIUSATO, non reinventato: la chiave deve avere lo stesso aspetto sia che
// il cliente la generi dal sito sia che la generi dal Connector, ed essere
// scritta nella STESSA tabella con le STESSE policy RLS.
const ALFABETO_CHIAVE = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // niente 0/O/1/I

function segmentoChiave(lunghezza) {
  let s = "";
  for (let i = 0; i < lunghezza; i++) {
    s += ALFABETO_CHIAVE[Math.floor(Math.random() * ALFABETO_CHIAVE.length)];
  }
  return s;
}

function generaChiaveConnessione() {
  return `DLM-${segmentoChiave(4)}-${segmentoChiave(4)}-${segmentoChiave(4)}`;
}

/**
 * Genera (o restituisce, se già esiste) la connection_reference del cliente
 * loggato. IDEMPOTENTE: se il cliente ha già una riga in mt5_accounts, la
 * restituisce invece di crearne una seconda — il Connector può chiamarla in
 * qualunque momento del wizard senza dover prima controllare a mano se
 * esiste già un account. Stessa tabella, stessa RLS, stessa gestione
 * collisione (retry singolo su errore 23505) della pagina web collega-mt5:
 * nessuna logica nuova, solo la stessa già in produzione, riusata da qui.
 */
async function generaConnectionReference() {
  const supabase = creaClienteSupabase();
  const { data: sessioneAttuale } = await supabase.auth.getSession();
  if (!sessioneAttuale?.session) {
    throw new Error("Nessuna sessione attiva: effettua il login prima di generare la chiave.");
  }
  const userId = sessioneAttuale.session.user.id;

  const { data: esistente, error: erroreLettura } = await supabase
    .from("mt5_accounts")
    .select("connection_reference")
    .eq("user_id", userId)
    .maybeSingle();
  if (erroreLettura) throw erroreLettura;
  if (esistente?.connection_reference) {
    return { connectionReference: esistente.connection_reference, appenaGenerata: false };
  }

  const primoTentativo = await supabase
    .from("mt5_accounts")
    .insert({ user_id: userId, connection_reference: generaChiaveConnessione(), status: "non_connesso" })
    .select("connection_reference")
    .single();

  if (primoTentativo.error) {
    if (primoTentativo.error.code === "23505") {
      const secondoTentativo = await supabase
        .from("mt5_accounts")
        .insert({ user_id: userId, connection_reference: generaChiaveConnessione(), status: "non_connesso" })
        .select("connection_reference")
        .single();
      if (secondoTentativo.error) throw secondoTentativo.error;
      return { connectionReference: secondoTentativo.data.connection_reference, appenaGenerata: true };
    }
    throw primoTentativo.error;
  }

  return { connectionReference: primoTentativo.data.connection_reference, appenaGenerata: true };
}

/**
 * Legge (sola lettura, RLS "solo le mie righe") lo stato del collegamento
 * MT5 del cliente attualmente loggato: riga mt5_accounts + eventuale riga
 * mt5_bridge_heartbeat collegata. Nessuna scrittura.
 */
async function leggiStatoRemoto() {
  const supabase = creaClienteSupabase();
  const { data: sessioneAttuale } = await supabase.auth.getSession();
  if (!sessioneAttuale?.session) {
    throw new Error("Nessuna sessione attiva: effettua il login prima di analizzare.");
  }
  const userId = sessioneAttuale.session.user.id;

  const { data: account, error: erroreAccount } = await supabase
    .from("mt5_accounts")
    .select("id, status, broker, account_number_masked, last_sync_at, last_error, equity_corrente, connection_reference")
    .eq("user_id", userId)
    .maybeSingle();
  if (erroreAccount) throw erroreAccount;

  let heartbeat = null;
  if (account) {
    const { data: hb, error: erroreHb } = await supabase
      .from("mt5_bridge_heartbeat")
      .select("ultimo_ping_at, versione_ea, stato, ultimo_errore_critico, ultimo_errore_critico_at")
      .eq("mt5_account_id", account.id)
      .maybeSingle();
    if (erroreHb) throw erroreHb;
    heartbeat = hb || null;
  }

  return { account: account || null, heartbeat };
}

module.exports = { creaClienteSupabase, accediCliente, leggiStatoRemoto, generaConnectionReference };
