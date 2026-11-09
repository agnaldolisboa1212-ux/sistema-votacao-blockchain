// Mensagens em portugues para erros ao ligar a carteira (Web3Auth / desenvolvimento).
// Devolve null quando o erro nao e reconhecido (o chamador usa entao a mensagem generica).
export function mensagemErroLigacao(erro) {
  const codigo = erro?.code;
  const texto = String(erro?.message || '');

  if (codigo === 5114 || codigo === 5005 || /closed the modal|has been closed by the user/i.test(texto)) {
    return 'A janela de início de sessão foi fechada antes de terminar. Tente novamente.';
  }
  if (codigo === 5004 || /window is blocked|popup.*blocked/i.test(texto)) {
    return 'O navegador bloqueou a janela do Web3Auth. Permita janelas pop-up para este site e tente novamente.';
  }
  if (codigo === 5120 || /blocked by the application/i.test(texto)) {
    return 'Esta conta foi bloqueada no Web3Auth. Contacte a comissão eleitoral.';
  }
  if (/clientId|client id|invalid network|project config|origin|whitelist|chains on dashboard/i.test(texto)) {
    return `Erro na configuração do Web3Auth: ${texto}`;
  }
  if (/failed to fetch|network ?error|load failed/i.test(texto)) {
    return 'Não foi possível contactar o Web3Auth. Verifique a ligação à Internet e tente novamente.';
  }
  return null;
}
