const express = require("express");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const {
    pool,
    initializeDatabase
} = require("./database/database");

const app = express();
const PORT = process.env.PORT || 3000;

let geminiClient = null;

// Render uses a reverse proxy.
if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

// ----------------------------------------
// Gemini
// ----------------------------------------

async function getGeminiClient() {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error(
            "GEMINI_API_KEY is missing from the environment variables."
        );
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
// Database helper functions
// ----------------------------------------

async function getFinancialTotals(userId) {
    const result = await pool.query(
        `
        SELECT
            COALESCE(
                SUM(
                    CASE
                        WHEN type = 'income' THEN amount
                        ELSE 0
                    END
                ),
                0
            ) AS "totalIncome",

            COALESCE(
                SUM(
                    CASE
                        WHEN type = 'expense' THEN amount
                        ELSE 0
                    END
                ),
                0
            ) AS "totalExpenses"

        FROM transactions
        WHERE user_id = $1
        `,
        [userId]
    );

    const totals = result.rows[0];

    return {
        totalIncome: Number(totals.totalIncome),
        totalExpenses: Number(totals.totalExpenses)
    };
}

async function getRecentTransactions(userId, limit = 10) {
    const result = await pool.query(
        `
        SELECT
            id,
            description,
            amount,
            type,
            created_at
        FROM transactions
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
        `,
        [userId, limit]
    );

    return result.rows;
}

// ----------------------------------------
// EJS configuration
// ----------------------------------------

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ----------------------------------------
// Middleware
// ----------------------------------------

app.use(express.static(path.join(__dirname, "public")));

app.use(express.urlencoded({
    extended: true
}));

app.use(express.json());

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

            secure: process.env.NODE_ENV === "production",

            sameSite: "lax"
        }
    })
);

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
    let username = "";
    let email = "";

    try {
        username =
            typeof req.body.username === "string"
                ? req.body.username.trim()
                : "";

        email =
            typeof req.body.email === "string"
                ? req.body.email.trim().toLowerCase()
                : "";

        const password =
            typeof req.body.password === "string"
                ? req.body.password
                : "";

        const confirmPassword =
            typeof req.body.confirmPassword === "string"
                ? req.body.confirmPassword
                : "";

        const formData = {
            username,
            email
        };

        if (!username || !email || !password || !confirmPassword) {
            return res.status(400).render("signup", {
                error: "Please complete every field.",
                formData
            });
        }

        if (username.length < 3 || username.length > 30) {
            return res.status(400).render("signup", {
                error: "Username must be between 3 and 30 characters.",
                formData
            });
        }

        const usernamePattern = /^[a-zA-Z0-9_]+$/;

        if (!usernamePattern.test(username)) {
            return res.status(400).render("signup", {
                error:
                    "Username may only contain letters, numbers, and underscores.",
                formData
            });
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailPattern.test(email)) {
            return res.status(400).render("signup", {
                error: "Please enter a valid email address.",
                formData
            });
        }

        if (password.length < 8) {
            return res.status(400).render("signup", {
                error: "Password must be at least 8 characters long.",
                formData
            });
        }

        if (password !== confirmPassword) {
            return res.status(400).render("signup", {
                error: "The passwords do not match.",
                formData
            });
        }

        const existingUsernameResult = await pool.query(
            `
            SELECT id
            FROM users
            WHERE LOWER(username) = LOWER($1)
            LIMIT 1
            `,
            [username]
        );

        if (existingUsernameResult.rows.length > 0) {
            return res.status(409).render("signup", {
                error: "That username is already being used.",
                formData
            });
        }

        const existingEmailResult = await pool.query(
            `
            SELECT id
            FROM users
            WHERE LOWER(email) = LOWER($1)
            LIMIT 1
            `,
            [email]
        );

        if (existingEmailResult.rows.length > 0) {
            return res.status(409).render("signup", {
                error: "An account with that email already exists.",
                formData
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const insertResult = await pool.query(
            `
            INSERT INTO users (
                username,
                email,
                password_hash
            )
            VALUES ($1, $2, $3)
            RETURNING id, username, email
            `,
            [
                username,
                email,
                passwordHash
            ]
        );

        const newUser = insertResult.rows[0];

        req.session.user = {
            id: Number(newUser.id),
            username: newUser.username,
            email: newUser.email
        };

        return res.redirect("/dashboard");
    } catch (error) {
        console.error("Registration error:", error);

        // PostgreSQL unique-constraint error.
        if (error.code === "23505") {
            return res.status(409).render("signup", {
                error:
                    "That username or email address is already being used.",
                formData: {
                    username,
                    email
                }
            });
        }

        return res.status(500).render("signup", {
            error: "Something went wrong while creating your account.",
            formData: {
                username,
                email
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
    let email = "";

    try {
        email =
            typeof req.body.email === "string"
                ? req.body.email.trim().toLowerCase()
                : "";

        const password =
            typeof req.body.password === "string"
                ? req.body.password
                : "";

        if (!email || !password) {
            return res.status(400).render("signin", {
                error: "Please enter your email and password.",
                email
            });
        }

        const userResult = await pool.query(
            `
            SELECT
                id,
                username,
                email,
                password_hash
            FROM users
            WHERE LOWER(email) = LOWER($1)
            LIMIT 1
            `,
            [email]
        );

        const user = userResult.rows[0];

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

        return res.redirect("/dashboard");
    } catch (error) {
        console.error("Sign-in error:", error);

        return res.status(500).render("signin", {
            error: "Something went wrong while signing in.",
            email
        });
    }
});

// ----------------------------------------
// Transactions
// ----------------------------------------

app.post("/transactions", requireAuth, async (req, res) => {
    try {
        const description =
            typeof req.body.description === "string"
                ? req.body.description.trim()
                : "";

        const amount = Number(req.body.amount);
        const type = req.body.type;

        if (!description || !req.body.amount || !type) {
            return res.status(400).send(
                "Please complete every field."
            );
        }

        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {
            return res.status(400).send(
                "The transaction amount must be greater than zero."
            );
        }

        if (type !== "income" && type !== "expense") {
            return res.status(400).send(
                "Invalid transaction type."
            );
        }

        await pool.query(
            `
            INSERT INTO transactions (
                user_id,
                description,
                amount,
                type
            )
            VALUES ($1, $2, $3, $4)
            `,
            [
                req.session.user.id,
                description,
                amount,
                type
            ]
        );

        return res.redirect("/dashboard");
    } catch (error) {
        console.error("Transaction error:", error);

        return res.status(500).send(
            "Unable to add the transaction."
        );
    }
});

app.post(
    "/transactions/:id/delete",
    requireAuth,
    async (req, res) => {
        try {
            const transactionId = Number(req.params.id);

            if (
                !Number.isInteger(transactionId) ||
                transactionId <= 0
            ) {
                return res.status(400).send(
                    "Invalid transaction."
                );
            }

            await pool.query(
                `
                DELETE FROM transactions
                WHERE id = $1
                AND user_id = $2
                `,
                [
                    transactionId,
                    req.session.user.id
                ]
            );

            return res.redirect("/dashboard");
        } catch (error) {
            console.error(
                "Delete transaction error:",
                error
            );

            return res.status(500).send(
                "Unable to delete the transaction."
            );
        }
    }
);

// ----------------------------------------
// Dashboard
// ----------------------------------------

app.get("/dashboard", requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;

        const {
            totalIncome,
            totalExpenses
        } = await getFinancialTotals(userId);

        const transactions =
            await getRecentTransactions(userId, 10);

        const currentBalance =
            totalIncome - totalExpenses;

        return res.render("dashboard", {
            user: req.session.user,
            totalIncome,
            totalExpenses,
            currentBalance,
            transactions,
            error: null
        });
    } catch (error) {
        console.error("Dashboard error:", error);

        return res.status(500).send(
            "Unable to load the dashboard."
        );
    }
});

// ----------------------------------------
// Sign out
// ----------------------------------------

app.post("/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error("Logout error:", error);

            return res.status(500).send(
                "Unable to sign out."
            );
        }

        res.clearCookie("connect.sid");

        return res.redirect("/");
    });
});

// ----------------------------------------
// AI
// ----------------------------------------

app.post(
    "/api/financial-advice",
    requireAuth,
    async (req, res) => {
        try {
            const question =
                typeof req.body.question === "string"
                    ? req.body.question.trim()
                    : "";

            if (!question) {
                return res.status(400).json({
                    error:
                        "Please enter a financial planning question."
                });
            }

            if (question.length > 1000) {
                return res.status(400).json({
                    error:
                        "Your question must be 1,000 characters or fewer."
                });
            }

            const userId = req.session.user.id;

            const {
                totalIncome,
                totalExpenses
            } = await getFinancialTotals(userId);

            const currentBalance =
                totalIncome - totalExpenses;

            const recentTransactions =
                await getRecentTransactions(userId, 20);

            const transactionSummary =
                recentTransactions.length > 0
                    ? recentTransactions
                          .map((transaction) => {
                              return (
                                  `${transaction.type}: ` +
                                  `${transaction.description} - ` +
                                  `$${Number(
                                      transaction.amount
                                  ).toFixed(2)}`
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

Use Markdown formatting with clear headings, short paragraphs,
and bullet points.

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

            const interaction =
                await ai.interactions.create({
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
                throw new Error(
                    "Gemini returned an empty response."
                );
            }

            return res.json({
                answer
            });
        } catch (error) {
            console.error(
                "Gemini financial assistant error:",
                error
            );

            return res.status(500).json({
                error:
                    "DollarPlan AI could not generate a response. " +
                    "Check your API key and try again."
            });
        }
    }
);

// ----------------------------------------
// 404 page
// ----------------------------------------

app.use((req, res) => {
    res.status(404).send("Page not found.");
});

// ----------------------------------------
// Start server
// ----------------------------------------

async function startServer() {
    try {
        await initializeDatabase();

        app.listen(PORT, "0.0.0.0", () => {
            console.log(
                `DollarPlan is running at http://localhost:${PORT}`
            );
        });
    } catch (error) {
        console.error(
            "DollarPlan could not start:",
            error
        );

        process.exit(1);
    }
}

startServer();