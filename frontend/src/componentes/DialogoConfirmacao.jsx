import { useEffect, useId, useRef } from 'react';

/**
 * Dialogo de confirmacao com <dialog> nativo (foco preso e tecla Esc incluidos).
 */
export default function DialogoConfirmacao({
  aberto,
  titulo,
  children,
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  perigo = false,
  aoConfirmar,
  aoCancelar,
}) {
  const ref = useRef(null);
  const idTitulo = useId();
  const idDescricao = useId();

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (aberto && !dialogo.open) {
      if (typeof dialogo.showModal === 'function') dialogo.showModal();
      else dialogo.setAttribute('open', '');
    } else if (!aberto && dialogo.open) {
      dialogo.close();
    }
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      className="dialogo"
      aria-labelledby={idTitulo}
      aria-describedby={children ? idDescricao : undefined}
      onCancel={(e) => {
        e.preventDefault();
        aoCancelar?.();
      }}
    >
      {aberto && (
        <div className="dialogo__interior">
          <h2 id={idTitulo}>{titulo}</h2>
          {children && <div id={idDescricao}>{children}</div>}
          <div className="acoes">
            <button type="button" className="botao botao--secundario" onClick={aoCancelar}>
              {textoCancelar}
            </button>
            <button
              type="button"
              className={`botao${perigo ? ' botao--perigo' : ''}`}
              onClick={aoConfirmar}
            >
              {textoConfirmar}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
