export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://yuriwoori.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Email is required" });

  const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  const SHOPIFY_STORE = process.env.SHOPIFY_STORE;

  try {
    // Step 1: Get customer
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

    // Step 2: Fetch orders
    const ordersRes = await fetch(
      `https://${SHOPIFY_STORE}/admin/api/2023-10/orders.json?email=${email}&status=any`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    const ordersData = await ordersRes.json();
    const orders = ordersData.orders || [];

    let earnedPoints = 0;
    let updatedBreakdown = [...breakdownArray];
    let newTotal = parseInt(total?.value || "0", 10);

    for (const order of orders) {
      const orderId = order.id.toString();

      // calculate net spent
      const refunds = order.refunds?.reduce((rSum, r) => {
        return rSum + r.transactions.reduce((tSum, t) => tSum + parseFloat(t.amount || 0), 0);
      }, 0) || 0;

      const netAmount = parseFloat(order.total_price || 0) - refunds;
      const orderPoints = Math.floor(netAmount / 10);

      const hasAwarded = updatedBreakdown.some(
        b => b.orderId === orderId && b.points > 0
      );
      const hasDeducted = updatedBreakdown.some(
        b => b.orderId === orderId && b.points < 0
      );

      if (order.cancelled_at || netAmount <= 0) {
        // Cancelled order → deduct points if previously awarded
        if (hasAwarded && !hasDeducted) {
          updatedBreakdown.push({
            action: "order_cancel",
            label: "Order Cancelled",
            points: -orderPoints,
            date: new Date().toISOString(),
            orderId
          });
          newTotal -= orderPoints;
        }
      } else {
        // Active order → award points if not already given
        if (!hasAwarded && orderPoints > 0) {
          updatedBreakdown.push({
            action: "order",
            label: "Order Bonus",
            points: orderPoints,
            date: new Date().toISOString(),
            orderId
          });
          newTotal += orderPoints;
          earnedPoints += orderPoints;
        }
      }
    }

    // Step 3: Update metafields
    const updateMutation = `
      mutation {
        metafieldsSet(metafields: [
          {
            namespace: "custom",
            key: "breakdown",
            type: "json",
            value: ${JSON.stringify(JSON.stringify(updatedBreakdown))},
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
      breakdown: updatedBreakdown
    });

  } catch (err) {
    console.error("Order Reward Error:", err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
