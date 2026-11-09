/**
 * Caixa de mensagem. Os erros usam role="alert" (anunciados de imediato);
 * os restantes usam role="status".
 */
export default function Aviso({ tipo = 'info', titulo, children, acoes }) {
  const papel = tipo === 'erro' ? 'alert' : 'status';
  return (
    <div className={`aviso aviso--${tipo}`} role={papel}>
      {titulo && <p className="aviso__titulo">{titulo}</p>}
      {children && <div className="aviso__corpo">{children}</div>}
      {acoes && <div className="acoes">{acoes}</div>}
    </div>
  );
}
