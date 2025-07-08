export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://yuriwoori.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  const SHOPIFY_STORE = process.env.SHOPIFY_STORE;

  try {
    const customerRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/search.json?query=email:${email}`, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      }
    });
    console.log(email);
    const customers = await customerRes.json();
    const customer = customers.customers?.[0];
    console.log(customers);
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const metafieldsRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customer.id}/metafields.json`, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN
      }
    });

    const metafields = await metafieldsRes.json();

    const total = metafields.metafields.find(mf => mf.namespace === 'total' && mf.key === 'total');
    const breakdown = metafields.metafields.find(mf => mf.namespace === 'breakdown' && mf.key === 'breakdown');

    return res.status(200).json({
      total: total?.value || 0,
      breakdown: breakdown?.value ? JSON.parse(breakdown.value) : []
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
