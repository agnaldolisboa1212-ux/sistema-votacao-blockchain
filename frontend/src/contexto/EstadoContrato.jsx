import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { verificarContrato } from '../contrato/votacao';

const Contexto = createContext(null);

/**
 * Verifica (uma vez e depois de 10 em 10 s enquanto nao estiver disponivel)
 * se o contrato esta publicado na rede configurada.
 */
export function EstadoContratoProvider({ children }) {
  const [verificacao, setVerificacao] = useState({ estado: 'a-verificar', mensagem: '' });
  const emCurso = useRef(false);

  const verificar = useCallback(async () => {
    if (emCurso.current) return;
    emCurso.current = true;
    try {
      const resultado = await verificarContrato();
      setVerificacao(resultado);
    } finally {
      emCurso.current = false;
    }
  }, []);

  useEffect(() => {
    verificar();
  }, [verificar]);

  useEffect(() => {
    if (verificacao.estado === 'publicado' || verificacao.estado === 'a-verificar') return undefined;
    const id = setInterval(verificar, 10000);
    return () => clearInterval(id);
  }, [verificacao.estado, verificar]);

  return (
    <Contexto.Provider value={{ ...verificacao, publicado: verificacao.estado === 'publicado', verificar }}>
      {children}
    </Contexto.Provider>
  );
}

export function useEstadoContrato() {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useEstadoContrato tem de estar dentro de EstadoContratoProvider');
  return valor;
}
