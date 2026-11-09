/** Indicador de carregamento com texto (anunciado por leitores de ecra). */
export default function Carregando({ texto = 'A carregar…', children }) {
  return (
    <div className="carregando" role="status" aria-live="polite">
      <span className="rodinha" aria-hidden="true" />
      <span>
        {texto}
        {children}
      </span>
    </div>
  );
}

/** Rodinha pequena para usar dentro de botoes. */
export function RodinhaBotao() {
  return <span className="rodinha" aria-hidden="true" style={{ width: 16, height: 16, borderWidth: 2 }} />;
}
