/**
 * extractor.js
 * Extracción de datos desde imágenes manuscritas.
 * Pipeline: preprocesamiento canvas → Tesseract.js OCR → heurísticas.
 */

const Extractor = (() => {

  /**
   * Preprocesa la imagen: escala de grises, contraste y binarización.
   * Mejora significativamente la legibilidad para Tesseract.
   */
  function preprocessImage(imageFile) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(imageFile);

      img.onload = () => {
        const canvas = document.createElement("canvas");
        // Escalar a un ancho mínimo de 1800px para mejor OCR
        const scale = Math.max(1, 1800 / img.width);
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imageData.data;

        for (let i = 0; i < d.length; i += 4) {
          // Escala de grises (luminancia perceptual)
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          // Contraste (factor 1.6)
          const contrasted = Math.min(255, Math.max(0, (gray - 128) * 1.6 + 128));
          // Binarización adaptativa simple (umbral 145)
          const binary = contrasted > 145 ? 255 : 0;
          d[i] = d[i + 1] = d[i + 2] = binary;
          // Alpha sin cambios
        }

        ctx.putImageData(imageData, 0, 0);
        URL.revokeObjectURL(url);

        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error("Error al preprocesar la imagen"));
        }, "image/png");
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo cargar la imagen"));
      };

      img.src = url;
    });
  }

  /**
   * OCR con Tesseract.js sobre imagen preprocesada.
   */
  async function extractWithTesseract(imageFile, onProgress) {
    onProgress(0.10, "Preprocesando imagen...");
    const processedBlob = await preprocessImage(imageFile);

    onProgress(0.25, "Iniciando reconocimiento OCR...");
    const worker = await Tesseract.createWorker("spa", 1, {
      logger: (m) => {
        if (m.status === "recognizing text" && onProgress) {
          const p = 0.25 + m.progress * 0.60;
          onProgress(p, "Reconociendo texto...");
        }
      }
    });

    const { data: { text } } = await worker.recognize(processedBlob);
    await worker.terminate();

    onProgress(0.90, "Analizando datos extraídos...");
    return normalizeExtraction(text);
  }

  /**
   * Normalizador heurístico para texto OCR crudo.
   * Orientado al formato de cuentas de cobro colombianas.
   */
  function normalizeExtraction(rawText) {
    const lines = rawText
      .split(/\n+/)
      .map(l => l.trim())
      .filter(l => l.length > 2);

    let obra          = null;
    let numeroCuenta  = null;
    let fechaEmision  = null;
    const items       = [];

    // Patrones
    const dateRegex   = /(\d{1,2})[\/\-.\s](\d{1,2})[\/\-.\s](\d{2,4})/;
    const moneyRegex  = /\$?\s*([\d]{1,3}(?:[.,]\d{3})+|\d{4,9})/g;
    const cuentaRegex = /(?:cuenta[^\d]*|n[°oºO][:\s.]*|#\s*|factura[^\d]*)(\d{1,6})/i;
    const obraRegex   = /(?:obra|proyecto|referencia)[:\s]+([A-Za-zÁÉÍÓÚÑáéíóúñ0-9\s\-]+)/i;

    // Conjunto de palabras a ignorar como descripción
    const skipWords = /^(fecha|total|valor|subtotal|iva|nit|cc|cuenta|factura|cobro|obra|proyecto)$/i;

    for (const line of lines) {
      // Número de cuenta
      if (!numeroCuenta) {
        const m = line.match(cuentaRegex);
        if (m) numeroCuenta = m[1].padStart(4, "0");
      }

      // Nombre de obra
      if (!obra) {
        const m = line.match(obraRegex);
        if (m) obra = m[1].trim().replace(/\s+/g, " ").toUpperCase();
      }

      const dateMatch   = line.match(dateRegex);
      const moneyMatches = [...line.matchAll(moneyRegex)];

      // Fecha de emisión (línea con fecha pero sin valor monetario)
      if (dateMatch && moneyMatches.length === 0 && !fechaEmision) {
        fechaEmision = parseDate(dateMatch);
        continue;
      }

      // Ítem: línea con fecha Y valor
      if (dateMatch && moneyMatches.length > 0) {
        const fecha  = parseDate(dateMatch);
        const rawVal = moneyMatches[moneyMatches.length - 1][1];
        const valor  = parseInt(rawVal.replace(/[.,]/g, ""), 10);

        let descripcion = line
          .replace(dateRegex, "")
          .replace(/\$?\s*[\d]{1,3}(?:[.,]\d{3})+/g, "")
          .replace(/\d{4,9}/g, "")
          .replace(/[^\wáéíóúñÁÉÍÓÚÑ\s]/gi, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (descripcion.length < 3 || skipWords.test(descripcion)) {
          descripcion = "transporte de un viaje";
        }

        if (valor > 5000 && valor < 100_000_000) {
          items.push({ fecha, descripcion, valor });
          if (!fechaEmision) fechaEmision = fecha;
        }
        continue;
      }

      // Línea solo con valor (sin fecha) → ítem sin fecha explícita
      if (!dateMatch && moneyMatches.length > 0) {
        const rawVal = moneyMatches[moneyMatches.length - 1][1];
        const valor  = parseInt(rawVal.replace(/[.,]/g, ""), 10);

        const descripcion = line
          .replace(/\$?\s*[\d]{1,3}(?:[.,]\d{3})+/g, "")
          .replace(/\d{4,9}/g, "")
          .replace(/[^\wáéíóúñÁÉÍÓÚÑ\s]/gi, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (
          descripcion.length >= 4 &&
          !skipWords.test(descripcion) &&
          valor > 5000 && valor < 100_000_000
        ) {
          items.push({ fecha: fechaEmision ?? null, descripcion, valor });
        }
      }
    }

    const total = items.reduce((s, it) => s + it.valor, 0);

    return [{
      obra:                 obra ?? null,
      numeroCuenta:         numeroCuenta ?? null,
      fechaEmision:         fechaEmision ?? null,
      items,
      total,
      moneda:               "COP",
      confianza_extraccion: items.length > 0 ? 0.72 : 0.15
    }];
  }

  function parseDate([, d, m, y]) {
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  /**
   * Punto de entrada principal.
   */
  async function extractInvoiceData(imageFile, onProgress = () => {}) {
    return await extractWithTesseract(imageFile, onProgress);
  }

  return {
    extractInvoiceData,
    extractWithTesseract,
    normalizeExtraction
  };
})();
