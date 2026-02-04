const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true },
    course: { type: String, required: true },
    type: { type: String, enum: ["IN", "OUT"], required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Attendance", attendanceSchema);
