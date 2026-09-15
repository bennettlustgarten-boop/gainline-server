// Outbound email via Resend (resend.com), used by the "Contact support"
// form and account emails (verification, password reset). Chosen over
// Gmail SMTP because Google increasingly blocks App Password creation for
// newer accounts regardless of 2-Step Verification status.
//
// IMPORTANT sandbox limitation: until a domain is verified at
// resend.com/domains, Resend only allows sending FROM its shared
// onboarding@resend.dev address, and only TO the email address that owns
// this API key (GainLineSupport@gmail.com) — any other recipient is
// rejected with a 403. That's enough for the support form (which always
// sends to that inbox) but NOT enough for verification/password-reset
// emails to real signups, which go to arbitrary addresses. Once a real
// domain is verified, update FROM_ADDRESS below to an address on that
// domain and every recipient restriction goes away.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPPORT_EMAIL_USER = "GainLineSupport@gmail.com";
const FROM_ADDRESS = "Gainline <onboarding@resend.dev>";

const configured = !!RESEND_API_KEY;

async function sendMail({ to, subject, text, replyTo }) {
  if (!configured) throw new Error("not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, text, reply_to: replyTo || undefined }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
  return res.json();
}

module.exports = { sendMail, configured, SUPPORT_EMAIL_USER };
