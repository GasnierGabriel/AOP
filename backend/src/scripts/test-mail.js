// Vérifie la configuration SMTP en envoyant un mail de test.
// Usage sur le serveur : docker compose -f docker-compose.prod.yml exec backend node src/scripts/test-mail.js toi@exemple.fr
require('dotenv').config();
const mailer = require('../mailer');

const to = process.argv[2];
if (!to) {
  console.error('Usage : node src/scripts/test-mail.js <destinataire>');
  process.exit(1);
}
if (!mailer.isEnabled()) {
  console.error('❌ SMTP non configuré : renseigne SMTP_HOST et MAIL_FROM dans .env');
  process.exit(1);
}

const { text, html } = mailer.layout({
  title: 'Mail de test',
  paragraphs: ["Si tu lis ce message, l'ERP ARECE sait envoyer des mails depuis " + mailer.FROM + '.'],
  footer: 'Envoyé par src/scripts/test-mail.js',
});
mailer
  .sendMail({ to, subject: 'ERP ARECE · Mail de test', text, html })
  .then((info) => console.log(`✅ Mail envoyé à ${to} (${info.response})`))
  .catch((err) => {
    console.error(`❌ Échec de l'envoi : ${err.message}`);
    process.exitCode = 1;
  });
