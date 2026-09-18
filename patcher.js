import {
  decodeSyxElek,
  encodeSyxElek,
  extractMainOs,
  makeElupBin,
  replaceElekSection,
  setElekVersion,
  apPack,
  sha256Hex,
} from "./elektron.js";

const drop = document.getElementById("drop");
const fileInput = document.getElementById("file");
const statusEl = document.getElementById("status");
const buildBtn = document.getElementById("build");
const downloads = document.getElementById("downloads");

let patch = null;
let selected = null;

function setStatus(msg, kind = "") {
  statusEl.textContent = msg;
  statusEl.dataset.kind = kind;
}

function downloadBlob(name, bytes) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function applySpans(mainOs, spans) {
  const out = new Uint8Array(mainOs);
  for (const span of spans) {
    const data = Uint8Array.from(atob(span.data), (c) => c.charCodeAt(0));
    out.set(data, span.offset);
  }
  return out;
}

async function loadPatch() {
  const res = await fetch("./patch.json");
  if (!res.ok) throw new Error("failed to load patch.json");
  patch = await res.json();
  setStatus(`Ready. Expecting stock OS ${patch.base} → builds ${patch.name}.`);
}

function onFile(file) {
  selected = file;
  downloads.hidden = true;
  buildBtn.disabled = !file || !patch;
  setStatus(file ? `Selected: ${file.name} (${file.size.toLocaleString()} bytes)` : "No file selected.");
}

async function build() {
  if (!selected || !patch) return;
  buildBtn.disabled = true;
  downloads.hidden = true;
  try {
    setStatus("Reading .syx…");
    const buf = new Uint8Array(await selected.arrayBuffer());
    setStatus("Decoding ELEK container…");
    const { container, device } = decodeSyxElek(buf);
    setStatus("Extracting MAIN OS…");
    const mainOs = extractMainOs(container);
    if (mainOs.length !== patch.mainOsSize) {
      throw new Error(`unexpected MAIN OS size ${mainOs.length} (want ${patch.mainOsSize})`);
    }
    setStatus("Checking stock fingerprint…");
    const hash = await sha256Hex(mainOs);
    if (hash !== patch.stockSha256) {
      throw new Error(
        "MAIN OS hash does not match stock 1.40C. Use an unmodified OCTATRACK_OS1.40C.syx from Elektron.",
      );
    }
    setStatus("Applying 1.40MIDISC8.1 patch…");
    const patched = applySpans(mainOs, patch.spans);
    const patchedHash = await sha256Hex(patched);
    if (patchedHash !== patch.patchedSha256) {
      throw new Error("patched image hash mismatch — aborting");
    }
    setStatus("Compressing (this can take a bit)…");
    await new Promise((r) => setTimeout(r, 30));
    const packed = apPack(patched);
    setStatus("Writing version + repacking…");
    const nc = new Uint8Array(container);
    setElekVersion(nc, patch.splash || patch.name.slice(0, 10));
    const rebuilt = replaceElekSection(nc, packed);
    const syx = encodeSyxElek(rebuilt, device);
    const bin = makeElupBin(rebuilt);
    setStatus(`Done. Built ${patch.name}. Flash the .bin via CF → OS UPGRADE.`);
    downloads.hidden = false;
    downloads.querySelector("[data-dl=bin]").onclick = () => downloadBlob(`${patch.name}.bin`, bin);
    downloads.querySelector("[data-dl=syx]").onclick = () =>
      downloadBlob(`OCTATRACK_${patch.name}.syx`, syx);
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), "error");
  } finally {
    buildBtn.disabled = !selected;
  }
}

drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("drag");
});
drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("drag");
  const f = e.dataTransfer.files?.[0];
  if (f) onFile(f);
});
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) onFile(f);
});
buildBtn.addEventListener("click", build);

loadPatch().catch((err) => setStatus(err.message || String(err), "error"));
