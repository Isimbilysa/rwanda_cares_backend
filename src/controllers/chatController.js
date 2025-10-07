require("dotenv").config();
const axios = require("axios");

async function handleChat(req, res) {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required." });

    const response = await axios.post(
      "https://api-inference.huggingface.co/models/facebook/blenderbot-400M-distill",
      {
        inputs: message,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HF_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply =
      response.data?.[0]?.generated_text ||
      "Sorry, I couldn't generate a reply.";

    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error.response?.data || error.message);
    res.status(500).json({ error: "Something went wrong." });
  }
}

module.exports = { handleChat };
