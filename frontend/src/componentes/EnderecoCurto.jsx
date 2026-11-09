import { abreviarEndereco } from '../utilitarios/formatacao';

/** Endereco abreviado; o endereco completo fica no title e para leitores de ecra. */
export default function EnderecoCurto({ endereco, href }) {
  if (!endereco) return null;
  const conteudo = (
    <>
      <span aria-hidden="true">{abreviarEndereco(endereco)}</span>
      <span className="visualmente-oculto">{endereco}</span>
    </>
  );
  if (href) {
    return (
      <a className="mono" href={href} target="_blank" rel="noreferrer" title={endereco}>
        {conteudo}
      </a>
    );
  }
  return (
    <span className="mono" title={endereco}>
      {conteudo}
    </span>
  );
}
