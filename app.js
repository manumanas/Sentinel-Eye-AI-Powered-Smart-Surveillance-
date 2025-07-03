const express = require("express");
const session = require("express-session");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const mysql = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const appRoutes = require("./routes/appRoutes");

const app = express();

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// Session configuration
app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "0c8eccddb63bb2f42b14de61ef1e5962e0a6699671cb3cccf6514eb4f477d675a69e6a4933ea29054bf27959ff91c7fe31f9381897d4472574b829c8ab9efc21",
    resave: false,
    saveUninitialized: true,
  })
);

// Store user session info
app.use((req, res, next) => {
  res.locals.user = req.session.name || null;
  next();
});

// Routes
app.use("/", authRoutes);
app.use("/", appRoutes);

// Serve uploaded images from the `public/uploads` folder
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// Multer configuration for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "public/uploads/");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true }); // Ensure folder exists
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname)); // Unique filename
  },
});

const upload = multer({ storage: storage });

// API route for analyzing uploaded images
app.post("/api/analyze-face", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const imagePath = req.file.path;
    const faceImage = req.file.filename;
    const user = req.session.name;
    const imageStream = fs.createReadStream(imagePath);

    // Prepare FormData for API request
    const formData = new FormData();
    formData.append("image", imageStream);

    // API request to Face Analyzer
    const response = await axios.post(
      "https://face-analyzer1.p.rapidapi.com/analyze/full",
      formData,
      {
        headers: {
          "x-rapidapi-key": "3847882385msh02d5e5e7753c1f6p128261jsn275b00a419e5",
          "x-rapidapi-host": "face-analyzer1.p.rapidapi.com",
          ...formData.getHeaders(),
        },
      }
    );

    const faceData = response.data.data[0];
    if (faceData) {
      const { age, emotion, gender } = faceData;

      // Save face data into the database
      const sql =
        "INSERT INTO My_faces (name, age, emotion, gender, status, face_image) VALUES (?, ?, ?, ?, ?, ?)";
      const values = [user, age, emotion, gender, "active", faceImage];

      mysql.query(sql, values, (err) => {
        if (err) {
          console.error("Error inserting into DB:", err);
          return res.status(500).json({ error: "Database error" });
        }
      });
    }

    res.json(response.data);
  } catch (error) {
    console.error("Error in face analysis:", error);
    res.status(500).json({ error: error.message });
  }
});

// Fetch user details by ID
app.get("/api/user/:id", (req, res) => {
  const userId = req.params.id;
  const query = "SELECT * FROM users WHERE id = ?";

  mysql.query(query, [userId], (err, results) => {
    if (err) {
      console.error("Error fetching user:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(results[0]);
  });
});

// Fetch all active users
app.get("/api/active-users", (req, res) => {
  const query = "SELECT * FROM users WHERE status = 'active'";

  mysql.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching active users:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json(results);
  });
});

// Admin panel route
app.get("/admin", (req, res) => {
  if (req.session.user) {
    res.render("admin", { user: req.session.user, users: [] });
  } else {
    res.redirect("/login");
  }
});

// View analytics data
app.get("/view-analytics", (req, res) => {
  const query = `SELECT id AS Sno, gender, age, emotion, status, face_image, timestamp AS time FROM My_faces`;

  mysql.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching face analytics:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.render("analytics", { users: results });
  });
});

// Fetch stored images
app.get("/image/:filename", (req, res) => {
  const filePath = path.join(__dirname, "public/uploads", req.params.filename);
  
  // Check if file exists before sending
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("Image not found");
  }
});

// Reports page
app.get("/reports", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "reports.html"));
});

// Home page
app.get("/", (req, res) => {
  res.render("index");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
