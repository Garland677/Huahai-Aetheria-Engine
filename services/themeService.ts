
import { ThemeConfig, ThemePalette } from "../types";
import { PALETTE_DATA } from "./paletteData";

// --- CENTRALIZED DEFAULT THEME CONFIGURATION ---
export const DEFAULT_THEME_CONFIG: ThemeConfig = {
    light: {
        baseHue: "orange-50",
        primaryHue: "orange-900",
        secondaryHue: "orange-900",
        baseSat: 0.2,
        primarySat: 0.7,
        secondarySat: 0.8,
        
        // Semantic Colors
        endorphinHue: "red-700",
        endorphinSat: 1.0,
        dopamineHue: "yellow-600",
        dopamineSat: 1.0,
        oxytocinHue: "teal-800",
        oxytocinSat: 1.0,
        libidoHue: "pink-600",
        libidoSat: 1.0,
        
        // Story Log
        storyLogBgHue: "orange-50",
        storyLogBgSat: 1.0,
        storyLogTextHue: "slate-900",
        storyLogTextSat: 1.0
    },
    dark: {
        baseHue: "orange-950",
        primaryHue: "yellow-400",
        secondaryHue: "yellow-900",
        baseSat: 0.15,
        primarySat: 0.35,
        secondarySat: 0.35,
        
        // Semantic Colors
        endorphinHue: "orange-500",
        endorphinSat: 1.0,
        dopamineHue: "yellow-500",
        dopamineSat: 1.0,
        oxytocinHue: "teal-500",
        oxytocinSat: 1.0,
        libidoHue: "pink-500",
        libidoSat: 1.0,
        
        // Story Log
        storyLogBgHue: "orange-900",
        storyLogBgSat: 0.2,
        storyLogTextHue: "slate-200",
        storyLogTextSat: 1.0
    }
};

// Palette options available in palette.css
export const PALETTE_HUES = [
    'slate', 'gray', 'zinc', 'neutral', 'stone',
    'red', 'orange', 'amber', 'yellow', 'lime', 
    'green', 'emerald', 'teal', 'cyan', 'sky', 
    'blue', 'indigo', 'violet', 'purple', 'fuchsia', 
    'pink', 'rose'
];

export const NEUTRAL_HUES = ['slate', 'gray', 'zinc', 'neutral', 'stone'];

// Helper: Parse "hue-shade" string (e.g. "slate-900") -> { hue: "slate", shade: 900 }
// If just "slate", use defaultShade
const parseColor = (input: string, defaultShade: number) => {
    const parts = input.split('-');
    // Check if last part is a number
    const potentialShade = parseInt(parts[parts.length - 1]);
    
    if (!isNaN(potentialShade) && parts.length >= 2) {
        return { 
            hue: parts.slice(0, -1).join('-'), 
            shade: potentialShade 
        };
    }
    return { hue: input, shade: defaultShade };
};

// Helper: Resolve OKLCH string from Hue/Shade + Saturation Multiplier
const resolveColor = (hue: string, shade: number, saturationMult: number = 1.0): string => {
    const hueData = PALETTE_DATA[hue];
    if (!hueData) return `var(--color-${hue}-${shade})`; // Fallback to CSS var if data missing

    const val = hueData[shade];
    if (!val) return `var(--color-${hue}-${shade})`;

    // Apply saturation multiplier to Chroma (C)
    // Clamp C to avoid invalid values (though browsers handle overflow gracefully usually)
    const newC = Math.max(0, val.c * saturationMult);
    
    return `oklch(${val.l} ${newC} ${val.h})`;
};

// Helper: Get a shade relative to current, clamped 50-950
const getStep = (current: number, delta: number) => {
    const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
    const idx = SHADES.indexOf(current);
    if (idx === -1) return current; // Should not happen if valid
    const newIdx = Math.max(0, Math.min(SHADES.length - 1, idx + delta));
    return SHADES[newIdx];
};

export const applyThemeToRoot = (themeConfig: ThemeConfig, isGlobalLightMode: boolean = false) => {
    const root = document.documentElement;
    
    // Select palette based on mode
    const palette = isGlobalLightMode ? themeConfig.light : themeConfig.dark;
    
    // Parse Colors
    // Defaults: Light Mode Base=50, Dark Mode Base=950
    const baseObj = parseColor(palette.baseHue, isGlobalLightMode ? 50 : 950);
    const priObj = parseColor(palette.primaryHue, isGlobalLightMode ? 600 : 500);
    const secObj = parseColor(palette.secondaryHue, isGlobalLightMode ? 200 : 800);

    // New Semantic Colors (Use defaults if undefined)
    const libidoObj = parseColor(palette.libidoHue || (isGlobalLightMode ? 'pink-600' : 'pink-500'), isGlobalLightMode ? 600 : 500);
    const dopamineObj = parseColor(palette.dopamineHue || (isGlobalLightMode ? 'yellow-600' : 'yellow-500'), isGlobalLightMode ? 600 : 500);
    const endorphinObj = parseColor(palette.endorphinHue || (isGlobalLightMode ? 'orange-600' : 'orange-500'), isGlobalLightMode ? 600 : 500);
    const oxytocinObj = parseColor(palette.oxytocinHue || (isGlobalLightMode ? 'teal-600' : 'teal-500'), isGlobalLightMode ? 600 : 500);

    // Story Log Colors (Defaults match current styles)
    // Light Mode Default: #eaddcf is roughly orange-50 or stone-100 with tweaks. Let's use orange-50.
    // Dark Mode Default: bg-surface (which comes from baseHue).
    const storyBgObj = parseColor(palette.storyLogBgHue || (isGlobalLightMode ? 'orange-50' : palette.baseHue), isGlobalLightMode ? 50 : 900);
    const storyTextObj = parseColor(palette.storyLogTextHue || (isGlobalLightMode ? 'slate-900' : palette.baseHue), isGlobalLightMode ? 900 : 200);

    // Get Saturation Multipliers (Default to 1 if undefined)
    const baseSat = palette.baseSat ?? 1.0;
    const priSat = palette.primarySat ?? 1.0;
    const secSat = palette.secondarySat ?? 1.0;
    
    // Semantic Saturation: Independent with Fallback to 1.0 (Previously secSat, now detached)
    const libidoSat = palette.libidoSat ?? 1.0;
    const dopamineSat = palette.dopamineSat ?? 1.0;
    const endorphinSat = palette.endorphinSat ?? 1.0;
    const oxytocinSat = palette.oxytocinSat ?? 1.0;

    const storyBgSat = palette.storyLogBgSat ?? 1.0;
    const storyTextSat = palette.storyLogTextSat ?? 1.0;

    const set = (name: string, value: string) => root.style.setProperty(name, value);
    
    // --- LOGIC: Determine Luminance Mode based on BASE SHADE ---
    // If base shade is >= 500, we treat it as a "Dark Theme" (light text).
    // If base shade < 500, we treat it as a "Light Theme" (dark text).
    const isDarkBase = baseObj.shade >= 500;

    // --- 1. BACKGROUNDS ---
    // Apply Base Saturation
    set('--bg-app', resolveColor(baseObj.hue, baseObj.shade, baseSat));
    
    let surfaceShade, surfaceHighlightShade, surfaceLightShade;

    if (isDarkBase) {
        // Dark Theme Logic
        surfaceShade = getStep(baseObj.shade, -1); // 950 -> 900
        surfaceHighlightShade = getStep(baseObj.shade, -2); // 950 -> 800
        surfaceLightShade = getStep(baseObj.shade, -1); // Input bg
    } else {
        // Light Theme Logic
        surfaceShade = getStep(baseObj.shade, 1); // 50 -> 100
        surfaceHighlightShade = getStep(baseObj.shade, 2); // 50 -> 200
        surfaceLightShade = getStep(baseObj.shade, 0); // Inputs usually white/lightest
    }

    set('--bg-surface', resolveColor(baseObj.hue, surfaceShade, baseSat));
    set('--bg-surface-highlight', resolveColor(baseObj.hue, surfaceHighlightShade, baseSat));
    set('--bg-surface-light', resolveColor(baseObj.hue, surfaceLightShade, baseSat));

    // --- 2. BORDERS ---
    // Borders need to contrast with surface
    const borderBaseShade = isDarkBase ? getStep(surfaceShade, -1) : getStep(surfaceShade, 1);
    const borderHighlightShade = isDarkBase ? getStep(surfaceShade, -2) : getStep(surfaceShade, 2);
    
    set('--border-base', resolveColor(baseObj.hue, borderBaseShade, baseSat));
    set('--border-highlight', resolveColor(baseObj.hue, borderHighlightShade, baseSat));
    // Active border usually brand color (Primary)
    set('--border-active', resolveColor(priObj.hue, 500, priSat)); 

    // --- 3. TEXT ---
    // Text colors usually have very low saturation to be readable, or match base hue.
    // We will use baseSat for text to keep it consistent with the "tinted grey" look if base is tinted.
    if (isDarkBase) {
        // Dark Base -> Light Text
        set('--text-body', resolveColor(baseObj.hue, 200, baseSat));
        set('--text-muted', resolveColor(baseObj.hue, 400, baseSat));
        set('--text-faint', resolveColor(baseObj.hue, 600, baseSat));
        set('--text-highlight', resolveColor(baseObj.hue, 50, baseSat));
        set('--text-inverted', resolveColor(baseObj.hue, 950, baseSat));
    } else {
        // Light Base -> Dark Text
        set('--text-body', resolveColor(baseObj.hue, 900, baseSat));
        set('--text-muted', resolveColor(baseObj.hue, 600, baseSat));
        set('--text-faint', resolveColor(baseObj.hue, 400, baseSat));
        set('--text-highlight', resolveColor(baseObj.hue, 950, baseSat));
        set('--text-inverted', resolveColor(baseObj.hue, 50, baseSat));
    }

    // --- 4. PRIMARY ACTION ---
    set('--primary-base', resolveColor(priObj.hue, priObj.shade, priSat));
    set('--primary-hover', resolveColor(priObj.hue, getStep(priObj.shade, isDarkBase ? -1 : 1), priSat));
    set('--primary-active', resolveColor(priObj.hue, getStep(priObj.shade, isDarkBase ? 1 : -1), priSat));
    
    // Primary FG: Needs contrast against Primary Base
    // If Primary Base is dark (>400), text is white. Else black.
    const priIsDark = priObj.shade > 400; 
    set('--primary-fg', priIsDark ? '#ffffff' : '#000000');

    // --- 5. SECONDARY ACTION ---
    set('--secondary-base', resolveColor(secObj.hue, secObj.shade, secSat));
    set('--secondary-hover', resolveColor(secObj.hue, getStep(secObj.shade, isDarkBase ? -1 : 1), secSat));
    
    const secIsDark = secObj.shade > 400;
    set('--secondary-fg', secIsDark ? '#ffffff' : '#000000');

    // --- 6. ACCENTS ---
    // Info uses secondary hue but forced saturation logic from secondarySat
    set('--info-base', resolveColor(secObj.hue, 600, secSat));
    set('--info-fg', resolveColor(secObj.hue, 200, secSat));

    // --- 7. EXTENDED SEMANTICS ---
    // Use independent saturations
    
    // Libido
    set('--libido-base', resolveColor(libidoObj.hue, libidoObj.shade, libidoSat));
    set('--libido-fg', resolveColor(libidoObj.hue, isDarkBase ? 200 : 800, libidoSat));

    // Dopamine
    set('--dopamine-base', resolveColor(dopamineObj.hue, dopamineObj.shade, dopamineSat));
    set('--dopamine-fg', resolveColor(dopamineObj.hue, isDarkBase ? 200 : 800, dopamineSat));

    // Endorphin
    set('--endorphin-base', resolveColor(endorphinObj.hue, endorphinObj.shade, endorphinSat));
    set('--endorphin-fg', resolveColor(endorphinObj.hue, isDarkBase ? 200 : 800, endorphinSat));

    // Oxytocin
    set('--oxytocin-base', resolveColor(oxytocinObj.hue, oxytocinObj.shade, oxytocinSat));
    set('--oxytocin-fg', resolveColor(oxytocinObj.hue, isDarkBase ? 200 : 800, oxytocinSat));

    // --- 8. STORY LOG ---
    // Use independent shades logic.
    // If user provided a specific shade (e.g. orange-50), use it.
    // If they just provided hue (e.g. orange), fallback to a logical default based on mode.
    const finalStoryBgShade = storyBgObj.shade; // Shade is already resolved by parseColor or default
    const finalStoryTextShade = storyTextObj.shade;

    set('--bg-story', resolveColor(storyBgObj.hue, finalStoryBgShade, storyBgSat));
    set('--text-story', resolveColor(storyTextObj.hue, finalStoryTextShade, storyTextSat));
};

export const serializeTheme = (theme: ThemeConfig): string => {
    // Explicitly construct full objects with defaults filled in to ensure all keys are exported
    // Use DEFAULT_THEME_CONFIG as base to avoid duplication, but here we handle raw objects
    const fillDefaults = (p: ThemePalette, mode: 'light'|'dark'): ThemePalette => ({
        baseHue: p.baseHue || (mode === 'light' ? "orange-50" : "orange-950"),
        baseSat: p.baseSat ?? (mode === 'light' ? 0.2 : 0.15),
        
        primaryHue: p.primaryHue || (mode === 'light' ? "orange-900" : "yellow-400"),
        primarySat: p.primarySat ?? (mode === 'light' ? 0.7 : 0.35),
        
        secondaryHue: p.secondaryHue || (mode === 'light' ? "orange-900" : "yellow-900"),
        secondarySat: p.secondarySat ?? (mode === 'light' ? 0.8 : 0.35),
        
        libidoHue: p.libidoHue || (mode === 'light' ? "pink-600" : "pink-500"),
        libidoSat: p.libidoSat ?? 1.0,
        
        dopamineHue: p.dopamineHue || (mode === 'light' ? "yellow-600" : "yellow-500"),
        dopamineSat: p.dopamineSat ?? 1.0,
        
        endorphinHue: p.endorphinHue || (mode === 'light' ? "red-700" : "orange-500"),
        endorphinSat: p.endorphinSat ?? 1.0,
        
        oxytocinHue: p.oxytocinHue || (mode === 'light' ? "teal-800" : "teal-500"),
        oxytocinSat: p.oxytocinSat ?? 1.0,

        storyLogBgHue: p.storyLogBgHue || (mode === 'light' ? "orange-50" : "orange-900"),
        storyLogBgSat: p.storyLogBgSat ?? (mode === 'light' ? 1.0 : 0.2),
        
        storyLogTextHue: p.storyLogTextHue || (mode === 'light' ? "slate-900" : "slate-200"),
        storyLogTextSat: p.storyLogTextSat ?? 1.0
    });

    const fullConfig: ThemeConfig = {
        light: fillDefaults(theme.light, 'light'),
        dark: fillDefaults(theme.dark, 'dark')
    };

    return JSON.stringify(fullConfig);
};

export const deserializeTheme = (str: string): ThemeConfig | null => {
    try {
        const parsed = JSON.parse(str);
        if (parsed.light && parsed.dark && parsed.light.baseHue && parsed.dark.baseHue) {
            return parsed as ThemeConfig;
        }
    } catch (e) {}
    return null;
};
