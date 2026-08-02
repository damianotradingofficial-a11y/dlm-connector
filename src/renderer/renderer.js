// DLM Auto Connector — logica UI (renderer, sandboxed).
//
// Usa SOLO window.dlmConnector (esposto da preload.js via contextBridge) —
// nessun accesso diretto a Node/filesystem da qui. Nessuna regola di
// trading: questa schermata mostra solo stato tecnico di collegamento.

const elEmail = document.getElementById("email");
const elPassword = document.getElementById("password");
const elBtnLogin = document.getElementById("btnLogin");
const elStatoLogin = document.getElementById("statoLogin");
const elErroreLogin = document.getElementById("erroreLogin");
const elCardLogin = document.getElementById("cardLogin");
const elCardLoggato = document.getElementById("cardLoggato");
const elEmailLoggata = document.getElementById("emailLoggata");
const elBtnLogout = document.getElementById("btnLogout");
const elBtnAnalizza = document.getElementById("btnAnalizza");
const elStatoAnalisi = document.getElementById("statoAnalisi");
const elCardRisultato = document.getElementById("cardRisultato");
const elVoci = document.getElementById("voci");
const elCardProblemi = document.getElementById("cardProblemi");
const elProblemi = document.getElementById("problemi");

function mostraLoggato(email) {
  elCardLogin.classList.add("nascosto");
  elCardLoggato.classList.remove("nascosto");
  elEmailLoggata.textContent = email;
}

function mostraNonLoggato() {
  elCardLogin.classList.remove("nascosto");
  elCardLoggato.classList.add("nascosto");
}

elBtnLogin.addEventListener("click", async () => {
  elErroreLogin.classList.add("nascosto");
  elStatoLogin.textContent = "Accesso in corso…";
  elBtnLogin.disabled = true;
  try {
    const risultato = await window.dlmConnector.login(elEmail.value.trim(), elPassword.value);
    if (!risultato.ok) {
      elErroreLogin.textContent = risultato.errore || "Accesso non riuscito.";
      elErroreLogin.classList.remove("nascosto");
      elStatoLogin.textContent = "";
      return;
    }
    elPassword.value = "";
    elStatoLogin.textContent = "";
    mostraLoggato(risultato.email);
  } finally {
    elBtnLogin.disabled = false;
  }
});

elBtnLogout.addEventListener("click", async () => {
  await window.dlmConnector.logout();
  mostraNonLoggato();
});

function pallino(stato) {
  const span = document.createElement("span");
  span.className = `pallino ${stato}`;
  return span;
}

function renderRisultato({ diagnosi }) {
  elVoci.innerHTML = "";
  for (const voce of diagnosi.voci) {
    const riga = document.createElement("div");
    riga.className = "voce";
    const testo = document.createElement("div");
    testo.className = "voce-testo";
    const etichetta = document.createElement("div");
    etichetta.className = "voce-etichetta";
    etichetta.textContent = `${voce.stato === "ok" ? "✅" : voce.stato === "info" ? "•" : "⚠️"} ${voce.etichetta}`;
    const dettaglio = document.createElement("div");
    dettaglio.className = "voce-dettaglio";
    dettaglio.textContent = voce.dettaglio;
    testo.appendChild(etichetta);
    testo.appendChild(dettaglio);
    riga.appendChild(pallino(voce.stato));
    riga.appendChild(testo);
    elVoci.appendChild(riga);
  }
  elCardRisultato.classList.remove("nascosto");

  elProblemi.innerHTML = "";
  if (diagnosi.problemi.length === 0) {
    elCardProblemi.classList.add("nascosto");
  } else {
    for (const problema of diagnosi.problemi) {
      const div = document.createElement("div");
      div.className = "problema";
      const titolo = document.createElement("div");
      titolo.className = "problema-titolo";
      titolo.textContent = problema.titolo;
      const descrizione = document.createElement("div");
      descrizione.className = "problema-descrizione";
      descrizione.textContent = problema.descrizione;
      const soluzione = document.createElement("div");
      soluzione.className = "problema-soluzione";
      soluzione.textContent = `Soluzione consigliata: ${problema.soluzione || "—"}`;
      div.appendChild(titolo);
      div.appendChild(descrizione);
      div.appendChild(soluzione);
      elProblemi.appendChild(div);
    }
    elCardProblemi.classList.remove("nascosto");
  }
}

elBtnAnalizza.addEventListener("click", async () => {
  elStatoAnalisi.textContent = "Analisi in corso…";
  elBtnAnalizza.disabled = true;
  try {
    const risultato = await window.dlmConnector.analizza();
    elStatoAnalisi.textContent = "";
    renderRisultato(risultato);
  } catch (e) {
    elStatoAnalisi.textContent = `Errore: ${e.message}`;
  } finally {
    elBtnAnalizza.disabled = false;
  }
});
