const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

require("dotenv").config();

// Initialize Stripe only if the API key is provided
const stripe = process.env.STRIPE_PAYMENT_SECRET_KEY
  ? require("stripe")(process.env.STRIPE_PAYMENT_SECRET_KEY)
  : null;

const app = express();

app.use(
  cors({
    origin: [process.env.CLIENT_URL || "http://localhost:3000"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const uri = process.env.MONGO_DB_URI;
const port = process.env.PORT || 5000;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.JWT_SECRET || "secret_key_recipe", (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const run = async () => {
  try {
    await client.connect();
    const database = client.db("recipe");

    const recipeCollection = database.collection("recipes");
    const userCollection = database.collection("users");
    const favoritesCollection = database.collection("favorites");
    const reportCollection = database.collection("reports");
    const paymentsCollection = database.collection("payments");

    // ============================================
    // AUTH ENDPOINTS (JWT)
    // ============================================

    app.post("/api/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET || "secret_key_recipe", {
        expiresIn: "1d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    app.post("/api/logout", async (req, res) => {
      res
        .clearCookie("token", { maxAge: 0, sameSite: "none", secure: true })
        .send({ success: true });
    });

    // ============================================
    // PUBLIC RECIPE ENDPOINTS
    // ============================================

    // Popular recipes (sorted by likes)
    app.get("/api/recipe", async (req, res) => {
      try {
        const recipes = await recipeCollection
          .find({})
          .sort({ likesCount: -1 })
          .limit(4)
          .toArray();
        res.send(recipes);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // Featured recipes
    app.get("/api/featured-recipe", async (req, res) => {
      try {
        const recipe = await recipeCollection
          .find({ isFeatured: true })
          .limit(4)
          .toArray();
        res.send(recipe);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // All recipes (with pagination & category filter)
    app.get("/api/all-recipe", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const categories = req.query.categories ? req.query.categories.split(",") : null;

        let query = {};
        if (categories && categories.length > 0) {
          query.category = { $in: categories };
        }

        const skip = (page - 1) * limit;
        const total = await recipeCollection.countDocuments(query);
        const recipes = await recipeCollection
          .find(query)
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 })
          .toArray();

        res.send({ recipes, total, page, limit });
      } catch (error) {
        res
          .status(500)
          .send({ message: "Error fetching recipes", error: error.message });
      }
    });

    // Recipe details by ID
    app.get("/api/details/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await recipeCollection.findOne(query);
        if (!result) {
          return res.status(404).send({ message: "Recipe not found" });
        }
        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: "Invalid ID or Server Error",
          error: error.message,
        });
      }
    });

    // Like a recipe
    app.patch("/api/recipe/:id/like", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await recipeCollection.updateOne(
          { _id: new ObjectId(id) },
          { $inc: { likesCount: 1 } }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // ============================================
    // USER RECIPE CRUD ENDPOINTS
    // ============================================

    app.get("/api/recipe-count/:email", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;
        const count = await recipeCollection.countDocuments({
          authorEmail: email,
        });
        res.send({ count });
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.get("/api/my-recipes/:email", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (req.user.email !== email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const recipes = await recipeCollection
          .find({ authorEmail: email })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(recipes);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.post("/api/recipe", verifyToken, async (req, res) => {
      try {
        const recipe = req.body;
        const email = recipe.authorEmail;

        const user = await userCollection.findOne({ email });
        const isPremium = user?.isPremium || false;

        if (!isPremium) {
          const count = await recipeCollection.countDocuments({
            authorEmail: email,
          });
          if (count >= 2) {
            return res.status(403).send({
              message: "Recipe limit reached. Upgrade to premium for unlimited recipes.",
              limitReached: true,
            });
          }
        }

        recipe.createdAt = new Date();
        recipe.updatedAt = new Date();
        recipe.likesCount = 0;
        recipe.isFeatured = false;
        recipe.status = "active";

        const result = await recipeCollection.insertOne(recipe);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.put("/api/recipe/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedData = req.body;
        delete updatedData._id;
        updatedData.updatedAt = new Date();

        const result = await recipeCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.delete("/api/recipe/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await recipeCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // ============================================
    // FAVORITES ENDPOINTS
    // ============================================

    app.post("/api/favorites", verifyToken, async (req, res) => {
      try {
        const { userEmail, recipeId, userId } = req.body;
        const exists = await favoritesCollection.findOne({
          userEmail,
          recipeId,
        });
        if (exists) {
          return res.status(400).send({ message: "Already in favorites" });
        }
        const result = await favoritesCollection.insertOne({
          userEmail,
          userId,
          recipeId,
          addedAt: new Date(),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.delete("/api/favorites", verifyToken, async (req, res) => {
      try {
        const { userEmail, recipeId } = req.body;
        const result = await favoritesCollection.deleteOne({
          userEmail,
          recipeId,
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.get("/api/favorites/:email", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (req.user.email !== email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const favorites = await favoritesCollection
          .find({ userEmail: email })
          .toArray();

        const recipeIds = favorites.map((f) => new ObjectId(f.recipeId));
        const recipes = await recipeCollection
          .find({ _id: { $in: recipeIds } })
          .toArray();

        res.send(recipes);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // ============================================
    // USER AND STATS ENDPOINT
    // ============================================

    // Store user data on login/register if not exists
    app.post("/api/users", async (req, res) => {
      try {
        const user = req.body;
        const query = { email: user.email };
        const existingUser = await userCollection.findOne(query);
        if (existingUser) {
          return res.send({ message: "User already exists", insertedId: null });
        }
        user.role = "user";
        user.isBlocked = false;
        user.isPremium = false;
        user.createdAt = new Date();
        user.updatedAt = new Date();
        const result = await userCollection.insertOne(user);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.get("/api/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const result = await userCollection.findOne({ email });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.get("/api/user-stats/:email", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;
        const totalRecipes = await recipeCollection.countDocuments({
          authorEmail: email,
        });
        const totalFavorites = await favoritesCollection.countDocuments({
          userEmail: email,
        });

        const userRecipes = await recipeCollection
          .find({ authorEmail: email })
          .toArray();
        const totalLikes = userRecipes.reduce(
          (sum, r) => sum + (r.likesCount || 0),
          0
        );

        const user = await userCollection.findOne({ email });
        const isPremium = user?.isPremium || false;

        res.send({
          totalRecipes,
          totalFavorites,
          totalLikes,
          isPremium,
        });
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // ============================================
    // REPORTS ENDPOINTS
    // ============================================

    app.post("/api/reports", verifyToken, async (req, res) => {
      try {
        const report = req.body;
        report.status = "pending";
        report.createdAt = new Date();
        const result = await reportCollection.insertOne(report);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // ============================================
    // STRIPE PAYMENT ENDPOINTS
    // ============================================

    app.post("/api/create-payment-intent", verifyToken, async (req, res) => {
      try {
        const { price } = req.body;
        if (!price || price <= 0) {
          return res.status(400).send({ message: "Invalid price" });
        }

        if (!stripe) {
          return res.status(500).send({ message: "Payment service not configured" });
        }

        const amount = parseInt(price * 100);

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.post("/api/payments", verifyToken, async (req, res) => {
      try {
        const payment = req.body;
        payment.paidAt = new Date();
        const paymentResult = await paymentsCollection.insertOne(payment);

        // Update user to premium
        if (payment.userEmail) {
          await userCollection.updateOne(
            { email: payment.userEmail },
            { $set: { isPremium: true, updatedAt: new Date() } }
          );
        }
        res.send(paymentResult);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.get("/api/payments/:email", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (req.user.email !== email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const payments = await paymentsCollection
          .find({ userEmail: email })
          .sort({ paidAt: -1 })
          .toArray();
        res.send(payments);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // ============================================
    // ADMIN ENDPOINTS
    // ============================================

    app.get("/api/admin/users", verifyToken, async (req, res) => {
      try {
        const users = await userCollection.find().toArray();
        res.send(users);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.patch("/api/admin/users/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.delete("/api/admin/users/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await userCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.get("/api/admin/recipes", verifyToken, async (req, res) => {
      try {
        const recipes = await recipeCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.send(recipes);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.delete("/api/admin/recipes/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await recipeCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.get("/api/admin/stats", verifyToken, async (req, res) => {
      try {
        const totalUsers = await userCollection.countDocuments();
        const totalRecipes = await recipeCollection.countDocuments();
        const premiumMembers = await userCollection.countDocuments({
          isPremium: true,
        });
        const totalReports = await reportCollection.countDocuments();

        res.send({
          totalUsers,
          totalRecipes,
          premiumMembers,
          totalReports,
        });
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.get("/api/admin/reports", verifyToken, async (req, res) => {
      try {
        const reports = await reportCollection.find().toArray();
        res.send(reports);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.patch("/api/admin/reports/:id/dismiss", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await reportCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "dismissed" } }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.delete("/api/admin/reports/:id/remove-recipe", verifyToken, async (req, res) => {
      try {
        const reportId = req.params.id;
        const report = await reportCollection.findOne({ _id: new ObjectId(reportId) });
        if (!report) return res.status(404).send({ message: "Report not found" });

        const recipeResult = await recipeCollection.deleteOne({ _id: new ObjectId(report.recipeId) });
        const reportResult = await reportCollection.updateOne(
          { _id: new ObjectId(reportId) },
          { $set: { status: "resolved" } }
        );

        res.send({ recipeResult, reportResult, message: "Recipe removed successfully" });
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    console.log(error);
  }
};

run();

app.get("/", (req, res) => {
  res.send("Hello World! Recipe Management System is running.");
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
