import { useState } from 'react';
import Aviso from './Aviso';
import Carregando from './Carregando';
import { useEstadoContrato } from '../contexto/EstadoContrato';
import { avisoRedeContrato } from '../contrato/votacao';
import { errosConfiguracao } from '../config';

/**
 * Mostra o estado do contrato quando nao esta utilizavel:
 * "Contrato não publicado", rede inacessivel ou configuracao em falta.
 * Com mostrarAVerificar=true mostra tambem o carregamento inicial.
 */
export default function AvisoContrato({ mostrarAVerificar = false }) {
  const { estado, mensagem, verificar } = useEstadoContrato();
  const [aRepetir, setARepetir] = useState(false);
  const erros = errosConfiguracao();

  async function repetir() {
    setARepetir(true);
    try {
      await verificar();
    } finally {
      setARepetir(false);
    }
  }

  const botaoRepetir = (
    <button type="button" className="botao botao--secundario botao--pequeno" onClick={repetir} disabled={aRepetir}>
      {aRepetir ? 'A verificar…' : 'Verificar novamente'}
    </button>
  );

  return (
    <>
      {erros.length > 0 && (
        <Aviso tipo="erro" titulo="Erro de configuração">
          <ul>
            {erros.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p>Reveja o ficheiro .env.local (ver .env.example) e reinicie o servidor de desenvolvimento.</p>
        </Aviso>
      )}
      {avisoRedeContrato && estado !== 'publicado' && (
        <Aviso tipo="aviso" titulo="Rede diferente">
          <p>{avisoRedeContrato}</p>
        </Aviso>
      )}
      {estado === 'a-verificar' && mostrarAVerificar && <Carregando texto="A verificar o contrato na blockchain…" />}
      {estado === 'nao-publicado' && (
        <Aviso tipo="aviso" titulo="Contrato não publicado" acoes={botaoRepetir}>
          <p>{mensagem}</p>
          <p>Publique o contrato com o script de publicação e recarregue esta página.</p>
        </Aviso>
      )}
      {estado === 'sem-rede' && (
        <Aviso tipo="erro" titulo="Rede blockchain indisponível" acoes={botaoRepetir}>
          <p>{mensagem}</p>
          <p>Confirme que o nó está a correr e que o endereço RPC está correto.</p>
        </Aviso>
      )}
    </>
  );
}
