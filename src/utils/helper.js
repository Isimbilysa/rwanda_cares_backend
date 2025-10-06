import jwt from "jsonwebtoken";
import crypto from "crypto";

// Generate JWT token
export const generateToken = (userId, role) => {
  const payload = { id: userId, role };
  const secret = process.env.JWT_SECRET || "secretkey";
  const options = { expiresIn: "1h" };
  return jwt.sign(payload, secret, options);
};

// Generate random verification token
export const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString("hex");
};
