/**
 * pdf-generator.js
 * Generación del PDF de Cuenta de Cobro siguiendo el formato fiscal colombiano
 * (Régimen Simplificado, Resolución 1165/96, Código 304).
 *
 * Librerías: jsPDF + jsPDF-AutoTable.
 */

const PdfGenerator = (() => {

  const DRIVE_ID = "1iX7d9gy73yopIchdXp44rtRxj7RLanPx";

  // URLs candidatas para la firma (en orden de preferencia)
  const FIRMA_URLS = [
    `https://lh3.googleusercontent.com/d/${DRIVE_ID}`,
    `https://drive.google.com/thumbnail?id=${DRIVE_ID}&sz=w800`,
    `https://drive.google.com/uc?id=${DRIVE_ID}&export=download`,
    "./firma.png"
  ];

  let _firmaDataUrl = null;
  let _firmaPromise  = null;

  // Descarga una URL como base64 usando fetch + FileReader (evita el tainted-canvas de CORS)
  async function _fetchBase64(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) return null;
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  }

  async function _precargarFirma() {
    for (const url of FIRMA_URLS) {
      const dataUrl = await _fetchBase64(url);
      if (dataUrl) {
        _firmaDataUrl = dataUrl;
        console.log("Firma cargada:", url);
        return;
      }
    }
    console.warn("Firma no disponible: se dibujará línea de firma.");
  }

  _firmaPromise = _precargarFirma();

  /**
   * Construye el PDF y dispara la descarga.
   * @param {object} data - Ver shape en app.js::generatePdf
   */
  async function build(data) {
    // Espera a que la firma esté lista (normalmente ya cargó)
    await _firmaPromise;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "letter" });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let y = margin;

    // ==========================================================
    // ENCABEZADO
    // ==========================================================
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Medellín, ${formatLongDate(data.fechaEmision)}`, pageWidth - margin, y + 6, { align: "right" });

    y += 18;

    doc.setFontSize(14);
    doc.text(`CUENTA DE COBRO No. ${data.numeroCuenta}`, pageWidth / 2, y, { align: "center" });

    y += 12;

    // ==========================================================
    // DATOS DEL DEUDOR
    // ==========================================================
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(data.deudor.nombre, margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text(`NIT: ${data.deudor.nit}`, margin, y);
    y += 8;

    // ==========================================================
    // DEBE A
    // ==========================================================
    doc.setFont("helvetica", "bold");
    doc.text("DEBE A:", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text(data.emisor.nombre, margin, y);
    y += 5;
    doc.text(`C.C. No. ${data.emisor.cc}`, margin, y);
    y += 8;

    // ==========================================================
    // SUMA EN LETRAS
    // ==========================================================
    const total = data.items.reduce((s, it) => s + it.valor, 0);
    const totalEnLetras = numberToSpanishWords(total);

    doc.setFont("helvetica", "bold");
    doc.text("LA SUMA DE:", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");

    const sumaLinea = `${formatCOP(total)} ${totalEnLetras} pesos colombianos`;
    const wrappedSuma = doc.splitTextToSize(sumaLinea, pageWidth - margin * 2);
    doc.text(wrappedSuma, margin, y);
    y += wrappedSuma.length * 5 + 4;

    // ==========================================================
    // TABLA RESUMEN (opcional, formal)
    // ==========================================================
    doc.autoTable({
      startY: y,
      head: [["Fecha", "Descripción", "Valor (COP)"]],
      body: data.items.map(it => [
        formatDateDDMMYYYY(it.fecha),
        `${it.descripcion} – obra ${data.obra}`,
        formatCOP(it.valor)
      ]),
      foot: [["", "TOTAL", formatCOP(total)]],
      theme: "grid",
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [31, 58, 138], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 28 },
        2: { cellWidth: 35, halign: "right" }
      }
    });

    y = doc.lastAutoTable.finalY + 16;

    // ==========================================================
    // FIRMA
    // ==========================================================
    if (y > 210) { doc.addPage(); y = margin; }

    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Firma:", margin, y);
    y += 4;

    if (_firmaDataUrl) {
      doc.addImage(_firmaDataUrl, "PNG", margin, y, 60, 24);
      y += 28;
    } else {
      doc.setDrawColor(0);
      doc.setLineWidth(0.4);
      doc.line(margin, y + 14, margin + 70, y + 14);
      y += 18;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(data.emisor.nombre.toUpperCase(), margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text(`C.C.: ${data.emisor.cc}`, margin, y);
    y += 5;
    doc.text(`Dirección: ${data.emisor.direccion}`, margin, y);
    y += 5;
    doc.text(`Teléfono fijo: ${data.emisor.telefono}`, margin, y);
    y += 5;
    doc.text(`Celulares: ${data.emisor.celulares}`, margin, y);
    y += 5;
    doc.text(`Cuenta de Ahorros Bancolombia No. ${data.emisor.cuenta}`, margin, y);
    y += 5;
    doc.text(`Titular: ${data.emisor.nombre} – C.C. ${data.emisor.cc}`, margin, y);
    y += 8;

    // ==========================================================
    // NOTA LEGAL
    // ==========================================================
    if (y > 250) { doc.addPage(); y = margin; }

    doc.setFontSize(8);
    doc.setTextColor(90);
    const nota = "Presentamos esta cuenta de cobro, la cual ha sido elaborada electrónicamente. " +
      "Según lo establecido en la Resolución 1165/96, esta cuenta no está sujeta a los " +
      "requisitos de impresión tradicionales. Operamos bajo el Régimen Simplificado, por lo " +
      "cual no somos responsables del cobro del impuesto a las ventas (IVA), ni actuamos como " +
      "agentes retenedores. Esta cuenta se identifica con el Código 304.";
    const wrappedNota = doc.splitTextToSize(nota, pageWidth - margin * 2);
    doc.text(wrappedNota, margin, y);

    // ==========================================================
    // DESCARGA
    // ==========================================================
    const obraArchivo = data.obra
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toUpperCase().replace(/\s+/g, "_");
    const filename = `${obraArchivo}_${data.fechaEmision}.pdf`;
    doc.save(filename);
  }

  // ============================================================
  // UTILIDADES
  // ============================================================

  function formatCOP(n) {
    return "$" + Number(n).toLocaleString("es-CO");
  }

  function formatDateDDMMYYYY(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}-${m}-${y}`;
  }

  function formatLongDate(iso) {
    if (!iso) iso = new Date().toISOString().slice(0, 10);
    const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
      "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} de ${meses[m - 1]} ${y}`;
  }

  /**
   * Conversión de número entero a palabras en español (pesos colombianos).
   * Soporta hasta millones.
   */
  function numberToSpanishWords(num) {
    if (num === 0) return "cero";

    const unidades = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
      "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
      "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis",
      "veintisiete", "veintiocho", "veintinueve"];
    const decenas = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
    const centenas = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
      "seiscientos", "setecientos", "ochocientos", "novecientos"];

    function convertirGrupo(n) {
      if (n === 0) return "";
      if (n < 30) return unidades[n];
      if (n < 100) {
        const d = Math.floor(n / 10);
        const u = n % 10;
        return u === 0 ? decenas[d] : `${decenas[d]} y ${unidades[u]}`;
      }
      if (n === 100) return "cien";
      const c = Math.floor(n / 100);
      const resto = n % 100;
      return resto === 0 ? centenas[c] : `${centenas[c]} ${convertirGrupo(resto)}`;
    }

    const millones = Math.floor(num / 1000000);
    const miles = Math.floor((num % 1000000) / 1000);
    const resto = num % 1000;

    const partes = [];
    if (millones > 0) {
      partes.push(millones === 1 ? "un millón" : `${convertirGrupo(millones)} millones`);
    }
    if (miles > 0) {
      partes.push(miles === 1 ? "mil" : `${convertirGrupo(miles)} mil`);
    }
    if (resto > 0) {
      partes.push(convertirGrupo(resto));
    }

    return partes.join(" ").trim();
  }

  return { build, numberToSpanishWords };
})();
