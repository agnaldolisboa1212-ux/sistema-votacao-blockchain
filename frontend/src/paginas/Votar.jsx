import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { modoCarteira } from '../carteira';
import { useCarteira } from '../carteira/useCarteira';
import {
  lerEleicao,
  lerEleitor,
  mensagemErro,
  obterContratoEscrita,
  procurarEvento,
  urlExploradorTransacao,
} from '../contrato/votacao';
import { useEstadoContrato } from '../contexto/EstadoContrato';
import Aviso from '../componentes/Aviso';
import AvisoContrato from '../componentes/AvisoContrato';
import Carregando from '../componentes/Carregando';
import DialogoConfirmacao from '../componentes/DialogoConfirmacao';
import PainelCarteira from '../componentes/PainelCarteira';
import Resultados from '../componentes/Resultados';
import { formatarDataHora } from '../utilitarios/formatacao';
import { useTituloPagina } from '../utilitarios/useTituloPagina';

const INTERVALO_ATUALIZACAO = 5000;

export default function Votar() {
  useTituloPagina('Votar');
  const { publicado } = useEstadoContrato();
  const carteira = useCarteira();
  const endereco = carteira?.endereco ?? null;

  const [eleicao, setEleicao] = useState(null);
  const [eleitor, setEleitor] = useState(null); // { endereco, registado, votou }
  const [erroLeitura, setErroLeitura] = useState('');

  const [escolha, setEscolha] = useState('');
  const [erroEscolha, setErroEscolha] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [faseVoto, setFaseVoto] = useState(''); // '' | 'assinar' | 'confirmar'
  const [hashPendente, setHashPendente] = useState('');
  const [erroVoto, setErroVoto] = useState('');
  const [comprovativo, setComprovativo] = useState(null);

  const sequencia = useRef(0);
  const montado = useRef(true);
  const refComprovativo = useRef(null);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const atualizar = useCallback(async () => {
    if (!publicado) return;
    const minha = ++sequencia.current;
    try {
      const [dadosEleicao, dadosEleitor] = await Promise.all([
        // Enquanto a votacao decorre, as contagens nem sequer ficam no estado da pagina.
        lerEleicao({ incluirVotos: false }),
        endereco ? lerEleitor(endereco) : Promise.resolve(null),
      ]);
      if (!montado.current || minha !== sequencia.current) return;
      setEleicao(dadosEleicao);
      setEleitor(dadosEleitor ? { endereco, ...dadosEleitor } : null);
      setErroLeitura('');
    } catch (e) {
      if (!montado.current || minha !== sequencia.current) return;
      setErroLeitura(mensagemErro(e));
    }
  }, [publicado, endereco]);

  useEffect(() => {
    atualizar();
    const id = setInterval(atualizar, INTERVALO_ATUALIZACAO);
    return () => clearInterval(id);
  }, [atualizar]);

  // Ao trocar de carteira, limpa o que era da carteira anterior.
  useEffect(() => {
    setComprovativo(null);
    setErroVoto('');
    setEscolha('');
  }, [endereco]);

  useEffect(() => {
    if (comprovativo) refComprovativo.current?.focus();
  }, [comprovativo]);

  const estadoEleitor = eleitor && eleitor.endereco === endereco ? eleitor : null;
  const candidatoEscolhido = eleicao?.candidatos.find((c) => String(c.id) === escolha) ?? null;
  const podeVotar = Boolean(
    publicado && eleicao?.aberta && carteira && estadoEleitor?.registado && !estadoEleitor.votou && !comprovativo,
  );
  const aVotar = faseVoto !== '';

  function pedirConfirmacao(evento) {
    evento.preventDefault();
    setErroVoto('');
    if (!candidatoEscolhido) {
      setErroEscolha('Escolha um candidato antes de votar.');
      return;
    }
    setErroEscolha('');
    setConfirmar(true);
  }

  async function votar() {
    const candidato = candidatoEscolhido;
    if (!candidato || !carteira) return;
    setConfirmar(false);
    setErroVoto('');
    setFaseVoto('assinar');
    setHashPendente('');
    try {
      const contrato = obterContratoEscrita(carteira.signer);
      const tx = await contrato.votar(candidato.id);
      if (montado.current) {
        setFaseVoto('confirmar');
        setHashPendente(tx.hash);
      }
      const recibo = await tx.wait();
      if (!recibo || recibo.status !== 1) throw new Error('A transação do voto falhou.');
      const evento = procurarEvento(recibo, 'VotoRegistado');
      const idEvento = evento ? Number(evento.args.idCandidato) : candidato.id;
      if (!montado.current) return;
      setComprovativo({
        hash: recibo.hash || tx.hash,
        bloco: recibo.blockNumber,
        idCandidato: idEvento,
        nome: eleicao?.candidatos.find((c) => c.id === idEvento)?.nome ?? candidato.nome,
        dataHora: evento ? Number(evento.args.dataHora) : null,
        eventoEncontrado: Boolean(evento),
      });
      setEscolha('');
    } catch (e) {
      if (montado.current) setErroVoto(mensagemErro(e));
    } finally {
      if (montado.current) {
        setFaseVoto('');
        setHashPendente('');
      }
      atualizar();
    }
  }

  return (
    <>
      <h1>Votar</h1>
      <p className="introducao">
        Ligue a carteira que habilitou e escolha o seu candidato. O voto é assinado pela sua carteira e enviado
        diretamente para a blockchain.
      </p>

      <AvisoContrato mostrarAVerificar />

      <section className="cartao" aria-labelledby="titulo-carteira">
        <h2 id="titulo-carteira">A sua carteira</h2>
        <PainelCarteira textoLigar="Ligar carteira" desativado={aVotar} />

        {carteira && publicado && !estadoEleitor && !erroLeitura && (
          <div style={{ marginTop: 12 }}>
            <Carregando texto="A verificar a carteira no contrato…" />
          </div>
        )}

        {carteira && estadoEleitor && !estadoEleitor.registado && (
          <div style={{ marginTop: 16 }}>
            <Aviso tipo="aviso" titulo="Carteira não habilitada">
              <p>
                Esta carteira não está habilitada para votar. Faça primeiro a <Link to="/habilitar">habilitação</Link>
                {modoCarteira === 'desenvolvimento'
                  ? ' (no modo de desenvolvimento, a carteira habilitada é a que estava ligada quando concluiu a habilitação).'
                  : ' e volte aqui a entrar com o mesmo email no Web3Auth.'}
              </p>
            </Aviso>
          </div>
        )}

        {carteira && estadoEleitor?.registado && estadoEleitor.votou && !comprovativo && (
          <div style={{ marginTop: 16 }}>
            <Aviso tipo="info" titulo="Esta carteira já votou">
              <p>O voto desta carteira já está registado na blockchain. Cada carteira só pode votar uma vez.</p>
            </Aviso>
          </div>
        )}

        {carteira && estadoEleitor?.registado && !estadoEleitor.votou && eleicao && !eleicao.aberta && (
          <div style={{ marginTop: 16 }}>
            <Aviso tipo="info">
              <p>A carteira está habilitada, mas a votação não está aberta neste momento.</p>
            </Aviso>
          </div>
        )}
      </section>

      {comprovativo && (
        <section className="cartao" aria-labelledby="titulo-comprovativo">
          <h2 id="titulo-comprovativo" ref={refComprovativo} tabIndex={-1}>
            Voto registado
          </h2>
          <Aviso tipo="sucesso">
            <p>
              O seu voto em <strong>{comprovativo.nome}</strong> foi registado na blockchain.
            </p>
          </Aviso>
          <dl className="dados">
            <dt>Transação</dt>
            <dd className="hash">
              {urlExploradorTransacao(comprovativo.hash) ? (
                <a href={urlExploradorTransacao(comprovativo.hash)} target="_blank" rel="noreferrer">
                  {comprovativo.hash}
                </a>
              ) : (
                comprovativo.hash
              )}
            </dd>
            <dt>Bloco</dt>
            <dd>{comprovativo.bloco}</dd>
            {comprovativo.dataHora && (
              <>
                <dt>Data e hora</dt>
                <dd>{formatarDataHora(comprovativo.dataHora)}</dd>
              </>
            )}
            <dt>Evento</dt>
            <dd>
              {comprovativo.eventoEncontrado
                ? 'VotoRegistado confirmado no recibo da transação'
                : 'Transação confirmada (evento não encontrado no recibo)'}
            </dd>
          </dl>
        </section>
      )}

      {publicado && (
        <section className="cartao" aria-labelledby="titulo-eleicao" aria-busy={!eleicao}>
          <div className="cabeca-secao">
            <h2 id="titulo-eleicao">Eleição</h2>
            {eleicao && (
              <span className={`selo ${eleicao.aberta ? 'selo--aberta' : 'selo--fechada'}`}>
                {eleicao.aberta ? 'Votação aberta' : 'Votação fechada'}
              </span>
            )}
          </div>

          {erroLeitura && (
            <Aviso tipo="erro" titulo="Não foi possível ler o contrato">
              <p>{erroLeitura} A página tenta novamente de 5 em 5 segundos.</p>
            </Aviso>
          )}

          {erroVoto && (
            <Aviso tipo="erro" titulo="O voto não foi registado">
              <p>{erroVoto}</p>
            </Aviso>
          )}

          {!eleicao && !erroLeitura && <Carregando texto="A ler o estado da eleição…" />}

          {eleicao?.aberta && (
            <>
              {eleicao.candidatos.length === 0 ? (
                <p>Ainda não há candidatos registados.</p>
              ) : podeVotar ? (
                <form onSubmit={pedirConfirmacao}>
                  <fieldset className="opcoes" disabled={aVotar} aria-describedby={erroEscolha ? 'erro-escolha' : undefined}>
                    <legend>Escolha um candidato</legend>
                    {eleicao.candidatos.map((c) => (
                      <label key={c.id} className="opcao">
                        <input
                          type="radio"
                          name="candidato"
                          value={String(c.id)}
                          checked={escolha === String(c.id)}
                          onChange={(e) => {
                            setEscolha(e.target.value);
                            setErroEscolha('');
                          }}
                        />
                        <span className="opcao__nome">{c.nome}</span>
                      </label>
                    ))}
                  </fieldset>
                  {erroEscolha && (
                    <p id="erro-escolha" className="aviso aviso--erro" role="alert">
                      {erroEscolha}
                    </p>
                  )}
                  {aVotar ? (
                    <Carregando
                      texto={
                        faseVoto === 'assinar'
                          ? 'A assinar e enviar o voto…'
                          : 'Voto enviado. A aguardar a confirmação da blockchain…'
                      }
                    >
                      {hashPendente && (
                        <>
                          {' '}
                          <span className="hash">{hashPendente}</span>
                        </>
                      )}
                    </Carregando>
                  ) : (
                    <div className="acoes">
                      <button type="submit" className="botao">
                        Votar
                      </button>
                    </div>
                  )}
                </form>
              ) : (
                <>
                  <h3>Candidatos</h3>
                  <ul>
                    {eleicao.candidatos.map((c) => (
                      <li key={c.id}>{c.nome}</li>
                    ))}
                  </ul>
                  {!carteira && <p>Ligue a sua carteira para votar.</p>}
                </>
              )}
              <p className="nota" style={{ marginTop: 16 }}>
                As contagens ficam escondidas nesta interface enquanto a votação decorre, mas continuam públicas na
                blockchain: qualquer pessoa as pode consultar diretamente no contrato.
              </p>
            </>
          )}

          {eleicao && !eleicao.aberta && (
            <>
              <h3>Resultados</h3>
              {eleicao.totalVotos === 0 && (
                <p>Ainda não há votos: a votação pode ainda não ter aberto.</p>
              )}
              <Resultados
                candidatos={eleicao.candidatos}
                totalVotos={eleicao.totalVotos}
                totalEleitores={eleicao.totalEleitores}
              />
            </>
          )}
        </section>
      )}

      <DialogoConfirmacao
        aberto={confirmar}
        titulo={candidatoEscolhido ? `Confirmar voto em ${candidatoEscolhido.nome}?` : 'Confirmar voto'}
        textoConfirmar="Confirmar voto"
        aoConfirmar={votar}
        aoCancelar={() => setConfirmar(false)}
      >
        <p>O voto é definitivo: depois de registado na blockchain não pode ser alterado.</p>
      </DialogoConfirmacao>
    </>
  );
}
