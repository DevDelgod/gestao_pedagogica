import { afirmar, grupo, igual, teste } from './lib.js';
import { validarAluno } from '../js/domain/cadastros.js';
import { cpfDe } from './fixtures.js';

const HOJE = '2026-10-23';
const base = { nome: 'Maria Exemplo', email: 'maria@exemplo.com', cpf: '', dataNascimento: '1990-04-12' };

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
