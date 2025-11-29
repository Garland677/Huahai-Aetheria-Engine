
/**
 * Aetheria Engine - Default Prompts & Templates
 */

/*
* --- MACRO DOCUMENTATION (可用宏变量) ---
*
* 1. checkCondition (单项逻辑判定 / Single Check)
*    {{CONDITION}} - 待判定的条件语句 (The condition string to evaluate)
*    {{WORLD}}     - 世界环境属性 (World state like time, weather)
*    {{ENTITIES}}  - 相关角色/实体的属性 (Attributes of source/target chars)
*    {{SHORT_HISTORY}} - **短**全局故事记录 (Short global logs, limited by maxShortHistoryRounds)
*
* 2. checkConditionsBatch (批量逻辑判定 / Batch Check) - *当前引擎默认使用 (Default)*
*    {{SHORT_HISTORY}} - **短**全局故事记录 (Short global logs)
*    {{ENTITIES}}  - 相关角色/实体的属性 (Attributes of source/target chars)
*    {{WORLD}}     - 世界环境属性 (World state like time, weather)
*    {{ITEMS}}     - 待判定的效果/条件列表 (List of effects to check)
*
* 3. determineCharacterAction (角色行动)
*    {{SPECIFIC_CONTEXT}} - 角色自身的人设/描述 (Persona)
*    {{LOCATION_CONTEXT}} - 当前地点描述 (Location info)
*    {{NEARBY_CONTEXT}}   - 周边地点信息 (Nearby locations)
*    {{KNOWN_REGIONS}}    - 已知世界区域列表 (List of known regions)
*    {{OTHERS_CONTEXT}}   - 在场其他角色信息 (Other characters present)
*    {{HISTORY_CONTEXT}}  - 角色个人相关记忆 (Character's memory)
*    {{SELF_CONTEXT}}     - 自身属性、状态、技能 (Self attributes/skills)
*    {{SHOP_CONTEXT}}     - 可购买的卡池物品 (Shop items)
*    {{PRIZE_POOLS}}      - 可用的奖池列表 (Available prize pools)
*    {{COST}}             - 创造/购买的基础消耗 (Cost value)
*    {{WORLD_STATE}}      - 世界环境属性 (World state variables)
*    {{PLEASURE_GOAL}}    - 快感系统目标指导 (Pleasure system instructions)
*
* 4. determineCharacterReaction (角色反应)
*    {{CHAR_NAME}}  - 角色名
*    {{CHAR_ID}}    - 角色ID
*    {{CHAR_DESC}}  - 角色描述
*    {{PLEASURE_GOAL}} - 快感目标指导
*/

import { DefaultSettings, AttributeType, AttributeVisibility, Character, Card, MapLocation, TerrainType } from "../types";

const defaultAcquireCard: Card = {
    id: "card_acquire_default",
    name: "尝试获取",
    description: "试图在未经允许的情况下得到物品，如抢夺、盗窃等，需要发动者有相应的行为支持。此技能将立刻触发目标的反应，需要发动者判断当前是否能够获取。",
    itemType: "skill",
    triggerType: "reaction", 
    cost: 0,
    effects: [
        {
            id: "eff_acquire_check",
            name: "获取判定",
            targetType: "specific_char",
            targetAttribute: "健康", 
            value: 0,
            conditionDescription: "目标没有成功阻止获取行为", 
            conditionContextKeys: []
        }
    ]
};

const defaultTradeCard: Card = {
    id: "card_trade_default",
    name: "交易",
    description: "当角色想要进行交易时使用（购买他人物品或行为、出售自己的物品或行为）。需指明交易目标、物品及是否开价。此行动会触发目标反应，决定交易是否达成。交易技能可以用于无价格交换使用，也可以交易非实物如承诺。",
    itemType: "skill",
    triggerType: "reaction",
    cost: 0,
    effects: [
        {
            id: "eff_trade_check",
            name: "交易判定",
            targetType: "specific_char",
            targetAttribute: "健康",
            value: 0,
            conditionDescription: "双方达成交易意向",
            conditionContextKeys: []
        }
    ]
};

const defaultInteractCard: Card = {
    id: "card_interact_default",
    name: "互动",
    description: "与目标进行言语或肢体互动，引起对方的注意或反应。不造成实质属性影响，仅触发对方的回应。",
    itemType: "skill",
    triggerType: "reaction",
    cost: 0,
    effects: [] // No effects -> Pure RP trigger
};

const defaultCharacterTemplate: Character = {
    id: "template_char",
    isPlayer: false,
    name: "新角色模版",
    appearance: "普通的样貌。",
    description: "在这里填写角色的生平、性格、背景秘密和行为逻辑。",
    avatarUrl: "",
    attributes: {
        '健康': { id: '健康', name: '健康', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
        '快感': { id: '快感', name: '快感', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
        '体能': { id: '体能', name: '体能', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
        '能量': { id: '能量', name: '能量', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PRIVATE },
        '创造点': { id: '创造点', name: '创造点', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
        '状态': { id: '状态', name: '状态', type: AttributeType.TEXT, value: '正常', visibility: AttributeVisibility.PUBLIC },
    },
    skills: [defaultAcquireCard, defaultTradeCard, defaultInteractCard],
    inventory: [],
    drives: [
        { id: 'drive_1', condition: "做出符合人设的有效行动", amount: 10, weight: 50 }
    ],
    conflicts: [],
    contextConfig: { 
        messages: [
            { role: "system", content: "你现在进入角色扮演模式。" }
        ] 
    },
    appearanceCondition: "总是",
    enableAppearanceCheck: true
};

const defaultLocationTemplate: MapLocation = {
    id: "template_loc",
    name: "新地点",
    description: "这是一个未知的地点。",
    coordinates: { x: 0, y: 0, z: 0 },
    isKnown: false,
    radius: 50,
    associatedNpcIds: [],
    attributes: {}
};

const defaultCardSkill: Card = {
    id: "template_skill",
    name: "新技能",
    description: "技能描述。",
    itemType: "skill",
    triggerType: "active",
    cost: 0,
    effects: [
        {
            id: "eff_1", name: "命中判定", targetType: "specific_char", targetAttribute: "健康", targetId: "", value: 0,
            conditionDescription: "无 (默认为真)", conditionContextKeys: []
        },
        {
            id: "eff_2", name: "效果", targetType: "specific_char", targetAttribute: "健康", targetId: "", value: -10,
            conditionDescription: "命中成功", conditionContextKeys: []
        }
    ]
};

const defaultCardItem: Card = {
    ...defaultCardSkill,
    id: "template_item",
    name: "新物品",
    description: "这是一个消耗品。",
    itemType: "consumable",
    cost: 5
};

const defaultCardEvent: Card = {
    ...defaultCardSkill,
    id: "template_event",
    name: "新事件/被动",
    description: "回合结束时触发的被动效果。",
    itemType: "event",
    triggerType: "settlement"
};

// Prompts as strings with placeholders
const PROMPTS = {
    checkCondition: `
    任务：判定逻辑条件
    条件语句: "{{CONDITION}}"
    
    [世界状态]
    {{WORLD}}

    [相关实体属性]
    {{ENTITIES}}

    [近期故事 (Short Context)]
    {{SHORT_HISTORY}}
    
    请根据上下文数据判断条件是否成立。
    
    要求：
    1. result: boolean (true/false)
    2. reason: string (10个字以内说明原因)
    
    输出格式 (JSON ONLY, 无Markdown):
    { "result": true, "reason": "..." }
  `,

    checkConditionsBatch: `
    角色：游戏规则逻辑判定核心
    
    任务：严格基于提供的 [世界状态]、[近期故事] 和 [相关实体属性] 来评估逻辑条件列表。
    
    核心规则：
    1. **判定 (Evaluate)**: 计算条件是否成立。
       - 如果条件是 "True", "None", "Always", "无", "必中", 结果为 true。
       - 如果条件是 "Hit Success" 或依赖前置效果成功，且没有相反证据，结果为 true。
    2. **数值严格性 (Math Strictness)**:
       - "大于" (>) : 50 > 50 是 False。
       - "大于等于" / "不低于" / "以上" (>=) : 50 >= 50 是 True。
       - "小于" (<) : 50 < 50 是 False。
       - "小于等于" / "不高于" / "以下" (<=) : 50 <= 50 是 True。
       - 如果待判定值不为数值（如状态属性），则需要结合故事上下文进行判断。
    3. **属性别名 (Alias)**: 
       - 请自动识别属性的中英文映射。例如：Health=健康, CP=创造点, Status=状态, Physique=体能。
       - **重要**: 如果目标实体拥有 "Health" 或 "健康" 属性，视为**属性存在**。
    4. **属性缺失与发现 (Discovery)**: 
       - 只有当条件明确检测一个不存在的属性（且不是常用别名）时，在 results 中返回 newAttribute 建议。
    5. **衍生数值 (Derived Value)**:
       - 如果条件要求动态计算数值（如 "造成力量x2的伤害"），请在 derivedValue 字段返回计算结果。
    6. **智能目标选择 (Smart Targeting)**:
       - 对于每一个待判定项目，请仔细阅读其名称和描述。
       - **关键**: 如果项目描述显式带有攻击性/负面性，且没有指定目标，请根据角色关系（Character Descriptions）选择一个合乎逻辑的敌对目标，**不要**选择发动者自己，除非描述中包含自残/牺牲。
       - 将你选择的目标名字返回在 "targetName" 字段中。
    
    [特殊规则 - 物品获取与交易 (Item Acquisition & Trade)]
    1. **尝试获取 (Acquire)**: 如果项目名称包含 "尝试获取" 且判定通过，分析故事中角色想获取什么。
       - 若明确且未被阻止，result=true 并返回 "tradeResult"。
       - 若不明确但行为成功，生成合理物品并返回 "tradeResult"。
    2. **交易 (Trade)**: 如果项目名称包含 "交易" 且判定通过 (双方同意)，必须分析交易的细节。
       - **判断交易方向**: 
         - 如果是发起方(source)向目标方(target)购买物品，则 "transactionType": "buy"。
         - 如果是发起方(source)向目标方(target)出售物品，则 "transactionType": "sell"。
         - 默认为 "buy"。
       - **提取价格 (Price)**: (CP/创造点/Money)，如果文中未提及具体数值但隐含交易，请估算一个合理价格，或者判断为双方自愿交换，价格为0。
       - 在 "tradeResult" 中包含 "price" 和 "transactionType" 字段。
       - 如果对方同意了交易，result 为 true。
       - 如果交易内容为行为或者服务，应当生成名为「*卖方名*的承诺」的交易结果物品，该物品的描述中将表明「*卖方名*承诺了*行为或服务*，命中后必须执行」，卡牌的效果判定条件为「目标为*卖方名*」

    [近期故事 (Short Context)]
    {{SHORT_HISTORY}}

    [相关实体属性 (可选目标) - 包含描述以便判断敌我关系]
    {{ENTITIES}}

    [世界状态]
    {{WORLD}}

    [创造点/结算获取 待判定列表 (包含描述)]
    {{ITEMS}}

    输出格式 (JSON Only):
    {
      "results": {
        "item_id": { 
            "result": boolean, 
            "reason": "10字以内的判定原因", 
            "derivedValue": number | null, 
            "targetName": "智能推断的目标角色名 (可选)",
            "newAttribute": { "name": "...", "type": "NUMBER|TEXT" } | null,
            "tradeResult": { 
                "itemName": "物品名称",
                "itemType": "consumable" | "skill",
                "description": "物品描述",
                "transactionType": "buy" | "sell", // 交易类型：buy=买入(Source付钱), sell=卖出(Target付钱)
                "price": 0, // 交易金额(CP)
                "sourceCharacterName": "物品的原持有者名字(如果是交易)",
                "effectSummary": "物品效果简述"
            } | null
        },
        ...
      }
    }
  `,
    
    checkConditionsStrictInstruction: `注意：请严格遵循数值比较逻辑。不要因为"接近"就判为真。50不大于50。`,

    determineTurnOrder: `
    角色：TRPG 游戏主持人 (DM)
    任务：根据当前场景、角色状态和故事发展，决定下一轮的角色行动顺序。
    
    [世界状态]
    {{WORLD_STATE}}

    [当前地点]
    {{LOCATION_NAME}}

    [活跃角色ID]
    {{ACTIVE_CHARS}}
    
    [角色列表]
    {{CHAR_LIST}}

    [近期故事]
    {{HISTORY}}

    输出格式 (JSON Only):
    {
      "order": ["char_id_1", "char_id_2", ...],
      "worldUpdates": { "key": "value" } // 可选的世界属性更新（如天气、时间）
    }
  `,

    determineCharacterAction: `
    [历史记忆 (个人视角)]
    {{HISTORY_CONTEXT}}
    
    [世界状态 (不含具体时间)]
    {{WORLD_STATE}}
    
    [当前状态 & 属性]
    {{SELF_CONTEXT}}

    [当前地点]
    {{LOCATION_CONTEXT}}

    [已知世界区域 (宏观认知)]
    {{KNOWN_REGIONS}}

    [周边地点信息 (可移动目的地)]
    {{NEARBY_CONTEXT}}

    [在场其他角色]
    {{OTHERS_CONTEXT}}
    
    [卡池 /商店 (可用CP购买)]
    基础创造消耗: {{COST}} CP
    {{SHOP_CONTEXT}}

    [可用抽奖池 (PRIZE POOLS)]
    {{PRIZE_POOLS}}

        角色扮演指令：
    请看你的人格描述，你要开始行动了。

    [角色设定 (Persona)]
    {{SPECIFIC_CONTEXT}}

    --- 基于快感和矛盾的行动规则 ---
    1. **角色扮演 (Roleplay)**: 必须符合人设。
    2. **逻辑判断 (Logic)**:
       - 快感系统目标 (Drives & Pleasure): {{PLEASURE_GOAL}}
       - 矛盾 (Conflicts): 结合上述快感目标，尝试解决活跃矛盾。
    3. **时间感知 (Time Judgment)**:
       - 根据你的行动内容，判断这大约花费了多少时间。
       - 对话/闲聊: 1分钟 - 10分钟
       - 战斗回合: 5分钟 - 30分钟
       - 探索/搜寻: 30分钟 - 2小时
       - 睡眠/等待: 6小时 - 3天
       - **请在 JSON 中返回 timePassed 字段 (格式 DD:HH:MM:SS)。**
    4. **行动约束 (Action Constraints)**:
       - **use_skill**: 仅限使用 [主动行动 (本轮可用)] 列表中的技能/物品。**严禁**使用 [被动/结算效果] 列表中的卡牌。使用任何技能时，角色都应当有明确的意图。
         - **重要**: 如果使用的技能效果中表明了 "AI决定" (AI Decides) ，你**必须**在 commands 中使用 "effectOverrides" 字段合理安排具体数值。
       - **move_to**: 如果决定移动，请从 [周边地点信息] 中选择一个目的地。
       - **buy_card**: 仅当 CP 足够时购买。
       - **create_card**: 消耗 CP 创造新能力。必须符合世界观和人设。
       - **lottery**: 使用游戏的奖池功能，奖池的具体用法应该参考奖池描述。
         - **action='draw'**: 必须指定 "amount" (抽取数量)。默认 1，但可以更多（如果奖池允许）。
         - **action='deposit'**: 必须在 "cardIds" 中提供要放入的物品ID列表 (可以多个)。例如 ["id1", "id2"]。**注意**: 只能放入 [背包] 中的物品，不能放入 [固有] 能力。**不要**使用 itemName。
         - **action='peek'**: 尝试查看奖池中的物品。
       - **redeem_card**: **[环境角色专用]** 检查并替换占位符卡牌为真实卡牌。
       - **generatedConflicts**: **[环境角色专用]** 如果你是环境角色，根据本轮故事中的冲突，apReward在10-30之间。如果某角色id已经有矛盾，禁止生成矛盾！！！
         - 矛盾是阻碍剧情推进的力量，例如角色间的仇恨和利益冲突、角色间的友情和爱情没有进展、角色自身的高远追求无法实现、角色的个人疑惑无法想通等。矛盾应该明确可解决。
       - **generatedDrives**: **[环境角色专用]** 如果你是环境角色，根据本轮故事中的诱惑，给在场角色添加新的驱力(Drives)，快感强度（amount）在10-30之间，默认权重应设为 50。
         - 驱力是角色非理性的欲望，如奴役、归属、控制、杀戮、拯救、性、掠夺、求胜、逃跑、饮食、睡眠等。驱力的描述必须明确而直接，且不一定有目标。
    5. **叙事与台词**: 
       - "narrative": 描述详细的肢体动作、心理活动、环境互动。**使用第三人称**。不要使用 HTML 标签。
       - "speech": 角色的台词语言。保持口语化。不要使用 HTML 标签。

    输出格式 (JSON Only - NO MARKDOWN BLOCK):
    {
      "narrative": "描述性文本 (纯文本，禁止 HTML)",
      "speech": "台词文本 (纯文本，禁止 HTML)",
      "timePassed": "00:00:05:00", // 本轮行动预估消耗的时间
      "commands": [
        { "type": "use_skill", "skillId": "id", "targetId": "id", "effectOverrides": { 1: -20 } },
        { "type": "buy_card", "buyCardId": "id" },
        { "type": "create_card", "createdCard": { "name": "...", "effects": [...] } },
        { "type": "move_to", "destinationName": "目标地点名" },
        { "type": "lottery", "poolId": "id", "action": "draw|deposit|peek", "amount": 1, "cardIds": ["id1", "id2"], "isHidden": false },
        { "type": "redeem_card", "targetCharId": "id", "oldCardId": "id", "newCard": { ... } }
      ],
      "generatedConflicts": [
          { "targetCharId": "id", "desc": "为当前没有矛盾的角色生成一个矛盾", "apReward": 20 }
      ],
      "generatedDrives": [
          { "targetCharId": "id", "drive": { "condition": "...", "amount": 15, "weight": 50 } }
      ]
    }
  `,

    determineCharacterReaction: `
    演绎角色：{{CHAR_NAME}} (ID: {{CHAR_ID}})
    设定：{{CHAR_DESC}}
    [快感目标] {{PLEASURE_GOAL}}
    
    [世界状态 (不含具体时间)]
    {{WORLD_STATE}}

    [场景中其他角色]
    {{OTHERS_CONTEXT}}

    [近期经历]
    {{RECENT_HISTORY}}

    [触发事件]
    {{TRIGGER_EVENT}}

    任务：请以第一人称或第三人称，对 [触发事件] 定义的事件做出符合你角色的详细的身体动作演绎和反应（吐槽、心理活动、评价或喊话）。
    这只是一段反应台词，你不能进行主动行为。
    
    **重要：输出必须是纯文本。绝对禁止包含 HTML 标签 (如 <span...>) 或 Markdown 格式。**
    **IMPORTANT: Output valid JSON string. No HTML. No Markdown.**

    输出格式 (JSON Only):
    { "speech": "..." }
  `,

    generateLocationDetails: `
    任务：生成地点详细信息 (中文)
    坐标: ({{X}}, {{Y}}, {{Z}})
    
    [世界指导]
    {{WORLD_GUIDANCE}}

    [区域上下文]
    {{REGION_CONTEXT_INSTRUCTION}}
    {{REGION_GEN_INSTRUCTION}}
    
    [地形数据]
    {{REGION_STATS_CONTEXT}}
    {{TERRAIN_ANALYSIS}}

    [现有角色]
    {{EXISTING_CHARS_CONTEXT}}

    要求：
    1. Name: 地点名称 (中文)。
    2. Description: 200字描述一个小地点如酒馆、电线杆下、街头、河边柳树下，应该包括地点的地理学特征，景色，当地的人物关系，特殊文化，癖好，活动，历史，以及与区域整体的关联。在本游戏中，高度超过300米即为雪山，高度低于0即为水域，但这并不意味着你必须生成水下区域。
    3. Region: 如果需要生成新区域，提供 region 对象。在生成区域描述的时候，以更加宏观的方式，200字描述一个地理版块的地理学特征、自然生态、政权情况、地区历史。最重要的是，需要列举该区域中存在的至少5个地点名称，这些名称是为了将来生成区域内地点的时候以可信的方式引用。

    **直接输出严格JSON格式**

    输出格式 (JSON Only):
    {
      "name": "地点名",
      "description": "...",
      "region": { "name": "...", "description": "..." } (可选)
    }
  `,

    generateCharacter: `
    任务：生成新角色，如果是人类角色，必须使用人类姓名列表
    描述需求: {{DESC}}
    风格需求: {{STYLE}}
    当前位置: {{LOCATION_NAME}}({{REGION_NAME}})：{{LOCATION_CONTEXT}} 
    
    [高优先级：强制人类姓名列表]
    {{SUGGESTED_NAMES}}
    
    [周边角色]
    {{EXISTING_CHARS}}
    
    [近期故事]
    {{HISTORY}}

    要求：
    1. 属性 (Attributes) 必须固定包含以下4个：
       - 创造点：必须默认为 50。
       - 健康：20-90 之间。
       - 体能：0-90 之间。
       - 快感：20-90 之间。
    2. 技能 (Skills) 必须包含 Card 对象结构，Condition 用自然语言描述。
       - **重要禁止**: 严禁生成名称中包含 "交易" (Trade), "获取" (Acquire), "互动" (Interact), "尝试获取" 等基础功能的卡牌。系统会自动为所有角色添加这些默认能力，请不要重复生成。
       - 必须包含一个健康影响技能、一个体能影响技能和一个快感影响技能。你可以根据角色设定决定要是正面技能还是负面技能。
       - "description": 100字详细描述技能成功时，角色将如何具体地攻击、恢复或者控制目标，这里需要描述角色与目标的详细互动。
       - **技能必须包含具体效果数值**:
         - "effect_attr": 影响的目标属性名 (如: 健康, 快感, 体能, CP, 状态)。默认为 '健康'。
         - "effect_val": 具体的整数值，范围通常在 -10 到 10 之间。 (负数=伤害/消耗，正数=回复/增强)。
    3. **必须**包含 "appearance" (外观): 描述角色的外貌（如体形、身高、服装、配饰），这是所有人都可见的公开信息。
    4. **必须**包含 "description" (描述): 200-400字，角色的生平、性格、秘密、癖好等私人信息，需要能够指导角色获取快感、追求目标、攻击与合作、探索环境的手段。
    5. 必须包含 "drives" (快感驱力/目标): 列表对象 { condition: "...", amount: 10-30, weight: 50 }。
      - 驱力是角色非理性的欲望，如奴役、归属、控制、杀戮、拯救、性、掠夺、求胜、逃跑、饮食、睡眠等。驱力的描述必须明确而直接，且不一定有目标。
    6. 必须包含 1-2 个初始矛盾 (conflicts)。每个矛盾必须包含 "desc"(描述) 和 "apReward"(10-30点)。
      - 矛盾是阻碍剧情推进的力量，例如角色间的仇恨和利益冲突、角色间的友情和爱情没有进展、角色自身的高远追求无法实现、角色的个人疑惑无法想通等。矛盾应该明确可解决。
    
    接下来，直接输出严格JSON格式：
    输出格式:
    {
      "name": "...",
      "appearance": "外貌描述...",
      "description": "详细生平与性格...",
      "attributes": { ... },
      "skills": [ 
          { 
              "name": "...", 
              "description": "...", 
              "trigger": "active", 
              "condition": "...",
              "effect_attr": "健康",
              "effect_val": -5
          } 
      ],
      "drives": [ { "condition": "...", "amount": 15, "weight": 50 } ],
      "conflicts": [ { "desc": "...", "apReward": 20 } ]
    }
  `,

    analyzeSettlement: `
    任务：分析故事发展，结算快感(Pleasure)奖励和矛盾解决。
    
    [世界状态]
    {{WORLD_STATE}}

    [近期故事]
    {{HISTORY}}
    
    [活跃矛盾列表 (Conflicts)]
    {{CONFLICTS_LIST}}
    
    [快感驱力列表 (Drives)]
    {{DRIVES_LIST}}
    
    请判断：
    1. 哪些矛盾 (Conflicts) 在近2轮故事中已经不再持续？ (返回 ID)
    2. 哪些 快感驱力 (Drives) 正在被追求？ (返回 ID)
    3. 简要分析理由。

    输出格式 (JSON Only):
    {
        "analysis": "思维链分析...",
        "solvedConflictIds": ["id1", ...],
        "fulfilledDriveIds": ["id2", ...]
    }
  `,

    analyzeTimePassage: `(DEPRECATED - This logic is now integrated into character actions)`,

    analyzeNewConflicts: ``, // Placeholder if needed
    instruction_generateNewRegion: `(这是一个未探明的区域，请根据地形数据生成一个新的区域名称和主题描述，并将其应用于此地点。)`,
    instruction_existingRegionContext: `(此地点位于已知区域 "{{REGION_NAME}}" 内。描述应符合区域主题: {{REGION_DESC}}。)` ,
    context_nearbyCharacters: `(在此地点已存在的角色: {{CHARS_LIST}}。新生成的NPC应该与他们有潜在的互动或关系。)`
};

export const INITIAL_DEFAULT_SETTINGS: DefaultSettings = {
    gameplay: {
        defaultInitialCP: 50,
        defaultCreationCost: 50, // Updated from 5 to 50
        defaultInitialAP: 50,
        worldTimeScale: 1 // New Default
    },
    templates: {
        character: defaultCharacterTemplate,
        location: defaultLocationTemplate,
        cards: {
            skill: defaultCardSkill,
            item: defaultCardItem,
            event: defaultCardEvent
        }
    },
    prompts: PROMPTS,
    weatherConfig: [
        { name: "晴朗 (Sunny)", weight: 30 },
        { name: "多云 (Cloudy)", weight: 25 },
        { name: "阴天 (Overcast)", weight: 20 },
        { name: "小雨 (Light Rain)", weight: 10 },
        { name: "暴雨 (Heavy Rain)", weight: 5 },
        { name: "迷雾 (Foggy)", weight: 5 },
        { name: "酸雨 (Acid Rain)", weight: 2 },
        { name: "辐射尘 (Fallout)", weight: 1 },
        { name: "极光 (Aurora)", weight: 2 }
    ],
    weatherChangeProbability: 0.1,
    initialWorldConfig: {
        startRegionName: "旧世边缘",
        startRegionDesc: "远离繁华都市的边缘地带，被遗忘的旧世界残影。",
        startLocationName: "起始营地",
        startLocationDesc: "一切开始的地方。",
        environmentCharNameSuffix: "的环境",
        environmentCharDescTemplate: "【系统代理】{{LOCATION_NAME}}的环境旁白角色，根据故事需求扮演自然环境、居民或路人、当地动植物、天气以及突发状况等，如果地点描述可知当地无居民，则不应该扮演当地居民。如果当地的环境本身可以和角色互动或者尝试获取角色的物品，旁白可以主动使用相关技能。"
    }
};

export { defaultAcquireCard, defaultInteractCard, defaultTradeCard };
