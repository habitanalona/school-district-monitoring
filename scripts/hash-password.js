"use strict";

const bcrypt = require("bcrypt");

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run db:hash -- \"YourPassword123\"");
  process.exit(1);
}
if (password.length < 10) {
  console.error("Use a password with at least 10 characters.");
  process.exit(1);
}

bcrypt
  .hash(password, 12)
  .then((hash) => {
    console.log(hash);
  })
  .catch((error) => {
    console.error("Hashing failed:", error.message);
    process.exit(1);
  });
