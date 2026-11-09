-- Esquema da base de dados do sistema de votação (MySQL 8.4, utf8mb4).
-- Aplicado por `npm run bd:criar` (scripts/criar-bd.js), que cria antes a base de dados.
-- Para aplicar à mão: mysql -u root votacao < bd/esquema.sql

-- ---------------------------------------------------------------------------
-- estudantes: quem pode votar.
--
-- PRIVACIDADE: não existe coluna com o endereço da carteira, e isso é de propósito.
-- A BD sabe quem está elegível e se já habilitou uma carteira (carteira_registada),
-- mas nunca QUAL carteira pertence a cada estudante. Também não há datas de habilitação,
-- para não ser possível cruzar a hora da habilitação com os eventos públicos da blockchain.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estudantes (
  id                 INT          NOT NULL AUTO_INCREMENT,
  numero_estudante   VARCHAR(20)  NOT NULL,
  nome               VARCHAR(120) NOT NULL,
  email              VARCHAR(160) NOT NULL,  -- Guardado sempre em minúsculas.
  senha_hash         VARCHAR(100) NOT NULL,  -- bcrypt.
  curso              VARCHAR(120) NULL,
  elegivel           TINYINT(1)   NOT NULL DEFAULT 1,
  carteira_registada TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_estudantes_numero (numero_estudante),
  UNIQUE KEY uq_estudantes_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- logs_votacao: cópia dos eventos públicos VotoRegistado do contrato, preenchida pela
-- sincronização do backend. Alimenta o módulo Python de deteção de anomalias.
-- data_hora está em UTC (o backend usa time_zone = '+00:00' nas suas sessões).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS logs_votacao (
  id             INT          NOT NULL AUTO_INCREMENT,
  endereco       CHAR(42)     NOT NULL,  -- Carteira que votou (dado público do evento).
  id_candidato   INT UNSIGNED NOT NULL,
  data_hora      DATETIME     NOT NULL,  -- Hora do bloco (block.timestamp), em UTC.
  hash_transacao CHAR(66)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_logs_votacao_hash (hash_transacao),
  KEY idx_logs_votacao_data_hora (data_hora)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
