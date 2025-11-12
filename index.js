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

function calculateDailyStreak(completionHistory) {
  if (!completionHistory || completionHistory.length === 0) return 0;

  const dates = completionHistory.map((dateStr) => {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const sortedDates = dates.sort((a, b) => b - a);

  let streak = 0;
  let today = new Date();
  today.setHours(0, 0, 0, 0);

  let currentDate = today;

  for (const date of sortedDates) {
    if (date.getTime() === currentDate.getTime()) {
      streak++;

      currentDate.setDate(currentDate.getDate() - 1);
    } else if (date < currentDate) {
      const diff = (currentDate - date) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else if (diff > 1) {
        break;
      }
    }
  }

  return streak;
}

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
      const cursor = habitsColl.find({ isPublic: true }).project(projectFields);
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
      const cursor = habitsColl
        .find({ isPublic: true })
        .project(projectFields)
        .sort({ createdAt: -1 })
        .limit(6);
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

    // Read my habits
    app.get("/api/v1/my-habits", verifyAccessToken, async (req, res) => {
      const { uid } = req.query;
      if (uid) {
        const filter = { "creator.uid": uid };
        const cursor = habitsColl.find(filter);
        const result = await cursor.toArray();
        res.json(result);
      }
    });

    //Create habit
    app.post("/api/v1/habits", verifyAccessToken, async (req, res) => {
      const newHabit = req.body;
      newHabit.createdAt = new Date();
      const result = await habitsColl.insertOne(newHabit);
      res.send(result);
    });

    //Complete Habit
    app.post(
      "/api/v1/habits/:id/complete",
      verifyAccessToken,
      async (req, res) => {
        const { id } = req.params;

        try {
          const filter = { _id: new ObjectId(id) };
          const habit = await habitsColl.findOne(filter);

          if (!habit) {
            return res.status(404).json({ message: "Habit not found" });
          }

          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const todayISO = today.toISOString();

          const updateResult = await habitsColl.findOneAndUpdate(
            { _id: new ObjectId(id), completionHistory: { $ne: todayISO } },
            { $push: { completionHistory: todayISO } },
            { returnDocument: "after" }
          );

          if (!updateResult.value) {
            return res
              .status(400)
              .json({ message: "Habit already completed today" });
          }

          const updatedHabit = updateResult.value;

          const newStreak = calculateDailyStreak(
            updatedHabit.completionHistory
          );

          await habitsColl.updateOne(
            { _id: new ObjectId(id) },
            { $set: { streak: newStreak } }
          );

          res.json({
            message: "Habit marked as completed",
            streak: newStreak,
            completionHistory: updatedHabit.completionHistory,
          });
        } catch (error) {
          console.error(error);
          res.status(500).json({ message: "Internal server error" });
        }
      }
    );

    //Update habit
    app.patch("/api/v1/habits/:id", verifyAccessToken, async (req, res) => {
      const { id } = req.params;
      const { title, description, category, reminderTime, image } = req.body;
      const filter = { _id: new ObjectId(id) };
      const update = {
        $set: {
          title,
          description,
          category,
          reminderTime,
          image,
        },
      };
      const result = await habitsColl.updateOne(filter, update);
      res.send(result);
    });

    //Delete habit
    app.delete("/api/v1/habits/:id", verifyAccessToken, async (req, res) => {
      const { id } = req.params;
      const filter = { _id: new ObjectId(id) };
      const result = await habitsColl.deleteOne(filter);
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
