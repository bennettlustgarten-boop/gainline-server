// Outbound email via Resend (resend.com), used by the "Contact support"
// form and account emails (verification, password reset). Chosen over
// Gmail SMTP because Google increasingly blocks App Password creation for
// newer accounts regardless of 2-Step Verification status.
//
// gainlineapp.online is verified at resend.com/domains, so this sends
// from a real address on that domain — no more sandbox restriction on
// which recipients can be emailed.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPPORT_EMAIL_USER = "GainLineSupport@gmail.com";
const FROM_ADDRESS = "Gainline <support@gainlineapp.online>";

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
