export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://yuriwoori.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  const SHOPIFY_STORE = process.env.SHOPIFY_STORE;

  try {
    // Step 1: Get customer by email
    const customerQuery = `
      {
        customers(first: 1, query: "email:${email}") {
          edges {
            node {
              id
              email
              metafields(first: 10, namespace: "custom") {
                edges {
                  node {
                    id
                    key
                    value
                    type
                  }
                }
              }
            }
          }
        }
      }
    `;

    const graphRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query: customerQuery })
    });

    const graphData = await graphRes.json();
    const customerNode = graphData?.data?.customers?.edges?.[0]?.node;

    if (!customerNode) return res.status(404).json({ error: "Customer not found" });

    const customerId = customerNode.id;
    const metafields = customerNode.metafields.edges.map(edge => edge.node);
    let total = metafields.find(mf => mf.key === "total");
    let breakdown = metafields.find(mf => mf.key === "breakdown");
    let breakdownArray = breakdown?.value ? JSON.parse(breakdown.value) : [];

    // Step 2: Check if order points already exist
    const hasOrderPoints = breakdownArray.some(entry => entry.action === "order");
    if (hasOrderPoints) {
      return res.status(200).json({ message: "Order points already awarded" });
    }

    // Step 3: Fetch orders using REST Admin API
    const ordersRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/orders.json?email=${email}&status=any`, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      }
    });

    const ordersData = await ordersRes.json();
    const orders = ordersData.orders || [];
    const totalSpent = orders.reduce((sum, order) => sum + parseFloat(order.total_price || 0), 0);
    const earnedPoints = Math.floor(totalSpent / 10);

    if (earnedPoints <= 0) {
      return res.status(200).json({ message: "No eligible orders for rewards" });
    }

    // Step 4: Update metafields (breakdown + total)
    breakdownArray.push({
      action: "order",
      label: "Order Bonus",
      points: earnedPoints,
      date: new Date().toISOString()
    });

    const newTotal = (parseInt(total?.value || "0", 10) + earnedPoints).toString();

    const updateMutation = `
      mutation {
        metafieldsSet(metafields: [
          {
            namespace: "custom",
            key: "breakdown",
            type: "json",
            value: ${JSON.stringify(JSON.stringify(breakdownArray))},
            ownerId: "${customerId}"
          },
          {
            namespace: "custom",
            key: "total",
            type: "number_integer",
            value: "${newTotal}",
            ownerId: "${customerId}"
          }
        ]) {
          metafields {
            key
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const updateRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query: updateMutation })
    });

    const updateData = await updateRes.json();
    const errors = updateData?.data?.metafieldsSet?.userErrors;

    if (errors?.length) {
      return res.status(500).json({ error: "Metafield update failed", details: errors });
    }

    return res.status(200).json({
      success: true,
      earnedPoints,
      newTotal,
      breakdown: breakdownArray
    });

  } catch (err) {
    console.error("Order Reward Error:", err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
