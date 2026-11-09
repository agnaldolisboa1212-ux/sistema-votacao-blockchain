import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErroApi, habilitarCarteira, iniciarSessao, obterEstadoEstudante } from '../api/cliente';
import { useCarteira } from '../carteira/useCarteira';
import { urlExploradorTransacao } from '../contrato/votacao';
import Aviso from '../componentes/Aviso';
import AvisoContrato from '../componentes/AvisoContrato';
import Carregando, { RodinhaBotao } from '../componentes/Carregando';
import EnderecoCurto from '../componentes/EnderecoCurto';
import PainelCarteira from '../componentes/PainelCarteira';
import { useTituloPagina } from '../utilitarios/useTituloPagina';

const PASSOS = ['Iniciar sessão', 'Criar carteira', 'Registar na eleição', 'Concluído'];

const MENSAGEM_SESSAO_EXPIRADA = 'A sua sessão expirou. Inicie sessão novamente para continuar.';

export default function Habilitar() {
  useTituloPagina('Habilitar');
  const carteira = useCarteira();

  // O token fica apenas em memoria (estado React); nunca em localStorage.
  const [token, setToken] = useState(null);
  const [fase, setFase] = useState('login'); // 'login' | 'estudante' | 'sucesso'
  const [estudante, setEstudante] = useState(null);

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [aEntrar, setAEntrar] = useState(false);
  const [erroLogin, setErroLogin] = useState('');
  const [avisoSessao, setAvisoSessao] = useState('');

  const [aHabilitar, setAHabilitar] = useState(false);
  const [erroHabilitar, setErroHabilitar] = useState(null); // { titulo, texto }
  const [sucesso, setSucesso] = useState(null);

  const tituloFase = useRef(null);
  const primeiraRenderizacao = useRef(true);

  useEffect(() => {
    if (primeiraRenderizacao.current) {
      primeiraRenderizacao.current = false;
      return;
    }
    tituloFase.current?.focus();
  }, [fase]);

  function sessaoExpirada() {
    setToken(null);
    setEstudante(null);
    setErroHabilitar(null);
    setAvisoSessao(MENSAGEM_SESSAO_EXPIRADA);
    setFase('login');
  }

  function terminarSessao() {
    setToken(null);
    setEstudante(null);
    setErroHabilitar(null);
    setAvisoSessao('');
    setSucesso(null);
    setFase('login');
  }

  async function entrar(evento) {
    evento.preventDefault();
    setErroLogin('');
    setAvisoSessao('');
    setAEntrar(true);
    try {
      const resposta = await iniciarSessao(email.trim(), senha);
      setSenha('');
      let dados = {
        nome: resposta?.estudante?.nome ?? '',
        habilitado: Boolean(resposta?.estudante?.habilitado),
        elegivel: true,
      };
      try {
        const estado = await obterEstadoEstudante(resposta.token);
        dados = {
          nome: estado.nome ?? dados.nome,
          elegivel: estado.elegivel !== false,
          habilitado: Boolean(estado.habilitado),
        };
      } catch (e) {
        if (e instanceof ErroApi && e.estado === 401) throw e;
        // Sem o estado detalhado usamos o que veio no login.
      }
      setEstudante(dados);
      // Se ja esta habilitado (ou nao e elegivel) nao continua: descarta o token.
      setToken(dados.habilitado || !dados.elegivel ? null : resposta.token);
      setFase('estudante');
    } catch (e) {
      if (e instanceof ErroApi && e.estado === 401) {
        setErroLogin(e.message || 'Email ou senha incorretos.');
      } else if (e instanceof ErroApi && e.estado === 403) {
        setErroLogin(e.message || 'Não é elegível para votar nesta eleição.');
      } else {
        setErroLogin(e?.message || 'Não foi possível iniciar sessão.');
      }
    } finally {
      setAEntrar(false);
    }
  }

  async function habilitar() {
    if (!token || !carteira) return;
    setErroHabilitar(null);
    setAHabilitar(true);
    try {
      const resposta = await habilitarCarteira(token, carteira.endereco);
      setSucesso({
        mensagem: resposta?.mensagem || 'Carteira habilitada com sucesso.',
        hashTransacao: resposta?.hashTransacao || '',
        endereco: carteira.endereco,
      });
      setEstudante((anterior) => (anterior ? { ...anterior, habilitado: true } : anterior));
      setToken(null); // concluido: o token deixa de ser necessario
      setFase('sucesso');
    } catch (e) {
      if (e instanceof ErroApi && e.estado === 401) {
        sessaoExpirada();
      } else if (e instanceof ErroApi && e.estado === 409) {
        setErroHabilitar({
          titulo: 'Habilitação recusada',
          texto: e.message,
          dica: 'Se já estava habilitado, pode ir diretamente votar. Se a carteira já estava registada, use outra carteira.',
        });
      } else if (e instanceof ErroApi && e.estado === 503) {
        setErroHabilitar({
          titulo: 'Blockchain indisponível',
          texto: e.message,
          dica: 'O registo na blockchain falhou. Aguarde um pouco e tente novamente.',
        });
      } else if (e instanceof ErroApi && e.tipo === 'tempo') {
        setErroHabilitar({
          titulo: 'Sem resposta do servidor',
          texto: e.message,
          dica: 'A habilitação pode ter sido concluída mesmo assim. Confirme no ecrã Votar antes de tentar novamente.',
        });
      } else {
        setErroHabilitar({ titulo: 'Não foi possível habilitar a carteira', texto: e?.message || 'Erro desconhecido.' });
      }
    } finally {
      setAHabilitar(false);
    }
  }

  const passoAtual = fase === 'login' ? 0 : fase === 'sucesso' ? 3 : carteira ? 2 : 1;
  const podeContinuar = fase === 'estudante' && estudante && !estudante.habilitado && estudante.elegivel && token;

  return (
    <>
      <h1>Habilitar para votar</h1>
      <p className="introducao">
        Confirme que é estudante elegível, crie a sua carteira e registe-a na eleição. Só precisa de o fazer
        uma vez. O voto em si é feito depois, no ecrã Votar, sem email nem senha.
      </p>

      <ol className="passos" aria-label="Passos da habilitação">
        {PASSOS.map((p, i) => (
          <li
            key={p}
            aria-current={i === passoAtual ? 'step' : undefined}
            className={i < passoAtual || (fase === 'sucesso' && i === 3) ? 'passos__feito' : undefined}
          >
            {p}
          </li>
        ))}
      </ol>

      <AvisoContrato />

      {fase === 'login' && (
        <section className="cartao" aria-labelledby="titulo-login">
          <h2 id="titulo-login" ref={tituloFase} tabIndex={-1}>
            Iniciar sessão
          </h2>
          {avisoSessao && (
            <Aviso tipo="aviso" titulo="Sessão expirada">
              <p>{avisoSessao}</p>
            </Aviso>
          )}
          <form className="formulario" onSubmit={entrar}>
            <div className="campo">
              <label htmlFor="email">Email institucional</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={aEntrar}
                aria-invalid={erroLogin ? 'true' : undefined}
                aria-describedby={erroLogin ? 'erro-login' : undefined}
              />
            </div>
            <div className="campo">
              <label htmlFor="senha">Palavra-passe</label>
              <input
                id="senha"
                type="password"
                autoComplete="current-password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                disabled={aEntrar}
                aria-invalid={erroLogin ? 'true' : undefined}
                aria-describedby={erroLogin ? 'erro-login' : undefined}
              />
            </div>
            {erroLogin && (
              <div id="erro-login">
                <Aviso tipo="erro">
                  <p>{erroLogin}</p>
                </Aviso>
              </div>
            )}
            <div>
              <button type="submit" className="botao" disabled={aEntrar} aria-busy={aEntrar}>
                {aEntrar && <RodinhaBotao />}
                {aEntrar ? 'A entrar…' : 'Entrar'}
              </button>
            </div>
          </form>
        </section>
      )}

      {fase === 'estudante' && estudante && (
        <section className="cartao" aria-labelledby="titulo-estudante">
          <div className="cabeca-secao">
            <h2 id="titulo-estudante" ref={tituloFase} tabIndex={-1}>
              Olá{estudante.nome ? `, ${estudante.nome}` : ''}
            </h2>
            <button type="button" className="botao botao--secundario botao--pequeno" onClick={terminarSessao} disabled={aHabilitar}>
              Terminar sessão
            </button>
          </div>

          <dl className="dados">
            <dt>Elegível</dt>
            <dd>{estudante.elegivel ? 'Sim' : 'Não'}</dd>
            <dt>Estado</dt>
            <dd>{estudante.habilitado ? 'Já habilitado' : 'Ainda não habilitado'}</dd>
          </dl>

          {estudante.habilitado && (
            <Aviso tipo="info" titulo="Já está habilitado">
              <p>
                A sua carteira já foi registada nesta eleição. Não é preciso repetir a habilitação: vá a{' '}
                <Link to="/votar">Votar</Link> e ligue a mesma carteira.
              </p>
            </Aviso>
          )}

          {!estudante.elegivel && !estudante.habilitado && (
            <Aviso tipo="erro" titulo="Não elegível">
              <p>A sua conta não é elegível para votar nesta eleição. Contacte a comissão eleitoral.</p>
            </Aviso>
          )}

          {podeContinuar && (
            <>
              <h3>Passo 2 · Criar carteira</h3>
              <PainelCarteira textoLigar="Criar carteira" desativado={aHabilitar} />

              {carteira && (
                <>
                  <h3 style={{ marginTop: 24 }}>Passo 3 · Registar na eleição</h3>
                  <p>
                    O servidor vai registar a carteira <EnderecoCurto endereco={carteira.endereco} /> no contrato da
                    eleição. São feitas duas transações na blockchain, por isso pode demorar alguns segundos.
                  </p>
                  {erroHabilitar && (
                    <Aviso tipo="erro" titulo={erroHabilitar.titulo}>
                      <p>{erroHabilitar.texto}</p>
                      {erroHabilitar.dica && <p>{erroHabilitar.dica}</p>}
                    </Aviso>
                  )}
                  {aHabilitar ? (
                    <Carregando texto="A registar a carteira na blockchain… Não feche esta página." />
                  ) : (
                    <button type="button" className="botao" onClick={habilitar}>
                      Habilitar esta carteira
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}

      {fase === 'sucesso' && sucesso && (
        <section className="cartao" aria-labelledby="titulo-sucesso">
          <h2 id="titulo-sucesso" ref={tituloFase} tabIndex={-1}>
            Carteira habilitada
          </h2>
          <Aviso tipo="sucesso">
            <p>{sucesso.mensagem}</p>
          </Aviso>
          <dl className="dados">
            <dt>Carteira</dt>
            <dd>
              <EnderecoCurto endereco={sucesso.endereco} />
            </dd>
            {sucesso.hashTransacao && (
              <>
                <dt>Transação</dt>
                <dd className="hash">
                  {urlExploradorTransacao(sucesso.hashTransacao) ? (
                    <a href={urlExploradorTransacao(sucesso.hashTransacao)} target="_blank" rel="noreferrer">
                      {sucesso.hashTransacao}
                    </a>
                  ) : (
                    sucesso.hashTransacao
                  )}
                </dd>
              </>
            )}
          </dl>
          <p>A sessão foi terminada. Para votar, não precisa de voltar a iniciar sessão.</p>
          <div className="acoes">
            <Link to="/votar" className="botao">
              Ir para Votar
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
