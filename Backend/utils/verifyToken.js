import jwt from "jsonwebtoken";

export const verifyToken = (req, res, next) => {
  const token = req.header("Authorization")?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ success: false, message: "Access Denied: No token provided" });
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret_key");
    req.user = verified;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: "Invalid Token" });
  }
};
