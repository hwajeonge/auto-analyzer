import express from "express";
import cors from "cors";
import { analyzePage } from "./analyze.js";

const app = express();

app.use(cors());
app.use(express.json());

app.post("/analyze", async (req, res) => {
  try {
    const { url } = req.body;
    const result = await analyzePage(url);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(4000, () => {
  console.log("✅ Playwright backend running on http://localhost:4000");
});
