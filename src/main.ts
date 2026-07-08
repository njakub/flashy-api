import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  // Own the body parsers so the JSON limit can be raised above Express's
  // 100kb default — POST /generate carries a base64 PDF (≤10 MB raw ≈
  // 13.4 MB encoded). Global by design; per-route limits aren't worth the
  // ceremony for an API this size.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ extended: true }));

  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });

  // 0.0.0.0 so the container is reachable by Fly's proxy, not just localhost.
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
bootstrap();
