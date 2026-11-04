import type { EmailMessage } from './mailer.service.js';

/**
 * Transactional emails, bilingual (Arabic first, then English) so the
 * message reads right whatever the recipient's language. Plain HTML with
 * inline styles only (mail clients drop stylesheets); every link is also in
 * the text part.
 */

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Section {
  dir: 'rtl' | 'ltr';
  heading: string;
  paragraphs: string[];
  button: string;
  footer: string;
}

function layout(product: string, url: string, sections: Section[], support?: string): string {
  const block = (s: Section) => `
    <div dir="${s.dir}" style="text-align:${s.dir === 'rtl' ? 'right' : 'left'};margin:0 0 28px">
      <h1 style="font-size:20px;margin:0 0 12px;color:#1c1917">${escape(s.heading)}</h1>
      ${s.paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.6;color:#44403c">${escape(p)}</p>`).join('')}
      <p style="margin:20px 0"><a href="${escape(url)}" style="background:#1c1917;color:#fafaf9;padding:11px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escape(s.button)}</a></p>
      <p style="margin:0;font-size:12px;color:#78716c">${escape(s.footer)}</p>
    </div>`;
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:Segoe UI,Tahoma,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:10px;padding:32px">
    <p style="font-size:22px;margin:0 0 24px;color:#1c1917">${escape(product)}</p>
    ${sections.map(block).join('<hr style="border:none;border-top:1px solid #e7e5e4;margin:0 0 28px">')}
    <p style="font-size:12px;color:#a8a29e;word-break:break-all;margin:0">${escape(url)}</p>
    ${support ? `<p style="font-size:12px;color:#a8a29e;margin:8px 0 0">${escape(support)}</p>` : ''}
  </div></body></html>`;
}

const text = (sections: Section[], url: string) =>
  sections.map((s) => [s.heading, ...s.paragraphs, url, s.footer].join('\n\n')).join('\n\n----\n\n');

export interface InvitationEmail {
  to: string;
  inviteeName: string;
  companyName: string;
  inviterName: string | null;
  url: string;
  expiresInDays: number;
  /** New account (sets a password) or existing user joining a company. */
  newAccount: boolean;
  product: string;
  support?: string;
}

export function invitationEmail(m: InvitationEmail): EmailMessage {
  const by = m.inviterName;
  const sections: Section[] = [
    {
      dir: 'rtl',
      heading: `دعوة للانضمام إلى ${m.companyName}`,
      paragraphs: [
        `مرحبًا ${m.inviteeName}،`,
        by ? `دعاك ${by} للانضمام إلى ${m.companyName} على ${m.product}.` : `تمت دعوتك للانضمام إلى ${m.companyName} على ${m.product}.`,
        m.newAccount ? 'اضغط الزر لتعيين كلمة المرور وتفعيل حسابك.' : 'اضغط الزر لقبول الدعوة.',
      ],
      button: m.newAccount ? 'تفعيل الحساب' : 'قبول الدعوة',
      footer: `ينتهي هذا الرابط خلال ${m.expiresInDays} أيام. إذا لم تكن تتوقع هذه الرسالة فتجاهلها.`,
    },
    {
      dir: 'ltr',
      heading: `You're invited to ${m.companyName}`,
      paragraphs: [
        `Hello ${m.inviteeName},`,
        by ? `${by} invited you to join ${m.companyName} on ${m.product}.` : `You've been invited to join ${m.companyName} on ${m.product}.`,
        m.newAccount ? 'Use the button to set your password and activate your account.' : 'Use the button to accept the invitation.',
      ],
      button: m.newAccount ? 'Activate account' : 'Accept invitation',
      footer: `This link expires in ${m.expiresInDays} days. If you weren't expecting it, you can ignore this email.`,
    },
  ];
  return {
    to: m.to,
    subject: `${m.companyName} · ${m.newAccount ? 'Activate your account / تفعيل حسابك' : 'Invitation / دعوة'}`,
    text: text(sections, m.url),
    html: layout(m.product, m.url, sections, m.support),
  };
}

export function passwordResetEmail(m: { to: string; name: string; url: string; expiresInMinutes: number; product: string; support?: string }): EmailMessage {
  const sections: Section[] = [
    {
      dir: 'rtl',
      heading: 'إعادة تعيين كلمة المرور',
      paragraphs: [`مرحبًا ${m.name}،`, `طلبت إعادة تعيين كلمة المرور لحسابك على ${m.product}.`],
      button: 'تعيين كلمة مرور جديدة',
      footer: `ينتهي هذا الرابط خلال ${m.expiresInMinutes} دقيقة ولا يُستخدم إلا مرة واحدة. إذا لم تطلب ذلك فتجاهل هذه الرسالة.`,
    },
    {
      dir: 'ltr',
      heading: 'Reset your password',
      paragraphs: [`Hello ${m.name},`, `We received a request to reset the password of your ${m.product} account.`],
      button: 'Set a new password',
      footer: `This link expires in ${m.expiresInMinutes} minutes and works once. If you didn't ask for it, ignore this email.`,
    },
  ];
  return {
    to: m.to,
    subject: `${m.product} · Reset your password / إعادة تعيين كلمة المرور`,
    text: text(sections, m.url),
    html: layout(m.product, m.url, sections, m.support),
  };
}
