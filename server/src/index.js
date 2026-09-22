require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const structureRoutes = require("./routes/structure");
const userRoutes = require("./routes/users");
const kaizenRoutes = require("./routes/kaizens");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/structure", structureRoutes);
app.use("/api/users", userRoutes);
app.use("/api/kaizens", kaizenRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Kaizen API listening on http://localhost:${PORT}`);
});
