import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppConfig } from '../../config/app-config.service.js';
import { PlatformAuth, Public, TenantOptional } from '../../core/security/decorators.js';
import {
  AcceptInvitationDto,
  ForgotPasswordDto,
  InvitationQueryDto,
  LoginDto,
  PlatformLoginDto,
  RefreshDto,
  ResetPasswordDto,
  SignupDto,
  SwitchTenantDto,
} from './dto/auth.dto.js';
import { PlatformAuthService } from './platform/platform-auth.service.js';
import {
  clearRefreshCookie,
  PLATFORM_REFRESH_COOKIE,
  readRefreshToken,
  setRefreshCookie,
  USER_REFRESH_COOKIE,
} from './refresh-cookie.js';
import { UserAuthService } from './user-auth.service.js';

/** Brute-force protection on credential endpoints (per client IP). */
const CREDENTIALS_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: UserAuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('signup')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create an account and a company (starts the plan trial)' })
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.signup(dto);
    setRefreshCookie(reply, USER_REFRESH_COOKIE, result.refreshToken, result.refreshTokenExpiresAt, this.secure);
    return result;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIALS_THROTTLE)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.login(dto);
    setRefreshCookie(reply, USER_REFRESH_COOKIE, result.refreshToken, result.refreshTokenExpiresAt, this.secure);
    return result;
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Email a password-reset link (same answer whether or not the account exists)' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(CREDENTIALS_THROTTLE)
  @ApiOperation({ summary: 'Set a new password from the emailed link; signs out every session' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Get('invitation')
  @Throttle(CREDENTIALS_THROTTLE)
  @ApiOperation({ summary: 'Who and which company an invitation link is for' })
  invitation(@Query() query: InvitationQueryDto) {
    return this.auth.invitation(query.token);
  }

  @Public()
  @Post('invitation/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIALS_THROTTLE)
  @ApiOperation({ summary: 'Accept an invitation (sets the password for new accounts) and sign in' })
  async acceptInvitation(@Body() dto: AcceptInvitationDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.acceptInvitation(dto);
    setRefreshCookie(reply, USER_REFRESH_COOKIE, result.refreshToken, result.refreshTokenExpiresAt, this.secure);
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the refresh token (body or httpOnly cookie) and get a new access token' })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.refresh(readRefreshToken(request, USER_REFRESH_COOKIE, dto.refreshToken));
    setRefreshCookie(reply, USER_REFRESH_COOKIE, result.refreshToken, result.refreshTokenExpiresAt, this.secure);
    return result;
  }

  @TenantOptional()
  @Post('switch-tenant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch the active company; returns a new access token' })
  switchTenant(@Body() dto: SwitchTenantDto) {
    return this.auth.switchTenant(dto.tenantId);
  }

  @TenantOptional()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.auth.logout();
    clearRefreshCookie(reply, USER_REFRESH_COOKIE, this.secure);
  }

  @TenantOptional()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out of every device' })
  async logoutAll(@Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.auth.logoutEverywhere();
    clearRefreshCookie(reply, USER_REFRESH_COOKIE, this.secure);
  }

  private get secure(): boolean {
    return this.config.get('COOKIE_SECURE');
  }
}

@ApiTags('Auth')
@TenantOptional()
@Controller('me')
export class MeController {
  constructor(private readonly auth: UserAuthService) {}

  @Get()
  @ApiOperation({ summary: 'Current user, active company, permissions, plan entitlements and companies' })
  me() {
    return this.auth.me();
  }
}

@ApiTags('Platform · Auth')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIALS_THROTTLE)
  async login(@Body() dto: PlatformLoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.login(dto);
    setRefreshCookie(reply, PLATFORM_REFRESH_COOKIE, result.refreshToken, result.refreshTokenExpiresAt, this.secure);
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.refresh(readRefreshToken(request, PLATFORM_REFRESH_COOKIE, dto.refreshToken));
    setRefreshCookie(reply, PLATFORM_REFRESH_COOKIE, result.refreshToken, result.refreshTokenExpiresAt, this.secure);
    return result;
  }

  @PlatformAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.auth.logout();
    clearRefreshCookie(reply, PLATFORM_REFRESH_COOKIE, this.secure);
  }

  @PlatformAuth()
  @Get('me')
  me() {
    return this.auth.me();
  }

  private get secure(): boolean {
    return this.config.get('COOKIE_SECURE');
  }
}
