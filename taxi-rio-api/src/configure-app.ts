import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { httpLoggingMiddleware } from './observability/http-logging.middleware';

export const SWAGGER_PATH = 'docs';

export function configureApp(app: INestApplication): void {
  app.enableShutdownHooks();
  app.use(httpLoggingMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Taxi Rio API')
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT emitido pelos endpoints de auth.',
    })
    .addTag('auth', 'Emissão de JWT para passageiro e motorista.')
    .addTag('corridas', 'Criação, consulta e transição de status das corridas.')
    .build();

  SwaggerModule.setup(
    SWAGGER_PATH,
    app,
    SwaggerModule.createDocument(app, config),
  );
}
