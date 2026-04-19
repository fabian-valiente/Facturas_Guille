/**
 * app.js
 * Controlador de la SPA: eventos, estado, orquestación.
 * Soporta extracción de una o múltiples facturas desde una sola imagen.
 */

const App = (() => {

  const state = { imageFile: null };

  const el = {
    uploadZone:        document.getElementById("uploadZone"),
    fileInput:         document.getElementById("fileInput"),
    preview:           document.getElementById("preview"),
    fileName:          document.getElementById("fileName"),
    clearBtn:          document.getElementById("clearBtn"),
    extractBtn:        document.getElementById("extractBtn"),
    status:            document.getElementById("status"),
    statusFill:        document.getElementById("statusFill"),
    statusText:        document.getElementById("statusText"),
    invoicesContainer: document.getElementById("invoicesContainer"),
    generateCard:      document.getElementById("generateCard"),
    generatePdfBtn:    document.getElementById("generatePdfBtn"),
    generateLabel:     document.getElementById("generateLabel"),
    numCuentaInput:    document.getElementById("num_cuenta"),
    fechaEmisionInput: document.getElementById("fecha_emision")
  };

  // ── Inicialización ────────────────────────────────────────────
  function init() {
    el.uploadZone.addEventListener("click", () => el.fileInput.click());
    el.uploadZone.addEventListener("dragover", e => {
      e.preventDefault(); e.stopPropagation();
      el.uploadZone.classList.add("dragover");
    });
    el.uploadZone.addEventListener("dragleave", e => {
      e.preventDefault(); e.stopPropagation();
      el.uploadZone.classList.remove("dragover");
    });
    el.uploadZone.addEventListener("drop", e => {
      e.preventDefault(); e.stopPropagation();
      el.uploadZone.classList.remove("dragover");
      if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });
    window.addEventListener("dragover", e => e.preventDefault());
    window.addEventListener("drop",     e => e.preventDefault());
    el.fileInput.addEventListener("change", e => {
      if (e.target.files.length > 0) handleFile(e.target.files[0]);
    });
    el.clearBtn.addEventListener("click", clearFile);
    el.extractBtn.addEventListener("click", runExtraction);
    el.generatePdfBtn.addEventListener("click", generateAllPdfs);
  }

  // ── Manejo de archivo ─────────────────────────────────────────
  function handleFile(file) {
    if (!file.type.startsWith("image/")) {
      alert("El archivo debe ser una imagen.");
      return;
    }
    state.imageFile = file;
    el.fileName.textContent = `Imagen cargada: ${file.name}`;
    el.preview.hidden    = false;
    el.uploadZone.hidden = true;
    el.extractBtn.disabled = false;
  }

  function clearFile() {
    state.imageFile = null;
    el.fileInput.value = "";
    el.preview.hidden    = true;
    el.uploadZone.hidden = false;
    el.extractBtn.disabled = true;
    el.invoicesContainer.innerHTML = "";
    el.generateCard.hidden = true;
    el.status.hidden       = true;
  }

  // ── Extracción ────────────────────────────────────────────────
  async function runExtraction() {
    if (!state.imageFile) return;
    el.extractBtn.disabled = true;
    el.status.hidden = false;
    setProgress(0.05, "Iniciando extracción…");

    try {
      // Extractor siempre retorna un array de facturas
      const invoices = await Extractor.extractInvoiceData(state.imageFile, (p, msg) => {
        setProgress(Math.max(0.1, p), msg);
      });

      const n = invoices.length;
      setProgress(1, `Extracción completada — ${n} factura${n !== 1 ? "s" : ""} detectada${n !== 1 ? "s" : ""}`);

      renderInvoices(invoices);
      el.generateCard.hidden = false;
      el.generateLabel.textContent = n > 1
        ? `Generar y descargar ${n} PDFs`
        : "Generar y descargar PDF";

      setTimeout(() => { el.status.hidden = true; }, 2000);
    } catch (err) {
      console.error(err);
      setProgress(0, "Error: " + err.message);
      el.extractBtn.disabled = false;
    }
  }

  function setProgress(fraction, message) {
    el.statusFill.style.width = Math.round(fraction * 100) + "%";
    el.statusText.textContent = message;
  }

  // ── Render de facturas ────────────────────────────────────────
  function renderInvoices(invoices) {
    el.invoicesContainer.innerHTML = "";
    invoices.forEach((invoice, idx) => {
      el.invoicesContainer.appendChild(buildInvoiceCard(invoice, idx, invoices.length));
    });
  }

  function buildInvoiceCard(invoice, idx, totalFacturas) {
    // Número de cuenta: usa el de la imagen o auto-incrementa desde el campo global
    const baseNum  = parseInt(el.numCuentaInput.value, 10) || 1;
    const numCuenta = invoice.numeroCuenta ?? String(baseNum + idx).padStart(4, "0");
    const fecha    = invoice.fechaEmision ?? el.fechaEmisionInput.value ?? todayIso();
    const obra     = invoice.obra ?? "no es legible";

    const section = document.createElement("section");
    section.className = "card invoice-card";
    section.style.setProperty("--delay", "0s");

    section.innerHTML = `
      <div class="card-head">
        <span class="step-num">${String(idx + 1).padStart(2, "0")}</span>
        <div style="flex:1; min-width:0">
          ${totalFacturas > 1 ? `<p class="card-desc" style="margin-bottom:10px">Factura ${idx + 1} de ${totalFacturas}</p>` : ""}
          <div class="invoice-meta-grid">
            <label>
              <span class="label-text">Obra / Proyecto</span>
              <input class="field-obra" type="text" value="${escapeHtml(obra)}" />
            </label>
            <label>
              <span class="label-text">Fecha emisión</span>
              <input class="field-fecha" type="date" value="${fecha}" />
            </label>
            <label>
              <span class="label-text">No. Cuenta</span>
              <input class="field-numero" type="text" value="${escapeHtml(numCuenta)}" style="max-width:90px" />
            </label>
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="items-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Descripción</th>
              <th>Valor (COP)</th>
              <th></th>
            </tr>
          </thead>
          <tbody class="items-tbody"></tbody>
          <tfoot>
            <tr>
              <td colspan="2" class="total-label">TOTAL</td>
              <td class="total-value total-cell">$ 0</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button class="btn-outline btn-add-item">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Agregar ítem
      </button>
    `;

    const tbody    = section.querySelector(".items-tbody");
    const totalCell = section.querySelector(".total-cell");

    (invoice.items || []).forEach(item => appendRow(tbody, item, totalCell));
    updateCardTotal(tbody, totalCell);

    section.querySelector(".btn-add-item").addEventListener("click", () => {
      appendRow(tbody, { fecha: todayIso(), descripcion: "", valor: 0 }, totalCell);
    });

    return section;
  }

  // ── Helpers de filas ─────────────────────────────────────────
  function appendRow(tbody, item, totalCell) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="date"   value="${item.fecha ?? ""}" /></td>
      <td><input type="text"   value="${escapeHtml(item.descripcion ?? "")}" /></td>
      <td><input type="number" min="0" step="1000" value="${item.valor ?? 0}" /></td>
      <td><button class="btn-remove" title="Eliminar">×</button></td>
    `;
    tr.querySelectorAll("input").forEach(inp =>
      inp.addEventListener("input", () => updateCardTotal(tbody, totalCell))
    );
    tr.querySelector(".btn-remove").addEventListener("click", () => {
      tr.remove();
      updateCardTotal(tbody, totalCell);
    });
    tbody.appendChild(tr);
  }

  function readItemsFromTbody(tbody) {
    return Array.from(tbody.querySelectorAll("tr")).map(row => {
      const inputs = row.querySelectorAll("input");
      return {
        fecha:       inputs[0].value,
        descripcion: inputs[1].value.trim(),
        valor:       parseInt(inputs[2].value, 10) || 0
      };
    });
  }

  function updateCardTotal(tbody, totalCell) {
    const total = readItemsFromTbody(tbody).reduce((s, it) => s + it.valor, 0);
    totalCell.textContent = formatCOP(total);
  }

  // ── Generación de PDFs ────────────────────────────────────────
  async function generateAllPdfs() {
    const cards = Array.from(el.invoicesContainer.querySelectorAll(".invoice-card"));
    if (cards.length === 0) {
      alert("No hay facturas para generar.");
      return;
    }

    const emisor = {
      nombre:   document.getElementById("emisor_nombre").value,
      cc:       document.getElementById("emisor_cc").value,
      direccion: document.getElementById("emisor_direccion").value,
      telefono: document.getElementById("emisor_telefono").value,
      celulares: document.getElementById("emisor_celulares").value,
      cuenta:   document.getElementById("emisor_cuenta").value
    };
    const deudor = {
      nombre: document.getElementById("deudor_nombre").value,
      nit:    document.getElementById("deudor_nit").value
    };

    el.generatePdfBtn.disabled = true;
    let generados = 0;

    try {
      for (const card of cards) {
        const items = readItemsFromTbody(card.querySelector(".items-tbody"))
          .filter(it => it.valor > 0);
        if (items.length === 0) continue;

        const payload = {
          emisor,
          deudor,
          numeroCuenta: card.querySelector(".field-numero").value || el.numCuentaInput.value,
          obra:         card.querySelector(".field-obra").value   || "OBRA",
          items,
          fechaEmision: card.querySelector(".field-fecha").value  || todayIso()
        };

        await PdfGenerator.build(payload);
        generados++;
        // Pausa entre descargas para evitar que el navegador las bloquee
        if (cards.length > 1) await new Promise(r => setTimeout(r, 800));
      }

      if (generados === 0) alert("Ninguna factura tiene ítems con valor.");
    } catch (err) {
      console.error("Error generando PDF:", err);
      alert("Error al generar el PDF: " + err.message);
    } finally {
      el.generatePdfBtn.disabled = false;
    }
  }

  // ── Utilidades ───────────────────────────────────────────────
  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatCOP(n) {
    return "$ " + n.toLocaleString("es-CO");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  document.addEventListener("DOMContentLoaded", init);

  return { state };
})();
