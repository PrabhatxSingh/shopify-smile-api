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
    signup: { points: 100, label: "Signup Bonus" },
    facebook: { points: 50, label: "Liked Facebook" }
  };

  if (!email || !ACTIONS[action]) {
    return res.status(400).json({ error: "Invalid parameters" });
  }

  try {
    // Step 1: Get customer by email
    const customersRes = await fetch(
      `https://${SHOPIFY_STORE}/admin/api/2023-10/customers/search.json?query=email:${email}`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );
    const customersData = await customersRes.json();
    const customer = customersData.customers?.[0];
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    // Step 2: Get existing metafields
    const metafieldsRes = await fetch(
      `https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customer.id}/metafields.json`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN
        }
      }
    );
    const metafieldsData = await metafieldsRes.json();
    const totalField = metafieldsData.metafields.find(
      (mf) => mf.namespace === "rewards" && mf.key === "total"
    );
    const breakdownField = metafieldsData.metafields.find(
      (mf) => mf.namespace === "rewards" && mf.key === "breakdown"
    );

    const currentTotal = parseInt(totalField?.value || "0");
    const breakdown = breakdownField?.value ? JSON.parse(breakdownField.value) : [];

    // Prevent duplicate
    if (breakdown.some((entry) => entry.action === action)) {
      return res.status(409).json({ error: "Already rewarded for this action" });
    }

    // Step 3: Update values
    breakdown.push({
      date: new Date().toISOString(),
      action,
      label: ACTIONS[action].label,
      points: ACTIONS[action].points
    });

    const newTotal = currentTotal + ACTIONS[action].points;

    // Step 4: Update total metafield
    const updateTotal = fetch(
      `https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customer.id}/metafields${totalField ? `/${totalField.id}` : ''}.json`,
      {
        method: totalField ? "PUT" : "POST",
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          metafield: {
            ...(totalField ? { id: totalField.id } : {}),
            namespace: "rewards",
            key: "total",
            type: "number_integer",
            value: newTotal.toString()
          }
        })
      }
    );

    // Step 5: Update breakdown metafield
    const updateBreakdown = fetch(
      `https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customer.id}/metafields${breakdownField ? `/${breakdownField.id}` : ''}.json`,
      {
        method: breakdownField ? "PUT" : "POST",
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          metafield: {
            ...(breakdownField ? { id: breakdownField.id } : {}),
            namespace: "rewards",
            key: "breakdown",
            type: "json",
            value: JSON.stringify(breakdown)
          }
        })
      }
    );

    await Promise.all([updateTotal, updateBreakdown]);
    console.log("newTotal", newTotal);
    console.log("breakdown", breakdown);
    return res.status(200).json({ message: "Points awarded successfully", total: newTotal });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
