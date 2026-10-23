import { afirmar, grupo, igual, teste } from './lib.js';
import { validarAluno, validarCurso, validarTurma } from '../js/domain/cadastros.js';
import { novoCurso } from '../js/models/schema.js';
import { cpfDe } from './fixtures.js';

const HOJE = '2026-10-23';
const base = { nome: 'Maria Exemplo', email: 'maria@exemplo.com', cpf: '', dataNascimento: '1990-04-12' };

grupo('Cadastro de curso: forma de avaliar e média', () => {
  teste('curso por nota tem média de aprovação (padrão 7) e ela é conferida', () => {
    igual(validarCurso({ nome: 'Web' }).dados.mediaAprovacao, 7);
    igual(validarCurso({ nome: 'Web', modoAvaliacao: 'nota', mediaAprovacao: '6,5'.replace(',', '.') }).dados.mediaAprovacao, 6.5);
    afirmar(validarCurso({ nome: 'Web', modoAvaliacao: 'nota', mediaAprovacao: '99' }).erro);
  });

  teste('curso Apto / Não apto não tem média: fica vazia, mesmo que o campo traga um valor (até inválido)', () => {
    const { dados, erro } = validarCurso({ nome: 'Fotografia', modoAvaliacao: 'apto', mediaAprovacao: '99' });
    afirmar(!erro, erro);
    igual([dados.modoAvaliacao, dados.mediaAprovacao], ['apto', null]);
    igual(novoCurso({ nome: 'Foto', modoAvaliacao: 'apto', mediaAprovacao: 7 }).mediaAprovacao, null);
    igual(novoCurso({ nome: 'Web', modoAvaliacao: 'nota' }).mediaAprovacao, 7);
  });

  teste('forma de avaliar desconhecida é recusada', () => {
    afirmar(validarCurso({ nome: 'Web', modoAvaliacao: 'xyz' }).erro);
  });
});

grupo('Cadastro de turma', () => {
  const turma = { nome: 'Web 2026.1', cursoId: 'c1', vagas: 20 };

  teste('aceita o nome longo que o sistema oficial dá à turma (mais de 120 caracteres)', () => {
    const nome = '2026.1 - Audiovisual para Mulheres - Sede da Incubadora de Inovação Social em Cultura - Terça, Quarta e Quinta-feira - 18:00 às 21:00';
    afirmar(nome.length > 120, 'o exemplo deveria passar de 120 caracteres');
    igual(validarTurma({ ...turma, nome }).dados.nome, nome);
  });

  teste('a mensagem diz se o nome é curto ou longo demais, e quanto tem', () => {
    afirmar(validarTurma({ ...turma, nome: ' ' }).erro.includes('pelo menos 2'));
    const longo = validarTurma({ ...turma, nome: 'x'.repeat(201) }).erro;
    afirmar(longo.includes('200') && longo.includes('201'), longo);
  });
});

grupo('Cadastro de pessoa', () => {
  teste('CPF com dígitos errados é recusado em cadastro novo', () => {
    afirmar(validarAluno({ ...base, cpf: '11111111111' }, { hoje: HOJE }).erro);
    igual(validarAluno({ ...base, cpf: cpfDe(100000001) }, { hoje: HOJE }).dados.cpf, cpfDe(100000001));
  });

  teste('CPF que já está gravado (veio da importação) não trava a edição de outro campo, mas trocar por outro inválido sim', () => {
    const importado = '12345678900';
    afirmar(!validarAluno({ ...base, cpf: importado }, { hoje: HOJE, cpfJaGravado: importado }).erro);
    afirmar(validarAluno({ ...base, cpf: '98765432101' }, { hoje: HOJE, cpfJaGravado: importado }).erro);
  });

  teste('menor de 18 anos exige responsável, a não ser para quem veio importado', () => {
    const menor = { ...base, dataNascimento: '2012-01-01' };
    afirmar(validarAluno(menor, { hoje: HOJE }).erro?.includes('responsável'));
    afirmar(!validarAluno(menor, { hoje: HOJE, exigirResponsavel: false }).erro);
    afirmar(!validarAluno({ ...menor, responsavel: { nome: 'Ana' } }, { hoje: HOJE }).erro);
  });
});
