import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import Replicate from 'replicate';
import { supabaseAdmin } from '@/lib/supabase/admin';
import mime from 'mime';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises'; // Use fs.promises for async operations
import os from 'os';
import path from 'path';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"; // <-- Import S3

// --- Environment Variable Checks ---
if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
if (!process.env.REPLICATE_API_TOKEN) throw new Error("Missing REPLICATE_API_TOKEN");
if (!process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
if (!process.env.R2_ACCESS_KEY_ID) throw new Error("Missing R2_ACCESS_KEY_ID");
if (!process.env.R2_SECRET_ACCESS_KEY) throw new Error("Missing R2_SECRET_ACCESS_KEY");
if (!process.env.R2_BUCKET_NAME) throw new Error("Missing R2_BUCKET_NAME");
// Supabase checked in admin import

// Initialize clients
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
});

// --- Configure S3 Client for R2 ---
const R2_BUCKET = process.env.R2_BUCKET_NAME!;
const R2_ENDPOINT = `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL; // Optional: For constructing public URLs
const S3 = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

// Type for the uploaded file object from ai.files.upload
interface UploadedFile {
    name: string; // Usually in projects/{project}/files/{file_id} format
    uri: string;
    mimeType: string;
    // Add other potential properties if needed based on SDK docs
}

// --- Helper Functions ---

// Helper: Save buffer to temp file and upload to Google AI
async function uploadFileToGoogleAI(buffer: Buffer, originalMimeType: string): Promise<{ uploadedFile: UploadedFile; tempPath: string }> {
    const fileExtension = mime.getExtension(originalMimeType) || 'tmp';
    const tempFileName = `vibefighter-special-${uuidv4()}.${fileExtension}`;
    const tempPath = path.join(os.tmpdir(), tempFileName);

    console.log(`Writing buffer to temporary file: ${tempPath}`);
    await fs.writeFile(tempPath, buffer);

    console.log(`Uploading temporary file (${tempPath}) to Google AI Files...`);
    try {
        // Use ai.files.upload (from @google/genai)
        const uploadedFile = await genAI.files.upload({ file: tempPath });

        if (!uploadedFile || !uploadedFile.name || !uploadedFile.uri || !uploadedFile.mimeType) {
            console.error("Google AI Upload Response:", uploadedFile);
            throw new Error("Failed to upload file to Google AI or received invalid response structure.");
        }
         console.log(`Uploaded ${tempPath} to Google AI: Name=${uploadedFile.name}, URI=${uploadedFile.uri}, MimeType=${uploadedFile.mimeType}`);
        // Cast to our defined interface
        return { uploadedFile: uploadedFile as UploadedFile, tempPath };
    } catch (uploadError) {
        console.error(`Error uploading ${tempPath} to Google AI:`, uploadError);
        // Attempt cleanup even if upload fails
        try {
            await fs.unlink(tempPath);
        } catch (unlinkError) {
            console.error(`Failed to clean up temp file ${tempPath} after upload error:`, unlinkError);
        }
        throw uploadError; // Re-throw the original error
    }
}

// Helper: Delete Google AI File (Best Effort)
async function deleteGoogleAIFile(fileName: string | undefined) {
    if (!fileName) return;
    try {
        console.log(`Deleting Google AI file: ${fileName}`);
        // Use ai.files.delete (from @google/genai)
        await genAI.files.delete({ name: fileName });
        console.log(`Successfully deleted Google AI file: ${fileName}`);
    } catch (error) {
        console.error(`Failed to delete Google AI file ${fileName}:`, error);
        // Log error but don't fail the overall process
    }
}

// Helper: Fetch image and upload (used for initial concept image)
async function fetchAndUploadImage(url: string): Promise<{ uploadedFile: UploadedFile; tempPath: string }> {
    console.log(`Fetching image from URL: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image ${url}: ${response.statusText}`);
    }
    const mimeType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`Fetched ${buffer.length} bytes, mimeType: ${mimeType}`);
    return uploadFileToGoogleAI(buffer, mimeType);
}


// Helper: Generate Prompt (Step 1 - Updated)
async function generateSpecialPrompt(uploadedConceptFile: UploadedFile): Promise<string> {
    console.log("Generating special power prompt using model gemini-2.5-flash...");
    // Use exact model and config from user example 1
    const model = 'gemini-2.5-flash';
    const config = {
        responseMimeType: 'text/plain',
        // Ensure thinkingConfig matches user example if needed
        // thinkingConfig: { thinkingBudget: 0 } // Add if required by example/docs
    };
    const contents = [{
        role: 'user',
        parts: [
            {
                text: `You are creating a prompt to generate an asset for a special power in a fight game, for this character in the image.
The prompt should have exactly this structure
"Create an image of full view of a fire ball as a game asset for a 90s fight game which will be a special power of one of the characters, make sure the movement is going from left to right, white background."
Examples of items are for example fire ball, an fire blad, an ice pick, dager, tornado, an animal, an object, or any other type of thing that will be thrown, whatever you think suits this specific character in the game, as it will be his special power, and should be really cool with this character
ONLY answer with the prompt, nothing before or after`,
            },
            {
                fileData: {
                    fileUri: uploadedConceptFile.uri,
                    mimeType: uploadedConceptFile.mimeType,
                }
            }
        ],
    }];

    let generatedPrompt = "";
    try {
        // Use ai.models.generateContentStream (from @google/genai)
        const responseStream = await genAI.models.generateContentStream({ model, config, contents });
        for await (const chunk of responseStream) {
            // Directly access text as per user example 1
            if (chunk?.text) {
                generatedPrompt += chunk.text;
            }
        }
    } catch (error) {
        console.error("Error generating special prompt stream:", error);
        throw new Error("Failed to generate special prompt from Gemini.");
    }


    if (!generatedPrompt.trim()) {
        throw new Error("Gemini returned an empty prompt.");
    }
    console.log('Generated Prompt:', generatedPrompt.trim());
    return generatedPrompt.trim();
}

// Helper: Generate Image (Step 2 - Updated)
async function generateSpecialImage(prompt: string): Promise<{ buffer: Buffer; mimeType: string }> {
    console.log("Generating special power image using model gemini-2.5 flash image...");
    // Use exact model and config from user example 2
    const model = 'gemini-2.5-flash-image';
    const config = {
        responseModalities: ['image'],
        responseMimeType: 'text/plain', // Expecting inlineData within text/plain response
        imageConfig: {"aspectRatio": "1:1"}
    };
    const contents = [{
        role: 'user',
        parts: [{ text: prompt }],
    }];

    let imageBuffer: Buffer | null = null;
    let imageMimeType: string | null = null;

    try {
        // Use ai.models.generateContentStream (from @google/genai)
        const responseStream = await genAI.models.generateContentStream({ model, config, contents });
        for await (const chunk of responseStream) {
            // Process stream exactly as in user example 2
            const part = chunk.candidates?.[0]?.content?.parts?.[0];
            if (part?.inlineData?.data) {
                 console.log("Received image inlineData chunk.");
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
                imageMimeType = part.inlineData.mimeType || 'image/png'; // Default or detect
                break; // Found the image data
            } else if (chunk?.text) {
                console.log("Received text chunk during image generation:", chunk.text);
            }
        }
    } catch (error) {
        console.error("Error generating special image stream:", error);
        throw new Error("Failed to generate special image from Gemini.");
    }

    if (!imageBuffer || !imageMimeType) {
        throw new Error("Gemini stream did not return valid image data.");
    }
    console.log(`Generated Image: ${imageBuffer.length} bytes, MIME: ${imageMimeType}`);
    return { buffer: imageBuffer, mimeType: imageMimeType };
}


// Helper: Check Direction (Step 3 - Updated)
async function checkImageDirection(uploadedImageFile: UploadedFile): Promise<string> {
    console.log("Checking image direction using model gemini-2.5-flash");
    // Use exact model and config from user example 3
    const model = 'gemini-2.5-flash';
    const config = {
        responseMimeType: 'text/plain',
        // thinkingConfig: { thinkingBudget: 0 } // Add if required by example/docs
    };
    const contents = [{
        role: 'user',
        parts: [
            {
                text: `is this game asset is doing a movement going from the left to the right?
Only answer "YES" or "NO" if it's going from right to left, or "NA" of it's not applicable to the image`,
            },
            {
                fileData: {
                    fileUri: uploadedImageFile.uri,
                    mimeType: uploadedImageFile.mimeType,
                }
            }
        ],
    }];

    let directionResult = "";
    try {
        // Use ai.models.generateContentStream (from @google/genai)
        const responseStream = await genAI.models.generateContentStream({ model, config, contents });
        for await (const chunk of responseStream) {
             if (chunk?.text) {
                directionResult += chunk.text;
            }
        }
    } catch (error) {
        console.error("Error checking image direction stream:", error);
        throw new Error("Failed to check image direction with Gemini.");
    }


    const finalDirection = directionResult.trim().toUpperCase();
    console.log('Direction Check Result:', finalDirection);

    if (!["YES", "NO", "NA"].includes(finalDirection)) {
        console.warn(`Unexpected direction check response: ${finalDirection}. Assuming NA.`);
        return "NA";
    }
    return finalDirection;
}

// Helper: Reverse Image (Step 3A - Updated)
async function reverseImage(uploadedOriginalImageFile: UploadedFile): Promise<{ buffer: Buffer; mimeType: string }> {
    console.log("Reversing image using model gemini-2.5-flash image generation...");
     // Use exact model and config from user example 3A
    const model = 'gemini-2.5-flash-image';
    const config = {
        responseModalities: ['text'],
        responseMimeType: 'text/plain', // Expecting inlineData within text/plain response
    };
    const contents = [{
        role: 'user',
        parts: [
            {
                fileData: { // Pass the uploaded file data
                    fileUri: uploadedOriginalImageFile.uri,
                    mimeType: uploadedOriginalImageFile.mimeType,
                }
            },
            { text: `reverse this image` }
        ],
    }];

    let reversedImageBuffer: Buffer | null = null;
    let reversedImageMimeType: string | null = null;

    try {
        // Use ai.models.generateContentStream (from @google/genai)
        const responseStream = await genAI.models.generateContentStream({ model, config, contents });
        for await (const chunk of responseStream) {
            // Process stream exactly as in user example 3A
             const part = chunk.candidates?.[0]?.content?.parts?.[0];
            if (part?.inlineData?.data) {
                 console.log("Received reversed image inlineData chunk.");
                reversedImageBuffer = Buffer.from(part.inlineData.data, 'base64');
                reversedImageMimeType = part.inlineData.mimeType || uploadedOriginalImageFile.mimeType; // Use original mime if not provided
                break; // Found the image data
            } else if (chunk?.text) {
                console.log("Received text chunk during image reversal:", chunk.text);
            }
        }
    } catch (error) {
        console.error("Error reversing image stream:", error);
        throw new Error("Failed to reverse image with Gemini.");
    }

    if (!reversedImageBuffer || !reversedImageMimeType) {
        throw new Error("Gemini stream did not return valid reversed image data.");
    }
    console.log(`Reversed Image: ${reversedImageBuffer.length} bytes, MIME: ${reversedImageMimeType}`);
    return { buffer: reversedImageBuffer, mimeType: reversedImageMimeType };
}

// Define the expected output structure (FileOutput has a url() method)
interface ReplicateFileOutput {
    url: () => { href: string } | string; // Returns object with href or string directly
}

// Helper: Remove Background (Step 4 - Uses Bria model via replicate.run)
async function removeImageBackground(imageBuffer: Buffer, mimeType: string): Promise<string> {
    // Convert buffer to base64 data URI for Replicate
    const base64Data = imageBuffer.toString('base64');
    const dataUri = `data:${mimeType};base64,${base64Data}`;
    const input = { image: dataUri };

    console.log(`Running Bria background removal via Replicate...`);

    try {
        // Use replicate.run() with Bria model
        const output: unknown = await replicate.run("bria/remove-background", { input });

        // Debug: Log the output structure
        console.log('Replicate output type:', typeof output);
        console.log('Replicate output is array:', Array.isArray(output));

        let imageUrl: string | null = null;

        // Handle array output (like other Replicate models)
        if (Array.isArray(output) && output.length > 0) {
            const firstItem = output[0];
            if (typeof firstItem === 'object' && firstItem !== null && typeof (firstItem as ReplicateFileOutput).url === 'function') {
                try {
                    const urlResult = (firstItem as ReplicateFileOutput).url();
                    // Check if url() returns an object with href property
                    if (typeof urlResult === 'object' && urlResult !== null && typeof (urlResult as any).href === 'string') {
                        imageUrl = (urlResult as any).href;
                    } else if (typeof urlResult === 'string') {
                        imageUrl = urlResult;
                    }
                } catch (e) {
                    console.error("Error calling Replicate .url():", e);
                }
            }
        }
        // Handle single object output
        else if (typeof output === 'object' && output !== null && typeof (output as ReplicateFileOutput).url === 'function') {
            try {
                const urlResult = (output as ReplicateFileOutput).url();
                // Check if url() returns an object with href property
                if (typeof urlResult === 'object' && urlResult !== null && typeof (urlResult as any).href === 'string') {
                    imageUrl = (urlResult as any).href;
                } else if (typeof urlResult === 'string') {
                    imageUrl = urlResult;
                }
            } catch (e) {
                console.error("Error calling Replicate .url():", e);
            }
        }
        // Handle direct string output
        else if (typeof output === 'string') {
            imageUrl = output;
        }

        if (!imageUrl || typeof imageUrl !== 'string') {
            console.error("Invalid image URL from Replicate. Output structure:", output);
            throw new Error("Could not get valid URL from Replicate output.");
        }

        console.log('Background removed image URL:', imageUrl);
        return imageUrl;

    } catch (error: any) {
        console.error("Error during Replicate background removal process:", error);
        throw new Error(`Background removal failed: ${error.message || 'Unknown error during process'}`);
    }
}


// --- Main POST Handler ---
export async function POST(request: NextRequest) {
  const supabase = supabaseAdmin;
  let requestBody;
  try {
    requestBody = await request.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { characterId, conceptImageUrl, conceptImageMimeType } = requestBody; // MimeType from request isn't strictly needed now as we fetch

  if (!characterId || !conceptImageUrl ) {
    return NextResponse.json({ error: 'Missing characterId or conceptImageUrl' }, { status: 400 });
  }

  console.log(`Starting special power generation for character: ${characterId}`);

  let conceptTempPath: string | undefined;
  let conceptUploadedFile: UploadedFile | undefined;
  let imageTempPath: string | undefined;
  let imageUploadedFile: UploadedFile | undefined;
  let finalR2Url: string | null = null; // Variable to store the final R2 URL

  try {
    // 0. Fetch concept image & upload to Google AI
    const conceptUploadResult = await fetchAndUploadImage(conceptImageUrl);
    conceptTempPath = conceptUploadResult.tempPath;
    conceptUploadedFile = conceptUploadResult.uploadedFile;

    // 1. Generate Prompt using uploaded concept image file
    const specialPrompt = await generateSpecialPrompt(conceptUploadedFile);

    // 2. Generate Initial Image using prompt
    const originalImage = await generateSpecialImage(specialPrompt);
    let finalImage = originalImage; // Assume original is final unless reversed

    // 3. Upload generated image to Google AI for direction check/reversal
    const imageUploadResult = await uploadFileToGoogleAI(originalImage.buffer, originalImage.mimeType);
    imageTempPath = imageUploadResult.tempPath;
    imageUploadedFile = imageUploadResult.uploadedFile;

    // 4. Check Direction using uploaded generated image file
    const direction = await checkImageDirection(imageUploadedFile);

    // 5. Reverse Image if needed (using the same uploaded file)
    if (direction === 'NO') {
      console.log('Reversing image direction...');
      // Pass the *uploaded file info* of the original generated image
      const reversedImage = await reverseImage(imageUploadedFile);
      finalImage = reversedImage; // Update final image to the reversed one
    }

    // 6. Remove Background from the final image (original or reversed)
    const replicateImageUrl = await removeImageBackground(finalImage.buffer, finalImage.mimeType);
    console.log(`Got temporary Replicate URL: ${replicateImageUrl}`);

    // 6a. Fetch image from Replicate URL and upload to R2
    console.log(`[Char ${characterId}] Fetching final special power image from Replicate: ${replicateImageUrl}`);
    const finalImageResponse = await fetch(replicateImageUrl);
    if (!finalImageResponse.ok) {
        throw new Error(`Failed to fetch final special power image from Replicate: ${finalImageResponse.statusText}`);
    }
    const finalImageContentType = finalImageResponse.headers.get('content-type') || 'image/png'; // Default to png if not specified
    const finalImageBuffer = Buffer.from(await finalImageResponse.arrayBuffer());
    const finalImageExtension = mime.getExtension(finalImageContentType) || 'png';

    const r2Key = `characters/${characterId}/special_power.${finalImageExtension}`;
    console.log(`[Char ${characterId}] Uploading final special power image to R2: ${R2_BUCKET}/${r2Key}`);
    await S3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: finalImageBuffer,
        ContentType: finalImageContentType,
    }));
    // Construct public URL if base URL is configured, otherwise use key (or handle as needed)
    finalR2Url = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${r2Key}` : r2Key; 
    console.log(`[Char ${characterId}] Final special power image uploaded to R2: ${finalR2Url}`);

    // 7. Save final R2 URL and prompt to Supabase
    console.log(`Saving final special image R2 URL (${finalR2Url}) and prompt to Supabase for character ${characterId}`);
    const { error: updateError } = await supabaseAdmin
      .from('characters')
      .update({
        special_prompt: specialPrompt,
        special_image: finalR2Url, // <-- Save the R2 URL here
       })
      .eq('id', characterId);

    if (updateError) {
      console.error('Supabase update error:', updateError);
       return NextResponse.json({ error: `Failed to update character in DB: ${updateError.message}` }, { status: 500 });
    }

    console.log(`Successfully generated and saved special power for character: ${characterId}`);
    return NextResponse.json({
        message: 'Special power generated successfully',
        specialImageUrl: finalR2Url, // <-- Return the R2 URL
        specialPrompt: specialPrompt
    });

  } catch (error: any) {
    console.error('Error generating special power:', error);
    // Attempt to update status in Supabase maybe?
    return NextResponse.json({ error: error.message || 'Failed to generate special power asset' }, { status: 500 });
  } finally {
    // Cleanup Temporary Files
    if (conceptTempPath) {
        fs.unlink(conceptTempPath).catch(e => console.error(`Failed cleanup: ${conceptTempPath}`, e));
    }
    if (imageTempPath) {
        fs.unlink(imageTempPath).catch(e => console.error(`Failed cleanup: ${imageTempPath}`, e));
    }
    // Cleanup Google AI Files (Best Effort)
    await deleteGoogleAIFile(conceptUploadedFile?.name);
    await deleteGoogleAIFile(imageUploadedFile?.name);
  }
} 