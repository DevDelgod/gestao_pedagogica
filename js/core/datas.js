/** Datas — funções puras, sem DOM, para uso em services e páginas. */

/** 'AAAA-MM-DD' → '10/03/2026' (sem passar por Date, para não deslocar o dia por fuso). */
export const formatarData = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

/** Data de hoje como 'AAAA-MM-DD' no fuso do navegador. */
export function hojeISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const p2 = (n) => String(n).padStart(2, '0');

/** Timestamp/Date → valor de <input type="datetime-local"> ('AAAA-MM-DDTHH:MM', fuso do navegador). */
export function paraInputDataHora(valor) {
  const d = valor?.toDate?.() ?? valor;
  return d instanceof Date ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}` : '';
}

/** Valor de <input type="datetime-local"> → Date (ou null se vazio). */
export const deInputDataHora = (texto) => (texto ? new Date(texto) : null);

/** Soma dias a uma data 'AAAA-MM-DD' e devolve 'AAAA-MM-DD'. */
export function somarDias(iso, dias) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  const d = new Date(ano, mes - 1, dia + dias);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Timestamp do Firestore (ou Date) → '10/03/26 19:45'. Vazio se ainda não houver valor. */
export function formatarDataHora(valor) {
  const data = valor?.toDate?.() ?? (valor instanceof Date ? valor : null);
  return data ? data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
}
