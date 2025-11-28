
# Vibe Fighter

![Vibe Fighter](/public/images/vibefighter-logo.png)

## About

Vibe Fighter is a lously Street Fighter/Mortal Kombat influenced game of one on one fighting platform, but every character and every scene can be AI generated on the fly, with any style.
Vibe Figther was 100% vibe coded with threeJS on Cursor. A human was only here to write prompts and click accept :)

## Game play

### Generate characters



### Random AI opponent from generated characters of your making

### Generate battle scenes backgrounds


### Fight! Each character has a special power auto generated!

Fight commands :
- move: left/Right
- jump: space
- block: b
- duck: down
- special power: shift+space




## Getting Started

The is using multiple AIs:
- Replicate for character and background generation, using your the FLUX LoRa of choice
- Tripo3D for 3D models generation of the character and rigging --> top up and free credits on [Tripo3D API](https://platform.tripo3d.ai/)
- Gemini 2.5 flash for text generation and some images creation (Nano Banana for special powers/floor design based on background)
- Fish Audio for name audio generation

Database is based on Supabase and file storage with CloudFlare R2

Use exemple.env to populate your different keys and options. 

Music were generated with Suno and sounds with elevenLabs

### Supabase structure

Supabase schema is in /supabase
Do not forget to activate public access read


### R2

Do not forget for Cloudfare R2 to open CORS options

### LoRa

You can use any FLUX LoRa of your choice which is linkable to Replicate (Replicate, CivitAI, HuggingFace, or any hosted tensorfile) or no LoRa. If a key is required (CivitAI especially) do not forget to add it to the link

Default is [N64/PS1 LoRa](https://civitai.com/models/660136) on CivitAI

Examples using other LoRas :

- [Ghibli style LoRa](https://civitai.com/models/433138/ghibli-style-flux-and-pdxl?modelVersionId=755852)

![ghibli 1](/readme/ghibli1.jpg)

![ghibli 2](/readme/ghibli2.jpg)


- [Retro Pop](https://civitai.com/models/626444/retro-pop-ce?modelVersionId=797127)

![pop 1](/readme/pop1.jpg)

![pop 2](/readme/pop2.jpg)


### Run

Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

**To be able to make a fight you will need to create at least 2 users**

## Known issues & best practices

- It's just a concept so many issues can be found
- When creating a character, the best 3D output would be a full front facing character with hands and legs not too close to the body or to each other
- AI fighter is not the best
- Animations are threeJS hand made so not the best
- No control on special attacks meaning some can be badly drawn 