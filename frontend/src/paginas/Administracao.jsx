import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserProvider, getAddress } from 'ethers';
import { rede, redeLocal, rpcLocal } from '../config';
import { lerAdministrador, lerEleicao, mensagemErro, obterContratoEscrita } from '../contrato/votacao';
import { useEstadoContrato } from '../contexto/EstadoContrato';
import Aviso from '../componentes/Aviso';
import AvisoContrato from '../componentes/AvisoContrato';
import Carregando, { RodinhaBotao } from '../componentes/Carregando';
import DialogoConfirmacao from '../componentes/DialogoConfirmacao';
import EnderecoCurto from '../componentes/EnderecoCurto';
import Resultados from '../componentes/Resultados';
import { useTituloPagina } from '../utilitarios/useTituloPagina';

const INTERVALO_ATUALIZACAO = 5000;
const TAMANHO_MAXIMO_NOME = 80;

function obterEthereum() {
  return typeof window !== 'undefined' ? window.ethereum : undefined;
}

function codigoErro(e) {
  return e?.code ?? e?.data?.originalError?.code ?? e?.error?.code;
}

/** Pede a MetaMask para mudar para a rede da app (e adiciona a rede local se nao existir). */
async function mudarParaRedeDaApp(eth) {
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: rede.chainIdHex }] });
  } catch (e) {
    const naoExiste = codigoErro(e) === 4902 || /unrecognized chain|not been added|unknown chain/i.test(e?.message || '');
    if (redeLocal && naoExiste) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: rede.chainIdHex,
            chainName: 'Hardhat (local)',
            rpcUrls: [rpcLocal],
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          },
        ],
      });
    } else {
      throw e;
    }
  }
}

export default function Administracao() {
  useTituloPagina('Administração');
  const { publicado } = useEstadoContrato();
  const eth = obterEthereum();

  const [ligacao, setLigacao] = useState(null); // { conta, signer, chainId }
  const [aLigar, setALigar] = useState(false);
  const [erroLigar, setErroLigar] = useState('');
  const [avisoRede, setAvisoRede] = useState('');

  const [administrador, setAdministrador] = useState(null);
  const [dados, setDados] = useState(null);
  const [erroLeitura, setErroLeitura] = useState('');

  const [nome, setNome] = useState('');
  const [erroNome, setErroNome] = useState('');
  const [operacao, setOperacao] = useState(''); // '' | 'adicionar' | 'abrir' | 'fechar'
  const [faseOperacao, setFaseOperacao] = useState(''); // 'assinar' | 'confirmar'
  const [erroOperacao, setErroOperacao] = useState('');
  const [sucessoOperacao, setSucessoOperacao] = useState('');
  const [confirmarEstado, setConfirmarEstado] = useState(null); // null | true (abrir) | false (fechar)

  const ligado = useRef(false);
  const montado = useRef(true);
  const sequencia = useRef(0);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const ligar = useCallback(
    async ({ pedirPermissao = true, mudarRede = true } = {}) => {
      const provider = obterEthereum();
      if (!provider) return;
      setErroLigar('');
      setAvisoRede('');
      if (pedirPermissao) setALigar(true);
      try {
        const contas = await provider.request({ method: pedirPermissao ? 'eth_requestAccounts' : 'eth_accounts' });
        if (!contas || contas.length === 0) {
          ligado.current = false;
          setLigacao(null);
          return;
        }
        if (mudarRede) {
          try {
            await mudarParaRedeDaApp(provider);
          } catch (e) {
            setAvisoRede(
              codigoErro(e) === 4001
                ? `Mudança de rede recusada. As operações só funcionam na rede ${rede.nome}.`
                : `Não foi possível mudar a MetaMask para a rede ${rede.nome}: ${mensagemErro(e)}`,
            );
          }
        }
        const browserProvider = new BrowserProvider(provider);
        const signer = await browserProvider.getSigner();
        const conta = getAddress(await signer.getAddress());
        const chainId = Number(await provider.request({ method: 'eth_chainId' }));
        ligado.current = true;
        if (montado.current) setLigacao({ conta, signer, chainId });
      } catch (e) {
        ligado.current = false;
        if (montado.current) {
          setLigacao(null);
          setErroLigar(
            codigoErro(e) === 4001 || codigoErro(e) === 'ACTION_REJECTED'
              ? 'A ligação foi recusada na MetaMask.'
              : codigoErro(e) === -32002
                ? 'Já existe um pedido pendente na MetaMask. Abra a extensão para o concluir.'
                : mensagemErro(e),
          );
        }
      } finally {
        if (montado.current) setALigar(false);
      }
    },
    [],
  );

  // Reage a mudancas de conta ou de rede na MetaMask.
  useEffect(() => {
    if (!eth?.on) return undefined;
    const aoMudarContas = (contas) => {
      if (!contas || contas.length === 0) {
        ligado.current = false;
        setLigacao(null);
      } else if (ligado.current) {
        ligar({ pedirPermissao: false, mudarRede: false });
      }
    };
    const aoMudarRede = () => {
      if (ligado.current) ligar({ pedirPermissao: false, mudarRede: false });
    };
    eth.on('accountsChanged', aoMudarContas);
    eth.on('chainChanged', aoMudarRede);
    return () => {
      eth.removeListener?.('accountsChanged', aoMudarContas);
      eth.removeListener?.('chainChanged', aoMudarRede);
    };
  }, [eth, ligar]);

  // Endereco da administradora (imutavel no contrato).
  useEffect(() => {
    if (!publicado) return;
    let cancelado = false;
    lerAdministrador()
      .then((a) => !cancelado && setAdministrador(a))
      .catch((e) => !cancelado && setErroLeitura(mensagemErro(e)));
    return () => {
      cancelado = true;
    };
  }, [publicado]);

  const ehAdministrador = Boolean(ligacao && administrador && ligacao.conta === administrador);
  const redeCerta = Boolean(ligacao && ligacao.chainId === rede.chainId);

  const atualizar = useCallback(async () => {
    if (!publicado || !ehAdministrador) return;
    const minha = ++sequencia.current;
    try {
      const d = await lerEleicao({ incluirVotos: true });
      if (!montado.current || minha !== sequencia.current) return;
      setDados(d);
      setErroLeitura('');
    } catch (e) {
      if (!montado.current || minha !== sequencia.current) return;
      setErroLeitura(mensagemErro(e));
    }
  }, [publicado, ehAdministrador]);

  useEffect(() => {
    atualizar();
    const id = setInterval(atualizar, INTERVALO_ATUALIZACAO);
    return () => clearInterval(id);
  }, [atualizar]);

  async function executar(tipo, enviar, mensagemSucesso) {
    setOperacao(tipo);
    setFaseOperacao('assinar');
    setErroOperacao('');
    setSucessoOperacao('');
    try {
      const contrato = obterContratoEscrita(ligacao.signer);
      const tx = await enviar(contrato);
      if (montado.current) setFaseOperacao('confirmar');
      const recibo = await tx.wait();
      if (!recibo || recibo.status !== 1) throw new Error('A transação falhou.');
      if (montado.current) setSucessoOperacao(mensagemSucesso);
      return true;
    } catch (e) {
      if (montado.current) setErroOperacao(mensagemErro(e));
      return false;
    } finally {
      if (montado.current) {
        setOperacao('');
        setFaseOperacao('');
      }
      atualizar();
    }
  }

  async function adicionarCandidato(evento) {
    evento.preventDefault();
    const limpo = nome.trim().replace(/\s+/g, ' ');
    if (!limpo) {
      setErroNome('Indique o nome do candidato.');
      return;
    }
    if (dados?.candidatos.some((c) => c.nome.toLowerCase() === limpo.toLowerCase())) {
      setErroNome('Já existe um candidato com esse nome.');
      return;
    }
    setErroNome('');
    const ok = await executar('adicionar', (c) => c.adicionarCandidato(limpo), `Candidato «${limpo}» adicionado.`);
    if (ok && montado.current) setNome('');
  }

  async function alterarEstado() {
    const abrir = confirmarEstado;
    setConfirmarEstado(null);
    await executar(
      abrir ? 'abrir' : 'fechar',
      (c) => c.definirVotacaoAberta(abrir),
      abrir ? 'Votação aberta.' : 'Votação fechada. Os resultados já estão visíveis no ecrã Votar.',
    );
  }

  const ocupado = operacao !== '';
  const podeEscrever = ehAdministrador && redeCerta && !ocupado;
  const textoFase =
    faseOperacao === 'assinar'
      ? 'A aguardar a assinatura na MetaMask…'
      : 'Transação enviada. A aguardar a confirmação da blockchain…';

  return (
    <>
      <h1>Administração</h1>
      <p className="introducao">
        Área da comissão eleitoral: gerir candidatos e abrir ou fechar a votação. Nesta fase usa-se a extensão
        MetaMask com a conta que publicou o contrato.
      </p>

      <AvisoContrato mostrarAVerificar />

      {!eth ? (
        <section className="cartao" aria-labelledby="titulo-sem-metamask">
          <h2 id="titulo-sem-metamask">MetaMask não encontrada</h2>
          <p>Para usar a administração é preciso a extensão MetaMask neste navegador:</p>
          <ol className="passos-lista">
            <li>
              Instale a MetaMask a partir do site oficial (
              <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                metamask.io
              </a>
              ).
            </li>
            <li>
              Importe a conta administradora, ou seja, a conta que publicou o contrato
              {redeLocal ? ' (na rede local, normalmente a primeira conta do nó Hardhat).' : '.'}
            </li>
            <li>Recarregue esta página e carregue em «Ligar MetaMask».</li>
          </ol>
        </section>
      ) : (
        <section className="cartao" aria-labelledby="titulo-conta">
          <h2 id="titulo-conta">Conta</h2>
          {!ligacao ? (
            <button
              type="button"
              className="botao"
              onClick={() => ligar()}
              disabled={aLigar}
              aria-busy={aLigar}
            >
              {aLigar && <RodinhaBotao />}
              {aLigar ? 'A ligar…' : 'Ligar MetaMask'}
            </button>
          ) : (
            <dl className="dados">
              <dt>Conta ligada</dt>
              <dd>
                <EnderecoCurto endereco={ligacao.conta} />
              </dd>
              <dt>Rede da MetaMask</dt>
              <dd>
                chainId {ligacao.chainId}
                {redeCerta ? ' (correta)' : ` (esperada: ${rede.chainId})`}
              </dd>
            </dl>
          )}

          {erroLigar && (
            <Aviso tipo="erro">
              <p>{erroLigar}</p>
            </Aviso>
          )}
          {avisoRede && (
            <Aviso tipo="aviso">
              <p>{avisoRede}</p>
            </Aviso>
          )}
          {ligacao && !redeCerta && (
            <Aviso tipo="aviso" titulo="Rede errada">
              <p>
                A MetaMask está na rede {ligacao.chainId}, mas o contrato está em {rede.nome} (chainId {rede.chainId}).
              </p>
              <button
                type="button"
                className="botao botao--secundario botao--pequeno"
                onClick={() => ligar({ pedirPermissao: false, mudarRede: true })}
              >
                Mudar de rede
              </button>
            </Aviso>
          )}
          {ligacao && publicado && !administrador && !erroLeitura && (
            <Carregando texto="A verificar a conta administradora…" />
          )}
          {ligacao && administrador && !ehAdministrador && (
            <Aviso tipo="erro" titulo="Esta conta não é a administradora">
              <p>
                Só a conta que publicou o contrato (<EnderecoCurto endereco={administrador} />) pode gerir a eleição.
                Escolha essa conta na MetaMask.
              </p>
            </Aviso>
          )}
        </section>
      )}

      {ehAdministrador && publicado && (
        <>
          {(erroOperacao || sucessoOperacao || ocupado) && (
            <div aria-live="polite">
              {ocupado && (
                <div className="cartao">
                  <Carregando texto={textoFase} />
                </div>
              )}
              {erroOperacao && (
                <Aviso tipo="erro" titulo="A operação falhou">
                  <p>{erroOperacao}</p>
                </Aviso>
              )}
              {sucessoOperacao && (
                <Aviso tipo="sucesso">
                  <p>{sucessoOperacao}</p>
                </Aviso>
              )}
            </div>
          )}

          {erroLeitura && (
            <Aviso tipo="erro" titulo="Não foi possível ler o contrato">
              <p>{erroLeitura}</p>
            </Aviso>
          )}

          <section className="cartao" aria-labelledby="titulo-estado">
            <div className="cabeca-secao">
              <h2 id="titulo-estado">Estado da votação</h2>
              {dados && (
                <span className={`selo ${dados.aberta ? 'selo--aberta' : 'selo--fechada'}`}>
                  {dados.aberta ? 'Aberta' : 'Fechada'}
                </span>
              )}
            </div>
            {!dados ? (
              <Carregando texto="A ler o contrato…" />
            ) : (
              <div className="acoes" style={{ marginTop: 0 }}>
                {dados.aberta ? (
                  <button
                    type="button"
                    className="botao botao--perigo"
                    onClick={() => setConfirmarEstado(false)}
                    disabled={!podeEscrever}
                  >
                    {operacao === 'fechar' && <RodinhaBotao />}
                    Fechar votação
                  </button>
                ) : (
                  <button
                    type="button"
                    className="botao"
                    onClick={() => setConfirmarEstado(true)}
                    disabled={!podeEscrever}
                  >
                    {operacao === 'abrir' && <RodinhaBotao />}
                    Abrir votação
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="cartao" aria-labelledby="titulo-adicionar">
            <h2 id="titulo-adicionar">Adicionar candidato</h2>
            {dados?.aberta && (
              <p className="ajuda" id="explicacao-adicionar">
                Não é possível adicionar candidatos com a votação aberta: o contrato só o permite com a votação
                fechada, para que a lista não mude durante a eleição. Feche a votação primeiro.
              </p>
            )}
            <form onSubmit={adicionarCandidato} noValidate>
              <div className="linha-inline">
                <div className="campo">
                  <label htmlFor="nome-candidato">Nome do candidato</label>
                  <input
                    id="nome-candidato"
                    type="text"
                    value={nome}
                    maxLength={TAMANHO_MAXIMO_NOME}
                    onChange={(e) => {
                      setNome(e.target.value);
                      setErroNome('');
                    }}
                    disabled={!dados || dados.aberta || !podeEscrever}
                    aria-invalid={erroNome ? 'true' : undefined}
                    aria-describedby={
                      [erroNome ? 'erro-nome' : '', dados?.aberta ? 'explicacao-adicionar' : ''].filter(Boolean).join(' ') ||
                      undefined
                    }
                  />
                </div>
                <button
                  type="submit"
                  className="botao"
                  disabled={!dados || dados.aberta || !podeEscrever}
                  aria-busy={operacao === 'adicionar'}
                >
                  {operacao === 'adicionar' && <RodinhaBotao />}
                  Adicionar
                </button>
              </div>
              {erroNome && (
                <p id="erro-nome" className="aviso aviso--erro" role="alert" style={{ marginTop: 10 }}>
                  {erroNome}
                </p>
              )}
            </form>
          </section>

          <section className="cartao" aria-labelledby="titulo-candidatos">
            <h2 id="titulo-candidatos">Candidatos e contagens</h2>
            <p className="ajuda" style={{ marginBottom: 12 }}>
              Visível apenas aqui durante a votação. Os valores atualizam-se de 5 em 5 segundos.
            </p>
            {!dados ? (
              <Carregando texto="A ler os candidatos…" />
            ) : (
              <Resultados
                candidatos={dados.candidatos}
                totalVotos={dados.totalVotos}
                totalEleitores={dados.totalEleitores}
                ordenar={false}
                destacarVencedor={false}
              />
            )}
          </section>
        </>
      )}

      <DialogoConfirmacao
        aberto={confirmarEstado !== null}
        titulo={confirmarEstado ? 'Abrir a votação?' : 'Fechar a votação?'}
        textoConfirmar={confirmarEstado ? 'Abrir votação' : 'Fechar votação'}
        perigo={confirmarEstado === false}
        aoConfirmar={alterarEstado}
        aoCancelar={() => setConfirmarEstado(null)}
      >
        {confirmarEstado ? (
          <>
            <p>Os estudantes habilitados passam a poder votar. Enquanto estiver aberta, não é possível adicionar candidatos.</p>
            {dados && dados.candidatos.length === 0 && (
              <p>
                <strong>Atenção:</strong> ainda não há candidatos registados.
              </p>
            )}
          </>
        ) : (
          <p>Ninguém poderá votar depois do fecho e os resultados ficam visíveis a todos no ecrã Votar.</p>
        )}
      </DialogoConfirmacao>
    </>
  );
}
