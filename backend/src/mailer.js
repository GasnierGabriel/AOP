// Envoi d'e-mails via SMTP (Google Workspace : relais SMTP smtp-relay.gmail.com autorisé par l'IP du serveur,
// ou smtp.gmail.com avec un mot de passe d'application). Désactivé tant que SMTP_HOST et MAIL_FROM sont vides.
const nodemailer = require('nodemailer');

const HOST = process.env.SMTP_HOST || '';
const PORT = Number(process.env.SMTP_PORT || 587);
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
const FROM = process.env.MAIL_FROM || '';
const FROM_NAME = process.env.MAIL_FROM_NAME || 'ERP ARECE';
// TLS exigé par défaut ; « false » uniquement pour un serveur SMTP de test local
const REQUIRE_TLS = process.env.SMTP_REQUIRE_TLS !== 'false';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost').replace(/\/+$/, '');
// Nom annoncé au serveur SMTP (EHLO) : le relais Google refuse « localhost »
const HELO_NAME = process.env.SMTP_HELO_NAME || new URL(PUBLIC_URL).hostname;

const isEnabled = () => Boolean(HOST && FROM);

let transport = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465, // 465 : TLS direct ; 587 : STARTTLS obligatoire
      requireTLS: REQUIRE_TLS && PORT !== 465,
      ignoreTLS: !REQUIRE_TLS,
      name: HELO_NAME,
      auth: USER ? { user: USER, pass: PASS } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
  }
  return transport;
}

async function sendMail({ to, subject, text, html }) {
  if (!isEnabled()) throw new Error("L'envoi d'e-mails n'est pas configuré (SMTP_HOST / MAIL_FROM)");
  return getTransport().sendMail({ from: { name: FROM_NAME, address: FROM }, to, subject, text, html });
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Bloc de contenu : un texte (paragraphe), { heading } (intertitre) ou { item, note, alert } (ligne de liste)
const blockText = (b) =>
  typeof b === 'string' ? b : b.heading ? `\n${b.heading.toUpperCase()}` : `• ${b.item}${b.note ? ` (${b.note})` : ''}`;
function blockHtml(b) {
  if (typeof b === 'string') return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${escapeHtml(b)}</p>`;
  if (b.heading) {
    return `<h2 style="margin:22px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#000f2e;border-bottom:1px solid #d9dce3;padding-bottom:4px">${escapeHtml(b.heading)}</h2>`;
  }
  const note = b.note
    ? ` <span style="color:${b.alert ? '#e6172f' : '#5b6478'};font-size:13px">· ${escapeHtml(b.note)}</span>`
    : '';
  return `<p style="margin:0 0 6px;font-size:14px;line-height:1.45;padding-left:14px;text-indent:-10px">• ${escapeHtml(b.item)}${note}</p>`;
}

// Gabarit commun aux mails de l'ERP, aux couleurs d'arece.eu (bleu nuit, rouge)
function layout({ title, paragraphs, button, footer }) {
  const text = [title, '', ...paragraphs.map(blockText), '', button ? `${button.label} : ${button.url}` : '', '', footer || '']
    .join('\n')
    .trim();
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f3f4f7;font-family:Arial,Helvetica,sans-serif;color:#000f2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-top:4px solid #e6172f">
<tr><td style="background:#000f2e;padding:18px 24px;color:#ffffff;font-weight:bold;letter-spacing:4px;font-size:18px">ARECE</td></tr>
<tr><td style="padding:28px 24px 8px">
<h1 style="margin:0 0 16px;font-size:20px;text-transform:uppercase;letter-spacing:1px">${escapeHtml(title)}</h1>
${paragraphs.map(blockHtml).join('\n')}
${
  button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#000f2e;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;text-transform:uppercase;letter-spacing:1px;font-size:14px">${escapeHtml(button.label)}</a></p>
<p style="margin:0 0 14px;font-size:12px;color:#5b6478;line-height:1.5">Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :<br><span style="word-break:break-all">${escapeHtml(button.url)}</span></p>`
    : ''
}
</td></tr>
<tr><td style="padding:12px 24px 24px;font-size:12px;color:#5b6478;line-height:1.5;border-top:1px solid #d9dce3">${escapeHtml(footer || '')}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

module.exports = { isEnabled, sendMail, layout, PUBLIC_URL, FROM };
