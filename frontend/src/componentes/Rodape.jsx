import { rede } from '../config';
import { enderecoContrato, urlExploradorEndereco } from '../contrato/votacao';
import { useEstadoContrato } from '../contexto/EstadoContrato';
import EnderecoCurto from './EnderecoCurto';

export default function Rodape() {
  const { estado } = useEstadoContrato();
  return (
    <footer className="rodape">
      <div className="contentor rodape__interior">
        <dl>
          <div>
            <dt>Rede</dt>
            <dd>
              {rede.nome} (chainId {rede.chainId})
            </dd>
          </div>
          <div>
            <dt>Contrato</dt>
            <dd>
              {enderecoContrato ? (
                <EnderecoCurto endereco={enderecoContrato} href={urlExploradorEndereco(enderecoContrato)} />
              ) : (
                'não publicado'
              )}
              {enderecoContrato && estado === 'nao-publicado' && ' (sem código nesta rede)'}
            </dd>
          </div>
        </dl>
      </div>
    </footer>
  );
}
