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
    // Step 1: Get customer by email using GraphQL
    const customerQuery = `
      {
        customers(first: 1, query: "email:${email}") {
          edges {
            node {
              id
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

    const metafields = customerNode.metafields.edges.map(edge => edge.node);

    const total = metafields.find(mf => mf.key === "total");
    let breakdown = metafields.find(mf => mf.key === "breakdown");

    // Step 2: Create breakdown metafield if missing
    if (!breakdown) {
      const createBreakdownMutation = `
        mutation {
          metafieldsSet(metafields: [
            {
              namespace: "custom",
              key: "breakdown",
              type: "json",
              value: "[]",
              ownerId: "${customerNode.id}"
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
      `;

      const createRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/graphql.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query: createBreakdownMutation })
      });

      const createData = await createRes.json();
      breakdown = createData?.data?.metafieldsSet?.metafields?.[0] || null;
    }

    
    return res.status(200).json({
      total: total?.value || "0",
      breakdown: breakdown?.value ? JSON.parse(breakdown.value) : []
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
