import { Module } from '@nestjs/common';
import { GradeController } from './grade.controller';
import { AnthropicGrader } from './grade.service';

@Module({
  controllers: [GradeController],
  providers: [AnthropicGrader],
})
export class GradeModule {}
