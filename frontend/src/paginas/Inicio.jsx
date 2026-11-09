import { Link } from 'react-router-dom';
import { useTituloPagina } from '../utilitarios/useTituloPagina';
import AvisoContrato from '../componentes/AvisoContrato';

export default function Inicio() {
  useTituloPagina('Início');

  return (
    <>
      <h1>Eleição estudantil em blockchain</h1>
      <p className="introducao">
        Cada estudante elegível recebe uma carteira digital, habilitada pela comissão eleitoral, e vota
        uma única vez. Os votos ficam registados num contrato público na blockchain Ethereum: qualquer
        pessoa pode auditar o resultado, mas o voto não fica ligado ao seu email.
      </p>

      <AvisoContrato />

      <div className="grelha-entradas">
        <Link to="/habilitar" className="entrada">
          <strong>1. Habilitar</strong>
          <span>Inicie sessão com a conta da instituição, crie a sua carteira e registe-a na eleição.</span>
        </Link>
        <Link to="/votar" className="entrada">
          <strong>2. Votar</strong>
          <span>Ligue a carteira habilitada e escolha o seu candidato. Não é pedido email nem senha.</span>
        </Link>
        <Link to="/admin" className="entrada">
          <strong>Administração</strong>
          <span>Para a comissão eleitoral: candidatos, abertura e fecho da votação (com MetaMask).</span>
        </Link>
      </div>

      <section className="cartao" aria-labelledby="como-funciona">
        <h2 id="como-funciona">Como funciona</h2>
        <ol className="passos-lista">
          <li>A instituição confirma que é estudante elegível (início de sessão no ecrã Habilitar).</li>
          <li>É criada uma carteira só sua; o servidor regista o endereço dessa carteira no contrato.</li>
          <li>No ecrã Votar, a carteira assina o voto diretamente na blockchain, sem passar pelo servidor.</li>
          <li>O contrato garante que cada carteira habilitada vota uma só vez.</li>
          <li>
            Depois do fecho, os resultados aparecem no ecrã Votar e podem ser confirmados por qualquer pessoa
            diretamente no contrato.
          </li>
        </ol>
      </section>
    </>
  );
}
