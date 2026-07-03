import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '../generated/prisma/client';
import type { GradingDefaultDto } from './users.schema';

export interface Profile {
  userId: string;
  email: string;
  gradingDefault: GradingDefaultDto;
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

  async updateGradingDefault(
    userId: string,
    gradingDefault: GradingDefaultDto,
  ): Promise<Profile> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { gradingDefault: toDbGradingDefault(gradingDefault) },
    });
    return toProfile(user);
  }
}
