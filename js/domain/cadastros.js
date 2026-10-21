/**
 * Validação e normalização dos cadastros de curso e turma — funções puras (sem Firebase, sem DOM).
 * Cada uma devolve { dados } (já limpos e com os tipos certos) ou { erro } (mensagem pronta para a tela).
 * Aceitam os valores crus de um formulário: números e datas chegam como texto.
 */
import { DIAS_SEMANA, STATUS_TURMA } from '../models/schema.js';

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
