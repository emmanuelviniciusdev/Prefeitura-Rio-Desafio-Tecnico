import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCorridas1791396000000 implements MigrationInterface {
  name = 'CreateCorridas1791396000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`corridas\` (
        \`id\` varchar(36) NOT NULL,
        \`user_id\` varchar(36) NOT NULL,
        \`local_partida\` varchar(255) NOT NULL,
        \`local_destino\` varchar(255) NOT NULL,
        \`tempo_decorrido_minutos\` float NOT NULL,
        \`status_corrida\` varchar(20) NOT NULL,
        \`created_at\` datetime(3) NOT NULL,
        \`created_by\` varchar(255) NOT NULL,
        \`updated_at\` datetime(3) NOT NULL,
        \`updated_by\` varchar(255) NOT NULL,
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`chk_corridas_status\` CHECK (
          \`status_corrida\` IN ('accepted', 'initialized', 'finished')
        ),
        CONSTRAINT \`chk_corridas_elapsed\` CHECK (\`tempo_decorrido_minutos\` >= 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`idempotency_keys\` (
        \`idempotency_key\` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`request_hash\` varchar(64) NOT NULL,
        \`resource_id\` varchar(36) NOT NULL,
        \`response_body\` json NOT NULL,
        \`created_at\` datetime(3) NOT NULL,
        PRIMARY KEY (\`idempotency_key\`),
        CONSTRAINT \`fk_idempotency_keys_corrida\`
          FOREIGN KEY (\`resource_id\`) REFERENCES \`corridas\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `idempotency_keys`');
    await queryRunner.query('DROP TABLE IF EXISTS `corridas`');
  }
}
