/**
 * Validação e normalização dos cadastros de curso e turma — funções puras (sem Firebase, sem DOM).
 * Cada uma devolve { dados } (já limpos e com os tipos certos) ou { erro } (mensagem pronta para a tela).
 * Aceitam os valores crus de um formulário: números e datas chegam como texto.
 */
import { DIAS_SEMANA, STATUS_TURMA } from '../models/schema.js';
import { validarGenero, validarNomeSocial } from './pessoa.js';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** '' / null / undefined viram o padrão; o resto vira número (pode dar NaN). */
const numero = (valor, padrao) => (valor === '' || valor === null || valor === undefined ? padrao : Number(valor));
const texto = (valor) => String(valor ?? '').trim();

export function validarCurso(entrada) {
  const nome = texto(entrada.nome);
  if (nome.length < 2 || nome.length > 120) return { erro: 'Informe o nome do curso (de 2 a 120 caracteres).' };

  const cargaHoraria = numero(entrada.cargaHoraria, 0);
  if (!Number.isInteger(cargaHoraria) || cargaHoraria < 0) return { erro: 'A carga horária deve ser um número inteiro de horas.' };

  const frequenciaMinima = numero(entrada.frequenciaMinima, 75);
  if (!(frequenciaMinima >= 0 && frequenciaMinima <= 100)) return { erro: 'A frequência mínima deve estar entre 0 e 100%.' };

  const mediaAprovacao = numero(entrada.mediaAprovacao, 7);
  if (!(mediaAprovacao >= 0 && mediaAprovacao <= 10)) return { erro: 'A média de aprovação deve estar entre 0 e 10.' };

  const descricao = texto(entrada.descricao);
  if (descricao.length > 1000) return { erro: 'A descrição pode ter no máximo 1000 caracteres.' };

  return { dados: { nome, descricao, cargaHoraria, frequenciaMinima, mediaAprovacao, ativo: entrada.ativo ?? true } };
}

/** CPF com dígitos verificadores (só os 11 dígitos, sem máscara). */
export function cpfValido(digitos) {
  if (!/^\d{11}$/.test(digitos) || /^(\d)\1{10}$/.test(digitos)) return false;
  const digito = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(digitos[i]) * (n + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(digitos[9]) && digito(10) === Number(digitos[10]);
}

/** Idade em anos completos em `hoje` (ambos 'AAAA-MM-DD'). */
export function idadeEm(nascimento, hoje) {
  const [an, mn, dn] = nascimento.split('-').map(Number);
  const [ah, mh, dh] = hoje.split('-').map(Number);
  return ah - an - (mh < mn || (mh === mn && dh < dn) ? 1 : 0);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Cadastro do aluno. Menores de 18 anos exigem o nome do responsável.
 * @param {object} entrada valores crus do formulário
 * @param {{ hoje: string }} contexto `hoje` em 'AAAA-MM-DD' (injetado para a função continuar pura)
 */
export function validarAluno(entrada, { hoje }) {
  const nome = texto(entrada.nome);
  if (nome.length < 2 || nome.length > 120) return { erro: 'Informe o nome do aluno (de 2 a 120 caracteres).' };

  const social = validarNomeSocial(entrada.nomeSocial);
  if (social.erro) return { erro: social.erro };
  const genero = validarGenero({ genero: entrada.genero, generoOutro: entrada.generoOutro });
  if (genero.erro) return { erro: genero.erro };

  const email = texto(entrada.email).toLowerCase();
  if (email && (!EMAIL.test(email) || email.length > 120)) return { erro: 'Informe um e-mail válido.' };

  const telefone = texto(entrada.telefone);
  if (telefone.length > 30) return { erro: 'O telefone pode ter no máximo 30 caracteres.' };

  const cpf = texto(entrada.cpf).replace(/\D/g, '');
  if (cpf && !cpfValido(cpf)) return { erro: 'CPF inválido. Confira os 11 dígitos.' };

  const dataNascimento = texto(entrada.dataNascimento) || null;
  if (dataNascimento && !DATA.test(dataNascimento)) return { erro: 'Data de nascimento inválida.' };
  if (dataNascimento && dataNascimento > hoje) return { erro: 'A data de nascimento não pode estar no futuro.' };

  const responsavelNome = texto(entrada.responsavel?.nome);
  const responsavelTelefone = texto(entrada.responsavel?.telefone);
  const parentesco = texto(entrada.responsavel?.parentesco);
  const menor = dataNascimento && idadeEm(dataNascimento, hoje) < 18;
  if (menor && !responsavelNome) return { erro: 'O aluno é menor de 18 anos: informe o nome do responsável.' };

  const cidade = texto(entrada.endereco?.cidade);
  const bairro = texto(entrada.endereco?.bairro);
  const observacoes = texto(entrada.observacoes);
  if (observacoes.length > 1000) return { erro: 'As observações podem ter no máximo 1000 caracteres.' };

  return {
    dados: {
      nome,
      nomeSocial: social.dados,
      ...genero.dados, // genero + generoOutro
      email,
      telefone,
      cpf,
      dataNascimento,
      responsavel: responsavelNome ? { nome: responsavelNome, telefone: responsavelTelefone, parentesco } : null,
      endereco: cidade || bairro ? { cidade, bairro } : null,
      observacoes,
    },
  };
}

export function validarTurma(entrada) {
  const nome = texto(entrada.nome);
  if (nome.length < 2 || nome.length > 120) return { erro: 'Informe o nome da turma (de 2 a 120 caracteres).' };

  const cursoId = texto(entrada.cursoId);
  if (!cursoId) return { erro: 'Escolha o curso da turma.' };

  const vagas = numero(entrada.vagas, NaN);
  if (!Number.isInteger(vagas) || vagas < 1 || vagas > 500) return { erro: 'O número de vagas deve ser um inteiro entre 1 e 500.' };

  const dias = [...new Set(entrada.diasSemana ?? [])];
  if (dias.some((d) => !DIAS_SEMANA.includes(d))) return { erro: 'Dia da semana inválido.' };
  const diasSemana = dias.sort((a, b) => DIAS_SEMANA.indexOf(a) - DIAS_SEMANA.indexOf(b)); // dom…sab

  const horarioInicio = texto(entrada.horarioInicio);
  const horarioFim = texto(entrada.horarioFim);
  if (Boolean(horarioInicio) !== Boolean(horarioFim)) return { erro: 'Informe o horário de início e o de fim, ou deixe os dois em branco.' };
  if (horarioInicio && !(HORA.test(horarioInicio) && HORA.test(horarioFim))) return { erro: 'Horário inválido.' };
  if (horarioInicio && horarioFim <= horarioInicio) return { erro: 'O horário de fim deve ser depois do início.' }; // 'HH:MM' compara como texto

  const dataInicio = texto(entrada.dataInicio) || null;
  const dataFim = texto(entrada.dataFim) || null;
  if ((dataInicio && !DATA.test(dataInicio)) || (dataFim && !DATA.test(dataFim))) return { erro: 'Data inválida.' };
  if (dataInicio && dataFim && dataFim < dataInicio) return { erro: 'A data de fim não pode ser antes da data de início.' };

  const status = entrada.status ?? STATUS_TURMA.PLANEJADA;
  if (!Object.values(STATUS_TURMA).includes(status)) return { erro: 'Situação da turma inválida.' };

  return {
    dados: {
      nome,
      cursoId,
      professorId: texto(entrada.professorId) || null,
      vagas,
      diasSemana,
      horarioInicio,
      horarioFim,
      dataInicio,
      dataFim,
      status,
    },
  };
}
