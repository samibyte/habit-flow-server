# Habit Flow Server

This is the **server-side API** for the Habit Flow web application — a productivity-focused platform that allows users to **create, track, and manage daily habits**, build streaks, and monitor progress.

---

## **Live API Status**

The API is running and available for requests.
Base URL: `https://habit-flow-api-server.vercel.app`

Health check endpoint:

```
GET /
```

Returns server status and local date.

---

## **Features**

- **User Authentication & Authorization**

  - Email/password and Google login support (handled client-side).
  - Firebase Admin SDK integration for token verification.
  - Protected routes for private habit operations (add, update, delete, mark complete).

- **CRUD Operations for Habits**

  - Create new habits (private route).
  - Read all public habits or user's own habits.
  - Update habit fields with proper validation.
  - Delete habits with ownership verification.

- **Habit Tracking**

  - Mark habits as complete for a day.
  - Automatically calculate **daily streaks**.
  - Prevent duplicate completion on the same day.
  - Supports timezone-based completion dates.

- **Data Management**

  - MongoDB with **collections, indexes, and queries optimized for performance**.
  - Supports filtering for public habits, latest habits, and user-specific habits.
  - Stores completion history, streaks, and creator info.

- **Validation & Error Handling**

  - Input validation for all habit-related fields.
  - Comprehensive error responses for unauthorized access, invalid IDs, and other failures.
  - Success messages for all write operations.

- **Utilities**

  - Handles local date formatting in server timezone (`Asia/Dhaka`) or client-provided timezone.
  - Calculation functions for streaks and habit completion history.

---

## **API Endpoints**

### **Public Endpoints**

| Method | Endpoint                | Description                  |
| ------ | ----------------------- | ---------------------------- |
| GET    | `/`                     | Health check / server status |
| GET    | `/api/v1/habits`        | Fetch all public habits      |
| GET    | `/api/v1/latest-habits` | Fetch latest 6 public habits |

### **Protected Endpoints (Require Firebase Token)**

| Method | Endpoint                      | Description                      |
| ------ | ----------------------------- | -------------------------------- |
| GET    | `/api/v1/habits/:id`          | Fetch a specific habit           |
| GET    | `/api/v1/my-habits?uid=<uid>` | Fetch all habits for a user      |
| POST   | `/api/v1/habits`              | Create a new habit               |
| POST   | `/api/v1/habits/:id/complete` | Mark habit as complete for today |
| PATCH  | `/api/v1/habits/:id`          | Update habit fields              |
| DELETE | `/api/v1/habits/:id`          | Delete a habit                   |

---

## **Installation**

1. Clone the repository:

```bash
git clone https://github.com/samibyte/habit-flow-server.git
cd habit-flow-server
```

2. Install dependencies:

```bash
npm install
```

3. Set environment variables (for Vercel or local development):

```env
PORT=3000
DB_URI=<Your MongoDB URI>
FIREBASE_ADMIN_KEY=<Your Firebase Admin JSON, Base64 encoded>
```

4. Start the server:

```bash
npm run dev   # For development
npm start     # For production
```

---

## **Technologies Used**

- **Node.js & Express.js** – Server framework
- **MongoDB** – Database for habit storage
- **Firebase Admin SDK** – Authentication & token verification
- **Cors & Express JSON Middleware** – For secure API access and JSON parsing
- **Intl DateTimeFormat** – Timezone-aware date formatting
- **Vercel** – Deployment

---

## **Best Practices Implemented**

- JWT token verification for private API routes.
- Proper input validation and error messages.
- Streak calculation logic for habit completion.
- Database indexing for optimized queries (`creator.uid`, `isPublic`, `createdAt`).
