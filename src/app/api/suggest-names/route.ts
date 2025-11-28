import { NextRequest, NextResponse } from 'next/server';
import {
    GoogleGenAI,
} from "@google/genai";

// Basic fetch wrapper with timeout
async function fetchWithTimeout(resource: string | URL | Request, options: RequestInit & { timeout?: number } = {}) {
    const { timeout = 8000 } = options; // Default timeout 8s
    
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
  
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal  
    });
    clearTimeout(id);
  
    return response;
}

// Ensure API key is set
if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY environment variable.");
}

// Pass API key within an options object
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Define system instruction separately
const systemInstruction = "You are helping create a character for a retro 90s fighting platform video game. The user will provide an image of a character concept. Suggest 3 potential names. Respond ONLY with a valid JSON array of 3 strings, like [\"Name One\", \"Name Two\", \"Name Three\"]. Do not include any other text or markdown formatting.";

const generationConfig = {
    temperature: 0.8, // Slightly creative but not too random
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 1024, // Limit output size
    responseMimeType: "application/json", // Expect JSON directly
};

interface RequestBody {
    imageUrl: string;
}

export async function POST(req: NextRequest) {
    let requestBody: RequestBody;
    try {
        requestBody = await req.json();
    } catch (error) {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { imageUrl } = requestBody;
    if (!imageUrl || typeof imageUrl !== 'string') {
        return NextResponse.json({ error: 'Missing or invalid imageUrl' }, { status: 400 });
    }

    try {
        // Fetch the image data from the provided URL
        console.log(`Fetching image for Gemini: ${imageUrl}`);
        const imageResponse = await fetchWithTimeout(imageUrl, { timeout: 10000 }); // 10s timeout for image fetch
        if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
        }
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'; // Default to jpeg if header missing
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageBase64 = Buffer.from(imageBuffer).toString('base64');

        // Prepare the prompt parts for Gemini, including the system instruction
        const userPromptParts = [
            { text: systemInstruction }, // Add system instruction text first
            //{ text: "\n\nSuggest 3 names for the character in this image." }, // Then the user prompt text
            { inlineData: { mimeType: contentType, data: imageBase64 } }, // Then the image
        ];

        console.log(`Sending image (${contentType}) to Gemini...`);
        const result = await genAI.models.generateContent({
            model: "gemini-2.5-flash",
            // Combine all instructions and data under the 'user' role
            contents: [
                { role: "user", parts: userPromptParts }
            ],
            ...generationConfig
        });

        // Access response text directly from result, assuming result is the response object
        const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!responseText) {
            console.error("Could not extract text from Gemini response:", result); // Log the full result
            throw new Error("Received empty or invalid response structure from Gemini.");
        }

        console.log("Raw Gemini response text:", responseText);
        
        // Attempt to parse the JSON response
        try {
            const names = JSON.parse(responseText);
            if (!Array.isArray(names) || names.length !== 3 || !names.every(n => typeof n === 'string')) {
                 throw new Error("Gemini response is not a valid JSON array of 3 strings.");
            }
            console.log("Suggested Names:", names);
            return NextResponse.json({ names }, { status: 200 });
        } catch (parseError) {
            console.error("Failed to parse Gemini response:", responseText, parseError);
            throw new Error("Received invalid name suggestions format.");
        }

    } catch (error: any) {
        console.error("Error suggesting names:", error);
        return NextResponse.json({ error: error.message || 'Failed to suggest names' }, { status: 500 });
    }
} 