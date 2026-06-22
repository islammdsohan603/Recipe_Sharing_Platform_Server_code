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
