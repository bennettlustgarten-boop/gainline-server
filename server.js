require("dotenv").config();
const express = require("express");
const cors = require("cors");

const coachRoutes = require("./routes/coach");
const paymentRoutes = require("./routes/payments");
const webhookRoutes = require("./routes/webhooks");

const app = express();

app.use(cors());

// The Stripe webhook route needs the RAW body to verify signatures, so it's
// mounted before express.json() and given its own raw parser.
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }));
app.use("/api/webhooks", webhookRoutes);

// Everything else can use normal JSON parsing.
app.use(express.json());
app.use("/api/coach", coachRoutes);
app.use("/api/payments", paymentRoutes);

app.get("/", (req, res) => {
  res.send("MII FITT server is running.");
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`MII FITT server listening on http://localhost:${PORT}`);
});
