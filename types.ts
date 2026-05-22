

export enum AttributeType {
  NUMBER = 'NUMBER',
  TEXT = 'TEXT',
}

export enum AttributeVisibility {
  PUBLIC = 'public', // Everyone sees it
  PRIVATE = 'private', // Only self sees it
}

export enum Provider {
  GEMINI = 'gemini',
  XAI = 'xai', // Grok
  VOLCANO = 'volcano', // Doubao
  OPENROUTER = 'openrouter', // OpenRouter
  OPENAI = 'openai',
  CLAUDE = 'claude',
  CUSTOM = 'custom', // Custom OpenAI Compatible
}

export enum TerrainType {
    LAND = 'Land',   // 野外/陆地
    WATER = 'Water', // 水域 (海/湖)
    RIVER = 'River', // 溪流/河
    CITY = 'City',   // 城市
    TOWN = 'Town',   // 村镇
}

export interface GlobalContextMessage {
    role: 'user' | 'model' | 'system'; 
    content: string;
}

export interface GlobalContextConfig {
    messages: GlobalContextMessage[];
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';

export interface AIConfig {
  provider: Provider;
  model?: string;
  apiKey?: string; // Optional override per char
  customEndpointId?: string; // If provider is CUSTOM, use this ID
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort; // New: Thinking Level
  contextConfig?: GlobalContextConfig; // New: Model specific context
  
  // New: Feedback / Annotations stored per model config
  readerComments?: string[]; // Queue of last 3 feedback strings (Branch Comments)
  pureComments?: string[]; // Queue of last 20 simple comments (Pure Comments)
}

export interface CustomEndpoint {
    id: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
    model?: string; // Default model name for this endpoint
    
    // Capabilities
    enableVision: boolean; // Send images?
    enableJsonMode: boolean; // Send response_format: json_object?
    
    // Advanced
    headers?: string; // JSON string for extra headers
    extraBody?: string; // JSON string for extra body params
    contextWindow?: number; // Optional override for context window size
}

export interface ContextConfig {
  messages: GlobalContextMessage[]; 
}

export interface ContextSegment {
    id: string;
    name: string;
    content: string;
    enabled: boolean;
}

export interface GameAttribute {
  id: string;
  name: string;
  type: AttributeType;
  value: string | number;
  visibility: AttributeVisibility;
  description?: string;
}

// The core mechanism
export interface Effect {
  id: string;
  name: string;
  // Target definition logic
  targetType: 'world' | 'self' | 'specific_char' | 'all_chars' | 'ai_choice' | 'hit_target';
  targetId?: string; // Specific Char ID if targetType is specific_char
  targetAttribute: string; // key in the attribute map (Free text now)
  
  value: string | number; // The modification
  dynamicValue?: boolean; // If true, AI determines the numeric/text value based on context
  conditionDescription: string; // AI evaluates this
  conditionContextKeys: string[]; // Keys of attributes to send to AI for context
}

export interface Card {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  itemType: 'skill' | 'consumable' | 'event'; // Added event for consistency
  triggerType: 'active' | 'passive' | 'settlement' | 'hidden_settlement' | 'reaction'; // Added reaction
  cost: number; // Cost in Creation Points
  effects: Effect[];
  visibility?: AttributeVisibility; // New: Card Visibility (Public/Private)
  isVirtualAction?: boolean; // New: Virtual action card merging interact/trade/acquire
}

export interface Drive {
    id: string;
    condition: string; // e.g. "Satisfy curiosity"
    amount: number; // Pleasure reward
    weight: number; // Probability weight for this drive to be active
}

export interface Conflict {
    id: string;
    desc: string; // The contradiction/problem description
    apReward: number; // Action Points (Player) & CP (Character) rewarded when solved
    solved: boolean; 
    solvedTimestamp?: number; // When it was solved
}

export interface Secret {
    id: string;
    question: string; // The attribute name or question (e.g. "喜欢吃的东西")
    correctAnswer: string;
    wrongAnswerA: string;
    wrongAnswerB: string;
    solved: boolean;
}

export interface LifeTrajectory {
    past: string;     // 已完成的章节 (仅作 Context)
    current: string;  // 当前正在进行的章节 (引导剧情)
    future: string;   // 预设的下一章节 (用于接替 Current)
}

// --- IMAGE SYSTEM TYPES ---
export interface GameImage {
    id: string;
    base64: string; // Raw base64 string without data:image/jpeg;base64, prefix
    mimeType: string; // e.g. 'image/jpeg'
    description: string; // Text description sent to AI before the image
}
// --------------------------

// --- LETTER SYSTEM TYPES ---
export interface LetterFragment {
    id: string;
    key: string; // JSON key
    label: string; // Display name / Instruction
}

export interface LetterParagraph {
    id: string;
    key: string; // JSON key
    label: string; // Section header
    fragments: LetterFragment[];
    separator: string; // default '\t'
}

export interface LetterTemplate {
    id: string;
    name: string;
    prompt: string; // User's custom instruction
    paragraphs: LetterParagraph[];
}

export interface MailItem {
    id: string;
    timestamp: number;
    charId: string; // Who sent it (NPC)
    templateSnapshot: LetterTemplate; // Snapshot of the template used
    userRequest: string; // What the user asked
    responseRaw: string; // The raw JSON string from AI
    responseParsed: Record<string, any>; // The structured data
    intro?: string; // New: Conversational opening/reply
    attachedImages?: GameImage[]; // Images sent with the mail
}
// ---------------------------

export interface CharacterMemoryConfig {
    useOverride: boolean;
    maxMemoryRounds: number;
    actionDropoutProbability: number;
    reactionDropoutProbability: number;
}

export interface Character {
  id: string;
  isPlayer: boolean;
  name: string;
  appearance: string; // New: Publicly visible appearance
  description: string; // Private biography/personality
  // style removed: Replaced by Virtual Space (contextConfig)
  avatarUrl?: string;
  attributes: Record<string, GameAttribute>;
  skills: Card[]; // Fixed Skills (Deck)
  inventory: string[]; // IDs of cards in the Inventory (Hand)
  drives: Drive[]; // Conditions to gain Pleasure
  conflicts: Conflict[]; // Conflicts specific to this character
  secrets?: Secret[]; // New: Secrets / Puzzle system
  lifeTrajectory?: LifeTrajectory; // New: Life Trajectory System
  movePlan?: string; // New: Current movement intention/plan
  
  useAiOverride?: boolean; // New: If true, use aiConfig. If false, use global.
  aiConfig?: AIConfig; // Only for NPCs
  
  memoryConfig?: CharacterMemoryConfig; // New: Character specific memory settings
  
  contextConfig: ContextConfig; // What does the AI know? (Contains Virtual Space messages)
  
  // New fields for update
  appearanceCondition: string; // e.g. "When the player enters the tavern"
  enableAppearanceCheck: boolean; // If true, AI checks this condition for turn order inclusion
  initialState?: Partial<Character>; // Snapshot for reset
  
  // Follower Logic
  isFollowing?: boolean; // If true, follows player to new locations
  
  // Professional Mode (New)
  isProfessional?: boolean; // If true, uses specialized professional prompts instead of story prompts

  // Mail System
  mailHistory?: MailItem[]; // New: History of letters

  // Multi-modal Support
  appearanceImages?: GameImage[]; // Max 1
  descriptionImages?: GameImage[]; // Max 3

  // Legacy Memory (Recursive Import Support)
  previousLifeLogs?: LogEntry[]; // New: Logs from previous save files, re-indexed to negative rounds
}

// --- PRIZE POOL TYPES ---
export interface PrizeItem {
    id: string;
    name: string;
    description: string;
    weight: number; // Probability weight
    isHidden?: boolean; // If true, the resulting card will be private
}

export interface PrizePool {
    id: string;
    name: string;
    description: string;
    locationIds: string[]; // New: Locations where this pool is available
    items: PrizeItem[];
    
    // New parameters for draw limits
    minDraws?: number; // Default 1
    maxDraws?: number; // Default 1
}
// ------------------------

// --- TRIGGER SYSTEM TYPES ---
export interface PromptsConfig {
    // Deprecated keys removed: checkCondition, determineTurnOrder, analyzeTimePassage
    checkConditionsBatch: string;
    checkConditionsStrictInstruction: string; // New field for strict mode instruction
    determineCharacterAction: string;
    determineCharacterActionPro: string; // New: Professional Action
    determineCharacterReaction: string;
    determineCharacterReactionPro: string; // New: Professional Reaction
    determineEnvAction: string; // New: Environment Character Action
    determineEnvReaction: string; // New: Environment Character Reaction
    generateLocationDetails: string;
    analyzeNewConflicts: string;
    analyzeSettlement: string;
    generateCharacter: string;
    generateUnveil: string; // New: Unveil character backstory
    generateLife: string; // New: Life Trajectory Generation
    // New instruction snippets
    instruction_generateNewRegion: string;
    instruction_existingRegionContext: string;
    context_nearbyCharacters: string;
    observation: string; // New: Observation prompt
    generateLetter: string; // New: Letter generation prompt
    storysuggest: string; // New: Story Suggestion Prompt
}

// Explicit Trigger Phases decoupled from PromptsConfig
export type TriggerPhase = 
    | 'checkConditionsBatch'
    | 'determineCharacterAction'
    | 'determineCharacterReaction'
    | 'generateLocationDetails'
    | 'analyzeSettlement'
    | 'generateCharacter'
    | 'generateUnveil'
    | 'generateLife'
    | 'observation' // Renamed: Removed 'generate'
    | 'storysuggest' // Renamed: Removed 'generate'
    | 'determineTurnOrder' // Logic-only phase
    | 'hidden_round_1' // New: Hidden Round 1 Start
    | 'hidden_round_2' // New: Hidden Round 2 Start
    | 'hidden_round_3' // New: Hidden Round 3 Start
    | 'hidden_round_4' // New: Hidden Round 4 Start
    | 'hidden_round_5'; // New: Hidden Round 5 Start

export type ConditionType = 'char_attr' | 'char_card' | 'world_time' | 'world_attr' | 'char_name' | 'loc_name' | 'region_name' | 'history' | 'natural_language' | 'specific_round_type' | 'current_location';

export type Comparator = '>' | '>=' | '=' | '!=' | '<' | '<=';
export type StringComparator = 'exists' | 'not_exists' | 'contains' | 'exact';

export interface TriggerCondition {
    id: string;
    type: ConditionType;
    // Target Selectors
    locationId?: string; // Location ID or 'all'
    characterId?: string; // Character ID or 'all'
    targetName?: string; // For Attr name, Card name, Char name, Loc name. For natural_language, this holds the description.
    // Logic
    comparator: Comparator | StringComparator;
    value?: string | number; // The threshold
    historyRounds?: number; // For history type
    
    // New: Specific Round Type Selector
    targetRoundTypes?: string[]; // e.g. ['normal', 'hidden_1', 'hidden_2', ...]
    
    // New: Current Location Selector
    targetLocationNames?: string[]; // List of location names to match
}

// New: Trigger Effects
export interface TriggerEffect {
    id: string;
    type: 'char_attr' | 'char_card' | 'world_attr' | 'trigger_toggle';
    locationId?: string; // 'all' or ID
    characterId?: string; // 'all', 'current', or ID
    
    // For Attribute (Char & World)
    targetName?: string; // Attribute name
    operation?: 'set' | 'add'; // Currently supports direct assignment or addition via expression parsing
    value?: string; // Value or Expression (e.g. "2a+5" where a is current value)

    // For Card
    cardOperation?: 'add' | 'remove';
    cardValue?: string; // JSON string of card IDs (for add) or card names (for remove)

    // For Trigger Toggle
    triggerOperation?: 'enable' | 'disable';
    targetTriggerIds?: string[]; // List of Trigger IDs to toggle
}

export interface Trigger {
    id: string;
    name: string;
    groupId?: string; // New: Group ID for categorization
    phase: TriggerPhase | TriggerPhase[]; // Updated: Support Multiple Phases
    conditions: TriggerCondition[];
    disableConditions?: TriggerCondition[]; // New: Conditions to disable this trigger automatically
    
    effects?: TriggerEffect[]; // New: Side effects
    isUrgent?: boolean; // New: If true, requirement is prompt suffix; if false, it's guidance.

    urgentRequirement: string; // Appended to prompt (Now serves as "Requirement Text")
    systemLog: string; // Added to story (Now Narrative Log) - Fallback
    narrativeLogs?: string[]; // New: List of possible narrative logs (randomly picked)
    enabled: boolean;
    maxTriggers?: number; // New: Auto-disable after X triggers. -1 means infinite.
}

export interface TriggerGroup {
    id: string;
    name: string;
    description?: string;
}
// ---------------------------

// --- MAP SYSTEM TYPES ---

export interface Coordinates {
    x: number;
    y: number;
    z: number; // Height
}

export interface MapRegion {
    id: string;
    name: string;
    description: string;
    vertices: {x: number, y: number}[]; // Polygon vertices
    center: {x: number, y: number};
    color: string; // RGBA string for visualization
}

// New: Settlements (Cities/Towns)
export interface MapSettlement {
    id: string;
    type: TerrainType.CITY | TerrainType.TOWN;
    name: string; // Auto-generated or placeholder
    vertices: {x: number, y: number}[];
    center: {x: number, y: number};
}

export interface MapLocation {
    id: string;
    name: string;
    description: string;
    coordinates: Coordinates;
    isKnown: boolean; // True = Green (Explored), False = Gray (Unknown)
    radius: number; // Area of influence
    attributes?: Record<string, GameAttribute>; // Like a character
    associatedNpcIds: string[]; // NPCs spawned here
    regionId?: string; // Link to a parent region
    terrainType?: TerrainType; // Saved specific terrain type
    avatarUrl?: string; // New: Location Avatar (Blurred abstract image)
    images?: GameImage[]; // Max 4 location images
    
    // New: Placeholder info from Story Suggestion
    pendingExplorationData?: {
        locationInstruction: string;
        cultureInstruction: string;
    };
}

export interface MapChunk {
    id: string;
    xIndex: number; // Global chunk index X (0, 1, -1 etc)
    yIndex: number; // Global chunk index Y
    size: number; // 1000m usually
    heightMap: number[]; // Flattened array of height values. Optimization: Store specific points or use seed? Storing grid for visualizer.
    seed: number;
    rivers?: number[]; // Indices of points that are river/water
}

export interface CharPosition {
    x: number;
    y: number;
    locationId?: string; // If attached to a specific POI
}

export interface MapState {
    chunks: Record<string, MapChunk>; // Key "x_y"
    locations: Record<string, MapLocation>;
    regions: Record<string, MapRegion>; // New: Regions
    settlements: Record<string, MapSettlement>; // New: Cities and Towns
    charPositions: Record<string, CharPosition>; // CharID -> Pos
    activeLocationId?: string; // The "Play Location" selected by player
    pendingActiveLocationId?: string; // New: Delayed location switch until settlement
    playerCoordinates: { x: number, y: number }; // Player center
    manualExplorationNext?: boolean; // New: If true, skip AI gen for next exploration
}

// ------------------------

export interface RoundState {
  roundNumber: number;
  turnIndex: number;
  phase: GamePhase; // Current execution phase
  activeCharId?: string; // Currently acting character
  defaultOrder: string[]; // The user-defined standard order (e.g., [1, 3, 2])
  currentOrder: string[]; // The actual order for this specific round (might be modified by effects)
  isReverse: boolean;
  isPaused: boolean;
  autoAdvance: boolean; // Deprecated boolean, kept for compatibility but now we use count
  autoAdvanceCount?: number; // New: Number of rounds to auto-play
  actionPoints: number; // Global action points for the player/party to move or act
  lastErrorMessage?: string; // New: Track error message for visualization
  
  // Manual Order Feature
  useManualTurnOrder?: boolean;
  isWaitingForManualOrder?: boolean; // If true, blocks execution until order is confirmed
  
  // Skip Settlement Feature
  skipSettlement?: boolean; // If true, skips settlement phase

  // Auto Reaction Feature
  autoReaction?: boolean; // If true, player characters react automatically using AI. If false, player inputs reaction.

  // Time Flow Control
  isWorldTimeFlowPaused?: boolean; // If true, automatic world time progression is paused

  // Hidden Round Feature
  isHiddenRound?: boolean; // If true, this round is a special hidden round
  hiddenRoundQueue?: string[][]; // New: Queue of character orders for subsequent hidden rounds
  hiddenRoundCounter?: number; // New: 1-based counter for current hidden round index
}

// NEW: Snapshot of Round State for Restoration
export type RoundSnapshot = RoundState;

export interface LogEntry {
    id: string;
    round: number;
    turnIndex: number;
    locationId?: string; // If undefined, considered a "Global" event (e.g. Round Start)
    presentCharIds?: string[]; // IDs of characters present when this happened. Used for memory filtering.
    content: string; // The text content
    timestamp: number;
    type?: 'narrative' | 'system' | 'action';
    isReaction?: boolean; // New: Marks if this log is a passive reaction to another event, not a main turn action
    
    // KEY UPDATE: Stores the round state at the moment this log was created
    snapshot?: RoundSnapshot;
    
    // NEW: Explicitly track who performed the action/reaction in this log
    actingCharId?: string;

    // Multi-modal support
    images?: GameImage[]; // Images attached to this log entry
}

export interface StoryTag {
    id: string;
    text: string;
    status: 'neutral' | 'like' | 'dislike';
    timestamp: number;
}

export interface WorldState {
  attributes: Record<string, GameAttribute>; // Weather, Mana, etc. (Location removed)
  history: LogEntry[]; // Structured Story Log
  worldGuidance: string; // User-defined direction for AI generation
  
  // New Story Suggestion Features
  lastFunSuggest?: string; // Stores {{FUN_SUGGEST}}
  storyTags?: StoryTag[]; // Stores all active tags
  
  // New: Semantic Trigger Logic
  activeLanguageConditions?: string[]; // List of fulfilled natural language condition IDs
}

export type GamePhase = 'init' | 'order' | 'turn_start' | 'char_acting' | 'executing' | 'settlement' | 'round_end';

export interface LockedFeatures {
    cardPoolEditor: boolean;
    characterEditor: boolean;
    locationEditor: boolean;
    actionPoints: boolean;
    // locationReset merged into locationEditor
    worldState: boolean;
    directorInstructions: boolean;
    prizePoolEditor: boolean;
    triggerEditor: boolean; // New
    mapView: boolean; // New: Locks map pan/zoom/view reset
    modelInterface: boolean; // New: Locks model configuration
}

export interface GlobalVariable {
    id: string;
    key: string;
    value: string;
}

// --- THEME SYSTEM ---
export interface ThemePalette {
    baseHue: string; // e.g. "slate", "gray", "zinc" - For Backgrounds/Borders
    baseSat?: number; // 0..2 Saturation Multiplier (Default 1)
    
    primaryHue: string; // e.g. "indigo", "violet" - For Primary Actions
    primarySat?: number; // 0..2 Saturation Multiplier (Default 1)
    
    secondaryHue: string; // e.g. "teal", "cyan" - For Secondary Actions/Highlights
    secondarySat?: number; // 0..2 Saturation Multiplier (Default 1)

    // New Semantic Colors
    libidoHue?: string; // Pleasure related (Default Pink)
    libidoSat?: number; // Independent Saturation

    dopamineHue?: string; // Happiness/Reward related (Default Yellow)
    dopamineSat?: number; // Independent Saturation

    endorphinHue?: string; // Tension/Relief related (Default Orange)
    endorphinSat?: number; // Independent Saturation

    oxytocinHue?: string; // Calm/Trust related (Default Teal)
    oxytocinSat?: number; // Independent Saturation

    // --- Story Log Specific ---
    storyLogBgHue?: string; // Background color for the story log
    storyLogBgSat?: number; 
    storyLogTextHue?: string; // Main text color for the story log
    storyLogTextSat?: number;
}

export interface ThemeConfig {
    light: ThemePalette;
    dark: ThemePalette;
}

export interface ImageSettings {
    maxShortEdge?: number;
    maxLongEdge?: number;
    compressionQuality?: number;
}

export interface AppSettings {
    apiKeys: Record<Provider, string>;
    customEndpoints: CustomEndpoint[]; // New: List of custom endpoints
    maxOutputTokens?: number; // Max output tokens for generation (Renamed from maxContextSize)
    maxInputTokens?: number; // New: Estimated max input tokens for context window
    reactionContextTurns?: number; // How many history lines to include for reactions
    devOptionsUnlocked: boolean; // Track if dev options are unlocked in this session
    devPassword?: string; // Password for developer options
    encryptSaveFiles?: boolean; // New: Toggle for save encryption
    saveExpirationDate?: string; // New: ISO String for Save Expiration
    lockedFeatures: LockedFeatures; // New: Feature locking for end-user distribution
    globalVariables: GlobalVariable[]; // New: Global Text Macros
    storyLogLightMode: boolean; // New: Global Light Mode Toggle
    storyLogFontSize?: number; // New: Font size for story log (px)
    storyLogFontWeight?: number; // New: Font weight for story log (100-900)
    
    // History Limit Settings
    maxHistoryRounds?: number; // Rounds of global history to send to AI
    maxShortHistoryRounds?: number; // Rounds of short global history for logic checks
    maxCharacterMemoryRounds?: number; // Rounds of character-specific memory
    maxEnvMemoryRounds?: number; // New: Memory rounds for environment characters
    
    // SPLIT MEMORY DROPOUT SETTINGS
    actionMemoryDropoutProbability?: number; // New: Probability to reduce memory during Action phase (4 rounds)
    reactionMemoryDropoutProbability?: number; // New: Probability to reduce memory during Reaction phase (2 rounds)

    savedLetterTemplates?: LetterTemplate[]; // Saved Letter Templates
    themeConfig: ThemeConfig; // NEW: Theming with Dual Modes
    
    // New: Image Configuration
    imageSettings: ImageSettings;

    // New: Native Chooser Override (for Android)
    useNativeChooser?: boolean;
    
    // Streaming Toggle
    enableStreaming?: boolean;
    
    // Auto Scroll Behavior
    autoScrollOnNewLog?: boolean; // Default false. If true, auto-scroll to bottom on new message.

    // Hidden Round Visibility
    showHiddenRoundContent?: boolean; // Default false. If true, show content even if player is not present.
    showAvatarsInLog?: boolean; // Default false. If true, show avatars in story log.
}

export interface GameplaySettings {
    defaultInitialCP?: number;
    defaultCreationCost?: number;
    defaultInitialAP?: number;
    worldTimeScale?: number; // New: Control simulation speed (1 = 1sec/sec)
    maxNPCsPerRound?: number; // New: Max NPCs to activate per round (Default 4)
    pleasureThresholdLow?: number;
    pleasureThresholdHigh?: number;
    pleasureDecayRate?: number;
    physiqueRecoveryRate?: number;
}

// New Templates and Prompts structure
export interface Templates {
    character: Character;
    location: MapLocation;
    cards: {
        skill: Card;
        item: Card;
        event: Card;
    };
}

export interface WeatherType {
    name: string;
    weight: number;
}

// New: Initial World Configuration
export interface InitialWorldConfig {
    startRegionName: string;
    startRegionDesc: string;
    startLocationName: string;
    startLocationDesc: string;
    environmentCharNameSuffix: string; // e.g. "的环境"
    environmentCharDescTemplate: string;
}

export interface DefaultSettings {
    gameplay: GameplaySettings;
    templates: Templates;
    prompts: PromptsConfig;
    weatherConfig: WeatherType[]; 
    weatherChangeProbability?: number;
    initialWorldConfig?: InitialWorldConfig; // New: Configurable initial world text
}

export interface DebugLog {
    id: string;
    timestamp: number;
    characterName: string;
    prompt: string;
    response: string;
}

export interface WindowState {
    type: 'char' | 'card' | 'settings' | 'world' | 'pool' | 'char_pool' | 'location_pool' | 'dev' | 'char_gen' | 'prize_pool' | 'shop' | 'trigger_pool' | 'letter' | 'theme' | 'location_edit' | 'story_edit' | 'world_composition' | 'puzzle' | 'reading_mode' | 'review';
    data?: any;
    id: number;
}

export interface GameState {
  world: WorldState;
  map: MapState; // New Map System
  round: RoundState;
  characters: Record<string, Character>;
  cardPool: Card[];
  prizePools: Record<string, PrizePool>; // New: Lottery System
  triggers: Record<string, Trigger>; // New: Trigger System
  triggerGroups: Record<string, TriggerGroup>; // New: Trigger Groups
  judgeConfig?: AIConfig; // Global AI for judging world effects
  charGenConfig?: AIConfig; // NEW: Dedicated AI for Character Generation
  charBehaviorConfig?: AIConfig; // NEW: Dedicated AI for Character Action/Reaction
  globalContext: GlobalContextConfig; // Global prepended context
  appSettings: AppSettings;
  
  // New central configuration
  defaultSettings: DefaultSettings;

  devMode: boolean;
  debugLogs: DebugLog[];
}

// AI Action Types
export type CommandType = 'use_skill' | 'buy_card' | 'create_card' | 'create_attr' | 'update_attr' | 'move_to' | 'lottery' | 'redeem_card';

export interface AICommand {
    type: CommandType;
    skillId?: string; // For use_skill
    targetId?: string; // For use_skill, create_attr (target char)
    buyCardId?: string; // For buy_card
    createdCard?: Card; // For create_card
    createdAttributes?: Array<{ targetId: string, attribute: GameAttribute }>; // For create_attr
    attributeUpdates?: Array<{ target: 'self'|'world', key: string, value: string|number, visibility?: AttributeVisibility }>; // For update_attr
    destinationName?: string; // For move_to
    
    // Lottery Command
    poolId?: string;
    action?: 'draw' | 'deposit' | 'peek';
    
    // Draw parameters
    amount?: number; // How many items to draw
    
    // Deposit parameters
    cardIds?: string[]; // IDs of inventory cards to deposit (New: Array support)
    // Deprecated: itemName (Support legacy for now)
    itemName?: string; 
    
    isHidden?: boolean;

    // Redeem Card (Environment Character)
    targetCharId?: string;
    oldCardId?: string;
    newCard?: Card;

    // (Removed effectOverrides)
}

export interface TurnAction {
    narrative: string;
    speech?: string; // New: Separated speech
    timePassed?: string; // New: Time passed string (e.g. "00:00:05:00")
    commands: AICommand[];
    // Environment characters can generate conflicts for others
    generatedConflicts?: Array<{ targetCharId: string, desc: string, apReward: number }>;
    // Environment characters can generate new drives for others (Pleasure System)
    generatedDrives?: Array<{ targetCharId: string, drive: Drive }>;
    // Fallback for raw AI response
    text?: string;
    // New: Secrets generated by AI
    generatedSecrets?: Array<{ question: string, correctAnswer: string, wrongAnswerA: string, wrongAnswerB: string }>;
    
    // New: Character's Move Intention/Plan
    movePlan?: string; 
}