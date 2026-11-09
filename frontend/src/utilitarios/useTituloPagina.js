import { useEffect } from 'react';

export function useTituloPagina(titulo) {
  useEffect(() => {
    document.title = titulo ? `${titulo} · Votação Estudantil` : 'Votação Estudantil';
  }, [titulo]);
}
