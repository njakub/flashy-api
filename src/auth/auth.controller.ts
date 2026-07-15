import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './auth.types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  googleSchema,
  appleSchema,
  type RegisterDto,
  type LoginDto,
  type RefreshDto,
  type GoogleDto,
  type AppleDto,
} from './auth.schema';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('google')
  google(@Body(new ZodValidationPipe(googleSchema)) dto: GoogleDto) {
    return this.authService.googleSignIn(dto.idToken);
  }

  @Post('apple')
  apple(@Body(new ZodValidationPipe(appleSchema)) dto: AppleDto) {
    return this.authService.appleSignIn(dto);
  }

  @Post('refresh')
  refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  async logout(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto) {
    await this.authService.logout(dto.refreshToken);
    return { ok: true };
  }

  /** In-app account deletion (App Store Guideline 5.1.1(v)). */
  @Delete('account')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async deleteAccount(@CurrentUser() user: AuthUser): Promise<void> {
    await this.authService.deleteAccount(user.userId);
  }
}
