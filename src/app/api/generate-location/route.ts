import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { GoogleGenAI, FileData } from '@google/genai';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch'; // Use node-fetch for fetching image buffer
import mime from 'mime'; // For mime type detection
import fs from 'fs/promises'; // For async file operations
import os from 'os'; // For temporary directory
import path from 'path'; // For path joining

// --- Import Supabase Admin Client ---
import { supabaseAdmin } from '@/lib/supabase/admin'; // Adjust path if needed

// --- Environment Variable Checks ---
if (!process.env.REPLICATE_API_TOKEN) throw new Error('Missing REPLICATE_API_TOKEN');
if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');
if (!process.env.R2_BUCKET_NAME) throw new Error('Missing R2_BUCKET_NAME');
if (!process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
if (!process.env.R2_ACCESS_KEY_ID) throw new Error("Missing R2_ACCESS_KEY_ID");
if (!process.env.R2_SECRET_ACCESS_KEY) throw new Error("Missing R2_SECRET_ACCESS_KEY");
if (!process.env.LORA_LINK) throw new Error('Missing LORA_LINK');
if (!process.env.LORA_TOKEN) {
    // It's a style token, so we can default it or warn. Let's warn for now.
    console.warn('Missing LORA_TOKEN environment variable. Defaulting to empty string for style.');
}
// Supabase checks are done in the admin client file

// --- Initialize Clients ---
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
// Supabase client is imported as supabaseAdmin

// --- Configure S3 Client for R2 (copied from initiate-character) ---
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_ENDPOINT = `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const S3 = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});


const loraWeights = process.env.LORA_LINK;
const loraStyleToken = process.env.LORA_TOKEN; // Keep as potentially undefined
let loraScale = 1; // Default LORA_SCALE
if (process.env.LORA_SCALE) {
    const parsedScale = parseFloat(process.env.LORA_SCALE);
    if (!isNaN(parsedScale)) {
        loraScale = parsedScale;
    }
}

// --- Interfaces ---
interface RequestBody { userPrompt: string; }
interface ReplicateFileOutput { url: () => { href: string }; } // Updated based on previous findings

// Type for the uploaded file object from ai.files.upload
interface UploadedFile { 
    uri: string; 
    mimeType: string; 
    // Add other potential properties if needed based on SDK docs
}

// --- Main POST Handler ---
export async function POST(req: NextRequest) {
    let requestBody: RequestBody;
    try {
        requestBody = await req.json();
    } catch (error) {
        console.error("Failed to parse request body:", error);
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { userPrompt } = requestBody;
    if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.trim().length === 0) {
        return NextResponse.json({ error: 'Missing or invalid userPrompt' }, { status: 400 });
    }

    let replicateImageUrl: string | null = null;
    let floorTextureBuffer: Buffer | null = null;
    let locationName: string | null = null;
    let locationId: string | null = null;
    let backgroundR2Url: string | null = null;
    let floorR2Url: string | null = null;
    let tempFilePath: string | null = null; // To store path for cleanup
    let uploadedFile: UploadedFile | null = null; // To store the uploaded file info

    try {
        // === 1. Generate Background (Replicate) ===
        console.log("Generating background with Replicate...");
        
        let replicatePrompt = `a background for a video game of ${userPrompt}`;
        if (loraStyleToken && loraStyleToken.trim() !== "") {
            replicatePrompt += `, ${loraStyleToken.trim()}`;
        }

        const replicateInput: any = {
            prompt: replicatePrompt,
            go_fast: false, guidance: 3, /*lora_scale: 0.9,*/ megapixels: "1",
            num_outputs: 1, aspect_ratio: "21:9",
            // lora_weights: loraWeights, // Will be added conditionally
            output_format: "jpg", output_quality: 80, prompt_strength: 0.8,
            num_inference_steps: 28
        };

        if (loraWeights && loraWeights.trim() !== "") {
            replicateInput.lora_weights = loraWeights.trim();
            replicateInput.lora_scale = loraScale; // Use the parsed or default LORA_SCALE
        }

        const replicateOutput: unknown = await replicate.run("black-forest-labs/flux-dev-lora", { input: replicateInput });

        // Extract Replicate URL
        if (Array.isArray(replicateOutput) && replicateOutput.length > 0) {
            const firstItem = replicateOutput[0];
             if (typeof firstItem === 'object' && firstItem !== null && typeof (firstItem as ReplicateFileOutput).url === 'function') {
                 try {
                    replicateImageUrl = (firstItem as ReplicateFileOutput).url().href;
                 } catch (e) { console.error("Error calling Replicate .url():", e); }
             }
        }
        if (!replicateImageUrl) throw new Error("Failed to get image URL from Replicate.");
        console.log("Replicate Background URL:", replicateImageUrl);

        // === 2. Fetch Background Image Data ===
        console.log("Fetching background image data...");
        const imageResponse = await fetch(replicateImageUrl);
        if (!imageResponse.ok) throw new Error(`Failed to fetch background image: ${imageResponse.statusText}`);
        const fetchedBuffer = await imageResponse.buffer();
        if (!fetchedBuffer || fetchedBuffer.length === 0) {
            throw new Error("Fetched background image data is empty.");
        }
        console.log(`Fetched background buffer: ${fetchedBuffer.length} bytes`);

        // === 2a. Save to Temporary File and Upload to Google AI ===
        tempFilePath = path.join(os.tmpdir(), `vibefighter-loc-${uuidv4()}.jpg`);
        console.log("Saving background to temporary file:", tempFilePath);
        await fs.writeFile(tempFilePath, fetchedBuffer);
        
        console.log("Uploading temporary file to Google AI Files...");
        // Explicitly type the result based on our interface/expectations
        uploadedFile = await ai.files.upload({ file: tempFilePath }) as UploadedFile;
        if (!uploadedFile || !uploadedFile.uri || !uploadedFile.mimeType) {
            throw new Error("Failed to upload file to Google AI or received invalid response.");
        }
        console.log(`Uploaded to Google AI: URI=${uploadedFile.uri}, MimeType=${uploadedFile.mimeType}`);

        // === 3. Generate UUID (moved after file ops incase they fail) ===
        locationId = uuidv4();
        console.log("Generated Location ID:", locationId);

        // === 4. Upload Background to R2 (can happen anytime after fetch) ===
        const backgroundKey = `locations/${locationId}/background.jpg`;
        console.log("Uploading background to R2:", backgroundKey);
        await S3.send(new PutObjectCommand({ 
            Bucket: R2_BUCKET,
            Key: backgroundKey,
            Body: fetchedBuffer, // Use the original buffer
            ContentType: 'image/jpeg',
        }));
        backgroundR2Url = process.env.R2_PUBLIC_URL ? `${process.env.R2_PUBLIC_URL}/${backgroundKey}` : null;
        if (!backgroundR2Url) console.warn("R2_PUBLIC_URL not set, cannot construct public URL for background.");
        console.log("Background R2 URL:", backgroundR2Url);

        // === 5 & 6. Generate Floor Texture & Name (Gemini - Concurrent) ===
        console.log("Starting Gemini stream tasks (floor texture & name)...");

        // Prepare the common fileDataPart using the uploaded file info
        const geminiFileDataPart = { 
            fileData: {
                fileUri: uploadedFile.uri,
                mimeType: uploadedFile.mimeType,
            }
        };

        const [floorResult, nameResult] = await Promise.all([
            // --- Generate Floor Texture (using STREAMING call as per example) ---
            (async () => {
                let generatedFloorBuffer: Buffer | null = null;
                try {
                    console.log("Calling Gemini stream for floor texture...");
                    // Use the config from the user's example
                    const config = {
                        responseModalities: ['image'],
                        responseMimeType: 'text/plain', 
                        imageConfig: {"aspectRatio": "1:1"}
                    };
                    const model = 'gemini-2.5-flash-image';
                    const contents = [{
                        role: 'user',
                        parts: [
                            geminiFileDataPart,
                            { text: `make the corresponding vertical top view texture floor asset for a video game for this image` },
                        ],
                    }];

                    // Use generateContentStream with the specific config
                    const responseStream = await ai.models.generateContentStream({
                        model,
                        config, // Pass the config object
                        contents,
                    });

                    console.log("Processing floor texture stream...");
                    // Process stream exactly as in user example
                    for await (const chunk of responseStream) {
                        const part = chunk.candidates?.[0]?.content?.parts?.[0];
                        if (part?.inlineData?.data) {
                            console.log("Received floor texture inlineData chunk.");
                            generatedFloorBuffer = Buffer.from(part.inlineData.data, 'base64');
                            break; // Found the image data
                        }
                    }

                    // Throw error if buffer wasn't found after iterating stream
                    if (!generatedFloorBuffer) {
                        console.error("Could not find floor texture inlineData in stream.");
                        throw new Error("Gemini stream did not return floor texture image data.");
                    }
                    return generatedFloorBuffer;

                } catch (err) {
                    console.error("Gemini floor texture stream generation failed:", err);
                    throw new Error("Failed to generate floor texture.");
                }
            })(),
            // --- Generate Location Name (using stream as per example) ---
            (async () => {
                let concatenatedName = "";
                try {
                    console.log("Calling Gemini stream for location name...");
                    const model = 'gemini-2.5-flash';
                    const contents = [{
                        role: 'user',
                        parts: [
                            geminiFileDataPart,
                            { text: `This is an image for a background for a fighting video game. Please give me the name of the location as it could be in the video game. Give only the name nothing before, nothing after\nThe prompt was : "${userPrompt}"` },
                        ],
                    }];

                    const responseStream = await ai.models.generateContentStream({
                        model,
                        contents,
                    });

                    console.log("Processing location name stream...");
                    // Iterate directly over the responseStream
                    for await (const chunk of responseStream) {
                         const text = chunk.text;
                         if (text) {
                            concatenatedName += text;
                         }
                    }
                    
                    // Check if any text was received
                    if (!concatenatedName.trim()) {
                           console.warn("Gemini location name stream was empty.");
                            // Aggregated response might not be available easily after consuming stream
                           throw new Error("Gemini returned an empty location name from stream.");
                    }

                    const finalName = concatenatedName.trim();
                    console.log("Received location name from Gemini:", finalName);
                    return finalName;

                } catch (err) {
                    console.error("Gemini location name stream generation failed:", err);
                    throw new Error("Failed to generate location name.");
                }
            })(),
        ]);

        floorTextureBuffer = floorResult;
        locationName = nameResult;
        // --- End of Gemini operations ---
        
        // Check results before proceeding
        if (!locationId || !backgroundR2Url || !floorTextureBuffer || !locationName) {
             throw new Error("Missing required data after generation steps.");
        }

        // === 7. Upload Floor Texture to R2 ===
        const floorKey = `locations/${locationId}/floor.jpg`;
        console.log("Uploading floor texture to R2:", floorKey);
        await S3.send(new PutObjectCommand({ 
            Bucket: R2_BUCKET, 
            Key: floorKey,
            Body: floorTextureBuffer,
            ContentType: mime.getType(floorKey) || 'image/jpeg',
        }));
        floorR2Url = process.env.R2_PUBLIC_URL ? `${process.env.R2_PUBLIC_URL}/${floorKey}` : null;
        if (!floorR2Url) console.warn("R2_PUBLIC_URL not set, cannot construct public URL for floor.");
        console.log("Floor Texture R2 URL:", floorR2Url);

        if (!floorR2Url) throw new Error("Failed to construct floor texture R2 URL.");

        // === 8. Save to Supabase ===
        console.log("Saving location data to Supabase...");
        const { data: dbData, error: dbError } = await supabaseAdmin // Use imported admin client
            .from('locations')
            .insert({
                id: locationId,
                name: locationName,
                user_prompt: userPrompt,
                background_image_url: backgroundR2Url,
                floor_texture_url: floorR2Url,
            })
            .select()
            .single();

        if (dbError) {
            console.error("Supabase insert error:", dbError);
            throw new Error(`Failed to save location to database: ${dbError.message}`);
        }
        console.log("Successfully saved location to Supabase:", dbData?.id);

        // === 9. Return Response ===
        // Return the main background URL and the new location ID
        return NextResponse.json({ locationImageUrl: backgroundR2Url, locationId: locationId }, { status: 200 });

    } catch (error: any) {
        console.error('[API generate-location Error]:', error);
        return NextResponse.json({ error: error.message || 'Failed to process location generation.' }, { status: 500 });
    } finally {
        // === Cleanup Temporary File ===
        if (tempFilePath) {
            console.log("Cleaning up temporary file:", tempFilePath);
            try {
                await fs.unlink(tempFilePath);
            } catch (cleanupError) {
                console.error("Failed to delete temporary file:", cleanupError);
            }
        }
        // Optionally delete the uploaded file from Google AI Files if not needed anymore
        // if (uploadedFile?.uri) { ... ai.files.delete(uploadedFile.name) ... } 
    }
}

// Note: This code assumes Gemini 1.5 Flash supports direct image data input (inlineData).
// If using ai.files.upload is necessary, the logic for preparing geminiFileDataPart and managing
// the uploaded file URI would need adjustment based on the @google/genai SDK specifics.
// Also, the exact model name for image generation might need updating based on availability ('gemini-2.0-flash-exp-image-generation' vs 'gemini-1.5-flash-latest').
// Basic safety settings are added for Gemini, adjust as needed. 