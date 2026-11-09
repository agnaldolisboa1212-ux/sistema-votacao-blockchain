import { useEffect, useRef } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import Cabecalho from './componentes/Cabecalho';
import Rodape from './componentes/Rodape';
import { EstadoContratoProvider } from './contexto/EstadoContrato';
import Administracao from './paginas/Administracao';
import Habilitar from './paginas/Habilitar';
import Inicio from './paginas/Inicio';
import Votar from './paginas/Votar';
import { useTituloPagina } from './utilitarios/useTituloPagina';

function NaoEncontrada() {
  useTituloPagina('Página não encontrada');
  return (
    <>
      <h1>Página não encontrada</h1>
      <p>
        O endereço não existe. Volte ao <Link to="/">início</Link>.
      </p>
    </>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const principal = useRef(null);
  const primeira = useRef(true);

  // Ao mudar de pagina, o foco vai para o conteudo principal (leitores de ecra).
  useEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    principal.current?.focus();
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <EstadoContratoProvider>
      <a className="saltar-conteudo" href="#conteudo">
        Saltar para o conteúdo
      </a>
      <Cabecalho />
      <main id="conteudo" className="principal" ref={principal} tabIndex={-1}>
        <div className="contentor">
          <Routes>
            <Route path="/" element={<Inicio />} />
            <Route path="/habilitar" element={<Habilitar />} />
            <Route path="/votar" element={<Votar />} />
            <Route path="/admin" element={<Administracao />} />
            <Route path="*" element={<NaoEncontrada />} />
          </Routes>
        </div>
      </main>
      <Rodape />
    </EstadoContratoProvider>
  );
}
