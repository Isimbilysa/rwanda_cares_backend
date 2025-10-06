// src/services/emailService.js
export const sendEmail = async ({ to, subject, template, context }) => {
  // For now, just log the email
  console.log(`
    Sending email to: ${to}
    Subject: ${subject}
    Template: ${template}
    Context: ${JSON.stringify(context)}
  `);

  // Later, you can integrate with a real email service like SendGrid, Mailgun, or nodemailer
};
