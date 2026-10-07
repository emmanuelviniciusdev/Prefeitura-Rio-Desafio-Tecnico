import { MigrationInterface, QueryRunner } from 'typeorm';

export class MoveIdempotencyKeyOntoCorridas1791397000000 implements MigrationInterface {
  name = 'MoveIdempotencyKeyOntoCorridas1791397000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `idempotency_keys`');
    await queryRunner.query('DELETE FROM `corridas`');
    await queryRunner.query(`
      ALTER TABLE \`corridas\`
        DROP CHECK \`chk_corridas_elapsed\`,
        DROP COLUMN \`tempo_decorrido_minutos\`,
        ADD COLUMN \`idempotency_key\` varchar(36) NOT NULL AFTER \`local_destino\`,
        ADD COLUMN \`dh_inicio\` datetime(3) NOT NULL AFTER \`idempotency_key\`,
        ADD COLUMN \`dh_fim\` datetime(3) NULL AFTER \`dh_inicio\`,
        ADD UNIQUE KEY \`uk_corridas_idempotency_key\` (\`idempotency_key\`)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DELETE FROM `corridas`');
    await queryRunner.query(`
      ALTER TABLE \`corridas\`
        DROP INDEX \`uk_corridas_idempotency_key\`,
        DROP COLUMN \`idempotency_key\`,
        DROP COLUMN \`dh_inicio\`,
        DROP COLUMN \`dh_fim\`,
        ADD COLUMN \`tempo_decorrido_minutos\` float NOT NULL,
        ADD CONSTRAINT \`chk_corridas_elapsed\` CHECK (\`tempo_decorrido_minutos\` >= 0)
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
}
