import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import mqtt from "mqtt";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { PORT = 5001, MONGO_URI, MQTT_URL, MQTT_TOPIC = "printer/status", MQTT_USER, MQTT_PASS } = process.env;

/* ---------- ข้อมูลล่าสุด + ประวัติในหน่วยความจำ ---------- */
let latest = null;
const buffer = []; // เก็บล่าสุด ~10 นาที
const BUFFER_MAX = 300;

const Reading = mongoose.model(
  "Reading",
  new mongoose.Schema({
    ts: { type: Date, index: { expires: "7d" } }, // ลบอัตโนมัติหลัง 7 วัน
    data: Object,
  })
);
const dbReady = () => mongoose.connection.readyState === 1;

/* ---------- จุดเดียวที่ต้องแก้เมื่อได้ format จริงจากวิน ----------
   รับ JSON ดิบจากเครื่อง -> คืนรูปแบบมาตรฐานที่หน้าเว็บใช้ */
function normalize(raw, simulated = false) {
  return {
    ts: Date.now(),
    simulated,
    state: raw.state ?? "idle", // printing | idle | error
    nozzle: { temp: Number(raw.nozzle?.temp ?? 0), target: Number(raw.nozzle?.target ?? 0) },
    bed: { temp: Number(raw.bed?.temp ?? 0), target: Number(raw.bed?.target ?? 0) },
    pos: { x: raw.pos?.x ?? 0, y: raw.pos?.y ?? 0, z: raw.pos?.z ?? 0 },
    job: raw.job
      ? { name: raw.job.name ?? "-", progress: Number(raw.job.progress ?? 0), elapsedSec: Number(raw.job.elapsedSec ?? 0) }
      : null,
  };
}

async function ingest(raw, simulated = false) {
  const d = normalize(raw, simulated);
  latest = d;
  buffer.push(d);
  if (buffer.length > BUFFER_MAX) buffer.shift();
  if (dbReady()) Reading.create({ ts: new Date(d.ts), data: d }).catch(() => {});
}

/* ---------- แหล่งข้อมูล: MQTT จริง หรือ simulator ---------- */
if (MQTT_URL) {
  const client = mqtt.connect(MQTT_URL, { username: MQTT_USER || undefined, password: MQTT_PASS || undefined });
  client.on("connect", () => {
    console.log("MQTT connected");
    client.subscribe(MQTT_TOPIC);
  });
  client.on("error", (e) => console.error("MQTT error:", e.message));
  client.on("message", (_t, msg) => {
    try {
      ingest(JSON.parse(msg.toString()));
    } catch {
      console.warn("ข้าม payload ที่ไม่ใช่ JSON");
    }
  });
} else {
  console.log("ไม่มี MQTT_URL -> ใช้ข้อมูลจำลอง");
  let t = 0, nozzle = 25;
  setInterval(() => {
    t++;
    nozzle = Math.min(210, nozzle + 6 + Math.random());
    ingest(
      {
        state: nozzle > 195 ? "printing" : "idle",
        nozzle: { temp: +nozzle.toFixed(1), target: 210 },
        bed: { temp: +(22 + Math.sin(t / 8) * 0.4).toFixed(1), target: 0 },
        pos: { x: +(100 + Math.sin(t / 3) * 40).toFixed(1), y: +(100 + Math.cos(t / 4) * 40).toFixed(1), z: +(0.2 + Math.floor(t / 20) * 0.2).toFixed(1) },
        job: { name: "benchy.gcode", progress: Math.min(100, t * 0.7), elapsedSec: t * 2 },
      },
      true
    );
  }, 2000);
}

/* ---------- ฐานข้อมูล (ไม่บังคับ) ---------- */
if (MONGO_URI) {
  mongoose.connect(MONGO_URI).then(() => console.log("MongoDB connected")).catch((e) => console.error("MongoDB error:", e.message));
}

/* ---------- API ---------- */
const app = express();
app.use(cors());

app.get("/api/health", (_q, r) => r.json({ success: true, db: dbReady(), mqtt: Boolean(MQTT_URL) }));
app.get("/api/printer/latest", (_q, r) => r.json({ success: true, data: latest }));
app.get("/api/printer/history", async (q, r) => {
  const minutes = Math.min(Number(q.query.minutes) || 5, 1440);
  const since = Date.now() - minutes * 60000;
  if (dbReady()) {
    const rows = await Reading.find({ ts: { $gte: new Date(since) } }).sort({ ts: 1 }).limit(1000).lean();
    return r.json({ success: true, data: rows.map((x) => x.data) });
  }
  r.json({ success: true, data: buffer.filter((x) => x.ts >= since) });
});

/* ---------- เสิร์ฟหน้าเว็บที่ build แล้ว (ตอน deploy) ---------- */
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "../web/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_q, r) => r.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
