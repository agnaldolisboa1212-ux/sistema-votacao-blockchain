import { Link, NavLink } from 'react-router-dom';
import { modoCarteira } from '../config';
import SeloDesenvolvimento from './SeloDesenvolvimento';

const LIGACOES = [
  { para: '/', texto: 'Início', fim: true },
  { para: '/habilitar', texto: 'Habilitar' },
  { para: '/votar', texto: 'Votar' },
  { para: '/admin', texto: 'Administração' },
];

export default function Cabecalho() {
  return (
    <header className="cabecalho">
      <div className="contentor cabecalho__interior">
        <Link to="/" className="marca">
          <svg className="marca__icone" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <rect x="4" y="13" width="24" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M10 13V7.5A1.5 1.5 0 0 1 11.5 6h9A1.5 1.5 0 0 1 22 7.5V13" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M12.5 9.5l2.5 2.5 4.5-4.5" fill="none" stroke="#ffd166" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 19h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          Votação Estudantil
        </Link>
        <nav className="navegacao" aria-label="Navegação principal">
          <ul>
            {LIGACOES.map((l) => (
              <li key={l.para}>
                <NavLink to={l.para} end={l.fim}>
                  {l.texto}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      {modoCarteira === 'desenvolvimento' && (
        <div className="faixa-dev">
          <div className="contentor">
            <SeloDesenvolvimento /> As carteiras dos estudantes são geradas no navegador, apenas para testes.
          </div>
        </div>
      )}
    </header>
  );
}
