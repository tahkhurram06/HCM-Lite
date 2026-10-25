import mongoose from "mongoose";

// Posted by Admin or HR, visible to everyone (brief M9: "Announcements on all dashboards").
const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    postedByName: { type: String, required: true }, // snapshot, survives user deactivation
  },
  { timestamps: true }
);

announcementSchema.index({ createdAt: -1 });

export default mongoose.model("Announcement", announcementSchema);