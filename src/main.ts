import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });

  // 0.0.0.0 so the container is reachable by Fly's proxy, not just localhost.
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
bootstrap();
