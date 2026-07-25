const express = require("express");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const db = require("./database/database");

const app = express();
const PORT = process.env.PORT || 3000;

let geminiClient = null;

async function getGeminiClient() {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing from the .env file.");
    }

    if (!geminiClient) {
        const { GoogleGenAI } = await import("@google/genai");

        geminiClient = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY
        });
    }

    return geminiClient;
}
// ----------------------------------------
// EJS configuration
// ----------------------------------------

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ----------------------------------------
// Middleware
// ----------------------------------------

// Serve CSS, JavaScript, and image files.
app.use(express.static(path.join(__dirname, "public")));

// Read form information.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configure login sessions.
app.use(
    session({
        secret:
            process.env.SESSION_SECRET ||
            "temporary-dollarplan-development-secret",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: 1000 * 60 * 60,
            secure: false
        }
    })
);

// Make the signed-in user available on every EJS page.
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    next();
});

// ----------------------------------------
// Authentication middleware
// ----------------------------------------

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect("/signin");
    }

    next();
}

// ----------------------------------------
// Home page
// ----------------------------------------

app.get("/", (req, res) => {
    res.render("index");
});

// ----------------------------------------
// Registration
// ----------------------------------------

app.get("/signup", (req, res) => {
    if (req.session.user) {
        return res.redirect("/dashboard");
    }

    res.render("signup", {
        error: null,
        formData: {
            username: "",
            email: ""
        }
    });
});

app.post("/signup", async (req, res) => {
    try {
        let {
            username,
            email,
            password,
            confirmPassword
        } = req.body;

        username = username ? username.trim() : "";
        email = email ? email.trim().toLowerCase() : "";
        password = password || "";
        confirmPassword = confirmPassword || "";

        const formData = {
            username,
            email
        };

        // Make sure every field was completed.
        if (!username || !email || !password || !confirmPassword) {
            return res.status(400).render("signup", {
                error: "Please complete every field.",
                formData
            });
        }

        // Validate username length.
        if (username.length < 3 || username.length > 30) {
            return res.status(400).render("signup", {
                error: "Username must be between 3 and 30 characters.",
                formData
            });
        }

        // Only allow letters, numbers, and underscores.
        const usernamePattern = /^[a-zA-Z0-9_]+$/;

        if (!usernamePattern.test(username)) {
            return res.status(400).render("signup", {
                error:
                    "Username may only contain letters, numbers, and underscores.",
                formData
            });
        }

        // Validate email.
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailPattern.test(email)) {
            return res.status(400).render("signup", {
                error: "Please enter a valid email address.",
                formData
            });
        }

        // Validate password length.
        if (password.length < 8) {
            return res.status(400).render("signup", {
                error: "Password must be at least 8 characters long.",
                formData
            });
        }

        // Make sure both passwords match.
        if (password !== confirmPassword) {
            return res.status(400).render("signup", {
                error: "The passwords do not match.",
                formData
            });
        }

        // Check whether the username already exists.
        const findUsername = db.prepare(`
            SELECT id
            FROM users
            WHERE LOWER(username) = LOWER(?)
        `);

        const existingUsername = findUsername.get(username);

        if (existingUsername) {
            return res.status(409).render("signup", {
                error: "That username is already being used.",
                formData
            });
        }

        // Check whether the email already exists.
        const findEmail = db.prepare(`
            SELECT id
            FROM users
            WHERE LOWER(email) = LOWER(?)
        `);

        const existingEmail = findEmail.get(email);

        if (existingEmail) {
            return res.status(409).render("signup", {
                error: "An account with that email already exists.",
                formData
            });
        }

        // Hash the password before saving it.
        const passwordHash = await bcrypt.hash(password, 12);

        // Save the new user.
        const insertUser = db.prepare(`
            INSERT INTO users (
                username,
                email,
                password_hash
            )
            VALUES (?, ?, ?)
        `);

        const result = insertUser.run(
            username,
            email,
            passwordHash
        );

        // Automatically sign in the new user.
        req.session.user = {
            id: Number(result.lastInsertRowid),
            username,
            email
        };

        res.redirect("/dashboard");
    } catch (error) {
        console.error("Registration error:", error);

        res.status(500).render("signup", {
            error: "Something went wrong while creating your account.",
            formData: {
                username: req.body.username || "",
                email: req.body.email || ""
            }
        });
    }
});

// ----------------------------------------
// Sign in
// ----------------------------------------

app.get("/signin", (req, res) => {
    if (req.session.user) {
        return res.redirect("/dashboard");
    }

    res.render("signin", {
        error: null,
        email: ""
    });
});

app.post("/signin", async (req, res) => {
    try {
        let { email, password } = req.body;

        email = email ? email.trim().toLowerCase() : "";
        password = password || "";

        if (!email || !password) {
            return res.status(400).render("signin", {
                error: "Please enter your email and password.",
                email
            });
        }

        const findUser = db.prepare(`
            SELECT
                id,
                username,
                email,
                password_hash
            FROM users
            WHERE LOWER(email) = LOWER(?)
        `);

        const user = findUser.get(email);

        // Use one general error instead of revealing whether an email exists.
        if (!user) {
            return res.status(401).render("signin", {
                error: "Incorrect email or password.",
                email
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).render("signin", {
                error: "Incorrect email or password.",
                email
            });
        }

        req.session.user = {
            id: Number(user.id),
            username: user.username,
            email: user.email
        };

        res.redirect("/dashboard");
    } catch (error) {
        console.error("Sign-in error:", error);

        res.status(500).render("signin", {
            error: "Something went wrong while signing in.",
            email: req.body.email || ""
        });
    }
});

// ----------------------------------------
// Transactions
// ----------------------------------------

app.post("/transactions", requireAuth, (req, res) => {
    try {
        let { description, amount, type } = req.body;

        description = description ? description.trim() : "";
        amount = Number(amount);

        if (!description || !amount || !type) {
            return res.status(400).send("Please complete every field.");
        }

        if (amount <= 0 || Number.isNaN(amount)) {
            return res.status(400).send(
                "The transaction amount must be greater than zero."
            );
        }

        if (type !== "income" && type !== "expense") {
            return res.status(400).send("Invalid transaction type.");
        }

        const insertTransaction = db.prepare(`
            INSERT INTO transactions (
                user_id,
                description,
                amount,
                type
            )
            VALUES (?, ?, ?, ?)
        `);

        insertTransaction.run(
            req.session.user.id,
            description,
            amount,
            type
        );

        res.redirect("/dashboard");
    } catch (error) {
        console.error("Transaction error:", error);
        res.status(500).send("Unable to add the transaction.");
    }
});

app.post("/transactions/:id/delete", requireAuth, (req, res) => {
    try {
        const transactionId = Number(req.params.id);

        if (!Number.isInteger(transactionId)) {
            return res.status(400).send("Invalid transaction.");
        }

        const deleteTransaction = db.prepare(`
            DELETE FROM transactions
            WHERE id = ?
            AND user_id = ?
        `);

        deleteTransaction.run(
            transactionId,
            req.session.user.id
        );

        res.redirect("/dashboard");
    } catch (error) {
        console.error("Delete transaction error:", error);
        res.status(500).send("Unable to delete the transaction.");
    }
});

// ----------------------------------------
// Dashboard
// ----------------------------------------

app.get("/dashboard", requireAuth, (req, res) => {
    try {
        const userId = req.session.user.id;

        const totalsQuery = db.prepare(`
            SELECT
                COALESCE(
                    SUM(
                        CASE
                            WHEN type = 'income' THEN amount
                            ELSE 0
                        END
                    ),
                    0
                ) AS totalIncome,

                COALESCE(
                    SUM(
                        CASE
                            WHEN type = 'expense' THEN amount
                            ELSE 0
                        END
                    ),
                    0
                ) AS totalExpenses

            FROM transactions
            WHERE user_id = ?
        `);

        const totals = totalsQuery.get(userId);

        const transactionsQuery = db.prepare(`
            SELECT
                id,
                description,
                amount,
                type,
                created_at
            FROM transactions
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 10
        `);

        const transactions = transactionsQuery.all(userId);

        const totalIncome = Number(totals.totalIncome);
        const totalExpenses = Number(totals.totalExpenses);
        const currentBalance = totalIncome - totalExpenses;

        res.render("dashboard", {
            user: req.session.user,
            totalIncome,
            totalExpenses,
            currentBalance,
            transactions,
            error: null
        });
    } catch (error) {
        console.error("Dashboard error:", error);
        res.status(500).send("Unable to load the dashboard.");
    }
});

// ----------------------------------------
// Sign out
// ----------------------------------------

app.post("/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error("Logout error:", error);
            return res.status(500).send("Unable to sign out.");
        }

        res.clearCookie("connect.sid");
        res.redirect("/");
    });
});

// ----------------------------------------
// AI
// ----------------------------------------

app.post("/api/financial-advice", requireAuth, async (req, res) => {
    try {
        const question =
            typeof req.body.question === "string"
                ? req.body.question.trim()
                : "";

        if (!question) {
            return res.status(400).json({
                error: "Please enter a financial planning question."
            });
        }

        if (question.length > 1000) {
            return res.status(400).json({
                error: "Your question must be 1,000 characters or fewer."
            });
        }

        const totalsQuery = db.prepare(`
            SELECT
                COALESCE(
                    SUM(
                        CASE
                            WHEN type = 'income' THEN amount
                            ELSE 0
                        END
                    ),
                    0
                ) AS totalIncome,

                COALESCE(
                    SUM(
                        CASE
                            WHEN type = 'expense' THEN amount
                            ELSE 0
                        END
                    ),
                    0
                ) AS totalExpenses

            FROM transactions
            WHERE user_id = ?
        `);

        const totals = totalsQuery.get(req.session.user.id);

        const totalIncome = Number(totals.totalIncome);
        const totalExpenses = Number(totals.totalExpenses);
        const currentBalance = totalIncome - totalExpenses;

        const categoryQuery = db.prepare(`
            SELECT
                description,
                type,
                amount
            FROM transactions
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 20
        `);

        const recentTransactions = categoryQuery.all(
            req.session.user.id
        );

        const transactionSummary =
            recentTransactions.length > 0
                ? recentTransactions
                      .map((transaction) => {
                          return (
                              `${transaction.type}: ` +
                              `${transaction.description} - ` +
                              `$${Number(transaction.amount).toFixed(2)}`
                          );
                      })
                      .join("\n")
                : "The user has not added any transactions yet.";

        const prompt = `
You are DollarPlan AI, an educational financial planning assistant.

Give practical, cautious, beginner-friendly financial guidance.
Do not claim to be a financial advisor.
Do not guarantee investment results.
Do not recommend taking on unnecessary debt.
Do not request bank account numbers, Social Security numbers,
credit-card numbers, passwords, or other sensitive information.

Use the user's financial summary when it is relevant.

USER FINANCIAL SUMMARY:
Total income recorded: $${totalIncome.toFixed(2)}
Total expenses recorded: $${totalExpenses.toFixed(2)}
Current balance: $${currentBalance.toFixed(2)}

RECENT TRANSACTIONS:
${transactionSummary}

USER QUESTION:
${question}

Respond with:
1. A direct answer.
2. A simple suggested plan.
3. Two or three practical next steps.
4. A short reminder that this is educational information,
   not professional financial advice.

Keep the response clear and reasonably short.
        `.trim();

        const ai = await getGeminiClient();

        const interaction = await ai.interactions.create({
            model: "gemini-3.6-flash",
            input: prompt,
            system_instruction:
                "You are DollarPlan AI, a cautious educational financial planning assistant.",
            generation_config: {
                temperature: 0.4
            }
        });

        const answer = interaction.output_text;

        if (!answer) {
            throw new Error("Gemini returned an empty response.");
        }

        res.json({
            answer
        });
    } catch (error) {
        console.error("Gemini financial assistant error:", error);

        res.status(500).json({
            error:
                "DollarPlan AI could not generate a response. " +
                "Check your API key and try again."
        });
    }
});

// ----------------------------------------
// 404 page
// ----------------------------------------

app.use((req, res) => {
    res.status(404).send("Page not found.");
});

// ----------------------------------------
// Start server
// ----------------------------------------

app.listen(PORT, "0.0.0.0", () => {
    console.log(`DollarPlan is running on port ${PORT}`);
});