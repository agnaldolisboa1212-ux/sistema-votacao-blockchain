import { useSyncExternalStore } from 'react';
import { obterCarteiraAtual, subscreverCarteira } from './index';

/** Carteira ligada (partilhada entre paginas) ou null. */
export function useCarteira() {
  return useSyncExternalStore(subscreverCarteira, obterCarteiraAtual, () => null);
}
