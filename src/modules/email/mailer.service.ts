import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { AppConfig } from '../../config/app-config.service.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Outgoing email over SMTP. Never throws: a failed send is logged and
 * reported as `false`, so a mail outage never rolls back business work.
 * Without SMTP_HOST (development) messages are logged; in tests they are
 * kept in `outbox` for assertions.
 */
@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transport: Transporter | null = null;
  /** Test environment only: every message "sent". */
  readonly outbox: EmailMessage[] = [];

  constructor(private readonly config: AppConfig) {}

  onModuleInit(): void {
    const host = this.config.get('SMTP_HOST');
    if (!host || this.config.isTest) return;
    const user = this.config.get('SMTP_USER');
    this.transport = nodemailer.createTransport({
      host,
      port: this.config.get('SMTP_PORT'),
      secure: this.config.get('SMTP_SECURE'),
      auth: user ? { user, pass: this.config.get('SMTP_PASSWORD') ?? '' } : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  get configured(): boolean {
    return this.transport !== null;
  }

  /** Checks the SMTP connection and credentials without sending anything. */
  async verify(): Promise<boolean> {
    if (!this.transport) return false;
    try {
      await this.transport.verify();
      return true;
    } catch (error) {
      this.logger.error(`SMTP verification failed: ${(error as Error).message}`);
      return false;
    }
  }

  async send(message: EmailMessage): Promise<boolean> {
    if (this.config.isTest) {
      this.outbox.push(message);
      return true;
    }
    if (!this.transport) {
      this.logger.warn(`[email not sent: SMTP not configured] to=${message.to} subject="${message.subject}"\n${message.text}`);
      return false;
    }
    try {
      await this.transport.sendMail({
        from: { name: this.config.get('EMAIL_FROM_NAME'), address: this.config.get('EMAIL_FROM') },
        replyTo: this.config.get('SUPPORT_EMAIL'),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return true;
    } catch (error) {
      this.logger.error(`email to ${message.to} failed: ${(error as Error).message}`);
      return false;
    }
  }
}
