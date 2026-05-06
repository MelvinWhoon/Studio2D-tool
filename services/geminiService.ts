
import { GoogleGenAI, GenerateContentResponse, Part, Type } from "@google/genai";
import { FurnitureChoice, ChatMessage } from "../types";

const MODEL_NAME_VISUALIZER = 'gemini-2.5-flash-image'; 
const MODEL_NAME_MOODBOARD = 'gemini-2.5-flash-image';

export const analyzeFloorPlan = async (base64Image: string): Promise<{description: string, items: FurnitureChoice[]}> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } },
        { text: "Analyseer deze plattegrond zorgvuldig. Geef een korte, professionele beschrijving van de ruimte (max 3 zinnen, in het Nederlands). Detecteer daarnaast alle zichtbare meubels. Geef een JSON-object terug met 'description' (string) en 'items' (array van objecten met 'id' en 'type'). Als er bijvoorbeeld 4 stoelen zijn, geef dan 4 aparte objecten terug in de items array met elk een uniek ID." }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                type: { type: Type.STRING }
              },
              required: ["id", "type"]
            }
          }
        },
        required: ["description", "items"]
      }
    }
  });
  
  const result = JSON.parse(response.text || '{"description": "Geen beschrijving kunnen genereren.", "items": []}');
  return {
    description: result.description,
    items: result.items.map((item: any) => ({
      ...item,
      skip: false
    }))
  };
};

export const visualizeFloorPlan = async (
  base64Image: string,
  userPrompt: string,
  moodboardContextImage?: string | null,
  furnitureChoices?: FurnitureChoice[],
  chatHistory?: ChatMessage[],
  annotationImage?: string | null,
  floorPlanDescription?: string | null,
  mode: '2D' | '2.5D' = '2D'
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const floorPlanPart: Part = {
    inlineData: {
      mimeType: 'image/png',
      data: base64Image.split(',')[1],
    },
  };

  const parts: Part[] = [floorPlanPart];

  if (moodboardContextImage) {
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: moodboardContextImage.split(',')[1],
      },
    });
  }

  if (annotationImage) {
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: annotationImage.split(',')[1],
      },
    });
  }

  // Add reference images from furniture choices
  if (furnitureChoices) {
    furnitureChoices.forEach(c => {
      if (c.referenceImage && !c.skip) {
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: c.referenceImage.split(',')[1],
          },
        });
      }
    });
  }

  const systemInstruction2D = `
ROLE:
You are a strict pixel-preserving 2D blueprint colorization processor.

PRIMARY OBJECTIVE:
You must transform ONLY the surface appearance of the FIRST IMAGE.
You must preserve the FIRST IMAGE with exact geometric fidelity.
The FIRST IMAGE is the master document and absolute ground truth.

ZERO-TOLERANCE OUTPUT CONTRACT:
The output must be the exact same blueprint as image 1, with only material and color applied inside already existing enclosed regions.

HIGHEST PRIORITY RULE:
IMAGE 1 IS LOCKED.
You are not generating a new floor plan.
You are not redesigning a space.
You are not interpreting a drawing.
You are not rendering a variation.
You are only coloring the already existing drawing.

MANDATORY PIXEL-FAITHFUL CONSTRAINTS:
- Keep the exact same canvas ratio.
- Keep the exact same framing.
- Keep the exact same orientation.
- Keep the exact same room shapes.
- Keep the exact same wall positions.
- Keep the exact same door swings.
- Keep the exact same window positions.
- Keep the exact same furniture outlines.
- Keep the exact same dimensions.
- Keep the exact same labels and technical annotations.
- Keep the exact same line positions.
- Keep the exact same scale.
- Keep all technical information readable and untouched.

FORBIDDEN ACTIONS:
You must never:
- move anything
- resize anything
- rotate anything
- crop anything
- zoom anything
- redraw anything
- restyle linework
- replace furniture
- add furniture
- remove furniture
- simplify shapes
- infer missing geometry
- clean up the plan
- enhance the architecture
- convert to 3D
- add perspective
- add decorative objects
- add shadows outside existing filled regions
- hide dimensions
- paint over measurement text
- alter symbols
- alter room boundaries
- alter wall thickness
- alter openings
- alter line sharpness
- invent new surfaces

THIS IS A CONSERVATION TASK, NOT A GENERATION TASK.
Think of the first image as a locked technical overlay that must survive unchanged.

LINEWORK PROTECTION:
All black, gray, or technical linework from image 1 must remain perfectly visible, sharp, and in exactly the same location.
Never thicken, soften, blur, repaint, erase, or partially cover linework.
Never cover dimension strings, numbers, symbols, arrows, labels, or annotations.

GEOMETRY LOCK:
Every closed contour in image 1 must remain identical.
Every object footprint in image 1 must remain identical.
Every furniture footprint in image 1 must remain identical.
Every negative space and gap must remain identical.

FURNITURE LOCK:
If furniture exists in image 1:
- keep the exact footprint
- keep the exact outline
- keep the exact position
- keep the exact angle
- keep the exact size
- only apply color or texture inside the already existing furniture shape

If furniture does not exist in image 1:
- do not create it
- do not suggest it
- do not imply it
- do not add accessories around it

MATERIAL APPLICATION RULE:
Apply materials only within already existing enclosed interior regions.
If a moodboard is provided, use it as a source for:
- color palette
- texture family
- material mood
- floor finish
- wood tone
- fabric tone
- stone tone
If NO moodboard is provided, use realistic, neutral, and high-quality materials (e.g., light oak floors, white/light grey walls, neutral fabrics).

The moodboard must never change layout or geometry.
The moodboard influences appearance only, never structure.

ANNOTATION RULE:
If an annotation image is present, only apply the requested appearance change to the marked area.
Do not modify non-marked areas unless explicitly instructed.

TEXT AND DIMENSION PROTECTION:
All text, measurements, arrows, symbols, and technical notation in image 1 are protected.
They must remain fully visible, readable, and unchanged.

RENDER STYLE RULE:
Output must remain a flat top-down 2D technical plan.
No perspective.
No cinematic lighting.
No beautification.
No re-rendered architecture.
No stylized reinterpretation.
No atmospheric redesign.

ALLOWED CHANGES ONLY:
You may only:
- color floors
- texture floors
- color existing furniture shapes
- texture existing furniture shapes
- color existing enclosed surfaces
- match exact requested colors for specified furniture items
- match reference-image materials for specified furniture items

STRICT COLOR OBEY RULE:
If the user provides a specific color standard, it must be followed exactly.
Accepted standards include HEX, RGB, RAL, Pantone.
If a reference image is provided for a furniture item, copy the appearance from that reference while preserving the blueprint geometry exactly.

PRE-OUTPUT SELF-CHECK:
Before finalizing, verify all conditions below are true:
1. The blueprint layout is identical to image 1.
2. No object moved.
3. No object was added.
4. No object was removed.
5. No furniture shape changed.
6. No wall changed.
7. No annotation disappeared.
8. No dimension disappeared.
9. No text changed.
10. Only surface color and texture changed.

If any check fails, discard the attempt and produce a more conservative result.

FINAL EXECUTION RULE:
When uncertain, do less.
Preserve geometry over appearance.
Preserve linework over texture.
Preserve the blueprint exactly.

INPUT ORDER:
Image 1: Locked master blueprint. This is the only geometry source.
Image 2: Moodboard. Appearance reference only.
Image 3: Annotation image. Area targeting only.
Additional images: Furniture appearance references only.
`;

  const systemInstruction25D = `
ROLE:
You are a pixel-locked blueprint surface-rendering processor.

CORE FUNCTION:
Your task is to colorize and add a subtle top-down 2.5D depth effect to IMAGE 1 only.
You must preserve the exact original blueprint geometry, line placement, object placement, scale, and layout with zero deviation.

ABSOLUTE SOURCE OF TRUTH:
IMAGE 1 is the locked master blueprint.
IMAGE 1 defines all geometry.
IMAGE 1 defines all positions.
IMAGE 1 defines all outlines.
IMAGE 1 defines all room boundaries.
IMAGE 1 defines all walls, doors, windows, furniture, text, labels, and dimensions.
No other image may alter geometry in any way.

NON-NEGOTIABLE OUTPUT CONTRACT:
The output must be a surface-treated version of IMAGE 1 only.
It must remain the exact same top-down blueprint.
It must not become isometric.
It must not become perspective.
It must not become angled.
It must not become reinterpreted.
It must not become redesigned.
It must not become a newly generated floor plan.

LOCKED-GEOMETRY RULE:
Every visible element in IMAGE 1 is frozen in place.
You must not move, redraw, simplify, restyle, replace, enlarge, reduce, rotate, clean up, or reinterpret any object or line.
All footprints must remain exactly identical.
All contours must remain exactly identical.
All coordinates must remain exactly identical.
All wall thicknesses must remain visually aligned to the original.
All furniture outlines must remain exactly identical.
All door swings must remain exactly identical.
All window positions must remain exactly identical.
All text, dimensions, technical notes, and symbols must remain readable and untouched.

PIXEL-FAITHFUL REQUIREMENT:
Treat IMAGE 1 as locked geometry.
Apply appearance only, never structural change.
The output should be visually traceable back to IMAGE 1 with one-to-one correspondence.
No object may appear where no object exists in IMAGE 1.
No object may disappear if it exists in IMAGE 1.
No object may gain a different shape than in IMAGE 1.

ALLOWED OPERATIONS ONLY:
You may only do the following:
1. Add color fills strictly inside already existing enclosed regions.
2. Apply realistic material textures strictly inside existing boundaries.
3. Add subtle top-down 2.5D depth cues by using:
   - soft drop shadows
   - inner shadows
   - bevel-like highlights
   - subtle edge highlights
4. Apply these effects only to already drawn walls, cabinetry, furniture, fixtures, and architectural elements.
5. Keep all effects aligned to the original top-down orientation.

DEPTH RULE:
Depth must be simulated only through shading.
Depth must not be created through redraw or perspective transformation.
Use only minimal 2.5D treatment.
Preferred shadow direction is consistent and subtle, for example down-right.
Highlights must stay subtle and must not alter outlines.
Shadows must not obscure linework, labels, or dimensions.

MATERIAL RULE:
Apply materials only within the exact existing regions from IMAGE 1.
Examples:
- floors may receive wood, tile, stone, or neutral material fills
- walls may receive white or light neutral finishes
- furniture may receive neutral surface colors and subtle material cues
Do not let textures spill outside original boundaries.
Do not invent seams, joints, panels, handles, legs, cushions, or structure that are not already drawn.

REFERENCE IMAGE RULES:
- IMAGE 1: geometry source only and fully locked
- IMAGE 2: moodboard, appearance reference only
- IMAGE 3: annotation image, targeting guidance only
- Additional images: appearance reference only for surface style and color
No reference image besides IMAGE 1 may modify layout or shape.

STRICTLY FORBIDDEN ACTIONS:
You must never:
- change the camera angle
- generate an isometric view
- generate a perspective view
- tilt the plan
- crop the plan
- zoom in or out
- change canvas ratio
- change framing
- change orientation
- move any object
- resize any object
- rotate any object
- replace 2D furniture outlines with realistic 3D furniture
- replace drawn elements with renders or assets
- add decor
- add plants
- add rugs
- add lamps
- add chairs where there are none
- add objects in empty corners
- add kitchen styling
- add art, accessories, or people
- infer missing geometry
- repair, clean up, or redesign the plan
- modify room shapes
- modify wall shapes
- modify furniture shapes
- modify table shapes
- modify sofa shapes
- modify technical markings
- hide or overwrite dimensions or labels

EXPLICIT DUTCH LOCKS:
Niks veranderen aan ruimtes.
Niks veranderen aan elementen.
Niks veranderen aan deuren.
Niks veranderen aan ramen.
Niks veranderen aan tafels.
Niks veranderen aan planten.
Niks toevoegen.
Niks weghalen.
Niks verplaatsen.
Niks roteren.
Niks qua layout aanpassen.

SPECIAL NEGATIVE CONSTRAINTS:
Do not add a chair in the top left room.
Do not add a plant next to the kitchen island.
Do not add plants anywhere unless explicitly drawn in IMAGE 1.
Do not add chairs anywhere unless explicitly drawn in IMAGE 1.

TEXT AND TECHNICAL PRESERVATION RULE:
All original text must remain legible.
All dimensions must remain legible.
All symbols must remain legible.
All technical annotations must remain untouched.
Do not paint over text.
Do not hide dimension strings.
Do not stylize text.

FAIL CONDITIONS:
If any geometry changes, the output is invalid.
If any object is added, the output is invalid.
If any object is removed, the output is invalid.
If any outline changes shape, the output is invalid.
If the camera angle changes, the output is invalid.
If furniture becomes a newly interpreted 3D model, the output is invalid.
If readability of text or dimensions is reduced, the output is invalid.

DECISION RULE:
When in doubt, preserve the original and do less.
If an effect risks changing geometry, do not apply it.
Geometry preservation always overrides realism.
Blueprint fidelity always overrides aesthetics.

MANDATORY PRE-OUTPUT SELF-CHECK:
Confirm all of the following before finalizing:
1. The result is still strictly top-down.
2. IMAGE 1 geometry is unchanged.
3. All outlines and footprints match IMAGE 1 exactly.
4. No new objects were added.
5. No objects were removed.
6. No furniture was replaced with 3D assets.
7. No doors, windows, walls, rooms, or furniture were moved.
8. Text and dimensions remain readable and untouched.
9. Any depth effect comes only from subtle shading, not geometric reinterpretation.
10. The final image is a surface-rendered version of IMAGE 1, not a redesign.

FINAL EXECUTION RULE:
Preserve geometry over appearance.
Preserve the blueprint exactly.
Apply color and depth only within the locked original drawing.
When uncertain, do less.
`;

  const systemInstruction = mode === '2.5D' ? systemInstruction25D : systemInstruction2D;

  let choicesText = "";
if (furnitureChoices && furnitureChoices.length > 0) {
  choicesText =
    "\n\nLOCKED FURNITURE APPEARANCE INSTRUCTIONS:\n" +
    furnitureChoices
      .map((c) => {
        if (c.skip) {
          return `- ITEM ${c.id} | TYPE ${c.type} | ACTION: DO NOT MODIFY APPEARANCE`;
        }

        return [
          `- ITEM ${c.id} | TYPE ${c.type}`,
          `  ACTION: CHANGE APPEARANCE ONLY`,
          `  GEOMETRY: MUST STAY IDENTICAL TO IMAGE 1`,
          `  PRODUCT REFERENCE: ${c.product || "NONE"}`,
          `  EXACT COLOR TARGET: ${c.color || "NONE"}`,
          c.referenceImage
            ? `  REFERENCE IMAGE: PROVIDED, COPY MATERIAL/COLOR ONLY`
            : `  REFERENCE IMAGE: NONE`,
        ].join("\n");
      })
      .join("\n");
}

  let annotationText = "";
  if (annotationImage) {
    annotationText = "\n\nANNOTATIE CONTEXT: De gebruiker heeft een gebied omcirkeld in de bijgevoegde annotatie-afbeelding. Voer de gevraagde wijziging specifiek uit voor het gemarkeerde gebied.";
  }

  let chatContext = "";
  if (chatHistory && chatHistory.length > 0) {
    chatContext = "\n\nCHAT GESCHIEDENIS / VERFIJNING:\n" + chatHistory.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n');
  }

  let descriptionContext = "";
  if (floorPlanDescription) {
    descriptionContext = `\n\nFLOOR PLAN ANALYSIS:\n${floorPlanDescription}\nUse this context to better understand the space you are colorizing.`;
  }

  parts.push({
  text: `
${systemInstruction}
${descriptionContext}
${choicesText}
${annotationText}
${chatContext}

USER REQUEST:
${userPrompt}

CRITICAL REMINDER:
Return the SAME floor plan as image 1.
Do not generate a new version of the layout.
Do not reinterpret technical drawing elements.
Only recolor and retexture enclosed existing regions.
Blueprint geometry must remain exactly unchanged.
`
  });

  const response: GenerateContentResponse = await ai.models.generateContent({
    model: MODEL_NAME_VISUALIZER,
    contents: { parts },
  });

  if (!response.candidates?.[0]?.content?.parts) {
    throw new Error("De AI kon geen resultaat genereren. Controleer of de afbeeldingen duidelijk zijn.");
  }

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }

  throw new Error("De AI heeft geen visueel resultaat geretourneerd.");
};

export const generateDualMoodboards = async (
  inspirationImages: string[]
): Promise<string[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const imageParts: Part[] = inspirationImages.map(img => ({
    inlineData: {
      mimeType: 'image/png',
      data: img.split(',')[1],
    },
  }));

  const style1Prompt = `
GENERATE CONCEPT 1. MATERIAL PALETTE BOARD.
Style: Professional designer swatch presentation.
Content: A clean, flat-lay arrangement of material samples. Include only tactile textures: wood grains, fabric weaves, stone slabs, and solid paint swatches.
Presentation: Use geometric shapes (circles, rectangles, organic blobs) for the swatches.
Background: Solid neutral studio background (off-white or light grey).
ABSOLUTE RULES: 
- NO lifestyle images.
- NO room interiors.
- NO furniture.
- NO windows or walls.
- NO people.
- NO text.
- ONLY raw material textures and colors derived from the input images.
- The entire image must be a collage of material samples, nothing else.
  `;

  const style2Prompt = `
GENERATE CONCEPT 2. BASIC NATUREL MOODBOARD.
Style: Creative, high-end editorial lifestyle collage with an organic, 'Basic Naturel' aesthetic.
Layout: A beautifully composed, overlapping collage of inspirational interior images as the primary focus. The text "Basic naturel" should be present but small, subtle, and elegant (e.g., in a corner or as a delicate watermark), ensuring it does not dominate the composition.
Content: 
- Primary focus: 3 to 5 stunning, calm, and spacious room interior images inspired by the input.
- Secondary elements: 4 large circular or organic-shaped color swatches subtly integrated on the side or overlapping the images.
- Creative touch: Add subtle organic textures, soft shadows between collage layers, or delicate botanical elements (like a dried branch or linen texture) to enhance the 'Basic Naturel' vibe.
Rules: The overall feel must be warm, earthy, minimalist, and highly professional. The inspiration images must remain the absolute center of attention.
  `;

  const results: string[] = [];

  try {
    const res1 = await ai.models.generateContent({
      model: MODEL_NAME_MOODBOARD,
      contents: { parts: [...imageParts, { text: style1Prompt }] },
    });
    
    const res2 = await ai.models.generateContent({
      model: MODEL_NAME_MOODBOARD,
      contents: { parts: [...imageParts, { text: style2Prompt }] },
    });

    const img1 = res1.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
    const img2 = res2.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;

    if (img1) results.push(`data:image/png;base64,${img1}`);
    if (img2) results.push(`data:image/png;base64,${img2}`);
  } catch (err) {
    console.error("Moodboard generation error:", err);
    throw err;
  }

  return results;
};
