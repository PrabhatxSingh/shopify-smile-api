export default async function handler(req, res) {
  const SMILE_PRIVATE_KEY = process.env.SMILE_PRIVATE_KEY;
  const { email, action } = req.query;

  const ACTIONS = {
    instagram: { reason: "Followed on Instagram", points: 50 },
    facebook: { reason: "Liked on Facebook", points: 50 },
  };

  if (!email || !ACTIONS[action]) {
    return res.status(400).json({ error: "Invalid email or action" });
  }

  try {
    const response = await fetch("https://api.smile.io/v1/points", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(SMILE_PRIVATE_KEY + ":").toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer_email: email,
        points: ACTIONS[action].points,
        reason: ACTIONS[action].reason,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Smile API error");

    res.status(200).json({ message: "Points awarded successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
