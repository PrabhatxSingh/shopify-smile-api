export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://yuriwoori.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: "Order ID is required" });
  }

  const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  const SHOPIFY_STORE = process.env.SHOPIFY_STORE;

  try {
    // Step 1: Fetch order data
    const orderRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/orders/${orderId}.json`, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      }
    });

    const orderData = await orderRes.json();
    const order = orderData?.order;

    if (!order) return res.status(404).json({ error: "Order not found" });

    // Step 2: Validate conditions
    const createdAt = new Date(order.created_at);
    const now = new Date();
    const hoursSinceOrder = Math.abs(now.getTime() - createdAt.getTime()) / 36e5;

    const isPaid = order.financial_status === "paid";
    const isDispatched = order.tags.includes("dispatched"); // or use metafields if needed

    if (!isPaid) {
      return res.status(400).json({ error: "Only paid orders can be canceled" });
    }

    if (hoursSinceOrder > 24) {
      return res.status(400).json({ error: "Cancellation window has expired (24h)" });
    }

    if (isDispatched) {
      return res.status(400).json({ error: "Order already dispatched" });
    }

    // Step 3: Cancel the order
    const cancelRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/orders/${orderId}/cancel.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      }
    });

    const cancelData = await cancelRes.json();

    if (!cancelRes.ok) {
      return res.status(500).json({ error: "Failed to cancel order", details: cancelData });
    }

    return res.status(200).json({ success: true, order: cancelData.order });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
