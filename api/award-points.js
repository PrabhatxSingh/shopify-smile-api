export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://yuriwoori.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

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
    // Get customer
    const customerRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/search.json?query=email:${email}`, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      }
    });
    const customers = await customerRes.json();
    const customer = customers.customers?.[0];
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    // Get existing metafields
    const metafieldsRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customer.id}/metafields.json`, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN
      }
    });
    const metafields = await metafieldsRes.json();

    let totalField = metafields.metafields.find(mf => mf.namespace === "custom" && mf.key === "total");
    let breakdownField = metafields.metafields.find(mf => mf.namespace === "custom" && mf.key === "breakdown");

    // Initialize missing metafields
    if (!totalField) {
      const createTotal = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customer.id}/metafields.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          metafield: {
            namespace: "custom",
            key: "total",
            type: "number_integer",
            value: "0"
          }
        })
      });
      totalField = await createTotal.json().then(res => res.metafield);
    }

    if (!breakdownField) {
      const createBreakdown = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customer.id}/metafields.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          metafield: {
            namespace: "custom",
            key: "breakdown",
            type: "json",
            value: "[]"
          }
        })
      });
      breakdownField = await createBreakdown.json().then(res => res.metafield);
    }

    const currentTotal = parseInt(totalField?.value || "0");
    const breakdown = breakdownField?.value ? JSON.parse(breakdownField.value) : [];

    // Prevent duplicate
    if (breakdown.some(entry => entry.action === action)) {
      return res.status(409).json({ error: "Already rewarded for this action" });
    }

    // Add new action
    breakdown.push({
      date: new Date().toISOString(),
      action,
      label: ACTIONS[action].label,
      points: ACTIONS[action].points
    });

    const newTotal = currentTotal + ACTIONS[action].points;

    // Update total
    const updateTotal = fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customer.id}/metafields/${totalField.id}.json`, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        metafield: {
          id: totalField.id,
          namespace: "custom",
          key: "total",
          type: "number_integer",
          value: newTotal.toString()
        }
      })
    });

    // Update breakdown
    const updateBreakdown = fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customer.id}/metafields/${breakdownField.id}.json`, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        metafield: {
          id: breakdownField.id,
          namespace: "custom",
          key: "breakdown",
          type: "json",
          value: JSON.stringify(breakdown)
        }
      })
    });

    await Promise.all([updateTotal, updateBreakdown]);

    return res.status(200).json({ message: "Points awarded successfully", total: newTotal });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
