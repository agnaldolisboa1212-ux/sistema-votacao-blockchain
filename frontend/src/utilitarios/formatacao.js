export function abreviarEndereco(endereco, inicio = 6, fim = 4) {
  if (!endereco) return '';
  if (endereco.length <= inicio + fim + 1) return endereco;
  return `${endereco.slice(0, inicio)}…${endereco.slice(-fim)}`;
}

const formatoPercentagem = new Intl.NumberFormat('pt-PT', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatarPercentagem(parte, total) {
  if (!total) return formatoPercentagem.format(0);
  return formatoPercentagem.format(parte / total);
}

const formatoNumero = new Intl.NumberFormat('pt-PT');

export function formatarNumero(n) {
  return formatoNumero.format(n ?? 0);
}

const formatoDataHora = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'long', timeStyle: 'medium' });

/** Converte segundos (block.timestamp) numa data legivel. */
export function formatarDataHora(segundos) {
  if (!segundos) return '';
  return formatoDataHora.format(new Date(Number(segundos) * 1000));
}

export function votosTexto(n) {
  return `${formatarNumero(n)} ${n === 1 ? 'voto' : 'votos'}`;
}
