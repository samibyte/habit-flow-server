import express from "express";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import admin from "firebase-admin";
import fs from "fs";

const app = express();
const port = process.env.PORT || 3000;

const serviceAccount = JSON.parse(
  fs.readFileSync("./firebaseAdminKey.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//middlewares
app.use(cors());
app.use(express.json());

const verifyAccessToken = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = authorization.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.token_email = decoded.email;
    next();
  } catch (err) {
    res.status(401).send({ message: "unauthorized access" });
  }
};

app.get("/", async (req, res) => {
  res.send("server running fine ;)");
});

const uri = process.env.DB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("habit-flow-db");
    const habitsColl = db.collection("habits");

    // habits colleciton api endpoints
    // Read Public habits
    app.get("/api/v1/habits", async (req, res) => {
      const projectFields = {
        completionHistory: 0,
        "creator.email": 0,
        "creator.uid": 0,
        reminderTime: 0,
        imageUrl: 0,
      };
      const cursor = habitsColl.find().project(projectFields);
      const result = await cursor.toArray();
      res.json(result);
    });

    // Read Latest Public habits
    app.get("/api/v1/latest-habits", async (req, res) => {
      const projectFields = {
        completionHistory: 0,
        "creator.email": 0,
        "creator.uid": 0,
        reminderTime: 0,
        imageUrl: 0,
      };
      const cursor = habitsColl.find().project(projectFields);
      const result = await cursor.toArray();
      res.json(result);
    });

    //Read specific habit
    app.get("/api/v1/habits/:id", verifyAccessToken, async (req, res) => {
      const { id } = req.params;
      const filter = { _id: new ObjectId(id) };
      const result = await habitsColl.findOne(filter);
      res.json(result);
    });

    //Create habit
    app.post("/api/v1/habits", async (req, res) => {
      const newHabit = req.body;
      newHabit.createdAt = new Date();
      const result = await habitsColl.insertOne(newHabit);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => console.log(`server running on ${port}`));
