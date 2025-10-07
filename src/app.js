// src/app.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoute = require("./routes/authRoute");
const chatRoute = require("./routes/chatRoute");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoute);
app.use("/api/chat", chatRoute); // ✅ Register chat route

module.exports = app;
