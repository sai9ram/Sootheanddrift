const Stripe = require('stripe');

const PACK_CATALOG = {
  1: { name: 'Soothe & Drift Steam Eye Mask — Starter Pause (1 Box / 15 Masks)', amount: 2400 },
  2: { name: 'Soothe & Drift Steam Eye Mask — The Gift Duo (2 Boxes / 30 Masks)', amount: 4200 },
  3: { name: 'Soothe & Drift Steam Eye Mask — Ritual Trio (3 Boxes / 45 Masks)', amount: 5800 }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return res.status(503).json({
      error: 'Stripe Checkout is almost ready — add STRIPE_SECRET_KEY in Vercel Environment Variables to enable live payments.'
    });
  }

  try {
    const stripe = new Stripe(secretKey);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const packId = [1, 2, 3].includes(Number(body.pack)) ? Number(body.pack) : 1;
    const addGift = Boolean(body.addGift);
    const addCase = Boolean(body.addCase);
    const discountClaimed = Boolean(body.discountClaimed);

    const selectedPack = PACK_CATALOG[packId];
    const applyDiscount = (cents) => (discountClaimed ? Math.round(cents * 0.85) : cents);

    const lineItems = [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: selectedPack.name,
            description: discountClaimed ? '15% Welcome Discount (DRIFT15) applied' : 'Self-Heating Air-Activated Steam Eye Mask'
          },
          unit_amount: applyDiscount(selectedPack.amount)
        },
        quantity: 1
      }
    ];

    if (addGift) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Signature Gift Box & Ribbon',
            description: 'Navy & gold presentation box'
          },
          unit_amount: applyDiscount(500)
        },
        quantity: 1
      });
    }

    if (addCase) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Flight Carry-On Pouch',
            description: 'Compact protective pouch for 5 sachets'
          },
          unit_amount: applyDiscount(600)
        },
        quantity: 1
      });
    }

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'soothe-and-drift.vercel.app';
    const origin = `${proto}://${host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      allow_promotion_codes: true,
      shipping_address_collection: {
        allowed_countries: ['US']
      },
      phone_number_collection: {
        enabled: true
      },
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/shop.html?pack=${packId}`,
      metadata: {
        pack: String(packId),
        addGift: String(addGift),
        addCase: String(addCase),
        discountClaimed: String(discountClaimed)
      }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: err.message || 'Unable to start checkout session' });
  }
};
