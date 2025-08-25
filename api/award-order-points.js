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

    // Step 2: Fetch orders using REST Admin API
    const ordersRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/orders.json?email=${email}&status=any`, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      }
    });

    const ordersData = await ordersRes.json();
    const orders = ordersData.orders || [];

    // Step 3: Calculate per-order rewards
    let newBreakdown = [...breakdownArray];
    let newTotal = parseInt(total?.value || "0", 10);
    let sessionAwardedPoints = 0; // net points change in this run

    for (const order of orders) {
      const orderId = order.id.toString();

      const refunds = order.refunds?.reduce((rSum, r) => {
        return (
          rSum +
          r.transactions.reduce((tSum, t) => tSum + parseFloat(t.amount || 0), 0)
        );
      }, 0) || 0;

      const netAmount = parseFloat(order.total_price || 0) - refunds;
      const earnedPoints = Math.floor(netAmount / 10);

      const isCancelled = !!order.cancelled_at;
      const isRefunded = order.financial_status === "refunded";
      const isPaid =
        order.financial_status === "paid" ||
        order.financial_status === "partially_paid";

      const alreadyAwarded = newBreakdown.some(
        (e) => e.orderId === orderId && e.action === "order_award"
      );
      const alreadyReverted = newBreakdown.some(
        (e) => e.orderId === orderId && e.action === "order_revert"
      );

      // ✅ Award points if order is valid
      if (
        earnedPoints > 0 &&
        isPaid &&
        !isCancelled &&
        !isRefunded &&
        !alreadyAwarded
      ) {
        newTotal += earnedPoints;
        sessionAwardedPoints += earnedPoints;
        newBreakdown.push({
          action: "order_award",
          orderId,
          label: `Order Bonus (${order.name || orderId})`,
          points: earnedPoints,
          date: new Date().toISOString(),
        });
      }

      // ❌ Revert points if order got cancelled/refunded
      if ((isCancelled || isRefunded) && alreadyAwarded && !alreadyReverted) {
        const awardEntry = newBreakdown.find(
          (e) => e.orderId === orderId && e.action === "order_award"
        );
        const awardedPoints = awardEntry?.points || 0;

        if (awardedPoints > 0) {
          newTotal -= awardedPoints;
          sessionAwardedPoints -= awardedPoints;
          newBreakdown.push({
            action: "order_revert",
            orderId,
            label: `Order Reverted (${order.name || orderId})`,
            points: -awardedPoints,
            date: new Date().toISOString(),
          });
        }
      }
    }

    // Step 4: Update metafields only if something changed
    if (sessionAwardedPoints !== 0) {
      const updateMutation = `
        mutation {
          metafieldsSet(metafields: [
            {
              namespace: "custom",
              key: "breakdown",
              type: "json",
              value: ${JSON.stringify(JSON.stringify(newBreakdown))},
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

      const updateRes = await fetch(
        `https://${SHOPIFY_STORE}/admin/api/2023-10/graphql.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: updateMutation }),
        }
      );

      const updateData = await updateRes.json();
      const errors = updateData?.data?.metafieldsSet?.userErrors;

      if (errors?.length) {
        return res
          .status(500)
          .json({ error: "Metafield update failed", details: errors });
      }
    }

    // Final response
    return res.status(200).json({
      success: true,
      sessionAwardedPoints, // net change this run
      newTotal,
      breakdown: newBreakdown,
    });
  } catch (err) {
    console.error("Order Reward Error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Internal Server Error" });
  }
}
