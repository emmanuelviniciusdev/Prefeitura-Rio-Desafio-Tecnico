import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameCorridaStatusAcceptedToRequested1791398000000 implements MigrationInterface {
  name = 'RenameCorridaStatusAcceptedToRequested1791398000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `corridas` DROP CHECK `chk_corridas_status`',
    );
    await queryRunner.query(`
      UPDATE \`corridas\`
      SET \`status_corrida\` = 'requested'
      WHERE \`status_corrida\` = 'accepted'
    `);
    await queryRunner.query(`
      ALTER TABLE \`corridas\`
        ADD CONSTRAINT \`chk_corridas_status\` CHECK (
          \`status_corrida\` IN ('requested', 'initialized', 'finished')
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `corridas` DROP CHECK `chk_corridas_status`',
    );
    await queryRunner.query(`
      UPDATE \`corridas\`
      SET \`status_corrida\` = 'accepted'
      WHERE \`status_corrida\` = 'requested'
    `);
    await queryRunner.query(`
      ALTER TABLE \`corridas\`
        ADD CONSTRAINT \`chk_corridas_status\` CHECK (
          \`status_corrida\` IN ('accepted', 'initialized', 'finished')
        )
    `);
  }
}
