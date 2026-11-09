import { useState } from 'react';
import { desligarCarteira, ligarCarteira, modoCarteira, novaCarteiraTeste } from '../carteira';
import { mensagemErroLigacao } from '../carteira/erros';
import { useCarteira } from '../carteira/useCarteira';
import { mensagemErro } from '../contrato/votacao';
import Aviso from './Aviso';
import { RodinhaBotao } from './Carregando';
import EnderecoCurto from './EnderecoCurto';
import SeloDesenvolvimento from './SeloDesenvolvimento';

/**
 * Painel para ligar a carteira do estudante e mostrar o endereco abreviado.
 * Nao mostra nem recebe o email: no modo Web3Auth e o proprio modal que o pede.
 */
export default function PainelCarteira({ textoLigar = 'Ligar carteira', desativado = false, permitirDesligar = true }) {
  const carteira = useCarteira();
  const [aLigar, setALigar] = useState(false);
  const [erro, setErro] = useState('');

  async function executar(acao) {
    setErro('');
    setALigar(true);
    try {
      await acao();
    } catch (e) {
      setErro(mensagemErroLigacao(e) || mensagemErro(e));
    } finally {
      setALigar(false);
    }
  }

  const dev = modoCarteira === 'desenvolvimento';

  return (
    <div>
      {dev && (
        <p>
          <SeloDesenvolvimento />
        </p>
      )}

      {!carteira ? (
        <>
          {modoCarteira === 'web3auth' && (
            <p className="ajuda">
              Abre-se a janela do Web3Auth, que pede o seu email e envia um código de confirmação. Esta
              página nunca recebe o seu email.
            </p>
          )}
          <button
            type="button"
            className="botao"
            onClick={() => executar(ligarCarteira)}
            disabled={desativado || aLigar}
            aria-busy={aLigar}
          >
            {aLigar && <RodinhaBotao />}
            {aLigar ? 'A ligar a carteira…' : textoLigar}
          </button>
        </>
      ) : (
        <div className="carteira">
          <span>
            Carteira ligada: <span className="carteira__endereco"><EnderecoCurto endereco={carteira.endereco} /></span>
          </span>
          {!dev && <span className="selo selo--info">{carteira.descricao}</span>}
          {dev && (
            <button
              type="button"
              className="botao botao--secundario botao--pequeno"
              onClick={() => executar(novaCarteiraTeste)}
              disabled={desativado || aLigar}
            >
              Nova carteira de teste
            </button>
          )}
          {permitirDesligar && (
            <button
              type="button"
              className="botao botao--secundario botao--pequeno"
              onClick={() => executar(desligarCarteira)}
              disabled={desativado || aLigar}
            >
              Desligar
            </button>
          )}
        </div>
      )}

      {carteira && dev && carteira.persistente === false && (
        <Aviso tipo="aviso">
          <p>
            Não foi possível guardar a carteira no navegador: será perdida ao recarregar a página.
          </p>
        </Aviso>
      )}

      {erro && (
        <div style={{ marginTop: 12 }}>
          <Aviso tipo="erro">
            <p>{erro}</p>
          </Aviso>
        </div>
      )}
    </div>
  );
}
