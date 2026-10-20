// Tempo SEMPRE local. O D1 grava UTC e o dono pensa em horario de Brasilia.
// Mensagem das 22h vira dia seguinte e o resumo do dia reporta errado sem avisar ninguem.
// Por isso nunca use datetime('now') cru em nenhuma query.

const FUSO = -3; // Brasilia. Mude aqui se o negocio for de outro fuso.

export function agora() {
  const d = new Date(Date.now() + FUSO * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function hoje() {
  return agora().slice(0, 10);
}

export function hora() {
  return Number(agora().slice(11, 13));
}

// Data local de N horas atras, no mesmo formato do banco.
export function agoraMenos(horas) {
  const d = new Date(Date.now() + FUSO * 3600 * 1000 - horas * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// Data local de N minutos atras.
export function agoraMenosMinutos(minutos) {
  const d = new Date(Date.now() + FUSO * 3600 * 1000 - minutos * 60 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function ontem() {
  const d = new Date(Date.now() + FUSO * 3600 * 1000 - 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// 0 = domingo, 6 = sabado. Usado pra frase "segunda de manha".
export function diaDaSemana() {
  return new Date(Date.now() + FUSO * 3600 * 1000).getUTCDay();
}
