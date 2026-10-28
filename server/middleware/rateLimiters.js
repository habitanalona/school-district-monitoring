"use strict";

const { rateLimit } = require("express-rate-limit");

function handler(message) {
  return (req, res) => {
    res.status(429).json({
      error: message,
      code: "RATE_LIMITED"
    });
  };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: handler("Too many sign-in attempts. Please wait 15 minutes and try again.")
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: handler("Too many password reset requests. Please try again later.")
});

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  skip: () => process.env.NODE_ENV === "test",
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: handler("Too many account requests. Please try again later.")
});

const photoUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: handler("Too many photo uploads. Please try again later.")
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: handler("Too many requests. Please slow down and try again.")
});

module.exports = {
  loginLimiter,
  passwordResetLimiter,
  registrationLimiter,
  photoUploadLimiter,
  apiLimiter
};
