import { afirmar, grupo, igual, teste } from './lib.js';
import { validarAula, recalcularMatriculas } from '../js/domain/diario.js';
import {
  avisosEnviados,
  avisosPendentes,
  faltasAvisadasAoMarcar,
  faltasAvisadasAoRecalcular,
  faltasDaPessoa,
  limiaresAtingidos,
  linkDoEmail,
  marcarEnviados,
  pessoasParaAvisar,
  proximoAviso,
  rascunhoDoEmail,
  resumoDaTurma,
} from '../js/domain/faltas.js';

const matricula = (faltas, avisosDeFalta = {}, extras = {}) => ({ id: 'm1', alunoId: 'a1', turmaId: 't1', alunoNome: 'Ana', turmaNome: 'Turma', cursoNome: 'Curso', status: 'ativa', frequencia: { faltas }, avisosDeFalta, ...extras });

grupo('E-mail a cada 3 faltas', () => {
  teste('os avisos alcançados e o próximo', () => {
    igual([limiaresAtingidos(0), limiaresAtingidos(2), limiaresAtingidos(3), limiaresAtingidos(7), limiaresAtingidos(9)], [[], [], [3], [3, 6], [3, 6, 9]]);
    igual([proximoAviso(0), proximoAviso(2), proximoAviso(3), proximoAviso(4), proximoAviso(6)], [3, 3, 6, 6, 9]);
  });

  teste('sem marca, só aparece quem está EXATAMENTE em 3, 6, 9… faltas (quem passou da marca já foi avisado antes)', () => {
    igual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((f) => avisosPendentes(matricula(f)).join()), ['', '', '', '3', '', '', '6', '', '', '9', '']);
  });

  teste('pendente é a marca alcançada que ainda não foi marcada como enviada', () => {
    igual(avisosPendentes(matricula(6, { 3: { em: '2026-10-01' } })), [6]);
    igual(avisosPendentes(matricula(6, { 3: { em: '2026-10-01' }, 6: { em: '2026-10-08' } })), []);
    igual(avisosPendentes(matricula(3, { 3: { em: '2026-10-01' } })), []);
  });

  teste('com a marca de avisos gravada, quem pulou uma marca (de 2 para 4 faltas) também aparece, mas nunca por estar entre duas', () => {
    igual(avisosPendentes(matricula(4, {}, { faltasAvisadas: 2 })), [3]);
    igual(avisosPendentes(matricula(7, {}, { faltasAvisadas: 2 })), [3, 6]);
    igual(avisosPendentes(matricula(7, {}, { faltasAvisadas: 3 })), [6]);
    igual(avisosPendentes(matricula(5, {}, { faltasAvisadas: 5 })), []);
    igual(avisosPendentes(matricula(7, { 3: { em: '2026-10-01' } }, { faltasAvisadas: 2 })), [6]);
  });

  teste('a marca de avisos nasce antes de as faltas crescerem, e nunca mais é refeita', () => {
    // pessoa sem marca: o passado (menos a marca em que está agora) vale como avisado
    igual([0, 2, 3, 4, 6].map((f) => faltasAvisadasAoRecalcular(matricula(f), f + 1)), [0, 2, 2, 4, 5]);
    igual(faltasAvisadasAoRecalcular(matricula(3, {}, { faltasAvisadas: 1 }), 5), null);
    // planilha com o histórico da turma (matrícula sem chamada antes): as faltas dela são o passado
    const semChamada = { alunoId: 'a', frequencia: { aulas: 0, faltas: 0 } };
    igual([2, 3, 4, 6].map((f) => faltasAvisadasAoRecalcular(semChamada, f, { historico: true })), [2, 2, 4, 5]);
    igual(faltasAvisadasAoRecalcular(matricula(3, {}, { frequencia: { aulas: 8, faltas: 3 } }), 4, { historico: true }), 2);
  });

  teste('marcar como enviado sobe a marca até as faltas de agora e nunca desce', () => {
    igual([faltasAvisadasAoMarcar(matricula(6)), faltasAvisadasAoMarcar(matricula(7, {}, { faltasAvisadas: 2 })), faltasAvisadasAoMarcar(matricula(4, {}, { faltasAvisadas: 6 }))], [6, 7, 6]);
    igual(avisosPendentes(matricula(7, {}, { faltasAvisadas: faltasAvisadasAoMarcar(matricula(7, {}, { faltasAvisadas: 2 })) })), []);
  });

  teste('justificar falta tira o aviso pendente, e o que já foi enviado continua registrado', () => {
    const enviada = matricula(4, { 3: { em: '2026-10-01', por: 'u' } });
    igual(avisosPendentes(matricula(6, { 3: { em: '2026-10-01' } })), [6]);
    igual(avisosPendentes(matricula(5, { 3: { em: '2026-10-01' } })), []); // uma falta justificada: 6 → 5
    igual(avisosEnviados(enviada).map((a) => a.limiar), [3]);
  });

  teste('marcar como enviado mantém os que já estavam e não troca a data de um já marcado', () => {
    const m = matricula(6, { 3: { em: '2026-10-01', por: 'antes' } });
    const mapa = marcarEnviados(m, [3, 6], { em: '2026-10-23', por: 'agora' });
    igual(mapa, { 3: { em: '2026-10-01', por: 'antes' }, 6: { em: '2026-10-23', por: 'agora' } });
    igual(m.avisosDeFalta, { 3: { em: '2026-10-01', por: 'antes' } }); // não altera o original
  });

  teste('quem precisa de e-mail: só matrícula ativa, com quem tem mais faltas primeiro, e o aviso é o maior pendente', () => {
    const alunos = [{ id: 'a1', email: 'ana@exemplo.com', nome: 'Ana' }, { id: 'a2', email: '', whatsapp: '(21) 90000-0000', nome: 'Bia' }, { id: 'a3', email: 'cris@exemplo.com', nome: 'Cris' }];
    const turmas = [{ id: 't1' }];
    const lista = pessoasParaAvisar({
      alunos,
      turmas,
      matriculas: [
        matricula(3, {}, { id: 'm1', alunoId: 'a1', alunoNome: 'Ana' }),
        matricula(7, {}, { id: 'm2', alunoId: 'a2', alunoNome: 'Bia', faltasAvisadas: 2 }), // marca gravada: pulou o 3 e o 6
        matricula(9, {}, { id: 'm3', alunoId: 'a3', alunoNome: 'Cris', status: 'evadida' }), // saiu: não recebe
        matricula(6, { 3: { em: '2026-10-01' }, 6: { em: '2026-10-08' } }, { id: 'm4', alunoId: 'a1', alunoNome: 'Ana (já avisada)' }),
        matricula(2, {}, { id: 'm5', alunoId: 'a3', alunoNome: 'Cris' }),
        matricula(4, {}, { id: 'm6', alunoId: 'a1', alunoNome: 'Dani (4 faltas)' }), // entre duas marcas: não aparece
        matricula(5, {}, { id: 'm7', alunoId: 'a2', alunoNome: 'Eva (5 faltas)' }), // idem
      ],
    });
    igual(lista.map((p) => [p.nome, p.faltas, p.limiar, p.pendentes]), [['Bia', 7, 6, [3, 6]], ['Ana', 3, 3, [3]]]);
    igual([lista[0].email, lista[0].telefone, lista[1].email], ['', '(21) 90000-0000', 'ana@exemplo.com']);
  });

  teste('rascunho do e-mail usa o primeiro nome (o social, se houver) e o link abre o e-mail já preenchido', () => {
    const rascunho = rascunhoDoEmail({ pessoa: { nome: 'Maria das Graças', nomeSocial: 'Mari Souza' }, nome: 'Maria das Graças', faltas: 6, turmaNome: '2026.1 - Audiovisual', cursoNome: 'Audiovisual' });
    afirmar(rascunho.corpo.startsWith('Olá, Mari.') && rascunho.corpo.includes('6 faltas'), rascunho.corpo);
    const link = linkDoEmail({ email: 'a@b.com', ...rascunho });
    afirmar(link.startsWith('mailto:a@b.com?subject=') && link.includes('&body=') && link.includes('%0A'), link);
  });

  teste('a turma, nas listas, aparece resumida (e com o nome inteiro quando não há período nem polo)', () => {
    igual(resumoDaTurma({ nome: '2026.1 - Audiovisual - Sede - Terça - 18:00', cursoNome: 'Audiovisual', periodo: '2026.1', polo: 'Sede' }), 'Audiovisual · 2026.1 · Sede');
    igual(resumoDaTurma({ nome: 'Web 2026.1 — Noite', cursoNome: 'Web' }), 'Web 2026.1 — Noite');
  });
});

grupo('Justificar faltas', () => {
  const aulas = [
    { data: '2026-10-05', registros: { a: 'F', b: 'P' }, justificativas: {} },
    { data: '2026-10-07', registros: { a: 'J', b: 'F' }, justificativas: { a: 'atestado' } },
    { data: '2026-10-06', registros: { a: 'P', b: 'P' } },
  ];

  teste('lista as faltas da pessoa (justificadas ou não), da mais recente para a mais antiga', () => {
    igual(faltasDaPessoa(aulas, 'a'), [{ data: '2026-10-07', justificada: true, motivo: 'atestado' }, { data: '2026-10-05', justificada: false, motivo: '' }]);
    igual(faltasDaPessoa(aulas, 'b').map((f) => f.data), ['2026-10-07']);
    igual(faltasDaPessoa(aulas, 'ninguem'), []);
  });

  teste('o motivo só vale para quem está com falta justificada e tem limite de tamanho', () => {
    const base = { data: '2026-10-05', conteudo: '', registros: { a: 'J', b: 'F', c: 'P' } };
    const { dados } = validarAula({ ...base, justificativas: { a: '  atestado  ', b: 'não devia valer', c: 'nem este', d: 'ninguém' } }, { hoje: '2026-10-23' });
    igual(dados.justificativas, { a: 'atestado' });
    afirmar(validarAula({ ...base, justificativas: { a: 'x'.repeat(301) } }, { hoje: '2026-10-23' }).erro.includes('300'));
    igual(validarAula({ ...base }, { hoje: '2026-10-23' }).dados.justificativas, {});
  });

  teste('falta justificada não entra na contagem de faltas nem no aviso de e-mail', () => {
    const turma = [
      { data: '2026-10-05', registros: { a: 'F' } },
      { data: '2026-10-06', registros: { a: 'F' } },
      { data: '2026-10-07', registros: { a: 'F' } },
      { data: '2026-10-08', registros: { a: 'J' } },
    ];
    const [resumo] = recalcularMatriculas({ aulas: turma, matriculas: [{ id: 'm', alunoId: 'a', status: 'ativa' }], frequenciaMinima: 75 });
    igual([resumo.frequencia.faltas, resumo.frequencia.justificadas], [3, 1]);
    igual(avisosPendentes({ frequencia: resumo.frequencia }), [3]);
    const justificada = turma.map((aula, i) => (i === 0 ? { ...aula, registros: { a: 'J' } } : aula));
    const [depois] = recalcularMatriculas({ aulas: justificada, matriculas: [{ id: 'm', alunoId: 'a', status: 'ativa' }], frequenciaMinima: 75 });
    igual([depois.frequencia.faltas, depois.frequencia.justificadas], [2, 2]);
    igual(avisosPendentes({ frequencia: depois.frequencia }), []);
  });
});
