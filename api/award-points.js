export default async function handler(req, res) {
 res.setHeader("Access-Control-Allow-Origin", "https://yuriwoori.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
  
  const { email, action } = req.body;

  const ACTIONS = {
    instagram: { points: 50, label: "Followed Instagram" },
    signup:    { points: 100, label: "Signup Bonus" },
    facebook:  { points: 50, label: "Liked Facebook" }
  };

  if (!email || !ACTIONS[action]) {
    return res.status(400).json({ error: "Invalid parameters" });
  }

  try {
    // 1. Lookup Customer by Email
    const customers = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/search.json?query=email:${email}`, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      }
    }).then(res => res.json());

    const customer = customers.customers?.[0];
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    // 2. Read Existing Metafields
    const metafields = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customer.id}/metafields.json`, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN
      }
    }).then(res => res.json());
    console.log(metafields
    const totalField = metafields.metafields.find(mf => mf.namespace === 'total' && mf.key === 'total');
    const breakdownField = metafields.metafields.find(mf => mf.namespace === 'breakdown' && mf.key === 'breakdown');

    const currentTotal = parseInt(totalField?.value || "0");
    const breakdown = breakdownField?.value ? JSON.parse(breakdownField.value) : [];

    // 3. Prevent duplicate actions (optional)
    if (breakdown.some(entry => entry.action === action)) {
      return res.status(409).json({ error: "Already rewarded for this action" });
    }

    // 4. Add new record
    breakdown.push({
      date: new Date().toISOString(),
      action,
      label: ACTIONS[action].label,
      points: ACTIONS[action].points
    });

    const newTotal = currentTotal + ACTIONS[action].points;

    // 5. Update metafields
    const updateTotal = fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customer.id}/metafields/${totalField?.id || ''}`, {
      method: totalField ? "PUT" : "POST",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        metafield: {
          namespace: "total",
          key: "total",
          value: newTotal,
          type: "number_integer",
          ...(totalField ? { id: totalField.id } : {})
        }
      })
    });

    const updateBreakdown = fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customer.id}/metafields/${breakdownField?.id || ''}`, {
      method: breakdownField ? "PUT" : "POST",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        metafield: {
          namespace: "breakdown",
          key: "breakdown",
          value: JSON.stringify(breakdown),
          type: "json",
          ...(breakdownField ? { id: breakdownField.id } : {})
        }
      })
    });

    await Promise.all([updateTotal, updateBreakdown]);

    return res.status(200).json({ message: "Points awarded successfully", total: newTotal });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
