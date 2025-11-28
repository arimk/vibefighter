import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from 'uuid'; // Although ID comes from client, might be needed
import { createClient } from '@supabase/supabase-js';

// --- Environment Variable Checks ---
if (!process.env.TRIPO_API_KEY) throw new Error("Missing TRIPO_API_KEY");
if (!process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
if (!process.env.R2_ACCESS_KEY_ID) throw new Error("Missing R2_ACCESS_KEY_ID");
if (!process.env.R2_SECRET_ACCESS_KEY) throw new Error("Missing R2_SECRET_ACCESS_KEY");
if (!process.env.R2_BUCKET_NAME) throw new Error("Missing R2_BUCKET_NAME");
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const TRIPO_API_KEY = process.env.TRIPO_API_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_ENDPOINT = `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// --- Configure S3 Client for R2 --- 
const S3 = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

// --- Supabase Service Client --- 
// Use Service Role Key for server-side admin actions (inserts/updates bypass RLS)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } } // Don't need sessions for service role
);

// --- Tripo3D API Functions --- 

// Uploads image data (Buffer) to Tripo and returns image_token
async function uploadToTripo(imageData: Buffer, contentType: string): Promise<string> {
    const url = "https://api.tripo3d.ai/v2/openapi/upload";
    const formData = new FormData();
		// Create a Blob from a Uint8Array copy of the Buffer to satisfy TS BlobPart types
		const imageBlob = new Blob([new Uint8Array(imageData)], { type: contentType });
    formData.append('file', imageBlob, 'character_concept.jpg'); // Filename is arbitrary here

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${TRIPO_API_KEY}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Tripo Upload Error Status:", response.status, response.statusText);
        console.error("Tripo Upload Error Body:", errorText);
        throw new Error(`Error uploading image to Tripo3D: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    if (data.code !== 0 || !data.data?.image_token) {
        console.error("Invalid Tripo Upload Response:", data);
        throw new Error("Failed to get image_token from Tripo3D upload.");
    }
    console.log("Tripo Upload Success, Token:", data.data.image_token);
    return data.data.image_token;
}

// Creates an image-to-model task on Tripo and returns task_id
async function createTripoTask(imageToken: string): Promise<string> {
    const url = 'https://api.tripo3d.ai/v2/openapi/task';
    const payload = {
        //model_version: "Turbo-v1.0-20250506",
        type: 'image_to_model',
        file: {
            type: 'jpg', // Assuming jpg based on Replicate output format
            file_token: imageToken
        },
        // Add other options if needed (e.g., texture: true, pbr: true)
        texture: true, 
        pbr: true,
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TRIPO_API_KEY}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Tripo Task Creation Error Status:", response.status, response.statusText);
        console.error("Tripo Task Creation Error Body:", errorText);
        throw new Error(`Error creating Tripo3D task: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    if (data.code !== 0 || !data.data?.task_id) {
        console.error("Invalid Tripo Task Creation Response:", data);
        throw new Error("Failed to get task_id from Tripo3D task creation.");
    }
    console.log("Tripo Task Created, ID:", data.data.task_id);
    return data.data.task_id;
}


// --- API Route Handler --- 

interface RequestBody {
    characterId: string;
    imageUrl: string; // Only need image URL and ID initially
    // characterName: string; // Name will be saved later
    prompt?: string; // Pass prompt if available
}

export async function POST(req: NextRequest) {
    let requestBody: RequestBody;
    try {
        requestBody = await req.json();
    } catch (error) {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { characterId, imageUrl, prompt } = requestBody;
    if (!characterId || !imageUrl) {
        return NextResponse.json({ error: 'Missing required fields (characterId, imageUrl)' }, { status: 400 });
    }

    console.log(`INITIATING Character ID: ${characterId}`);

    let r2ImageUrl = ``; // To store the R2 URL
    let tripoModelTaskId = ``;

    try {
        // 1. Fetch Image & Upload to R2 (as before)
        console.log(`Fetching concept image: ${imageUrl}`);
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const fileExtension = contentType.split('/')[1] || 'jpg';
        const r2Key = `characters/${characterId}/image.${fileExtension}`; // Fixed filename
        console.log(`Uploading concept image to R2: ${R2_BUCKET}/${r2Key}`);
        await S3.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: imageBuffer,
            ContentType: contentType,
        }));
        r2ImageUrl = process.env.R2_PUBLIC_URL ? `${process.env.R2_PUBLIC_URL}/${r2Key}` : ``; // Construct public URL
        console.log(`Concept image uploaded to R2: ${r2ImageUrl || r2Key}`);

        // 2. Create Initial Character Record in Supabase
        console.log(`Creating initial record for character ${characterId} in Supabase...`);
        const { data: insertData, error: insertError } = await supabaseAdmin
            .from('characters') 
            .insert({ 
                id: characterId,
                prompt: prompt, // Save the original prompt if available
                concept_image_url: r2ImageUrl || r2Key, // Store R2 URL or key
                status: 'modeling' // Set initial status
             })
            .select('id') // Select something to confirm insertion
            .single(); // Expect single row

        if (insertError) {
            console.error("Supabase insert error:", insertError);
            throw new Error(`Failed to create character record: ${insertError.message}`);
        }
        console.log("Supabase record created:", insertData);

        // 3. Upload image to Tripo3D
        const tripoImageToken = await uploadToTripo(imageBuffer, contentType);

        // 4. Create Tripo3D image-to-model task
        tripoModelTaskId = await createTripoTask(tripoImageToken);

        // 5. Update Character Record with Model Task ID
        console.log(`Updating character ${characterId} with model task ID ${tripoModelTaskId}...`);
        const { error: updateError } = await supabaseAdmin
            .from('characters')
            .update({ tripo_model_task_id: tripoModelTaskId })
            .eq('id', characterId);

        if (updateError) {
            console.error("Supabase update error (model task ID):", updateError);
            // Log error but maybe don't fail the whole process?
        }

        // 6. Trigger Special Power Generation (Non-blocking)
        console.log(`Triggering special power generation for character ${characterId} in background...`);
        fetch(`${req.nextUrl.origin}/api/create-special-power`, { // Use origin for correct absolute URL
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                characterId: characterId, 
                conceptImageUrl: r2ImageUrl, // Pass the R2 URL 
                conceptImageMimeType: contentType // Pass the detected content type
            }),
        }).catch(err => {
            // Log error but don't block the main response
            console.error(`Failed to trigger special power generation for ${characterId}:`, err);
        });

        // 7. Return success and the Tripo Task ID (Renumbered from 6)
        return NextResponse.json({ 
            message: "Character modeling initiated.", 
            characterId: characterId,
            taskId: tripoModelTaskId, 
            conceptImageUrl: r2ImageUrl || r2Key // Return R2 URL or key
        }, { status: 200 });

    } catch (error: any) {
        console.error(`Error initiating character ${characterId}:`, error);
        // Attempt to update status to 'failed' in Supabase if possible
        if (characterId) {
            await supabaseAdmin.from('characters').update({ status: 'failed' }).eq('id', characterId);
        }
        return NextResponse.json({ error: error.message || 'Failed to initiate character creation' }, { status: 500 });
    }
} 