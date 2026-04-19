/**
 * auth.js
 * Sistema de autenticación con doble capa de protección:
 *
 * Capa 1 — XOR ofuscación:
 *   La credencial no existe en texto plano en el código.
 *   Está dividida en dos arrays (_K y _C) cuyo XOR produce la clave.
 *
 * Capa 2 — PBKDF2 + SHA-256:
 *   La clave recuperada se pasa por 150 000 iteraciones de PBKDF2.
 *   Solo el hash resultante se usa para comparar. La clave original
 *   se descarta de memoria después de la inicialización.
 *
 * Nunca se escribe la contraseña en localStorage ni sessionStorage.
 * Solo se guarda una bandera de sesión mientras el tab esté abierto.
 */

const Auth = (() => {

  // ─── Credencial XOR-ofuscada ───────────────────────────────────────────────
  // _C[i] XOR _K[i] produce el byte de la credencial.
  // Nada aquí es legible como texto plano.
  const _K = [163, 127,  44, 145,  94, 216,  75, 242,  54, 199, 137];
  const _C = [192,  23,  67, 227,  59, 172,  46, 195,  15, 254, 186];

  // ─── Parámetros PBKDF2 ────────────────────────────────────────────────────
  // Salt fijo derivado del nombre de la aplicación (no secreto, sí necesario).
  const _SALT = new Uint8Array([
    71, 101, 109, 105, 110, 105, 115,   // G e m i n i s
    70,  97,  99, 116, 117, 114,  97,   // F a c t u r a
   115,  50,  48,  50,  54             // s 2 0 2 6
  ]);
  const _ITER = 150_000;

  // Recupera la credencial desde los arrays XOR (solo en memoria, solo una vez)
  function _decode() {
    return String.fromCharCode(..._C.map((c, i) => c ^ _K[i]));
  }

  // Deriva un hash PBKDF2-SHA256 a partir de cualquier string
  async function _derive(password) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: _SALT, iterations: _ITER, hash: "SHA-256" },
      keyMaterial,
      256
    );
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  }

  // Hash de referencia (lazy init, solo existe en memoria RAM durante la sesión)
  let _refHash = null;

  async function _init() {
    if (!_refHash) _refHash = await _derive(_decode());
  }

  // ─── API pública ──────────────────────────────────────────────────────────

  /**
   * Verifica si el input coincide con la contraseña almacenada.
   * Usa comparación de tiempo constante para prevenir timing attacks.
   */
  async function verify(input) {
    await _init();
    const inputHash = await _derive(input);
    let diff = inputHash.length ^ _refHash.length;
    const len = Math.min(inputHash.length, _refHash.length);
    for (let i = 0; i < len; i++) {
      diff |= inputHash.charCodeAt(i) ^ _refHash.charCodeAt(i);
    }
    return diff === 0;
  }

  const SESSION_KEY = "_gs_auth_v1";

  function isAuthenticated() {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  }

  function setAuthenticated() {
    sessionStorage.setItem(SESSION_KEY, "1");
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    location.replace("login.html");
  }

  return { verify, isAuthenticated, setAuthenticated, logout };
})();
