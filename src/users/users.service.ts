import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '../generated/prisma/client';
import type { UpdateProfileDto, GradingDefaultDto } from './users.schema';
import { getModel } from '../llm/models';

export interface Profile {
  userId: string;
  email: string;
  gradingDefault: GradingDefaultDto;
  gradingModel: string;
  generationModel: string;
  /// A user can have both set (password added after linking Google, or vice
  /// versa) — these are independent flags, not a single exclusive method.
  hasPassword: boolean;
  hasGoogle: boolean;
}

const toWireGradingDefault = (v: 'LOCAL' | 'AI'): GradingDefaultDto =>
  v === 'AI' ? 'ai' : 'local';
const toDbGradingDefault = (v: GradingDefaultDto): 'LOCAL' | 'AI' =>
  v === 'ai' ? 'AI' : 'LOCAL';

const toProfile = (user: User): Profile => ({
  userId: user.id,
  email: user.email,
  gradingDefault: toWireGradingDefault(user.gradingDefault),
  gradingModel: user.gradingModel,
  generationModel: user.generationModel,
  hasPassword: user.passwordHash !== null,
  hasGoogle: user.googleId !== null,
});

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<Profile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return toProfile(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<Profile> {
    if (
      dto.gradingModel &&
      !getModel(dto.gradingModel)?.tasks.includes('grading')
    ) {
      throw new BadRequestException(
        `"${dto.gradingModel}" is not a valid grading model`,
      );
    }
    if (
      dto.generationModel &&
      !getModel(dto.generationModel)?.tasks.includes('generation')
    ) {
      throw new BadRequestException(
        `"${dto.generationModel}" is not a valid generation model`,
      );
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.gradingDefault !== undefined && {
          gradingDefault: toDbGradingDefault(dto.gradingDefault),
        }),
        ...(dto.gradingModel !== undefined && {
          gradingModel: dto.gradingModel,
        }),
        ...(dto.generationModel !== undefined && {
          generationModel: dto.generationModel,
        }),
      },
    });
    return toProfile(user);
  }
}
