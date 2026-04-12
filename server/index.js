const express = require("express");
const cors = require("cors");
const launcherRoutes = require("./routes/launcher");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/launcher", launcherRoutes);

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});