const Stripe = require('stripe');

module.exports.config = {
  api: {
    bodyParser: false
  }
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return res.status(503).json({ error: 'Stripe webhook environment variables not configured' });
  }

  const stripe = new Stripe(secretKey);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name || 'Valued Sleeper';
    const amountTotal = ((session.amount_total || 0) / 100).toFixed(2);

    console.log('Order completed:', {
      sessionId: session.id,
      email: customerEmail,
      amountTotal: `$${amountTotal}`,
      shipping: session.shipping_details || null
    });

    // Optional branded order confirmation email via Resend
    if (process.env.RESEND_API_KEY && customerEmail) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.ORDER_FROM_EMAIL || 'Soothe & Drift <orders@sootheanddrift.com>',
            to: [customerEmail],
            subject: 'Your Soothe & Drift™ Order Is Confirmed',
            html: `
              <div style="font-family: Arial, sans-serif; background:#02050b; color:#f6ebd0; padding:32px; border-radius:16px;">
                <h1 style="color:#e5c07b; margin-top:0;">Thank You, ${customerName}!</h1>
                <p style="color:#d1d5db; line-height:1.6;">We received your order totaling <strong>$${amountTotal} USD</strong> (Ref: <code>${session.id}</code>).</p>
                <p style="color:#d1d5db; line-height:1.6;">Your Self-Heating Steam Eye Masks will ship within 1–2 business days with free US shipping.</p>
                <p style="color:#9ca3af; font-size:12px; margin-top:24px;">Soothe &amp; Drift™ &middot; The Art of Taking a Pause</p>
              </div>
            `
          })
        });
      } catch (emailErr) {
        console.error('Resend email failed:', emailErr);
      }
    }
  }

  return res.status(200).json({ received: true });
};
