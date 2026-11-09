import { formatarNumero, formatarPercentagem, votosTexto } from '../utilitarios/formatacao';

/**
 * Lista de candidatos com votos, percentagem e barras.
 * @param {{ candidatos: {id:number,nome:string,votos:number}[], totalVotos: number, totalEleitores?: number, ordenar?: boolean, destacarVencedor?: boolean }} props
 */
export default function Resultados({ candidatos, totalVotos, totalEleitores, ordenar = true, destacarVencedor = true }) {
  const total = totalVotos ?? candidatos.reduce((s, c) => s + c.votos, 0);
  const lista = ordenar ? [...candidatos].sort((a, b) => b.votos - a.votos || a.id - b.id) : candidatos;
  const maximo = candidatos.reduce((m, c) => Math.max(m, c.votos), 0);

  return (
    <>
      <dl className="totais">
        <div className="total">
          <dt>Total de votos</dt>
          <dd>{formatarNumero(total)}</dd>
        </div>
        {totalEleitores != null && (
          <div className="total">
            <dt>Eleitores habilitados</dt>
            <dd>{formatarNumero(totalEleitores)}</dd>
          </div>
        )}
        {totalEleitores != null && (
          <div className="total">
            <dt>Participação</dt>
            <dd>{formatarPercentagem(total, totalEleitores)}</dd>
          </div>
        )}
      </dl>

      {candidatos.length === 0 ? (
        <p>Não há candidatos registados.</p>
      ) : (
        <ol className="resultados" aria-label="Votos por candidato">
          {lista.map((c) => {
            const percentagem = total ? (c.votos / total) * 100 : 0;
            const vencedor = destacarVencedor && total > 0 && c.votos === maximo;
            return (
              <li key={c.id} className="resultado">
                <div className="resultado__topo">
                  <span className="resultado__nome">
                    {c.nome}{' '}
                    {vencedor && <span className="selo selo--aberta">Mais votado</span>}
                  </span>
                  <span className="resultado__valor">
                    {votosTexto(c.votos)} · {formatarPercentagem(c.votos, total)}
                  </span>
                </div>
                <div className="barra" aria-hidden="true">
                  <div className="barra__preenchimento" style={{ width: `${percentagem}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
