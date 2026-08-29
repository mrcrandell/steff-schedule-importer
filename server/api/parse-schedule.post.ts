import { GoogleGenAI, Type } from "@google/genai";
import { normalizeShifts } from "../utils/normalizeShifts";

/**
 * POST /api/parse-schedule
 *
 * Accepts a multipart form with a single "file" field (image or PDF).
 * Returns an array of normalized shift objects for the employee STEFF.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  if (!config.geminiApiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: "GEMINI_API_KEY is not configured",
    });
  }

  if (!config.geminiModel) {
    throw createError({
      statusCode: 500,
      statusMessage: "GEMINI_MODEL is not configured",
    });
  }

  // Parse multipart form data
  const formData = await readMultipartFormData(event);
  if (!formData || formData.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "No file uploaded" });
  }

  const filePart = formData.find((p) => p.name === "file");
  if (!filePart || !filePart.data) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing "file" field in form data',
    });
  }

  const mimeType = (filePart.type ?? "image/jpeg") as string;
  const base64Data = filePart.data.toString("base64");

  // Initialize Gemini client
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

  // Define the structured output schema
  const responseSchema = {
    type: Type.ARRAY,
    description: "List of shift entries for STEFF only",
    items: {
      type: Type.OBJECT,
      properties: {
        date: {
          type: Type.STRING,
          description: "The specific date of the shift in YYYY-MM-DD format",
        },
        rawStartTime: {
          type: Type.STRING,
          description:
            'The raw start time as printed on the schedule, e.g. "7:45 AM"',
        },
        rawEndTime: {
          type: Type.STRING,
          description:
            'The raw end time as printed on the schedule, e.g. "4:00 PM"',
        },
      },
      required: ["date", "rawStartTime", "rawEndTime"],
    },
  };

  const prompt = `You are analyzing a work schedule image or PDF.
Your task is to extract ALL shift entries that belong ONLY to the employee named "STEFF".
Completely ignore every other employee row.

Rules:
1. Parse any grid date range headers (e.g., "AUGUST 1 - 7 2026") to determine the exact calendar date for each column.
2. Return one object per shift day for STEFF.
3. Skip any cell that is empty, contains "R" (Requested Off), or is otherwise not a real shift time pair.
4. Dates must be in YYYY-MM-DD format.
5. Times must be in 12-hour format with AM/PM, e.g. "7:45 AM" or "4:00 PM".
6. Return an empty array if STEFF has no shifts visible.`;

  let rawShifts: Array<{
    date: string;
    rawStartTime: string;
    rawEndTime: string;
  }>;

  try {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema,
      },
    });

    const raw = response.text ?? "";
    // The SDK may return an already-parsed value or a JSON string depending on version
    rawShifts = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    console.error("[parse-schedule] Gemini error:", err);
    throw createError({
      statusCode: 502,
      statusMessage: "Failed to parse schedule with Gemini AI",
    });
  }

  const normalized = normalizeShifts(rawShifts);
  return normalized;
});
