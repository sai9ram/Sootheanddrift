const Stripe = require('stripe');

const CATALOG = {
  'pack-1': {
    name: 'Soothe & Drift™ Steam Eye Mask — Starter Pause (1 Box / 15 Masks)',
    description: 'Air-activated self-heating warm eye compress (up to 60 mins warmth)',
    amount: 2400
  },
  'pack-2': {
    name: 'Soothe & Drift™ Steam Eye Mask — The Gift Duo (2 Boxes / 30 Masks)',
    description: '2 Boxes (30 individually sealed masks) — Save $6',
    amount: 4200
  },
  'pack-3': {
    name: 'Soothe & Drift™ Steam Eye Mask — Ritual Trio (3 Boxes / 45 Masks)',
    description: '3 Boxes (45 individually sealed masks) — Save $14',
    amount: 5800
  },
  'gift-box': {
    name: 'Signature Gift Box & Ribbon',
    description: 'Navy & gold presentation gift box',
    amount: 500
  },
  'travel-pouch': {
    name: 'Flight Carry-On Pouch',
    description: 'Compact protective travel pouch for 5 sachets',
    amount: 600
  }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return res.status(503).json({
      error: 'Stripe Checkout is ready on the backend — add STRIPE_SECRET_KEY in Vercel Environment Variables to activate live payments.'
    });
  }

  try {
    const stripe = new Stripe(secretKey);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const discountClaimed = Boolean(body.discountClaimed);
    const applyDiscount = (cents) => (discountClaimed ? Math.round(cents * 0.85) : cents);

    let requestedItems = [];
    if (Array.isArray(body.items) && body.items.length > 0) {
      requestedItems = body.items
        .filter((i) => i && CATALOG[i.id])
        .map((i) => ({
          id: i.id,
          qty: Math.max(1, Math.min(20, parseInt(i.qty, 10) || 1))
        }));
    } else {
      const packId = [1, 2, 3].includes(Number(body.pack)) ? `pack-${Number(body.pack)}` : 'pack-1';
      requestedItems.push({ id: packId, qty: 1 });
      if (body.addGift) requestedItems.push({ id: 'gift-box', qty: 1 });
      if (body.addCase) requestedItems.push({ id: 'travel-pouch', qty: 1 });
    }

    if (requestedItems.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty.' });
    }

    const lineItems = requestedItems.map(({ id, qty }) => {
      const item = CATALOG[id];
      return {
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.name,
            description: discountClaimed ? `${item.description} (15% Off DRIFT15 Applied)` : item.description
          },
          unit_amount: applyDiscount(item.amount)
        },
        quantity: qty
      };
    });

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
      cancel_url: `${origin}/shop.html`,
      metadata: {
        items: JSON.stringify(requestedItems),
        discountClaimed: String(discountClaimed)
      }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: err.message || 'Unable to create checkout session' });
  }
};
