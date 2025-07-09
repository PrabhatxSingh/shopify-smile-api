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
    const customerRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/search.json?query=email:${email}`, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      }
    });
    const customers = await customerRes.json();
    const customer = customers.customers?.[0];
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const customerGid = `gid://shopify/Customer/${customer.id}`;
    console.log(customerGid);
    // Step 2: Query existing metafields via GraphQL
    const metafieldsQuery = {
      query: `
        query {
          customer(id: "${customerGid}") {
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  id
                  key
                  type
                  value
                }
              }
            }
          }
        }
      `
    };

    const metafieldsRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(metafieldsQuery)
    });

    const metafieldsData = await metafieldsRes.json();
    const metafields = metafieldsData?.data?.customer?.metafields?.edges || [];

    let totalField = metafields.find(edge => edge.node.key === "total")?.node;
    let breakdownField = metafields.find(edge => edge.node.key === "breakdown")?.node;

    let currentTotal = parseInt(totalField?.value || "0", 10);
    let breakdown = [];

    if (breakdownField?.value) {
      try {
        breakdown = JSON.parse(breakdownField.value);
      } catch (e) {
        console.error("Invalid JSON in breakdown metafield");
        breakdown = [];
      }
    }

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

    // Step 3: Construct mutation
    const metafieldsSetMutation = {
      query: `
        mutation metafieldsSet {
          metafieldsSet(metafields: [
            {
              ${totalField?.id ? `id: "${totalField.id}",` : ""}
              ownerId: "${customerGid}",
              namespace: "custom",
              key: "total",
              type: "number_integer",
              value: "${newTotal}"
            },
            {
              ${breakdownField?.id ? `id: "${breakdownField.id}",` : ""}
              ownerId: "${customerGid}",
              namespace: "custom",
              key: "breakdown",
              type: "json",
              value: ${JSON.stringify(JSON.stringify(breakdown))}
            }
          ]) {
            metafields {
              id
              key
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `
    };

    const updateRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(metafieldsSetMutation)
    });
    console.log(updateRes);
    const updateData = await updateRes.json();
    const userErrors = updateData.data?.metafieldsSet?.userErrors;

    if (userErrors && userErrors.length > 0) {
      return res.status(500).json({ error: "Metafield update failed", details: userErrors });
    }

    return res.status(200).json({ message: "Points awarded successfully", total: newTotal });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
