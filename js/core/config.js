/**
 * Configuração do projeto.
 *
 * A firebaseConfig NÃO é segredo: ela só identifica o projeto. Quem protege os dados
 * são as regras do Firestore (firestore.rules) e o Firebase Auth.
 * Console Firebase → Configurações do projeto → Seus apps → App da Web → "Configuração do SDK".
 */
export const firebaseConfig = {
  apiKey: 'COLE_AQUI',
  authDomain: 'COLE_AQUI.firebaseapp.com',
  projectId: 'COLE_AQUI',
  storageBucket: 'COLE_AQUI.firebasestorage.app',
  messagingSenderId: 'COLE_AQUI',
  appId: 'COLE_AQUI',
};

/**
 * Cloudinary — upload direto do navegador com "unsigned upload preset".
 * Console Cloudinary → Settings → Upload → Upload presets → Add (Signing mode: Unsigned).
 * No preset, restrinja formatos e tamanho máximo e fixe uma pasta, pois qualquer pessoa
 * que veja este arquivo consegue usar o preset.
 * NUNCA coloque api_secret aqui.
 */
export const cloudinary = {
  cloudName: 'COLE_AQUI',
  uploadPreset: 'COLE_AQUI',
};

export const configurado = !JSON.stringify(firebaseConfig).includes('COLE_AQUI');

const hostLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.localhost');

/**
 * Modo desenvolvimento: liga SOZINHO quando o Firebase ainda não foi configurado E a página está
 * em localhost. Usa um Firebase simulado no navegador (js/dev/), com contas e dados de exemplo.
 * Ao preencher firebaseConfig acima, desliga sozinho e o sistema passa a usar o Firebase real.
 * Em qualquer endereço que não seja local ele nunca liga.
 */
export const modoDesenvolvimento = !configurado && hostLocal;
