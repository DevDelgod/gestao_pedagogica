/**
 * Uma base de dados FICTÍCIA e pronta, montada pelas mesmas funções da importação (sem tocar em banco nenhum):
 * oito matrículas em duas turmas, e a frequência da turma da noite (3 aulas).
 */
import { detectarFrequencia, detectarListagem, lerFrequencia, lerListagem, planejarFrequencia, planejarListagem, resolverTurmaDaFrequencia } from '../js/domain/importacao.js';
import { linhasDaFrequencia, linhasDaListagem } from './fixtures.js';

export const HOJE = '2026-10-23';

/** As células de data do fixture ({ data }) viram texto, como o leitor de planilhas as entrega. */
const comoLidas = (linhas) => linhas.map((l) => l.map((c) => (c && typeof c === 'object' && c.data ? c.data : c)));

export function baseFicticia() {
  const listagem = linhasDaListagem();
  const { registros } = lerListagem(listagem, detectarListagem(listagem), { hoje: HOJE });
  const plano = planejarListagem(registros, { alunos: [], matriculas: [], turmas: [], cursos: [] }, { periodoPadrao: '2026.1', hoje: HOJE });
  const alunos = plano.alunos.map((a) => ({ id: a.id, ...a.dados }));
  let matriculas = plano.matriculas.map((m) => ({ id: m.id, ...m.dados }));
  const turmas = plano.turmas.map((t) => ({ id: t.id, ...t.dados }));
  const cursos = plano.cursos.filter((c) => c.novo).map((c) => ({ id: c.id, ...c.dados }));

  const frequencia = comoLidas(linhasDaFrequencia());
  const leitura = lerFrequencia(frequencia, detectarFrequencia(frequencia));
  const { turmaId } = resolverTurmaDaFrequencia(leitura, { matriculas, turmas });
  const turma = turmas.find((t) => t.id === turmaId);
  const planoFrequencia = planejarFrequencia(leitura, { turma, curso: cursos[0], matriculas: matriculas.filter((m) => m.turmaId === turmaId), aulas: [] });
  const aulas = planoFrequencia.aulas.map((a) => ({ id: a.id, turmaId, data: a.data, ...a.dados }));
  matriculas = matriculas.map((m) => {
    const resumo = planoFrequencia.resumos.find((r) => r.matriculaId === m.id);
    return resumo ? { ...m, frequencia: resumo.frequencia, riscoEvasao: resumo.riscoEvasao } : m;
  });
  return { alunos, matriculas, turmas, cursos, aulas, turmaDaNoite: turma };
}
