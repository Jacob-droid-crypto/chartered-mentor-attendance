app.use(cors());
app.use(express.json());
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("./models/User");
const Attendance = require("./models/Attendance");

const app = express();
app.use(express.static("public"));

// ================= HOURS CALCULATION LOGIC =================
const calculateHours = (records) => {
  let totalMs = 0;
  let lastIn = null;

  records.forEach((r) => {
    if (r.type === "IN") {
      lastIn = r.createdAt;
    } else if (r.type === "OUT" && lastIn) {
      totalMs += r.createdAt - lastIn;
      lastIn = null;
    }
  });

  return (totalMs / (1000 * 60 * 60)).toFixed(2); // hours
};

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json());

/* ================= MONGODB CONNECTION ================= */
mongoose
  .connect(
    "mongodb+srv://jacobthomassjcet_db_user:aBhEBoxEe4G52roO@cluster0.sryohx1.mongodb.net/charteredMentor",
  )
  .then(async () => {
    console.log("✅ MongoDB Connected Successfully");
    await createAdminIfNotExists();
  })
  .catch((err) => console.error("❌ MongoDB connection error:", err));

/* ================= CREATE DEFAULT ADMIN ================= */
async function createAdminIfNotExists() {
  try {
    const adminId = "ADMIN001";
    const adminPassword = "admin123";

    const admin = await User.findOne({ userId: adminId });

    if (!admin) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);

      await User.create({
        userId: adminId,
        password: hashedPassword,
        role: "admin",
        firstLogin: true,
      });

      console.log("✅ Default Admin Created");
    }
  } catch (error) {
    console.error("Admin creation error:", error);
  }
}

/* ================= ADMIN LOGIN ================= */
app.post("/admin/login", async (req, res) => {
  try {
    const { userId, password } = req.body;

    const admin = await User.findOne({ userId, role: "admin" });
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid password" });

    res.json({
      message: "Login successful",
      firstLogin: admin.firstLogin,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ================= ADD STUDENT ================= */
app.post("/admin/add-student", async (req, res) => {
  try {
    const { name, email, course } = req.body;

    if (!name || !email || !course) {
      return res.status(400).json({ message: "All fields required" });
    }

    // Prevent duplicates
    const exists = await User.findOne({ email, role: "student" });
    if (exists) {
      return res.json({
        message: "Student already exists",
        userId: exists.userId,
      });
    }

    const year = new Date().getFullYear().toString().slice(-2);
    const count = await User.countDocuments({ role: "student" });
    const admissionNumber = 100 + count + 1;

    const studentId = `${year}${course}${admissionNumber}`;

    // Strong password
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%";
    let plainPassword = "";
    for (let i = 0; i < 10; i++) {
      plainPassword += chars[Math.floor(Math.random() * chars.length)];
    }

    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    await User.create({
      userId: studentId,
      name,
      email,
      password: hashedPassword,
      role: "student",
      firstLogin: true,
    });

    res.json({
      userId: studentId,
      password: plainPassword,
    });
  } catch (err) {
    console.error("Add student error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ================= STUDENT LOGIN ================= */
app.post("/student/login", async (req, res) => {
  try {
    const { userId, password } = req.body;

    const student = await User.findOne({ userId, role: "student" });
    if (!student) return res.status(404).json({ message: "Student not found" });

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid password" });

    res.json({
      message: "Login successful",
      studentId: student.userId,
      name: student.name,
      firstLogin: student.firstLogin,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ================= CHANGE STUDENT PASSWORD ================= */
app.post("/student/change-password", async (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
      return res.status(400).json({ message: "Missing data" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await User.updateOne(
      { userId, role: "student" },
      { password: hashedPassword, firstLogin: false },
    );

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
// 🎓 Student Dashboard Info
app.get("/student/dashboard/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await User.findOne(
      { userId: studentId, role: "student" },
      { password: 0 },
    );

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const today = new Date().toISOString().split("T")[0];

    const logs = await Attendance.find({
      studentId,
      date: today,
    }).sort({ createdAt: 1 });

    res.json({
      studentId: student.userId,
      name: student.name,
      email: student.email,
      todayLogs: logs,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ================= MARK ATTENDANCE (IN / OUT) ================= */
/* ================= MARK ATTENDANCE (QR SCAN) ================= */
app.post("/student/scan-qr", async (req, res) => {
  try {
    const { studentId, qrValue } = req.body;

    if (!studentId || !qrValue) {
      return res.status(400).json({ message: "Missing data" });
    }

    const student = await User.findOne({
      userId: studentId,
      role: "student",
    });

    if (!student) {
      return res.status(401).json({
        message: "Invalid student session. Please login again.",
      });
    }

    /* 🔒 IP RESTRICTION (TEMP – YOUR WIFI) */
    const ALLOWED_PUBLIC_IP = "103.182.166.212";

    const requestIP =
      req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";

    const cleanIP = requestIP.replace("::ffff:", "");

    const isAllowed =
      cleanIP === ALLOWED_PUBLIC_IP ||
      cleanIP.startsWith("192.168.") ||
      cleanIP.startsWith("10.") ||
      cleanIP.startsWith("172.");

    if (!isAllowed) {
      return res.status(403).json({
        message: "Attendance allowed only inside institution network",
      });
    }

    /* ✅ QR VALIDATION */
    let type;
    if (qrValue === "CM-ATTENDANCE-IN") type = "IN";
    else if (qrValue === "CM-ATTENDANCE-OUT") type = "OUT";
    else {
      return res.status(401).json({ message: "Invalid QR code" });
    }

    const course = studentId.substring(2, 5);

    await Attendance.create({
      studentId,
      course,
      type,
    });

    res.json({
      message: `Attendance ${type} marked successfully`,
    });
  } catch (error) {
    console.error("QR scan error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ⏱ Daily Hours Calculation
app.get("/student/daily-hours/:studentId/:date", async (req, res) => {
  try {
    const { studentId, date } = req.params;

    const logs = await Attendance.find({ studentId, date }).sort({
      createdAt: 1,
    });

    let totalMs = 0;
    let lastIn = null;

    for (const log of logs) {
      if (log.type === "IN") {
        lastIn = log.createdAt;
      } else if (log.type === "OUT" && lastIn) {
        totalMs += log.createdAt - lastIn;
        lastIn = null;
      }
    }

    const totalHours = (totalMs / (1000 * 60 * 60)).toFixed(2);

    res.json({
      studentId,
      date,
      totalHours,
    });
  } catch (err) {
    console.error("Hour calculation error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ================= ADMIN VIEW ATTENDANCE ================= */
app.get("/admin/attendance", async (req, res) => {
  try {
    const records = await Attendance.find().sort({ date: -1, time: -1 });

    const cleaned = records.map((r) => ({
      studentId: r.studentId,
      course: r.course || "-",
      date: r.date,
      time: r.time || "-",
      type: r.type || (r.status ? "PRESENT" : "-"),
    }));

    res.json(cleaned);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching attendance" });
  }
});
// 📊 Admin - Daily Attendance Summary
app.get("/admin/daily-summary", async (req, res) => {
  try {
    const records = await Attendance.find();

    const summary = {};

    records.forEach((r) => {
      const key = `${r.studentId}_${r.date}`;

      if (!summary[key]) {
        summary[key] = {
          studentId: r.studentId,
          course: r.course,
          date: r.date,
          hasIN: false,
          hasOUT: false,
        };
      }

      if (r.type === "IN") summary[key].hasIN = true;
      if (r.type === "OUT") summary[key].hasOUT = true;
    });

    const result = Object.values(summary).map((s) => ({
      studentId: s.studentId,
      course: s.course,
      date: s.date,
      status: s.hasIN && s.hasOUT ? "Present" : s.hasIN ? "Partial" : "Absent",
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
/* ================= QR ENTRY ROUTES ================= */

// Check-IN QR
app.get("/qr/in", (req, res) => {
  res.sendFile(__dirname + "/public/qr-scan.html");
});

app.get("/qr/out", (req, res) => {
  res.sendFile(__dirname + "/public/qr-scan.html");
});

app.get("/qr/in", (req, res) => {
  res.send(`
    <!doctype html>
    <html>
      <head>
        <title>QR Check-IN</title>
      </head>
      <body>
        <script>
          localStorage.setItem("qrValue", "CM-ATTENDANCE-IN");
          window.location.href = "/qr-scan.html";
        </script>
      </body>
    </html>
  `);
});

// Check-OUT QR
app.get("/qr/out", (req, res) => {
  res.send(`
    <!doctype html>
    <html>
      <head>
        <title>QR Check-OUT</title>
      </head>
      <body>
        <script>
          localStorage.setItem("qrValue", "CM-ATTENDANCE-OUT");
          window.location.href = "/qr-scan.html";
        </script>
      </body>
    </html>
  `);
});

/* ================= TEST ROUTE ================= */
app.get("/", (req, res) => {
  res.send("Chartered Mentor Backend Running");
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
