const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoute = require("./routes/authRoute");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoute);

module.exports = app;
