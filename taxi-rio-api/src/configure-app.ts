import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';

export function configureApp(app: INestApplication): void {
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Taxi Rio API')
    .setDescription(
      'API de corridas. A criação é idempotente pelo cabeçalho Idempotency-Key. A consulta de uma corrida usa cache read-through no Redis.',
    )
    .setVersion('1.0')
    .addTag('corridas', 'Criação, consulta e transição de status das corridas.')
    .build();

  SwaggerModule.setup(
    SWAGGER_PATH,
    app,
    SwaggerModule.createDocument(app, config),
  );
}
