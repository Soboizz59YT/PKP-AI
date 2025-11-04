import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { Source } from '../types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateTitle = async (prompt: string): Promise<string> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Generate a very short, concise title (4 words max) for a chat that starts with this user prompt: "${prompt}"`,
        });
        return response.text.replace(/["*]/g, '').trim();
    } catch (error) {
        console.error("Error generating title:", error);
        return "New Chat";
    }
};

type StreamChunk = {
    textChunk?: string;
    sources?: Source[];
};

export async function* generateTextWithSearchStream(
    prompt: string, 
    history: { role: 'user' | 'model', parts: { text: string }[] }[]
): AsyncGenerator<StreamChunk> {
    try {
        const model = 'gemini-2.5-flash';
        const systemInstruction = `You are PKP.ai, a helpful and friendly AI assistant. Your name is PKP.ai. Under no circumstances should you mention you are Gemini or any other AI model by Google. You must only identify as PKP.ai. You can generate text with Google Search grounding. You can also generate HTML for a slide-based presentation. To create slides, wrap each slide's content in a <section> tag. For example: <section><h2>Slide 1</h2><p>Content...</p></section><section><h2>Slide 2</h2>...</section>. Do not add any other HTML tags like <html> or <body>, just the <section> tags.`;

        const contents = [...history, { role: 'user', parts: [{ text: prompt }] }];
        
        const streamResult = await ai.models.generateContentStream({
            model,
            contents,
            config: {
                systemInstruction,
                tools: [{ googleSearch: {} }],
            },
        });

        const allSources: Source[] = [];

        // Stream text chunks and collect sources from each chunk
        for await (const chunk of streamResult) {
            if (chunk.text) {
                yield { textChunk: chunk.text };
            }

            const groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (groundingChunks) {
                const chunkSources = groundingChunks.map(c => c.web).filter(Boolean) as Source[];
                chunkSources.forEach(source => {
                    if (source.uri && !allSources.some(s => s.uri === source.uri)) {
                        allSources.push(source);
                    }
                });
            }
        }

        // After streaming is complete, yield the collected sources
        if (allSources.length > 0) {
            yield { sources: allSources };
        }

    } catch (error) {
        console.error("Error generating text:", error);
        throw new Error("Failed to get response from AI.");
    }
}


export async function* generatePresentationStream(title: string): AsyncGenerator<StreamChunk> {
    try {
        const fullPrompt = `You are an AI assistant that creates beautiful, professional, single-file HTML slide deck presentations.
Your task is to generate a complete, single-file HTML and CSS slide deck presentation for the topic: "${title}".

The output MUST be a single block of HTML code, starting with <!DOCTYPE html> and ending with </html>. Do not wrap it in markdown backticks like \`\`\`html ... \`\`\`.

The presentation should have a modern and visually appealing aesthetic (dark theme is preferred). It must include:
1.  **Complete Structure:** A full HTML document with <head> (containing <style>) and <body> (containing the slides and <script>).
2.  **Engaging Animations:** Subtle CSS animations (e.g., fade-in, slide-up) on headings and content to make the presentation dynamic.
3.  **Relevant Imagery:** Every content slide MUST include a relevant image placeholder. Use https://placehold.co for images, making the placeholder text relevant to the slide's topic (e.g., <img src="https://placehold.co/1200x800/2E2A59/FFFFFF?text=Slide+Topic" alt="Relevant image description">).
4.  **Arrow Key Navigation:** Crucially, you must include the necessary JavaScript within a <script> tag at the end of the <body> to enable slide-to-slide navigation using the left (←) and right (→) arrow keys. The navigation should scroll between slides smoothly.
5.  **8-10 Slides:** The presentation should contain between 8 and 10 slides, each wrapped in a <section> tag, covering the topic comprehensively from introduction to conclusion.

Please generate the complete HTML file now.`;

        const streamResult = await ai.models.generateContentStream({
            model: 'gemini-2.5-pro',
            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
            config: {
                systemInstruction: `You are PKP.ai, an AI presentation generator. Your name is PKP.ai. Under no circumstances should you mention you are Gemini or any other AI model by Google. You must only identify as PKP.ai. Your sole purpose is to generate complete, single-file HTML presentations based on user prompts.`,
            },
        });
        
        for await (const chunk of streamResult) {
            if (chunk.text) {
                yield { textChunk: chunk.text };
            }
        }

    } catch (error) {
        console.error("Error generating presentation:", error);
        throw new Error("Failed to get response from AI for presentation.");
    }
}


export const generateImage = async (prompt: string): Promise<string> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [{ text: prompt }],
            },
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });

        const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

        if (imagePart?.inlineData) {
            const base64ImageBytes: string = imagePart.inlineData.data;
            const mimeType = imagePart.inlineData.mimeType || 'image/png';
            return `data:${mimeType};base64,${base64ImageBytes}`;
        }

        throw new Error("No image data found in API response.");
    } catch (error) {
        console.error("Error generating image:", error);
        if (error instanceof Error && error.message.includes('SAFETY')) {
             throw new Error("Failed to generate image due to safety restrictions. Please try a different prompt.");
        }
        throw new Error("Failed to generate image.");
    }
};