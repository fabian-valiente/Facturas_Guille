/**
 * extractor.js
 * Módulo de extracción de datos desde imágenes manuscritas.
 *
 * Estrategia principal: Gemini Vision API (gemini-2.5-flash).
 * Fallback: Tesseract.js OCR + heurísticas.
 */

const Extractor = (() => {

  const GEMINI_API_KEY = "AIzaSyA9RElfkS4S0T9akN_wuGJ__T_FgbtcxQE";
  const GEMINI_ENDPOINT =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const PROMPT = `Eres un sistema de extracción de datos de cuentas de cobro manuscritas en español colombiano.
La imagen puede contener UNA o VARIAS cuentas de cobro / notas de obra separadas por título, encabezado o sección visual distinta.

Devuelve EXCLUSIVAMENTE un array JSON válido (siempre array, aunque solo haya una cuenta):

[
  {
    "obra": "<nombre de la obra o proyecto, o null>",
    "numeroCuenta": "<número de cuenta si aparece, con ceros a la izquierda de 4 dígitos, o null>",
    "fechaEmision": "<fecha global del documento YYYY-MM-DD, o null>",
    "items": [
      {
        "fecha": "YYYY-MM-DD",
        "descripcion": "<descripción del servicio o material>",
        "valor": <entero COP, sin puntos ni comas>
      }
    ],
    "total": <suma entera>,
    "moneda": "COP",
    "confianza_extraccion": <0 a 1>
  }
]

Reglas:
- Retorna SIEMPRE un array, incluso si hay solo una cuenta.
- Si hay varias cuentas en la hoja, incluye TODAS como elementos del array.
- Años "26" → "2026". Valores "950.000" → 950000.
- fechaEmision es la fecha del encabezado del documento, no la de los ítems.
- numeroCuenta: "No. 5", "#5", "Cuenta 5" → "0005".
- No inventes datos. Campo no legible → null.
- No incluyas texto fuera del JSON.`;

  /**
   * Extracción con Gemini Vision API.
   */
  async function extractWithGemini(imageFile, onProgress) {
    onProgress(0.15, "Enviando imagen a Gemini...");

    const base64 = await fileToBase64(imageFile);

    const payload = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: imageFile.type,
                data: base64
              }
            },
            { text: PROMPT }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0
      }
    };

    const response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errText}`);
    }

    onProgress(0.85, "Procesando respuesta de Gemini...");

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!rawText) throw new Error("Gemini no devolvió contenido");

    return parseJsonResponse(rawText);
  }

  /**
   * OCR cliente con Tesseract.js (fallback sin conexión).
   */
  async function extractWithTesseract(imageFile, onProgress) {
    const worker = await Tesseract.createWorker("spa", 1, {
      logger: (m) => {
        if (m.status === "recognizing text" && onProgress) {
          onProgress(m.progress, "Reconociendo texto (OCR fallback)...");
        }
      }
    });

    const { data: { text } } = await worker.recognize(imageFile);
    await worker.terminate();

    return normalizeExtraction(text);
  }

  /**
   * Normalizador heurístico para texto OCR crudo.
   */
  function normalizeExtraction(rawText) {
    const lines = rawText
      .split(/\n+/)
      .map(l => l.trim())
      .filter(l => l.length > 3);

    let obra = null;
    let numeroCuenta = null;
    let fechaEmision = null;
    const items = [];

    const headerRegex = /obra[:\s]+([A-Za-zÁÉÍÓÚÑáéíóúñ0-9\s]+)/i;
    const dateRegex = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/;
    const moneyRegex = /([\d]{1,3}(?:[.,]\d{3})+|\d{4,7})/g;
    const cuentaRegex = /(?:cuenta[^\d]*|n[°oºO][:\s.]*|#\s*)(\d{1,6})/i;

    for (const line of lines) {
      if (!numeroCuenta) {
        const m = line.match(cuentaRegex);
        if (m) numeroCuenta = m[1].padStart(4, "0");
      }

      const headerMatch = line.match(headerRegex);
      if (headerMatch && !obra) {
        obra = headerMatch[1].trim().toUpperCase();
        continue;
      }

      const dateMatch = line.match(dateRegex);
      const moneyMatches = [...line.matchAll(moneyRegex)];

      if (dateMatch && moneyMatches.length === 0 && !fechaEmision) {
        const [, d, m, y] = dateMatch;
        const year = y.length === 2 ? `20${y}` : y;
        fechaEmision = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
        continue;
      }

      if (dateMatch && moneyMatches.length > 0) {
        const [, d, m, y] = dateMatch;
        const year = y.length === 2 ? `20${y}` : y;
        const fecha = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

        const rawValue = moneyMatches[moneyMatches.length - 1][1];
        const valor = parseInt(rawValue.replace(/[.,]/g, ""), 10);

        let descripcion = line
          .replace(dateRegex, "")
          .replace(moneyRegex, "")
          .replace(/[^\wáéíóúñÁÉÍÓÚÑ\s]/gi, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (descripcion.length < 3) descripcion = "transporte de un viaje";

        if (valor > 10000 && valor < 50000000) {
          items.push({ fecha, descripcion, valor });
          if (!fechaEmision) fechaEmision = fecha;
        }
      }
    }

    const total = items.reduce((sum, it) => sum + it.valor, 0);

    // Siempre retorna array
    return [{
      obra: obra ?? null,
      numeroCuenta: numeroCuenta ?? null,
      fechaEmision: fechaEmision ?? null,
      items,
      total,
      moneda: "COP",
      confianza_extraccion: items.length > 0 ? 0.65 : 0.1
    }];
  }

  /**
   * Parsea respuesta JSON (array o objeto), tolera ```json``` fences.
   * Siempre devuelve un array.
   */
  function parseJsonResponse(text) {
    const cleaned = text.replace(/```json|```/g, "").trim();
    const firstArr = cleaned.indexOf("[");
    const firstObj = cleaned.indexOf("{");
    const useArr   = firstArr !== -1 && (firstObj === -1 || firstArr < firstObj);
    const open  = useArr ? "[" : "{";
    const close = useArr ? "]" : "}";
    const start = cleaned.indexOf(open);
    const end   = cleaned.lastIndexOf(close);
    if (start === -1 || end === -1) throw new Error("Respuesta sin JSON válido");
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = () => reject(new Error("Error leyendo el archivo"));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Punto de entrada: Gemini primero, Tesseract como fallback.
   */
  async function extractInvoiceData(imageFile, onProgress = () => {}) {
    try {
      return await extractWithGemini(imageFile, onProgress);
    } catch (err) {
      console.warn("Gemini falló, usando Tesseract como fallback:", err.message);
      onProgress(0.1, "Gemini no disponible, usando OCR local...");
      return await extractWithTesseract(imageFile, onProgress);
    }
  }

  return {
    extractInvoiceData,
    extractWithGemini,
    extractWithTesseract,
    normalizeExtraction
  };
})();
