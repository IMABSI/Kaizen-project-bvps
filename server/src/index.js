require("dotenv").config();
const { createApp } = require("./app");

const app = createApp();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Kaizen API listening on http://localhost:${PORT}`);
});
