import { parsePinCoordinates } from '../core/matching.js';
import { callVision } from './provider-client.js';
import { providerLabel } from './provider-config.js';
import { getQuestionSetup, log } from './question-runtime.js';

export async function answerPinQuestion(title, imageUrl, options = {}) {
  const { apiKey, visionModel, provider, requestContext } = await getQuestionSetup(options);
  if (!apiKey) throw new Error(`No ${providerLabel(provider)} API key configured.`);
  if (!imageUrl) throw new Error('No image URL for pin question.');

  const prompt = `You must place a pin on this image to answer a quiz question:
"${title}"

COORDINATE SYSTEM:
- X=0 is the LEFT edge, X=100 is the RIGHT edge
- Y=0 is the TOP edge, Y=100 is the BOTTOM edge
- The center of the image is X=50, Y=50

STEP BY STEP:
1. Describe what you see (world map? regional map? photo? diagram? chart?).
2. Figure out what the question wants you to find.
3. If it's a MAP: look at the actual coastlines, borders, and labels visible in THIS specific image. Different maps use different projections and crops, so do NOT assume fixed positions. Instead, find recognizable landmarks in the image (continent shapes, labeled countries, visible borders) and estimate your target relative to those.
4. If it's NOT a map: find the exact visible feature the question asks about. Place the pin on the object itself, not on empty space around it.
5. Pick a visible reference point near your target and estimate its coordinates.
6. Estimate your target's coordinates relative to that reference point.
7. Sanity check EACH coordinate:
   - If you said "about 1/3 from the left", X should be near 33. If you said "about 1/4", X should be near 25. Actually do the division.
   - If you said "about 2/5 from the top", Y should be near 40. NOT 58. Convert your fraction to a number.
   - Is the target left/right of center? Then X should be below/above 50.
   - Is the target above/below center? Then Y should be below/above 50.

COMMON MISTAKES TO AVOID:
- MATH ERRORS: "2/5 from the top" = Y=40, NOT Y=58. "1/4 from the left" = X=25, NOT X=35. Always convert fractions to percentages correctly.
- On maps: don't guess from memory where a country "should" be. Look at where it actually appears in THIS image.
- Don't place pins on margins, labels, captions, legends, or whitespace.
- Don't place pins in the ocean when the question asks about land.
- For "base/bottom/foot" targets, place on the visible structure, not blank space below it.

Show your reasoning, then on the FINAL line output ONLY: X,Y
Example: 65.0,40.0`;

  log(`Pin question using ${providerLabel(provider)} vision model ${visionModel}.`);
  const raw = await callVision(
    provider,
    apiKey,
    visionModel,
    'You are a spatial reasoning expert. You will be shown an image and asked to place a pin at a specific location. Look carefully at the actual image content - maps can be any projection, any crop, any style. Reason step by step from what you see, then output coordinates. Your final line must be ONLY X,Y (0-100 scale).',
    prompt,
    imageUrl,
    { ...requestContext, maxTokens: 800, timeoutMs: 30000, temperature: 0.1 }
  );
  return parsePinCoordinates(raw);
}
