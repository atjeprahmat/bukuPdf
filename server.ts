import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Configure JSON body parsing with a larger limit to accommodate extracted PDF text
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Gemini SDK with User-Agent telemetry
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Endpoint to generate a structured summary of a PDF document's text
 */
app.post("/api/summarize", async (req, res) => {
  try {
    const { text, title } = req.body;

    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "Missing or invalid PDF text content." });
      return;
    }

    // Limit text size to a safe, highly informative threshold (e.g., 300k characters)
    // to keep latency reasonable and avoid exceeding model limits
    const safeText = text.length > 300000 ? text.substring(0, 300000) + "\n\n[Konten dipotong untuk optimasi ringkasan...]" : text;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Berikut adalah konten teks lengkap dari dokumen PDF yang berjudul "${title || 'Dokumen Tanpa Judul'}". 
Tolong buat ringkasan yang sangat komprehensif, terstruktur dengan indah, dan informatif dalam Bahasa Indonesia.

Format ringkasan harus menggunakan Markdown dengan elemen visual yang rapi dan memuat bagian berikut:
1. **Ringkasan Eksekutif (Executive Summary)**: Penjelasan singkat namun padat tentang apa dokumen ini, argumen utama, atau tujuan utamanya (2-3 paragraf).
2. **Topik & Gagasan Utama**: Daftar poin-poin penting berisi konsep utama yang dibahas di dokumen ini.
3. **Struktur / Garis Besar Isi**: Analisis bab atau bagian penting yang ditemukan dalam dokumen (jika ada) beserta penjelasannya.
4. **Wawasan Utama & Kesimpulan**: Apa kesimpulan utama dan hal-hal yang bisa dipelajari dari dokumen ini.

Teks Dokumen PDF:
"""
${safeText}
"""`
            }
          ]
        }
      ],
      config: {
        temperature: 0.2, // lower temperature for factual summary
      }
    });

    const summary = response.text;
    res.json({ summary });
  } catch (error: any) {
    console.error("Error in /api/summarize:", error);
    res.status(500).json({ error: error.message || "Gagal membuat ringkasan dokumen." });
  }
});

/**
 * Endpoint for conversational Q&A grounded in the PDF document's text
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { text, history, message, title } = req.body;

    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "Missing or invalid PDF text content." });
      return;
    }

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Missing or invalid chat message." });
      return;
    }

    // Limit context size to 250k characters for safe chat execution
    const safeContext = text.length > 250000 ? text.substring(0, 250000) + "\n\n[Konten dipotong untuk optimasi percakapan...]" : text;

    // Convert history format to Gemini parts structure
    const mappedHistory = (history || []).map((msg: any) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }]
    }));

    // Build the contents payload. The first message establishes the PDF grounding context.
    const contents = [
      {
        role: "user",
        parts: [
          {
            text: `Berikut adalah konten teks lengkap dari dokumen PDF/buku berjudul "${title || 'Dokumen Tanpa Judul'}". 
Tolong analisis konten ini dan jadilah asisten AI yang siap menjawab setiap pertanyaan pengguna berdasarkan teks ini.

Teks Dokumen PDF:
\"\"\"
${safeContext}
\"\"\"`
          }
        ]
      },
      {
        role: "model",
        parts: [
          {
            text: `Saya telah memuat dan menganalisis dokumen "${title || 'Dokumen Tanpa Judul'}". Saya siap membantu Anda mencari, menganalisis, dan menjawab pertanyaan apa pun mengenai isinya. Apa yang ingin Anda tanyakan?`
          }
        ]
      },
      ...mappedHistory,
      {
        role: "user",
        parts: [{ text: message }]
      }
    ];

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents,
      config: {
        systemInstruction: "Anda adalah asisten AI pintar berbahasa Indonesia yang ahli dalam menganalisis dokumen. Tugas Anda adalah membantu pengguna memahami buku atau dokumen PDF yang mereka unggah. Berikan jawaban yang akurat, komprehensif, dan ramah yang bersumber dari teks PDF. Jika pertanyaan tidak dapat dijawab dari isi PDF tersebut, gunakan pengetahuan umum Anda namun sebutkan secara jujur bahwa informasi tersebut tidak tertulis langsung di dokumen PDF tersebut.",
        temperature: 0.7,
      }
    });

    const reply = response.text;
    res.json({ reply });
  } catch (error: any) {
    console.error("Error in /api/chat:", error);
    res.status(500).json({ error: error.message || "Gagal memproses pesan Anda." });
  }
});

// Setup Vite development server or production static serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
