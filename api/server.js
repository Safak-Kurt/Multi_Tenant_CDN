const express = require("express");

const pool = require("./db/pool");
const tenantsRouter = require("./routes/tenants");
const authRoutes = require("./routes/auth");
const uploadRoutes = require("./routes/uploads");

const app = express();

const PORT = process.env.PORT || 4000;

app.use(express.json({
    limit: "1mb",
}));

app.get("/", (req, res) => {
    res.json({
        service: "multi-tenant-cdn-api",
        status: "running",
    });
});

app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            status: "ok",
            database: "connected",
        });
    } catch (err) {
        console.error("Health check failed:", err);

        res.status(503).json({
            status: "error",
            database: "disconnected",
        });
    }
});

app.use("/api/tenants", tenantsRouter);
app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);

app.use((err, req, res, next) => {
    console.error(err);

    res.status(500).json({
        error: "Internal server error",
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `API server listening on port ${PORT}`
    );
});
