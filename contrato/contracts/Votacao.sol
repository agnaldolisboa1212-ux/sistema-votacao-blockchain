// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Votacao
/// @notice Eleicao estudantil: so votam carteiras registadas pela comissao,
///         cada carteira vota uma unica vez e qualquer pessoa pode auditar.
contract Votacao {
    struct Candidato {
        string nome;
        uint256 votos;
    }

    struct Eleitor {
        bool registado;
        bool votou;
    }

    /// Conta da comissao eleitoral que publicou o contrato.
    address public immutable administrador;

    bool public votacaoAberta;
    uint256 public totalEleitores;
    uint256 public totalVotos;

    Candidato[] public candidatos;
    mapping(address => Eleitor) public eleitores;

    event CandidatoAdicionado(uint256 indexed idCandidato, string nome);
    event EleitorRegistado(address indexed eleitor);
    event EstadoVotacaoAlterado(bool aberta);
    event VotoRegistado(address indexed eleitor, uint256 indexed idCandidato, uint256 dataHora);

    error ApenasAdministrador();
    error VotacaoEmCurso();
    error VotacaoFechada();
    error NomeInvalido();
    error EnderecoInvalido();
    error EleitorJaRegistado();
    error EleitorNaoRegistado();
    error JaVotou();
    error CandidatoInexistente();

    modifier apenasAdministrador() {
        if (msg.sender != administrador) revert ApenasAdministrador();
        _;
    }

    constructor() {
        administrador = msg.sender;
    }

    /// @notice Regista um candidato. So e possivel com a votacao fechada.
    function adicionarCandidato(string calldata nome) external apenasAdministrador {
        if (votacaoAberta) revert VotacaoEmCurso();
        if (bytes(nome).length == 0) revert NomeInvalido();

        candidatos.push(Candidato({nome: nome, votos: 0}));
        emit CandidatoAdicionado(candidatos.length - 1, nome);
    }

    /// @notice Habilita uma carteira para votar. Pode ser feito antes ou durante a votacao.
    function registarEleitor(address eleitor) external apenasAdministrador {
        if (eleitor == address(0)) revert EnderecoInvalido();
        if (eleitores[eleitor].registado) revert EleitorJaRegistado();

        eleitores[eleitor].registado = true;
        totalEleitores += 1;
        emit EleitorRegistado(eleitor);
    }

    /// @notice Abre (true) ou fecha (false) a votacao.
    function definirVotacaoAberta(bool aberta) external apenasAdministrador {
        votacaoAberta = aberta;
        emit EstadoVotacaoAlterado(aberta);
    }

    /// @notice Regista o voto da carteira que assina a transacao.
    function votar(uint256 idCandidato) external {
        if (!votacaoAberta) revert VotacaoFechada();
        Eleitor storage eleitor = eleitores[msg.sender];
        if (!eleitor.registado) revert EleitorNaoRegistado();
        if (eleitor.votou) revert JaVotou();
        if (idCandidato >= candidatos.length) revert CandidatoInexistente();

        eleitor.votou = true;
        candidatos[idCandidato].votos += 1;
        totalVotos += 1;
        emit VotoRegistado(msg.sender, idCandidato, block.timestamp);
    }

    function obterNumeroCandidatos() external view returns (uint256) {
        return candidatos.length;
    }

    /// @notice Devolve todos os candidatos de uma vez (leitura para a interface).
    function obterCandidatos() external view returns (string[] memory nomes, uint256[] memory votos) {
        uint256 n = candidatos.length;
        nomes = new string[](n);
        votos = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            nomes[i] = candidatos[i].nome;
            votos[i] = candidatos[i].votos;
        }
    }
}
