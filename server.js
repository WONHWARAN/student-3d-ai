import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 8);
const MAX_CONCURRENT = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS || 2));
const MESHY_KEY = process.env.MESHY_API_KEY;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("PNG, JPG, WEBP 이미지만 사용할 수 있습니다."), ok);
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const jobs = new Map();
const queue = [];
let running = 0;

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
}

function enqueue(job) {
  jobs.set(job.id, job);
  queue.push(job.id);
  processQueue();
}

async function processQueue() {
  while (running < MAX_CONCURRENT && queue.length) {
    const id = queue.shift();
    const job = jobs.get(id);
    if (!job || job.status !== "queued") continue;

    running++;
    runJob(job).finally(() => {
      running--;
      processQueue();
    });
  }
}

async function runJob(job) {
  job.status = "processing";
  job.message = "AI가 그림을 분석하고 3D 모델을 만드는 중이에요.";
  job.startedAt = Date.now();

  try {
    if (!MESHY_KEY) {
      throw new Error("MESHY_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.");
    }

    // Meshy Image-to-3D API는 공개 이미지 URL 또는 base64 Data URI를 입력으로 받을 수 있습니다.
    const dataUri = `data:${job.mime};base64,${job.buffer.toString("base64")}`;

    const createRes = await fetch("https://api.meshy.ai/openapi/v1/image-to-3d", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MESHY_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        image_url: dataUri,
        enable_pbr: true,
        should_remesh: true,
        target_polycount: 50000,
        should_texture: true,
        target_formats: ["glb"]
      })
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`3D 생성 요청 실패 (${createRes.status}): ${text.slice(0,300)}`);
    }

    const created = await createRes.json();
    const taskId = created.result;
    job.taskId = taskId;

    // Meshy는 작업 ID를 반환하고, 완료될 때까지 상태를 조회합니다.
    for (;;) {
      await new Promise(r => setTimeout(r, 5000));

      const statusRes = await fetch(
        `https://api.meshy.ai/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`,
        { headers: { "Authorization": `Bearer ${MESHY_KEY}` } }
      );

      if (!statusRes.ok) {
        throw new Error(`작업 상태 조회 실패 (${statusRes.status})`);
      }

      const task = await statusRes.json();
      job.progress = Number(task.progress || 0);

      if (task.status === "SUCCEEDED") {
        job.status = "done";
        job.progress = 100;
        job.modelUrl = task.model_urls?.glb || "";
        job.thumbnailUrl = task.thumbnail_url || "";
        job.message = "완성됐어요! 3D 모델을 돌려보세요.";
        break;
      }

      if (task.status === "FAILED" || task.status === "CANCELED") {
        throw new Error(task.task_error?.message || `AI 작업이 ${task.status} 상태로 종료됐습니다.`);
      }
    }
  } catch (err) {
    job.status = "error";
    job.message = err?.message || "알 수 없는 오류가 발생했습니다.";
  } finally {
    // 원본 이미지 메모리 정리
    job.buffer = null;
    job.finishedAt = Date.now();
  }
}

app.post("/api/jobs", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "이미지를 선택해주세요." });
  }

  const id = makeId();
  const job = {
    id,
    status: "queued",
    progress: 0,
    message: "대기열에 등록됐어요.",
    mime: req.file.mimetype,
    buffer: req.file.buffer,
    createdAt: Date.now(),
    modelUrl: "",
    thumbnailUrl: ""
  };

  enqueue(job);

  res.json({
    id,
    position: queue.length,
    message: "AI 3D 변환 대기열에 등록됐어요."
  });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "작업을 찾을 수 없습니다." });

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    position: job.status === "queued" ? Math.max(1, queue.indexOf(job.id) + 1) : 0,
    modelUrl: job.modelUrl || "",
    thumbnailUrl: job.thumbnailUrl || ""
  });
});

app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    aiConnected: Boolean(MESHY_KEY),
    running,
    queued: queue.length,
    maxConcurrent: MAX_CONCURRENT
  });
});

app.use((err, _req, res, _next) => {
  const message = err?.code === "LIMIT_FILE_SIZE"
    ? `이미지 용량은 ${MAX_MB}MB 이하로 올려주세요.`
    : (err?.message || "요청을 처리하지 못했습니다.");
  res.status(400).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`학생용 3D 사이트: http://localhost:${PORT}`);
  console.log(`AI 연결: ${MESHY_KEY ? "설정됨" : "미설정"}`);
});
