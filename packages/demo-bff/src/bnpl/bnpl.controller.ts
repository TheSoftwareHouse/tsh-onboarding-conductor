import { ConfigService } from '@nestjs/config';
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';

import { AppConfig, KSA_JOURNEY } from '../config/app.config';
import { LeanLink } from '../lean/lean-link.service';
import { PersonaService, PersonaSummary } from '../personas/persona.service';
import { BnplService } from './bnpl.service';
import { BankLoginDto } from './dto/bank-login.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { GetSessionQuery } from './dto/get-session.query';
import { CreatedSession, JourneyView, ProcessingView, SessionView } from './dto/session-view';
import { SessionNotFoundException } from './errors/session-not-found.exception';
import { SubmitSessionDto } from './dto/submit-session.dto';

@Controller('v1/bnpl')
export class BnplController {
  constructor(
    private readonly service: BnplService,
    private readonly personas: PersonaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Which journey this BFF runs, so the web app can pick its page table before any session. */
  @Get('journey')
  journey(): JourneyView {
    return { journey: this.service.journeyOf() };
  }

  /** The UK personae; the KSA journey has none (the Lean mock-bank login decides the data). */
  @Get('personas')
  listPersonas(): PersonaSummary[] {
    return this.service.journeyOf() === KSA_JOURNEY ? [] : this.personas.list();
  }

  @Post('sessions')
  create(@Body() dto: CreateSessionDto): Promise<CreatedSession> {
    return this.service.createSession(dto.persona);
  }

  @Get('sessions/:token')
  get(@Param('token') token: string, @Query() query: GetSessionQuery): Promise<SessionView> {
    return this.service.getSession(token, query.wait);
  }

  /** Test-only: the e2e suites need the engine id to post the `mock_credit` callback. */
  @Get('sessions/:token/onboarding')
  onboarding(@Param('token') token: string): { onboardingId: string } {
    if (this.config.get('NODE_ENV', { infer: true }) !== 'test') {
      throw new SessionNotFoundException();
    }

    return { onboardingId: this.service.onboardingIdOf(token) };
  }

  @Post('sessions/:token/submit')
  @HttpCode(200)
  submit(
    @Param('token') token: string,
    @Body() dto: SubmitSessionDto,
  ): Promise<SessionView | ProcessingView> {
    return this.service.submit(token, dto.values);
  }

  @Post('sessions/:token/bank-login')
  @HttpCode(200)
  bankLogin(@Param('token') token: string, @Body() dto: BankLoginDto): Promise<SessionView> {
    return this.service.bankLogin(token, dto.persona, dto.method);
  }

  /** KSA journey: creates the Lean customer, parks the step and answers the widget's parameters. */
  @Post('sessions/:token/bank-link')
  @HttpCode(200)
  bankLink(@Param('token') token: string): Promise<LeanLink> {
    return this.service.bankLink(token);
  }

  @Post('sessions/:token/run')
  @HttpCode(200)
  run(@Param('token') token: string): Promise<ProcessingView> {
    return this.service.run(token);
  }
}
