import { GoogleGenAI, Type } from "@google/genai";

const getApiKey = () => {
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) {
      // @ts-ignore
      return process.env.GEMINI_API_KEY;
    }
    return "";
  } catch (e) {
    return "";
  }
};

let aiInstance: GoogleGenAI | null = null;

const getAI = () => {
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: getApiKey() });
  }
  return aiInstance;
};

export async function analyzeExperimentProblem(problem: string, context: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `As a lab assistant, analyze this experiment problem:
    Problem: ${problem}
    Context: ${context}
    
    Provide possible causes and specific suggestions for improvement.`,
    config: {
      systemInstruction: "You are an expert biomedical researcher with 20 years of lab experience. Your advice is practical, scientifically sound, and encouraging.",
    }
  });
  return response.text;
}

export async function generateExperimentSummary(experimentData: any) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Summarize this experiment:
    Data: ${JSON.stringify(experimentData)}
    
    Provide a concise summary, key takeaways, and optimization suggestions for next time.`,
    config: {
      systemInstruction: "You are a research supervisor. Summarize the experiment results and provide critical feedback for optimization.",
    }
  });
  return response.text;
}

export async function chatWithAssistant(message: string, history: { role: 'user' | 'model', parts: { text: string }[] }[], context?: string) {
  const ai = getAI();
  const chat = ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: `You are an expert AI Lab Assistant. Your goal is to help researchers with their lab work, protocol optimization, troubleshooting, and project management. 
      ${context ? `Current Context: ${context}` : ''}
      Be concise, practical, and scientifically rigorous.`,
    },
    history: history,
  });

  const response = await chat.sendMessage({ message });
  return response.text;
}
