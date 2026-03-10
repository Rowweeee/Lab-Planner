import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("lab_planner.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    color TEXT NOT NULL,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS template_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    day_offset INTEGER DEFAULT 0,
    step_order INTEGER NOT NULL,
    description TEXT NOT NULL,
    duration_minutes INTEGER,
    notes TEXT,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    template_id INTEGER,
    start_date TEXT NOT NULL,
    status TEXT DEFAULT 'planned',
    notes TEXT,
    color TEXT,
    FOREIGN KEY (template_id) REFERENCES templates(id)
  );

  CREATE TABLE IF NOT EXISTS experiment_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER NOT NULL,
    day_offset INTEGER DEFAULT 0,
    step_order INTEGER NOT NULL,
    description TEXT NOT NULL,
    is_completed INTEGER DEFAULT 0,
    completed_at TEXT,
    notes TEXT,
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER NOT NULL UNIQUE,
    purpose TEXT,
    results TEXT,
    summary TEXT,
    problems_json TEXT,
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS project_arguments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
`);

// Migration: Add missing columns if they don't exist
const tables = {
  experiments: ['color', 'project_id', 'argument_id', 'samples_json'],
  template_steps: ['notes', 'duration_minutes'],
  experiment_steps: ['notes'],
  templates: ['project_id'],
  project_arguments: ['planned_experiments']
};

for (const [table, columns] of Object.entries(tables)) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  const existingColumns = info.map(c => c.name);
  for (const column of columns) {
    if (!existingColumns.includes(column)) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${column.includes('_id') ? 'INTEGER' : 'TEXT'}`);
        console.log(`Added column ${column} to table ${table}`);
      } catch (e) {
        console.error(`Failed to add column ${column} to ${table}:`, e);
      }
    }
  }
}

// Seed default templates if empty
const templateCount = db.prepare("SELECT COUNT(*) as count FROM templates").get() as { count: number };
if (templateCount.count === 0) {
  const insertTemplate = db.prepare("INSERT INTO templates (name, type, color, description) VALUES (?, ?, ?, ?)");
  const insertStep = db.prepare("INSERT INTO template_steps (template_id, day_offset, step_order, description) VALUES (?, ?, ?, ?)");

  // WB Template
  const wbId = insertTemplate.run("Western Blot", "Molecular", "#3b82f6", "Standard WB protocol").lastInsertRowid;
  [
    [0, 1, "Gel Preparation"],
    [0, 2, "Sample Loading"],
    [0, 3, "Electrophoresis"],
    [0, 4, "Transfer"],
    [0, 5, "Primary Antibody Incubation (Overnight)"],
    [1, 6, "Secondary Antibody Incubation"],
    [1, 7, "ECL Exposure & Imaging"]
  ].forEach(step => insertStep.run(wbId, ...step));

  // qPCR Template
  const qpcrId = insertTemplate.run("qPCR", "Molecular", "#10b981", "RNA extraction to qPCR").lastInsertRowid;
  [
    [0, 1, "RNA Extraction"],
    [0, 2, "Reverse Transcription"],
    [0, 3, "qPCR Reaction Setup"],
    [0, 4, "Real-time PCR Run"]
  ].forEach(step => insertStep.run(qpcrId, ...step));
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PATCH", "DELETE"]
    }
  });
  const PORT = 3000;

  app.use(express.json());

  // Helper to notify clients
  const notifyClients = () => {
    io.emit("data_changed");
  };

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    socket.on("disconnect", () => console.log("Client disconnected"));
  });

  // Projects API
  app.get("/api/projects", (req, res) => {
    const projects = db.prepare("SELECT * FROM projects").all();
    res.json(projects);
  });

  app.post("/api/projects", (req, res) => {
    const { name, description, color } = req.body;
    const info = db.prepare("INSERT INTO projects (name, description, color) VALUES (?, ?, ?)").run(name, description, color);
    notifyClients();
    res.json({ id: info.lastInsertRowid });
  });

  app.get("/api/projects/:id", (req, res) => {
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
    const arguments_ = db.prepare("SELECT * FROM project_arguments WHERE project_id = ?").all(req.params.id);
    res.json({ ...project, arguments: arguments_ });
  });

  app.patch("/api/projects/:id", (req, res) => {
    const { name, description, color } = req.body;
    db.prepare("UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description), color = COALESCE(?, color) WHERE id = ?")
      .run(name, description, color, req.params.id);
    notifyClients();
    res.json({ success: true });
  });

  app.delete("/api/projects/:id", (req, res) => {
    db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
    notifyClients();
    res.json({ success: true });
  });

  // Project Arguments API
  app.post("/api/project-arguments", (req, res) => {
    const { project_id, content } = req.body;
    const info = db.prepare("INSERT INTO project_arguments (project_id, content) VALUES (?, ?)").run(project_id, content);
    notifyClients();
    res.json({ id: info.lastInsertRowid });
  });

  app.delete("/api/project-arguments/:id", (req, res) => {
    db.prepare("DELETE FROM project_arguments WHERE id = ?").run(req.params.id);
    notifyClients();
    res.json({ success: true });
  });

  app.patch("/api/project-arguments/:id", (req, res) => {
    const { content, planned_experiments } = req.body;
    db.prepare("UPDATE project_arguments SET content = COALESCE(?, content), planned_experiments = COALESCE(?, planned_experiments) WHERE id = ?")
      .run(content, planned_experiments, req.params.id);
    notifyClients();
    res.json({ success: true });
  });

  // API Routes
  app.get("/api/templates", (req, res) => {
    const templates = db.prepare("SELECT * FROM templates").all();
    res.json(templates);
  });

  app.post("/api/templates", (req, res) => {
    const { name, type, color, description, steps, project_id } = req.body;
    const info = db.prepare("INSERT INTO templates (name, type, color, description, project_id) VALUES (?, ?, ?, ?, ?)").run(name, type, color, description, project_id || null);
    const templateId = info.lastInsertRowid;

    if (steps && Array.isArray(steps)) {
      const insertStep = db.prepare("INSERT INTO template_steps (template_id, day_offset, step_order, description, notes, duration_minutes) VALUES (?, ?, ?, ?, ?, ?)");
      steps.forEach((step, index) => {
        insertStep.run(templateId, step.day_offset || 0, index + 1, step.description, step.notes || null, step.duration_minutes || null);
      });
    }
    notifyClients();
    res.json({ id: templateId });
  });

  app.patch("/api/templates/:id", (req, res) => {
    const { name, type, color, description, steps, project_id } = req.body;
    db.prepare("UPDATE templates SET name = ?, type = ?, color = ?, description = ?, project_id = ? WHERE id = ?").run(name, type, color, description, project_id || null, req.params.id);
    
    if (steps && Array.isArray(steps)) {
      db.prepare("DELETE FROM template_steps WHERE template_id = ?").run(req.params.id);
      const insertStep = db.prepare("INSERT INTO template_steps (template_id, day_offset, step_order, description, notes, duration_minutes) VALUES (?, ?, ?, ?, ?, ?)");
      steps.forEach((step, index) => {
        insertStep.run(req.params.id, step.day_offset || 0, index + 1, step.description, step.notes || null, step.duration_minutes || null);
      });
    }
    notifyClients();
    res.json({ success: true });
  });

  app.delete("/api/templates/:id", (req, res) => {
    db.prepare("DELETE FROM templates WHERE id = ?").run(req.params.id);
    notifyClients();
    res.json({ success: true });
  });

  app.get("/api/templates/:id/steps", (req, res) => {
    const steps = db.prepare("SELECT * FROM template_steps WHERE template_id = ? ORDER BY day_offset, step_order").all(req.params.id);
    res.json(steps);
  });

  app.post("/api/experiments", (req, res) => {
    const { name, template_id, start_date, color, project_id, argument_id, steps: customSteps, samples_json } = req.body;
    const info = db.prepare("INSERT INTO experiments (name, template_id, start_date, color, project_id, argument_id, samples_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(name, template_id, start_date, color, project_id || null, argument_id || null, samples_json || null);
    const experimentId = info.lastInsertRowid;

    if (customSteps && Array.isArray(customSteps)) {
      const insertExpStep = db.prepare("INSERT INTO experiment_steps (experiment_id, day_offset, step_order, description, notes) VALUES (?, ?, ?, ?, ?)");
      customSteps.forEach((step, index) => {
        insertExpStep.run(experimentId, step.day_offset, index + 1, step.description, step.notes);
      });
    } else if (template_id) {
      const steps = db.prepare("SELECT * FROM template_steps WHERE template_id = ?").all(template_id) as any[];
      const insertExpStep = db.prepare("INSERT INTO experiment_steps (experiment_id, day_offset, step_order, description, notes) VALUES (?, ?, ?, ?, ?)");
      steps.forEach(step => {
        insertExpStep.run(experimentId, step.day_offset, step.step_order, step.description, step.notes);
      });
    }

    notifyClients();
    res.json({ id: experimentId });
  });

  app.get("/api/experiments", (req, res) => {
    const experiments = db.prepare(`
      SELECT e.*, COALESCE(e.color, t.color) as color, t.name as template_name,
      (SELECT MAX(day_offset) FROM experiment_steps WHERE experiment_id = e.id) as max_day_offset,
      p.name as project_name
      FROM experiments e 
      LEFT JOIN templates t ON e.template_id = t.id
      LEFT JOIN projects p ON e.project_id = p.id
    `).all();
    res.json(experiments);
  });

  app.delete("/api/experiments/:id", (req, res) => {
    db.prepare("DELETE FROM experiments WHERE id = ?").run(req.params.id);
    notifyClients();
    res.json({ success: true });
  });

  app.get("/api/experiments/:id", (req, res) => {
    const experiment = db.prepare("SELECT * FROM experiments WHERE id = ?").get(req.params.id);
    const steps = db.prepare("SELECT * FROM experiment_steps WHERE experiment_id = ? ORDER BY day_offset, step_order").all(req.params.id);
    const record = db.prepare("SELECT * FROM records WHERE experiment_id = ?").get(req.params.id);
    res.json({ ...experiment, steps, record });
  });

  app.post("/api/experiment-steps", (req, res) => {
    const { experiment_id, day_offset, description, notes } = req.body;
    const lastStep = db.prepare("SELECT MAX(step_order) as max_order FROM experiment_steps WHERE experiment_id = ?").get(experiment_id) as { max_order: number };
    const stepOrder = (lastStep?.max_order || 0) + 1;
    const info = db.prepare("INSERT INTO experiment_steps (experiment_id, day_offset, step_order, description, notes) VALUES (?, ?, ?, ?, ?)")
      .run(experiment_id, day_offset || 0, stepOrder, description, notes || null);
    notifyClients();
    res.json({ id: info.lastInsertRowid });
  });

  app.delete("/api/experiment-steps/:id", (req, res) => {
    db.prepare("DELETE FROM experiment_steps WHERE id = ?").run(req.params.id);
    notifyClients();
    res.json({ success: true });
  });

  app.patch("/api/experiments/:id", (req, res) => {
    const { name, status, notes, start_date, color, project_id, argument_id, samples_json } = req.body;
    db.prepare("UPDATE experiments SET name = COALESCE(?, name), status = COALESCE(?, status), notes = COALESCE(?, notes), start_date = COALESCE(?, start_date), color = COALESCE(?, color), project_id = COALESCE(?, project_id), argument_id = COALESCE(?, argument_id), samples_json = COALESCE(?, samples_json) WHERE id = ?")
      .run(name, status, notes, start_date, color, project_id, argument_id, samples_json, req.params.id);
    notifyClients();
    res.json({ success: true });
  });

  app.patch("/api/experiment-steps/:id", (req, res) => {
    const { is_completed, description, notes, day_offset } = req.body;
    db.prepare("UPDATE experiment_steps SET is_completed = COALESCE(?, is_completed), completed_at = ?, description = COALESCE(?, description), notes = COALESCE(?, notes), day_offset = COALESCE(?, day_offset) WHERE id = ?")
      .run(is_completed !== undefined ? (is_completed ? 1 : 0) : null, is_completed ? new Date().toISOString() : null, description, notes, day_offset, req.params.id);
    notifyClients();
    res.json({ success: true });
  });

  app.get("/api/records", (req, res) => {
    const records = db.prepare(`
      SELECT r.*, e.name as experiment_name, e.start_date, e.color
      FROM records r
      JOIN experiments e ON r.experiment_id = e.id
      ORDER BY e.start_date DESC
    `).all();
    res.json(records);
  });

  app.post("/api/records", (req, res) => {
    const { experiment_id, purpose, results, summary, problems_json } = req.body;
    db.prepare(`
      INSERT INTO records (experiment_id, purpose, results, summary, problems_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(experiment_id) DO UPDATE SET
        purpose=excluded.purpose,
        results=excluded.results,
        summary=excluded.summary,
        problems_json=excluded.problems_json
    `).run(experiment_id, purpose, results, summary, problems_json);
    notifyClients();
    res.json({ success: true });
  });

  app.delete("/api/records/:id", (req, res) => {
    db.prepare("DELETE FROM records WHERE id = ?").run(req.params.id);
    notifyClients();
    res.json({ success: true });
  });

  app.post("/api/ai/analyze", async (req, res) => {
    const { problem, context } = req.body;
    try {
      const { analyzeExperimentProblem } = await import("./src/services/geminiService.ts");
      const analysis = await analyzeExperimentProblem(problem, context);
      res.json({ analysis });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "AI analysis failed" });
    }
  });

  app.post("/api/ai/chat", async (req, res) => {
    const { message, history, context } = req.body;
    try {
      const { chatWithAssistant } = await import("./src/services/geminiService.ts");
      const response = await chatWithAssistant(message, history, context);
      res.json({ response });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "AI chat failed" });
    }
  });

  app.post("/api/ai/summarize", async (req, res) => {
    const { experimentData } = req.body;
    try {
      const { generateExperimentSummary } = await import("./src/services/geminiService.ts");
      const summary = await generateExperimentSummary(experimentData);
      res.json({ summary });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "AI summary failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
