import express from "express";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import admin from "firebase-admin";
import fs from "fs";

const app = express();
const port = process.env.PORT || 3000;

// Users timezone
const USER_TIMEZONE = "Asia/Dhaka";

if (!process.env.DB_URI) {
  console.error(" ERROR: DB_URI environment variable is not set");
  process.exit(1);
}

// Initialize Firebase Admin
try {
  const serviceAccount = JSON.parse(
    fs.readFileSync("./firebaseAdminKey.json", "utf8")
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log(" Firebase Admin initialized successfully");
} catch (error) {
  console.error(" Failed to initialize Firebase Admin:", error.message);
  process.exit(1);
}

//middlewares
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Firebase access token middleware
const verifyAccessToken = async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res.status(401).json({
      message: "Unauthorized access - No authorization header",
    });
  }

  const token = authorization.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      message: "Unauthorized access - Invalid authorization format",
    });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.token_email = decoded.email;
    req.token_uid = decoded.uid;
    next();
  } catch (err) {
    console.error("Token verification failed:", err.message);
    return res.status(401).json({
      message: "Unauthorized access - Invalid or expired token",
    });
  }
};

function getLocalDateString(date = new Date(), timezone = USER_TIMEZONE) {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    return formatter.format(date);
  } catch (err) {
    console.error("Error formatting date:", err);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
}

function getLocalDateStringWithClientTZ(date = new Date(), clientTimezone) {
  const timezone = clientTimezone || USER_TIMEZONE;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  } catch (err) {
    console.error("Error formatting date with client timezone:", err);
    return getLocalDateString(date, USER_TIMEZONE);
  }
}

function toLocalDateStringAny(value) {
  if (!value) return null;
  if (typeof value !== "string") return null;
  if (value.length >= 10) return value.slice(0, 10);
  return value;
}

function calculateDailyStreak(completionHistory = []) {
  const normalized = completionHistory
    .map(toLocalDateStringAny)
    .filter(Boolean);

  const datesSet = new Set(normalized);

  let streak = 0;
  let cursor = getLocalDateString();

  while (datesSet.has(cursor)) {
    streak += 1;

    const [y, m, d] = cursor.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 1);
    cursor = getLocalDateString(dt);
  }

  return streak;
}

// Validation helper
function validateHabitInput(data, isUpdate = false) {
  const errors = [];

  if (!isUpdate && !data.title) {
    errors.push("Title is required");
  }

  if (
    data.title &&
    (typeof data.title !== "string" || data.title.trim().length === 0)
  ) {
    errors.push("Title must be a non-empty string");
  }

  if (data.title && data.title.length > 200) {
    errors.push("Title must be less than 200 characters");
  }

  if (data.description && data.description.length > 1000) {
    errors.push("Description must be less than 1000 characters");
  }

  if (!isUpdate && !data.category) {
    errors.push("Category is required");
  }

  if (data.category && typeof data.category !== "string") {
    errors.push("Category must be a string");
  }

  if (!isUpdate && !data.creator?.uid) {
    errors.push("Creator UID is required");
  }

  if (data.isPublic !== undefined && typeof data.isPublic !== "boolean") {
    errors.push("isPublic must be a boolean");
  }

  if (data.reminderTime && typeof data.reminderTime !== "string") {
    errors.push("Reminder time must be a string");
  }

  if (data.imageUrl && typeof data.imageUrl !== "string") {
    errors.push("Image URL must be a string");
  }

  return errors;
}

// Health check
app.get("/", async (req, res) => {
  const now = new Date();
  res.json({
    status: "ok",
    message: "Habit Flow API is running fine ;)",
    timestamp: now.toISOString(),
    localDate: getLocalDateString(now),
    timezone: USER_TIMEZONE,
  });
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
    await client.connect();
    console.log(" Successfully connected to MongoDB!");

    const db = client.db("habit-flow-db");
    const habitsColl = db.collection("habits");

    // Performance optimization with indexes
    try {
      await habitsColl.createIndex({ "creator.uid": 1 });
      await habitsColl.createIndex({ isPublic: 1 });
      await habitsColl.createIndex({ createdAt: -1 });
      console.log(" Database indexes created");
    } catch (err) {
      console.warn("  Index creation warning:", err.message);
    }

    console.log(` Server timezone: ${USER_TIMEZONE}`);
    console.log(` Current local date: ${getLocalDateString()}`);

    // Read public habits
    app.get("/api/v1/habits", async (req, res) => {
      try {
        const projectFields = {
          completionHistory: 0,
          "creator.email": 0,
          "creator.uid": 0,
          reminderTime: 0,
          imageUrl: 0,
        };
        const cursor = habitsColl
          .find({ isPublic: true })
          .project(projectFields);
        const result = await cursor.toArray();
        res.json(result);
      } catch (err) {
        console.error("Error fetching public habits:", err);
        res.status(500).json({
          message: "Failed to fetch public habits",
          error: err.message,
        });
      }
    });

    //Read latest public habit
    app.get("/api/v1/latest-habits", async (req, res) => {
      try {
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
      } catch (err) {
        console.error("Error fetching latest habits:", err);
        res.status(500).json({
          message: "Failed to fetch latest habits",
          error: err.message,
        });
      }
    });

    //Read specific habit
    app.get("/api/v1/habits/:id", verifyAccessToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid habit ID format" });
        }

        const filter = { _id: new ObjectId(id) };
        const habit = await habitsColl.findOne(filter);

        if (!habit) {
          return res.status(404).json({ message: "Habit not found" });
        }

        if (habit.creator?.uid !== req.token_uid && !habit.isPublic) {
          return res.status(403).json({
            message:
              "Access denied - You don't have permission to view this habit",
          });
        }

        res.json(habit);
      } catch (err) {
        console.error("Error fetching habit:", err);
        res.status(500).json({
          message: "Failed to fetch habit",
          error: err.message,
        });
      }
    });

    // Read my habits
    app.get("/api/v1/my-habits", verifyAccessToken, async (req, res) => {
      try {
        const { uid } = req.query;

        if (!uid) {
          return res
            .status(400)
            .send({ message: "UID query parameter is required" });
        }

        if (uid !== req.token_uid) {
          return res.status(403).json({
            message: "Access denied - Cannot access other users' habits",
          });
        }

        const filter = { "creator.uid": uid };
        const cursor = habitsColl.find(filter);
        const result = await cursor.toArray();
        res.json(result);
      } catch (err) {
        console.error("Error fetching user habits:", err);
        res.status(500).send({
          message: "Failed to fetch habits",
          error: err.message,
        });
      }
    });

    //Create habit
    app.post("/api/v1/habits", verifyAccessToken, async (req, res) => {
      try {
        const {
          title,
          description,
          category,
          reminderTime,
          difficulty,
          frequency,
          goal,
          imageUrl,
          isPublic,
          creator,
        } = req.body;

        // Validate input
        const validationErrors = validateHabitInput(req.body);
        if (validationErrors.length > 0) {
          return res.status(400).json({
            message: "Validation failed",
            errors: validationErrors,
          });
        }

        if (creator?.uid !== req.token_uid) {
          return res.status(403).json({
            message: "Access denied - Cannot create habits for other users",
          });
        }

        const newHabit = {
          title: title.trim(),
          description: description?.trim() || "",
          category,
          isPublic: Boolean(isPublic),
          reminderTime: reminderTime || null,
          frequency: frequency || null,
          difficulty: difficulty || null,
          goal: goal || null,
          imageUrl: imageUrl || null,
          creator: {
            uid: creator.uid,
            email: creator.email || req.token_email,
            displayName: creator.displayName || "Anonymous",
          },
          completionHistory: [],
          streak: 0,
          createdAt: new Date(),
        };

        const result = await habitsColl.insertOne(newHabit);

        res.status(201).json({
          message: "Habit created successfully",
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error("Error creating habit:", err);
        res.status(500).json({
          message: "Failed to create habit",
          error: err.message,
        });
      }
    });

    // Mark Complete Habit
    app.post(
      "/api/v1/habits/:id/complete",
      verifyAccessToken,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { timezone } = req.body;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid habit ID format" });
          }

          const todayLocal = timezone
            ? getLocalDateStringWithClientTZ(new Date(), timezone)
            : getLocalDateString();

          const filter = { _id: new ObjectId(id) };

          const habit = await habitsColl.findOne(filter);
          if (!habit)
            return res.status(404).json({ message: "Habit not found" });

          // if (habit.creator?.uid !== req.token_uid) {
          //   return res.status(403).json({
          //     message: "Access denied - You can only complete your own habits",
          //   });
          // }

          if (!habit.isPublic && habit.creator?.uid !== req.token_uid) {
            return res.status(403).json({
              message:
                "Access denied - You can only complete your own private habits",
            });
          }

          const completionHistory = Array.isArray(habit.completionHistory)
            ? habit.completionHistory
            : [];

          if (completionHistory.includes(todayLocal)) {
            return res.status(400).json({
              message: "Habit already completed today",
              habit,
              completedDate: todayLocal,
            });
          }

          completionHistory.push(todayLocal);
          const newStreak = calculateDailyStreak(completionHistory);

          const updateResult = await habitsColl.findOneAndUpdate(
            filter,
            {
              $set: {
                completionHistory,
                streak: newStreak,
                lastCompletedAt: new Date(),
              },
            },
            { returnOriginal: false }
          );

          let updatedHabit = updateResult.value;
          if (!updatedHabit) {
            updatedHabit = await habitsColl.findOne(filter);
          }

          return res.json({
            message: "Habit marked as completed",
            habit: updatedHabit,
            completedDate: todayLocal,
          });
        } catch (err) {
          console.error("Error in /habits/:id/complete:", err);
          return res.status(500).json({
            message: "Internal server error",
            error: err.message,
          });
        }
      }
    );

    // Update habit
    app.patch("/api/v1/habits/:id", verifyAccessToken, async (req, res) => {
      try {
        const { id } = req.params;
        const {
          title,
          description,
          category,
          reminderTime,
          difficulty,
          frequency,
          goal,
          imageUrl,
          isPublic,
        } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid habit ID format" });
        }

        // Validate input
        const validationErrors = validateHabitInput(req.body, true);
        if (validationErrors.length > 0) {
          return res.status(400).json({
            message: "Validation failed",
            errors: validationErrors,
          });
        }

        const filter = { _id: new ObjectId(id) };

        // User authorization
        const habit = await habitsColl.findOne(filter);

        if (!habit) {
          return res.status(404).json({ message: "Habit not found" });
        }

        if (habit.creator?.uid !== req.token_uid) {
          return res.status(403).json({
            message: "Access denied - You can only update your own habits",
          });
        }

        const updateFields = {};
        if (title !== undefined) updateFields.title = title.trim();
        if (description !== undefined)
          updateFields.description = description.trim();
        if (category !== undefined) updateFields.category = category;
        if (reminderTime !== undefined)
          updateFields.reminderTime = reminderTime;
        if (frequency !== undefined) updateFields.frequency = reminderTime;
        if (difficulty !== undefined) updateFields.difficulty = reminderTime;
        if (goal !== undefined) updateFields.goal = reminderTime;
        if (imageUrl !== undefined) updateFields.imageUrl = imageUrl;
        if (isPublic !== undefined) updateFields.isPublic = Boolean(isPublic);

        if (Object.keys(updateFields).length === 0) {
          return res.status(400).json({
            message: "No valid fields to update",
          });
        }

        const update = { $set: updateFields };
        const result = await habitsColl.findOneAndUpdate(filter, update, {
          returnOriginal: false,
        });

        let updatedHabit = result.value;
        if (!updatedHabit) {
          updatedHabit = await habitsColl.findOne(filter);
        }

        res.send({
          message: "Habit updated successfully",
          habit: updatedHabit,
        });
      } catch (err) {
        console.error("Error updating habit:", err);
        res.status(500).send({
          message: "Failed to update habit",
          error: err.message,
        });
      }
    });

    //Delete habit
    app.delete("/api/v1/habits/:id", verifyAccessToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid habit ID format" });
        }

        const filter = { _id: new ObjectId(id) };

        const habit = await habitsColl.findOne(filter);

        if (!habit) {
          return res.status(404).json({ message: "Habit not found" });
        }

        if (habit.creator?.uid !== req.token_uid) {
          return res.status(403).json({
            message: "Access denied - You can only delete your own habits",
          });
        }

        const result = await habitsColl.deleteOne(filter);

        res.send({
          message: "Habit deleted successfully",
          deletedCount: result.deletedCount,
        });
      } catch (err) {
        console.error("Error deleting habit:", err);
        res.status(500).send({
          message: "Failed to delete habit",
          error: err.message,
        });
      }
    });

    // Global error handler
    app.use((err, req, res, next) => {
      console.error("Unhandled error:", err);
      res.status(500).json({
        message: "Internal server error",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(" Pinged deployment. Successfully connected to MongoDB!");
  } catch (err) {
    console.error(" Failed to connect to MongoDB:", err);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(" Fatal error:", err);
  process.exit(1);
});

app.listen(port, () => {
  console.log(` Server running on port ${port}`);
  console.log(` Server started at: ${new Date().toISOString()}`);
  console.log(` Timezone: ${USER_TIMEZONE}`);
  console.log(` Local date: ${getLocalDateString()}`);
});
