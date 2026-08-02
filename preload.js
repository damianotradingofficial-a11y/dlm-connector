// DLM Auto Connector — preload script.
//
// Espone alla UI (renderer, sandboxed) SOLO le funzioni necessarie, tramite
// contextBridge — mai accesso diretto a Node/filesystem dal renderer
// (contextIsolation: true, nodeIntegration: false, impostati in main.js).
// Nessun dato sensibile passa da qui: email/password inserite dal cliente
// stesso (mai salvate su disco), risultati di sola lettura/diagnosi, e le
// azioni di installazione/apertura MT5 — tutte già filtrate e verificate
// lato main.js (allowlist di scrittura in installBridge.js).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dlmConnector", {
  // Blocco 1
  login: (email, password) => ipcRenderer.invoke("dlm:login", { email, password }),
  logout: () => ipcRenderer.invoke("dlm:logout"),
  analizza: () => ipcRenderer.invoke("dlm:analizza"),
  // Blocco 2/3
  selezionaInstallazione: (indice) => ipcRenderer.invoke("dlm:selezionaInstallazione", { indice }),
  installaBridge: () => ipcRenderer.invoke("dlm:installaBridge"),
  generaConnectionReference: () => ipcRenderer.invoke("dlm:generaConnectionReference"),
  apriMt5: () => ipcRenderer.invoke("dlm:apriMt5"),
  versioni: () => ipcRenderer.invoke("dlm:versioni"),
  statoWizard: () => ipcRenderer.invoke("dlm:statoWizard"),
});
