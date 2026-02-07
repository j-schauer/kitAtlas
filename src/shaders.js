/*
 * MSDF Shaders - Pixi.js v8 Compatible
 *
 * These shaders are designed to work with Pixi.js v8 (WebGL2 + WebGPU) but can
 * also be used standalone by providing identity matrices for GlobalUniforms.
 *
 * PIXI BINDING REQUIREMENTS:
 *   WebGL:  Pixi auto-injects uProjectionMatrix, uWorldTransformMatrix uniforms
 *   WebGPU: Pixi owns @group(0) for GlobalUniforms, custom bindings go to @group(1)
 *
 * STANDALONE USAGE:
 *   Provide identity matrices for uProjectionMatrix/uWorldTransformMatrix
 *   and positions in clip-space (-1 to 1).
 */

// =============================================================================
// GLSL VERTEX SHADER (WebGL2)
// =============================================================================
// Pixi provides uProjectionMatrix and uWorldTransformMatrix automatically.
// For standalone use, bind identity mat3 uniforms.

export const msdfVertGLSL = `#version 300 es
in vec2 aPosition;
in vec2 aUV;

// Pixi-provided transform matrices (bind identity for standalone)
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;

out vec2 vTexcoord;

void main() {
    // Combine Pixi's projection and world transforms
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix;
    vec3 clip = mvp * vec3(aPosition, 1.0);
    gl_Position = vec4(clip.xy, 0.0, 1.0);
    vTexcoord = aUV;
}
`;

// =============================================================================
// GLSL FRAGMENT SHADER (WebGL2)
// =============================================================================
// Works with both Pixi and standalone - no Pixi-specific requirements.

export const msdfFragGLSL = `#version 300 es
precision mediump float;

in vec2 vTexcoord;
out vec4 outColor;

uniform sampler2D uTexture;

uniform int uDebugMode;
uniform vec4 uDebugColor;
uniform vec4 uViewport;

uniform vec4 uColor;
uniform float uSmoothing;
uniform float uWeight;
uniform float uUseAlpha;

uniform float uFancyEnable;

uniform float uOutlineOnOff;
uniform float uOutlineWidth;
uniform vec4 uOutlineColor;

uniform float uGlowOnOff;
uniform float uGlowRadius;
uniform vec4 uGlowColor;
uniform float uGlowAlpha;
uniform vec2 uGlowOffset;
uniform float uGlowDiffusion;

uniform float uBlurOnOff;
uniform float uCharBlur;

uniform float uShowMedian;

uniform float uPxRange;
uniform vec2 uTexSize;

float median(vec3 v) {
    return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
}

float getScreenPxRange(vec2 texCoord, float pxRange, vec2 texSize) {
    vec2 unitRange = vec2(pxRange) / texSize;
    vec2 screenTexSize = vec2(1.0) / fwidth(texCoord);
    return max(0.5 * dot(unitRange, screenTexSize), 1.0);
}

void main() {
    if (uDebugMode == 1) {
        outColor = uDebugColor;
        return;
    }

    if (uDebugMode == 2) {
        vec2 quadUV = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw;
        float thickness = 0.02;
        float d1 = abs(quadUV.y - quadUV.x);
        float d2 = abs(quadUV.y - (1.0 - quadUV.x));
        float border = min(min(quadUV.x, 1.0 - quadUV.x), min(quadUV.y, 1.0 - quadUV.y));
        if (d1 < thickness || d2 < thickness || border < 0.015) {
            outColor = uDebugColor;
        } else {
            outColor = vec4(0.15, 0.15, 0.15, 1.0);
        }
        return;
    }

    if (uDebugMode == 3) {
        outColor = texture(uTexture, vTexcoord);
        return;
    }

    vec4 texSample = texture(uTexture, vTexcoord);
    vec3 msd = texSample.rgb;

    float msdfDist = median(msd);
    float sdfDist = texSample.a;

    float dist;
    if (uUseAlpha > 0.5) {
        dist = min(msdfDist, sdfDist);
    } else {
        dist = msdfDist;
    }

    float screenPxRange = getScreenPxRange(vTexcoord, uPxRange, uTexSize);
    float screenDist = (dist - 0.5) * screenPxRange;
    screenDist += uWeight * screenPxRange * 0.5;

    float w = max(fwidth(screenDist), 0.25);
    float wOut = w * min(uSmoothing, 1.0);
    float wIn = w * uSmoothing;

    float aOut = 0.5 * smoothstep(-wOut, 0.0, screenDist);
    float aIn = 0.5 + 0.5 * smoothstep(0.0, wIn, screenDist);
    float baseAlpha = mix(aOut, aIn, step(0.0, screenDist));

    float outA = baseAlpha * uColor.a;
    vec3 outRGB = uColor.rgb * outA;
    vec4 glyphPM = vec4(outRGB, outA);

    if (uFancyEnable < 0.5) {
        if (glyphPM.a < (1.0 / 255.0)) discard;
        vec3 gammaRGB = pow(glyphPM.rgb, vec3(1.0 / 2.2));
        outColor = vec4(gammaRGB, glyphPM.a);
        return;
    }

    if (uShowMedian > 0.5) {
        outColor = vec4(vec3(median(msd)), 1.0);
        return;
    }

    if (uBlurOnOff > 0.5 && uCharBlur > 0.0) {
        float blurPx = uCharBlur * 3.0;
        baseAlpha = smoothstep(-blurPx, blurPx, screenDist);
        outA = baseAlpha * uColor.a;
        outRGB = uColor.rgb * outA;
        glyphPM = vec4(outRGB, outA);
    }

    vec4 outlinePM = vec4(0.0);
    if (uOutlineOnOff > 0.5 && uOutlineWidth > 0.0) {
        float owPx = uOutlineWidth;
        float halfOw = owPx * 0.5;
        float outlineAlpha = 1.0 - smoothstep(halfOw - 0.5, halfOw + 0.5, abs(screenDist));
        float oa = outlineAlpha * uOutlineColor.a;
        outlinePM = vec4(uOutlineColor.rgb * oa, oa);
    }

    vec4 glowPM = vec4(0.0);
    if (uGlowOnOff > 0.5 && uGlowRadius > 0.0 && uGlowAlpha > 0.0) {
        vec2 glowUV = vTexcoord - uGlowOffset * 0.001;
        vec4 glowSample = texture(uTexture, glowUV);
        float glowDist = median(glowSample.rgb);
        float glowScreenDist = (glowDist - 0.5) * screenPxRange;
        float d = max(-glowScreenDist, 0.0);
        float R = max(uGlowRadius, 1.0);
        float aa = fwidth(d);
        float sigma = max(1.0, mix(1.0, R * 0.5, uGlowDiffusion / 5.0));
        float g = exp(-0.5 * (d * d) / (sigma * sigma));
        float gR = exp(-0.5 * (R * R) / (sigma * sigma));
        float glowFalloff = clamp((g - gR) / max(1.0 - gR, 1e-5), 0.0, 1.0);
        glowFalloff *= 1.0 - smoothstep(R, R + aa, d);
        float ga = glowFalloff * uGlowAlpha * (1.0 - baseAlpha);
        glowPM = vec4(uGlowColor.rgb * ga, ga);
    }

    vec4 colour = glowPM;
    colour = outlinePM + colour * (1.0 - outlinePM.a);
    colour = glyphPM + colour * (1.0 - glyphPM.a);

    if (colour.a < (1.0 / 255.0)) discard;
    outColor = vec4(pow(colour.rgb, vec3(1.0 / 2.2)), colour.a);
}
`;

// =============================================================================
// WGSL SHADER (WebGPU) - Pixi.js v8 Compatible
// =============================================================================
//
// BINDING LAYOUT:
//   @group(0) - Pixi's GlobalUniforms (projection, world transform)
//   @group(1) - Custom uniforms, texture, sampler
//
// PIXI USAGE:
//   - Resource names must match WGSL var names: "u", "uTexture", "uSampler"
//   - Inline @location attributes with trailing comma (parser bug #11819 workaround)
//   - Pixi provides GlobalUniforms automatically - no setup needed

export const msdfWGSL = `
// Pixi v8 Global Uniforms - auto-bound by Pixi at @group(0)
struct GlobalUniforms {
    uProjectionMatrix: mat3x3f,
    uWorldTransformMatrix: mat3x3f,
    uWorldColorAlpha: vec4f,
    uResolution: vec2f,
}

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;

// Custom uniforms - @group(1), provided via resources
struct Uniforms {
    uColor: vec4f,
    uDebugColor: vec4f,
    uViewport: vec4f,
    uOutlineColor: vec4f,
    uGlowColor: vec4f,
    uGlowOffset: vec2f,
    uTexSize: vec2f,
    uSmoothing: f32,
    uWeight: f32,
    uUseAlpha: f32,
    uPxRange: f32,
    uFancyEnable: f32,
    uShowMedian: f32,
    uOutlineOnOff: f32,
    uOutlineWidth: f32,
    uGlowOnOff: f32,
    uGlowRadius: f32,
    uGlowAlpha: f32,
    uGlowDiffusion: f32,
    uBlurOnOff: f32,
    uCharBlur: f32,
    uDebugMode: i32,
    _pad: vec3f,
}

@group(1) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(1) var uTexture: texture_2d<f32>;
@group(1) @binding(2) var uSampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) vTexcoord: vec2f,
}

// IMPORTANT: Inline @location with trailing comma (Pixi parser bug #11819 workaround)
@vertex
fn vs_main(
    @location(0) aPosition: vec2f,
    @location(1) aUV: vec2f,
) -> VertexOutput {
    var out: VertexOutput;

    // Use Pixi's projection and world transform (both from group 0)
    let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix;
    let clip = mvp * vec3f(aPosition, 1.0);
    out.position = vec4f(clip.xy, 0.0, 1.0);
    out.vTexcoord = aUV;

    return out;
}

// =============================================================================
// FRAGMENT SHADER
// =============================================================================

fn median(v: vec3f) -> f32 {
    return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
}

fn getScreenPxRange(texCoord: vec2f, pxRange: f32, texSize: vec2f) -> f32 {
    let unitRange = vec2f(pxRange) / texSize;
    let screenTexSize = vec2f(1.0) / fwidth(texCoord);
    return max(0.5 * dot(unitRange, screenTexSize), 1.0);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    // Debug mode 1: solid color
    if (u.uDebugMode == 1) {
        return u.uDebugColor;
    }

    // Debug mode 2: grid pattern
    if (u.uDebugMode == 2) {
        let quadUV = (in.position.xy - u.uViewport.xy) / u.uViewport.zw;
        let thickness = 0.02;
        let d1 = abs(quadUV.y - quadUV.x);
        let d2 = abs(quadUV.y - (1.0 - quadUV.x));
        let border = min(min(quadUV.x, 1.0 - quadUV.x), min(quadUV.y, 1.0 - quadUV.y));
        if (d1 < thickness || d2 < thickness || border < 0.015) {
            return u.uDebugColor;
        } else {
            return vec4f(0.15, 0.15, 0.15, 1.0);
        }
    }

    // Debug mode 3: raw texture
    if (u.uDebugMode == 3) {
        return textureSample(uTexture, uSampler, in.vTexcoord);
    }

    // MSDF distance calculation
    let texSample = textureSample(uTexture, uSampler, in.vTexcoord);
    let msd = texSample.rgb;
    let msdfDist = median(msd);
    let sdfDist = texSample.a;

    // Use MTSDF (min of MSDF and SDF) or just MSDF
    var dist: f32;
    if (u.uUseAlpha > 0.5) {
        dist = min(msdfDist, sdfDist);
    } else {
        dist = msdfDist;
    }

    // Screen-space distance for anti-aliasing
    let screenPxRange = getScreenPxRange(in.vTexcoord, u.uPxRange, u.uTexSize);
    var screenDist = (dist - 0.5) * screenPxRange;
    screenDist += u.uWeight * screenPxRange * 0.5;

    // Asymmetric smoothing for sharper edges
    let w = max(fwidth(screenDist), 0.25);
    let wOut = w * min(u.uSmoothing, 1.0);
    let wIn = w * u.uSmoothing;

    let aOut = 0.5 * smoothstep(-wOut, 0.0, screenDist);
    let aIn = 0.5 + 0.5 * smoothstep(0.0, wIn, screenDist);
    var baseAlpha = mix(aOut, aIn, step(0.0, screenDist));

    // Premultiplied alpha output
    var outA = baseAlpha * u.uColor.a;
    var outRGB = u.uColor.rgb * outA;
    var glyphPM = vec4f(outRGB, outA);

    // Fast path: no fancy effects
    if (u.uFancyEnable < 0.5) {
        if (glyphPM.a < (1.0 / 255.0)) {
            discard;
        }
        let gammaRGB = pow(glyphPM.rgb, vec3f(1.0 / 2.2));
        return vec4f(gammaRGB, glyphPM.a);
    }

    // Debug: show median distance
    if (u.uShowMedian > 0.5) {
        let med = median(msd);
        return vec4f(vec3f(med), 1.0);
    }

    // Character blur effect
    if (u.uBlurOnOff > 0.5 && u.uCharBlur > 0.0) {
        let blurPx = u.uCharBlur * 3.0;
        baseAlpha = smoothstep(-blurPx, blurPx, screenDist);
        outA = baseAlpha * u.uColor.a;
        outRGB = u.uColor.rgb * outA;
        glyphPM = vec4f(outRGB, outA);
    }

    // Outline effect
    var outlinePM = vec4f(0.0);
    if (u.uOutlineOnOff > 0.5 && u.uOutlineWidth > 0.0) {
        let owPx = u.uOutlineWidth;
        let halfOw = owPx * 0.5;
        let outlineAlpha = 1.0 - smoothstep(halfOw - 0.5, halfOw + 0.5, abs(screenDist));
        let oa = outlineAlpha * u.uOutlineColor.a;
        outlinePM = vec4f(u.uOutlineColor.rgb * oa, oa);
    }

    // Glow effect
    var glowPM = vec4f(0.0);
    if (u.uGlowOnOff > 0.5 && u.uGlowRadius > 0.0 && u.uGlowAlpha > 0.0) {
        let glowUV = in.vTexcoord - u.uGlowOffset * 0.001;
        let glowSample = textureSample(uTexture, uSampler, glowUV);
        let glowDist = median(glowSample.rgb);
        let glowScreenDist = (glowDist - 0.5) * screenPxRange;
        let d = max(-glowScreenDist, 0.0);
        let R = max(u.uGlowRadius, 1.0);
        let aa = fwidth(d);
        let sigma = max(1.0, mix(1.0, R * 0.5, u.uGlowDiffusion / 5.0));
        let g = exp(-0.5 * (d * d) / (sigma * sigma));
        let gR = exp(-0.5 * (R * R) / (sigma * sigma));
        var glowFalloff = clamp((g - gR) / max(1.0 - gR, 1e-5), 0.0, 1.0);
        glowFalloff *= 1.0 - smoothstep(R, R + aa, d);
        let ga = glowFalloff * u.uGlowAlpha * (1.0 - baseAlpha);
        glowPM = vec4f(u.uGlowColor.rgb * ga, ga);
    }

    // Composite: glow -> outline -> glyph (back to front)
    var colour = glowPM;
    colour = outlinePM + colour * (1.0 - outlinePM.a);
    colour = glyphPM + colour * (1.0 - glyphPM.a);

    if (colour.a < (1.0 / 255.0)) {
        discard;
    }
    return vec4f(pow(colour.rgb, vec3f(1.0 / 2.2)), colour.a);
}
`;
