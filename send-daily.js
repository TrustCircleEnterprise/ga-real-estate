/**
 * send-daily.js
 * Sends the day's study plan by email, and a short SMS nudge via the
 * carrier email-to-SMS gateway. Run daily by GitHub Actions.
 *
 * Reads which "day" of the 14-day plan to send based on a START_DATE
 * you set in repo Settings → Secrets and variables → Actions → Variables.
 *
 * Required SECRETS (Settings → Secrets → Actions):
 *   GMAIL_USER      your gmail address (the sender)
 *   GMAIL_APP_PASS  a Google App Password (NOT your normal password)
 *   TO_EMAIL        where the daily plan email goes (can be the same gmail)
 *   SMS_GATEWAY     your phone's email-to-SMS address, e.g. 5551234567@vtext.com
 *
 * Required VARIABLE (Settings → Variables → Actions):
 *   START_DATE      the date you begin Day 1, format YYYY-MM-DD (e.g. 2026-06-01)
 *
 * APP_URL is optional — set it as a Variable to link the email to your live app.
 */

const nodemailer = require('nodemailer');
const fs = require('fs');

const {
  GMAIL_USER, GMAIL_APP_PASS, TO_EMAIL, SMS_GATEWAY,
  START_DATE, APP_URL
} = process.env;

function fail(msg) { console.error('ERROR: ' + msg); process.exit(1); }

if (!GMAIL_USER || !GMAIL_APP_PASS) fail('Missing GMAIL_USER or GMAIL_APP_PASS secret.');
if (!TO_EMAIL) fail('Missing TO_EMAIL secret.');
if (!START_DATE) fail('Missing START_DATE variable (YYYY-MM-DD).');

// ---- figure out which day we are on ----
const start = new Date(START_DATE + 'T00:00:00');
const now = new Date();
// normalize both to midnight UTC-ish day counts
const msPerDay = 24 * 60 * 60 * 1000;
const dayNum = Math.floor((now - start) / msPerDay) + 1; // Day 1 on START_DATE

if (dayNum < 1) {
  console.log(`Plan hasn't started yet (START_DATE=${START_DATE}). Day would be ${dayNum}. Exiting.`);
  process.exit(0);
}
if (dayNum > 14) {
  console.log(`Plan complete (day ${dayNum} > 14). Sending a final nudge instead.`);
}

const content = JSON.parse(fs.readFileSync('daily-content.json', 'utf8'));

let day, encouragement;
if (dayNum >= 1 && dayNum <= 14) {
  day = content.days.find(d => d.day === dayNum);
  encouragement = content.encouragement[dayNum - 1];
} else {
  // after day 14 — gentle reminder, no crash
  day = { day: dayNum, title: 'Exam Window', focus: 'You finished the plan', tasks: ['Review flashcards lightly', 'Trust your preparation', 'Go pass that exam'] };
  encouragement = "You've completed the 14-day plan. Whenever your exam is — walk in confident. You earned it.";
}

const appLine = APP_URL ? `\n\nOpen your interactive app to check off tasks:\n${APP_URL}\n` : '';

// ---- build the email ----
const subject = `Day ${day.day}: ${day.title} — your GA real estate plan`;

const textBody =
`${encouragement}

────────────────────────────
DAY ${day.day} · ${day.title}
Focus: ${day.focus}
────────────────────────────

TODAY'S TASKS:
${day.tasks.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}
${appLine}
Exam reminders: 152 questions · 4 hours · 75% to pass each portion.

You've got this.`;

const htmlBody = `
<div style="font-family:Georgia,serif;background:#1a0f0a;color:#f5e6d3;padding:28px;max-width:600px;margin:0 auto;border:1px solid #4a2818">
  <div style="font-size:11px;letter-spacing:.25em;text-transform:uppercase;color:#d4a574;font-family:Arial,sans-serif">Fourteen Days to License</div>
  <p style="font-size:17px;line-height:1.5;color:#d4a574;font-style:italic;margin:14px 0 22px">${encouragement}</p>
  <div style="border-top:2px solid #8b3a1f;padding-top:18px">
    <div style="font-size:11px;letter-spacing:.2em;color:#a8825c;font-family:Arial,sans-serif">DAY ${day.day}</div>
    <h2 style="margin:4px 0 4px;font-weight:400;font-size:26px;color:#f5e6d3">${day.title}</h2>
    <div style="color:#a8825c;font-style:italic;font-size:14px;margin-bottom:18px">${day.focus}</div>
    <div style="font-size:11px;letter-spacing:.2em;color:#d4a574;font-family:Arial,sans-serif;margin-bottom:10px">TODAY'S TASKS</div>
    <ul style="padding-left:0;list-style:none;margin:0">
      ${day.tasks.map(t => `<li style="padding:9px 0 9px 26px;position:relative;border-bottom:1px solid #2d1810;font-size:15px;line-height:1.5">
        <span style="position:absolute;left:0;top:9px;width:16px;height:16px;border:2px solid #6b4a30;border-radius:4px;display:inline-block"></span>${t}</li>`).join('')}
    </ul>
  </div>
  ${APP_URL ? `<a href="${APP_URL}" style="display:inline-block;margin-top:22px;background:#8b3a1f;color:#f5e6d3;text-decoration:none;padding:13px 26px;font-family:Arial,sans-serif;font-size:13px;letter-spacing:.08em;border:1px solid #d4a574">OPEN MY STUDY APP →</a>` : ''}
  <p style="color:#6b4a30;font-size:12px;margin-top:26px;font-family:Arial,sans-serif;letter-spacing:.08em">152 QUESTIONS · 4 HOURS · 75% TO PASS EACH PORTION · YOU GOT THIS</p>
</div>`;

// short SMS — keep under ~300 chars for gateways
const smsBody = `Day ${day.day} (${day.title}) is in your inbox. ${encouragement.split('.').slice(1).join('.').trim() || encouragement}${APP_URL ? ' ' + APP_URL : ''}`.slice(0, 300);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASS }
});

(async () => {
  try {
    // 1) the full plan email
    await transporter.sendMail({
      from: `"GA Real Estate Plan" <${GMAIL_USER}>`,
      to: TO_EMAIL,
      subject,
      text: textBody,
      html: htmlBody
    });
    console.log(`✓ Email sent for Day ${day.day} to ${TO_EMAIL}`);

    // 2) the SMS nudge via carrier gateway (only if configured)
    if (SMS_GATEWAY) {
      await transporter.sendMail({
        from: `"GA RE" <${GMAIL_USER}>`,
        to: SMS_GATEWAY,
        subject: '',           // many gateways drop the subject for SMS
        text: smsBody
      });
      console.log(`✓ SMS nudge sent to ${SMS_GATEWAY}`);
    } else {
      console.log('• SMS_GATEWAY not set — skipped SMS (that\'s fine).');
    }
  } catch (e) {
    fail('Send failed: ' + e.message);
  }
})();
