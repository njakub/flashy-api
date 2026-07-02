import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SyncModule } from './sync/sync.module';
import { GradeModule } from './grade/grade.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, SyncModule, GradeModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
