const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const express = require("express");
const cors = require("cors");

const app = express();

require("dotenv").config();
app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_DB_URI;
const port = process.env.PORT;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const run = async () => {
  try {
    await client.connect();
    const database = client.db("recipe");

    const recipeCollection = database.collection("recipes");
    const userCollection = database.collection("user");
    const favoritesCollection = database.collection("favorites");

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

    // All recipes
    app.get("/api/all-recipe", async (req, res) => {
      try {
        const data = recipeCollection.find();
        const result = await data.toArray();
        res.send(result);
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

    // ============================================
    // USER RECIPE CRUD ENDPOINTS
    // ============================================

    // Get recipe count for a user (for 2-recipe limit check)
    app.get("/api/recipe-count/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const count = await recipeCollection.countDocuments({
          userEmail: email,
        });
        res.send({ count });
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // Get recipes by user email
    app.get("/api/my-recipes/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const recipes = await recipeCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(recipes);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // Add a new recipe
    app.post("/api/recipe", async (req, res) => {
      try {
        const recipe = req.body;
        const email = recipe.userEmail;

        // Check recipe count for non-premium users
        const user = await userCollection.findOne({ email });
        const isPremium = user?.isPremium || false;

        if (!isPremium) {
          const count = await recipeCollection.countDocuments({
            userEmail: email,
          });
          if (count >= 2) {
            return res.status(403).send({
              message:
                "Recipe limit reached. Upgrade to premium for unlimited recipes.",
              limitReached: true,
            });
          }
        }

        recipe.createdAt = new Date();
        recipe.likesCount = 0;
        recipe.isFeatured = false;

        const result = await recipeCollection.insertOne(recipe);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // Update a recipe
    app.put("/api/recipe/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updatedData = req.body;
        delete updatedData._id;
        updatedData.updatedAt = new Date();

        const result = await recipeCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData },
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // Delete a recipe
    app.delete("/api/recipe/:id", async (req, res) => {
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

    // Add to favorites
    app.post("/api/favorites", async (req, res) => {
      try {
        const { userEmail, recipeId } = req.body;

        // Check if already favorited
        const exists = await favoritesCollection.findOne({
          userEmail,
          recipeId,
        });
        if (exists) {
          return res.status(400).send({ message: "Already in favorites" });
        }

        const result = await favoritesCollection.insertOne({
          userEmail,
          recipeId,
          createdAt: new Date(),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // Remove from favorites
    app.delete("/api/favorites", async (req, res) => {
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

    // Get user favorites with recipe details
    app.get("/api/favorites/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const favorites = await favoritesCollection
          .find({ userEmail: email })
          .toArray();

        // Get full recipe details for each favorite
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
    // USER STATS ENDPOINT
    // ============================================

    app.get("/api/user-stats/:email", async (req, res) => {
      try {
        const email = req.params.email;

        const totalRecipes = await recipeCollection.countDocuments({
          userEmail: email,
        });
        const totalFavorites = await favoritesCollection.countDocuments({
          userEmail: email,
        });

        // Calculate total likes received on user's recipes
        const userRecipes = await recipeCollection
          .find({ userEmail: email })
          .toArray();
        const totalLikes = userRecipes.reduce(
          (sum, r) => sum + (r.likesCount || 0),
          0,
        );

        // Check premium status
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
    // ADMIN ENDPOINTS
    // ============================================

    // Get all users
    app.get("/api/admin/users", async (req, res) => {
      try {
        const users = await userCollection.find().toArray();
        res.send(users);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // Update user (role, premium status)
    app.patch("/api/admin/users/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData },
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // Delete user
    app.delete("/api/admin/users/:id", async (req, res) => {
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

    // Get all recipes (admin)
    app.get("/api/admin/recipes", async (req, res) => {
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

    // Delete recipe (admin)
    app.delete("/api/admin/recipes/:id", async (req, res) => {
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

    // Admin overview stats
    app.get("/api/admin/stats", async (req, res) => {
      try {
        const totalUsers = await userCollection.countDocuments();
        const totalRecipes = await recipeCollection.countDocuments();
        const premiumMembers = await userCollection.countDocuments({
          isPremium: true,
        });
        const totalFavorites = await favoritesCollection.countDocuments();

        res.send({
          totalUsers,
          totalRecipes,
          premiumMembers,
          totalFavorites,
        });
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // Admin reports
    app.get("/api/admin/reports", async (req, res) => {
      try {
        // Recipes by category
        const recipesByCategory = await recipeCollection
          .aggregate([
            { $group: { _id: "$category", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ])
          .toArray();

        // Top liked recipes
        const topRecipes = await recipeCollection
          .find()
          .sort({ likesCount: -1 })
          .limit(5)
          .toArray();

        // Total stats
        const totalUsers = await userCollection.countDocuments();
        const totalRecipes = await recipeCollection.countDocuments();

        res.send({
          recipesByCategory,
          topRecipes,
          totalUsers,
          totalRecipes,
        });
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } catch (error) {
    console.log(error);
  }
};

run();

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
