import { getEnv, getBooleanEnv } from "./env.js";

const EMAIL_TEMPLATES = {
  order_confirmation: {
    subject: "Pedido confirmado - genMyTee #{order_id_short}",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h1 style="color:#1e293b;font-size:24px;">Gracias por tu pedido</h1>
        <p style="color:#475569;font-size:16px;line-height:1.6;">
          Hemos recibido tu pedido <strong>#{order_id_short}</strong> y estamos preparando tu prenda personalizada.
        </p>
        <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0;color:#334155;"><strong>Estado:</strong> En produccion</p>
          <p style="margin:8px 0 0;color:#334155;"><strong>Tiempo estimado:</strong> 10-15 dias laborables</p>
        </div>
        <p style="color:#475569;font-size:14px;">
          Te enviaremos un email cuando tu pedido sea enviado con el numero de seguimiento.
        </p>
        <p style="color:#475569;font-size:14px;">
          Si tienes alguna pregunta, respondenos a este email.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">genMyTee - Tu diseno, tu estilo</p>
      </div>
    `,
  },

  order_shipped: {
    subject: "Tu pedido ha sido enviado - genMyTee #{order_id_short}",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h1 style="color:#1e293b;font-size:24px;">Tu pedido esta en camino</h1>
        <p style="color:#475569;font-size:16px;line-height:1.6;">
          Tu pedido <strong>#{order_id_short}</strong> ha sido enviado.
        </p>
        <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0;color:#334155;"><strong>Transportista:</strong> {carrier}</p>
          <p style="margin:8px 0 0;color:#334155;"><strong>Numero de seguimiento:</strong> {tracking_number}</p>
          {tracking_link}
        </div>
        <p style="color:#475569;font-size:14px;">
          El tiempo de entrega habitual es de 5-10 dias laborables desde el envio.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">genMyTee - Tu diseno, tu estilo</p>
      </div>
    `,
  },

  gift_card: {
    subject: "Te han regalado una tarjeta regalo genMyTee de {amount}€",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h1 style="color:#1e293b;font-size:24px;">Tienes una tarjeta regalo</h1>
        <p style="color:#475569;font-size:16px;line-height:1.6;">
          Hola <strong>{recipient_name}</strong>, {sender_name} te ha regalado una tarjeta regalo de <strong>{amount}€</strong> para genMyTee.
        </p>
        <div style="background:linear-gradient(135deg,#818cf8,#7c5cff);border-radius:12px;padding:24px;margin:16px 0;text-align:center;">
          <p style="margin:0;color:#fff;font-size:14px;">Tu codigo de regalo</p>
          <p style="margin:8px 0;color:#fff;font-size:28px;font-weight:700;letter-spacing:2px;">{code}</p>
          <p style="margin:0;color:rgba(255,255,255,0.8);font-size:14px;">Valor: {amount}€</p>
        </div>
        <p style="color:#475569;font-size:16px;line-height:1.6;">
          {message}
        </p>
        <div style="text-align:center;margin:24px 0;">
          <a href="{shop_url}" style="display:inline-block;padding:12px 32px;background:#818cf8;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
            Canjear en genMyTee
          </a>
        </div>
        <p style="color:#94a3b8;font-size:12px;">
          Introduce el codigo en el carrito para aplicar tu descuento. Valido durante 1 ano.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">genMyTee - Tu diseno, tu estilo</p>
      </div>
    `,
  },

  email_verification: {
    subject: "Tu código de verificación - genMyTee",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h1 style="color:#1e293b;font-size:24px;">Verifica tu email</h1>
        <p style="color:#475569;font-size:16px;line-height:1.6;">
          Tu código de verificación es:
        </p>
        <div style="background:#f1f5f9;border-radius:12px;padding:24px;margin:16px 0;text-align:center;">
          <p style="margin:0;color:#1e293b;font-size:36px;font-weight:700;letter-spacing:8px;">{code}</p>
        </div>
        <p style="color:#475569;font-size:14px;">
          Este código expira en 30 minutos. Si no solicitaste este código, puedes ignorar este email.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">genMyTee - Tu diseño, tu estilo</p>
      </div>
    `,
  },

  admin_alert: {
    subject: "[genMyTee] {alert_type}",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h1 style="color:#dc2626;font-size:24px;">{alert_type}</h1>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0;color:#991b1b;font-size:16px;font-weight:600;">{message}</p>
          <p style="margin:8px 0 0;color:#991b1b;">Generaciones: <strong>{count}</strong> / {limit}</p>
          <p style="margin:8px 0 0;color:#991b1b;font-size:13px;">Timestamp: {timestamp}</p>
        </div>
        <p style="color:#475569;font-size:14px;">
          Puedes gestionar el estado de la IA desde el panel de admin: POST /api/admin/ai
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">genMyTee - Alerta automatica del sistema</p>
      </div>
    `,
  },

  review_request: {
    subject: "Como quedo tu prenda? - genMyTee",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h1 style="color:#1e293b;font-size:24px;">Como quedo tu prenda?</h1>
        <p style="color:#475569;font-size:16px;line-height:1.6;">
          Esperamos que estes disfrutando de tu prenda personalizada. Nos encantaria saber que te parece.
        </p>
        <p style="color:#475569;font-size:16px;line-height:1.6;">
          Tu opinion nos ayuda a mejorar y ayuda a otros clientes a decidirse.
        </p>
        <div style="text-align:center;margin:24px 0;">
          <a href="{review_url}" style="display:inline-block;padding:12px 32px;background:#818cf8;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
            Dejar una resena
          </a>
        </div>
        <p style="color:#94a3b8;font-size:12px;">
          Si no deseas recibir mas emails, simplemente ignora este mensaje.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">genMyTee - Tu diseno, tu estilo</p>
      </div>
    `,
  },
};

export function isEmailEnabled() {
  return getBooleanEnv("EMAIL_ENABLED", { defaultValue: false });
}

function getFromAddress() {
  return getEnv("EMAIL_FROM", { defaultValue: "pedidos@genmytee.com" });
}

function getReplyTo() {
  return getEnv("EMAIL_REPLY_TO", { defaultValue: "" });
}

function renderTemplate(templateKey, vars = {}) {
  const template = EMAIL_TEMPLATES[templateKey];
  if (!template) return null;

  let subject = template.subject;
  let html = template.html;

  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{${key}}`;
    const hashPlaceholder = `#{${key}}`;
    subject = subject.replaceAll(hashPlaceholder, String(value || ""));
    subject = subject.replaceAll(placeholder, String(value || ""));
    html = html.replaceAll(hashPlaceholder, String(value || ""));
    html = html.replaceAll(placeholder, String(value || ""));
  }

  return { subject, html };
}

async function sendViaResend(to, subject, html) {
  const apiKey = getEnv("RESEND_API_KEY", { defaultValue: "" });
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set, skipping email send");
    return { ok: false, error: "no_api_key" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: getFromAddress(),
      to: [to],
      reply_to: getReplyTo() || undefined,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: `resend_${response.status}`, detail: body };
  }

  const data = await response.json().catch(() => ({}));
  return { ok: true, id: data.id };
}

export async function sendEmail(to, templateKey, vars = {}, { logger = console } = {}) {
  if (!isEmailEnabled()) return { ok: false, error: "email_disabled" };
  if (!to || typeof to !== "string" || !to.includes("@")) {
    return { ok: false, error: "invalid_recipient" };
  }

  const rendered = renderTemplate(templateKey, vars);
  if (!rendered) return { ok: false, error: "unknown_template" };

  try {
    const result = await sendViaResend(to, rendered.subject, rendered.html);
    if (result.ok) {
      logger.log(`[email] sent ${templateKey} to ${to.slice(0, 3)}***`);
    } else {
      logger.warn(`[email] failed ${templateKey}: ${result.error}`);
    }
    return result;
  } catch (err) {
    logger.error(`[email] send error: ${err?.message}`);
    return { ok: false, error: "send_failed" };
  }
}

export async function sendOrderConfirmation(email, { orderId } = {}, opts) {
  const short = String(orderId || "").slice(-8);
  return sendEmail(email, "order_confirmation", { order_id_short: short }, opts);
}

export async function sendShippingNotification(email, { orderId, carrier, trackingNumber, trackingUrl } = {}, opts) {
  const short = String(orderId || "").slice(-8);
  const trackingLink = trackingUrl
    ? `<p style="margin:8px 0 0;"><a href="${trackingUrl}" style="color:#818cf8;">Seguir mi pedido</a></p>`
    : "";
  return sendEmail(email, "order_shipped", {
    order_id_short: short,
    carrier: carrier || "Correo",
    tracking_number: trackingNumber || "--",
    tracking_link: trackingLink,
  }, opts);
}

export async function sendReviewRequest(email, { reviewUrl } = {}, opts) {
  const url = reviewUrl || "https://genmytee.com";
  return sendEmail(email, "review_request", { review_url: url }, opts);
}

export { EMAIL_TEMPLATES };
