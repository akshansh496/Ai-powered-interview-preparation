const { GoogleGenAI } = require("@google/genai");
const { z } = require("zod");
const { zodToJsonSchema } = require("zod-to-json-schema");

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_GENAI_API_KEY,
});

const interviewReportSchema = z.object({
  matchScore: z
    .number()
    .min(0)
    .max(100)
    .describe(
      "The match score between the candidate's resume and the job describe"
    ),
  technicalQuestions: z
    .array(
      z.object({
        question: z
          .string()
          .describe(
            "The technical question that can be asked during the interview"
          ),
        intention: z
          .string()
          .describe("The intention of interviewer behind the question"),
        answer: z
          .string()
          .describe(
            "How to answer the question, what points to cover in the answer"
          ),
      })
    )
    .describe(
      "List of technical questions that can be asked during the interview along with their intention and how to answer them"
    ),
  behavioralQuestions: z
    .array(
      z.object({
        question: z
          .string()
          .describe(
            "The behavioral question that can be asked during the interview"
          ),
        intention: z
          .string()
          .describe("The intention of interviewer behind the question"),
        answer: z
          .string()
          .describe(
            "How to answer the question, what points to cover in the answer"
          ),
      })
    )
    .describe(
      "List of behavioral questions that can be asked during the interview along with their intention and how to answer them"
    ),
  skillGaps: z
    .array(
      z.object({
        skill: z.string().describe("The skill that the candidate is lacking"),
        severity: z
          .enum(["low", "medium", "high"])
          .describe("The severity of the skill gap"),
      })
    )
    .describe(
      "List of skills that the candidate is lacking along with their severity"
    ),
  preparationPlan: z
    .array(
      z.object({
        day: z
          .number()
          .describe("The day number for which the preparation plan is created"),
        focus: z
          .string()
          .describe("The focus of the preparation plan for the day"),
        tasks: z
          .array(z.string())
          .describe("List of tasks to be done on that day"),
      })
    )
    .describe(
      "List of preparation plans for the candidate to follow before the interview"
    ),
    title:z.string().describe("The title of the job for which the report is generated")
});


async function generateInterviewReport({
  resume,
  selfDescription,
  jobDescription,
}) {
  const prompt = `
You are an expert interviewer.

Generate an interview report.

Use ONLY the provided JSON schema.

Do not omit any field.
Do not add extra fields.

Resume:
${resume}

Self Description:
${selfDescription}

Job Description:
${jobDescription}
`;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: zodToJsonSchema(interviewReportSchema),
    },
  });

  return JSON.parse(response.text)
}

module.exports = generateInterviewReport;
