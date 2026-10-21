/**
 * Como o sistema trata o nome e o gênero das pessoas — funções puras (sem Firebase, sem DOM).
 *
 * O sistema atende pessoas LGBTQIAPN+, então:
 *  - o nome usado para chamar a pessoa é o NOME SOCIAL, quando ela informa um; o nome civil
 *    continua guardado e visível para a equipe (documentos, declarações);
 *  - o gênero é opcional, autodeclarado, e sempre existe a opção "Outro" com texto livre.
 */
import { GENEROS } from '../models/schema.js';
import { ROTULO_GENERO } from '../models/rotulos.js';

/** Nome para exibir e chamar: o social, se houver; senão o civil. */
export const nomeExibicao = (pessoa) => String(pessoa?.nomeSocial ?? '').trim() || String(pessoa?.nome ?? '');

/** Há nome social diferente do civil (a tela, então, mostra o civil como informação secundária). */
export const temNomeSocial = (pessoa) => {
  const social = String(pessoa?.nomeSocial ?? '').trim();
  return social !== '' && social !== String(pessoa?.nome ?? '').trim();
};

/** Texto do gênero para exibir ('' quando não informado). Com "Outro", mostra o que a pessoa escreveu. */
export function rotuloDoGenero(pessoa) {
  if (!pessoa?.genero) return '';
  if (pessoa.genero === 'outro') return String(pessoa.generoOutro ?? '').trim() || ROTULO_GENERO.outro;
  return ROTULO_GENERO[pessoa.genero] ?? '';
}

/**
 * Valida e normaliza gênero + texto livre. Vazio é válido (campo opcional).
 * @returns {{ dados: { genero: string|null, generoOutro: string } } | { erro: string }}
 */
export function validarGenero({ genero, generoOutro }) {
  const escolhido = String(genero ?? '').trim();
  if (!escolhido) return { dados: { genero: null, generoOutro: '' } };
  if (!GENEROS.includes(escolhido)) return { erro: 'Opção de gênero inválida.' };

  if (escolhido !== 'outro') return { dados: { genero: escolhido, generoOutro: '' } };

  const escrito = String(generoOutro ?? '').trim();
  if (escrito.length < 2) return { erro: 'Você escolheu "Outro": escreva o gênero ou escolha outra opção.' };
  if (escrito.length > 60) return { erro: 'O gênero pode ter no máximo 60 caracteres.' };
  return { dados: { genero: 'outro', generoOutro: escrito } };
}

/** Nome social (opcional): no máximo 120 caracteres. */
export function validarNomeSocial(valor) {
  const nome = String(valor ?? '').trim();
  return nome.length > 120 ? { erro: 'O nome social pode ter no máximo 120 caracteres.' } : { dados: nome };
}
