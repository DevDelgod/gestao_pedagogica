/**
 * Upload de documentos e imagens para o Cloudinary (unsigned preset, direto do navegador).
 *
 * No Firestore guarde apenas o objeto devolvido (url + publicId), nunca o arquivo.
 * Apagar arquivo exige assinatura (api_secret) e por isso NÃO dá para fazer daqui;
 * se um dia for preciso, será por uma Cloud Function. Guardar o publicId já deixa isso pronto.
 */
import { cloudinary, modoDesenvolvimento } from './config.js';

/** Modo desenvolvimento: sem conta no Cloudinary. O arquivo vira um data URL guardado no navegador. */
const LIMITE_SIMULADO = 600 * 1024;

async function simularEnvio(arquivo, pasta) {
  if (arquivo.size > LIMITE_SIMULADO) {
    throw new Error('No modo desenvolvimento o limite é de 600 KB por arquivo (os dados ficam guardados no navegador).');
  }
  const url = await new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(leitor.result);
    leitor.onerror = () => rejeitar(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
  return {
    nome: arquivo.name,
    url,
    publicId: `fudev/${pasta}/${crypto.randomUUID().slice(0, 8)}`,
    tipo: arquivo.type.startsWith('image/') ? 'image' : 'raw',
    formato: (arquivo.name.split('.').pop() ?? '').toLowerCase(),
    bytes: arquivo.size,
  };
}

/**
 * @param {File} arquivo
 * @param {string} [pasta] subpasta lógica, ex.: 'alunos/documentos'
 * @returns {Promise<{ nome: string, url: string, publicId: string, tipo: string, formato: string, bytes: number }>}
 */
export async function enviarArquivo(arquivo, pasta = 'geral') {
  if (modoDesenvolvimento) return simularEnvio(arquivo, pasta);

  const corpo = new FormData();
  corpo.append('file', arquivo);
  corpo.append('upload_preset', cloudinary.uploadPreset);
  corpo.append('folder', `fudev/${pasta}`);

  const resposta = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudinary.cloudName}/auto/upload`,
    { method: 'POST', body: corpo },
  );
  if (!resposta.ok) {
    const detalhe = await resposta.json().catch(() => ({}));
    throw new Error(detalhe?.error?.message ?? 'Falha ao enviar o arquivo.');
  }

  const r = await resposta.json();
  return {
    nome: arquivo.name,
    url: r.secure_url,
    publicId: r.public_id,
    tipo: r.resource_type, // image | video | raw
    formato: r.format ?? '',
    bytes: r.bytes,
  };
}

/** Versão otimizada/redimensionada de uma imagem já enviada (transformação na URL). */
export const miniatura = (url, largura = 240) =>
  url.replace('/upload/', `/upload/c_fill,w_${largura},q_auto,f_auto/`);
