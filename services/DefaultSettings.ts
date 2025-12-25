
/*
* --- MACRO DOCUMENTATION (可用宏变量说明书) ---
* ... (No changes to comments) ...
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
    description: "当角色想要进行交易时使用（购买他人物品或行为、出售自己的物品或行为）。需指明交易目标、物品及是否开价。此行动会触发目标反应，决定交易是否达成。交易技能可以用于无价格交换使用，也可以交易非实物如承诺。世界中，每一个cp的价值类似于中国的100元人民币",
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
    style: "在这里填写角色的说话风格，例如“杂鱼~杂鱼~”。",
    avatarUrl: "",
    attributes: {
        '健康': { id: '健康', name: '健康', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
        '快感': { id: '快感', name: '快感', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
        '体能': { id: '体能', name: '体能', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
        '活跃': { id: '活跃', name: '活跃', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
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
    useAiOverride: false, // Default to using global settings
    memoryConfig: {
        useOverride: false,
        maxMemoryRounds: 10,
        actionDropoutProbability: 0.34,
        reactionDropoutProbability: 0.34
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
<user>
    任务：判定逻辑条件
    条件语句: "{{CONDITION}}"
    
    [世界状态]
    {{WORLD}}

    [相关实体属性]
    {{ENTITIES}}

    [近期故事 (Short Context)]
    {{SHORT_HISTORY}}
    
    请根据上下文数据判断条件是否成立。如果没有明确证据，倾向于判定成功。
    
    要求：
    1. result: boolean (true/false)
    2. reason: string (10个字以内说明判定成功或失败的要点)
    
    输出格式 (JSON ONLY, 无Markdown):
    { 
      "语言": "中文",
      "result": true,
      "reason": "..."
    }
</user>
  `,

    checkConditionsBatch: `
<user>
    角色：游戏规则逻辑判定核心
    
    任务：严格基于提供的 [世界状态]、[近期故事] 和 [相关实体属性] 来评估逻辑条件列表。如果有多个效果的判定，请注意区分多个效果分别的条件。
    
    核心规则：
    1. **判定 (Evaluate)**: 计算条件是否成立。
       - 如果条件是 "True", "None", "Always", "必中", 结果为 true。如果条件是"None", "无", 在没有被动技能阻挡的情况下结果为true。 
       - 如果条件是 "Hit Success" 或依赖前置效果成功，且没有相反证据，结果为 true。
    2. **数值严格性 (Math Strictness)**:
       - "大于" (>) : 50 > 50 是 False。
       - "大于等于" / "不低于" / "以上" (>=) : 50 >= 50 是 True。
       - "小于" (<) : 50 < 50 是 False。
       - "小于等于" / "不高于" / "以下" (<=) : 50 <= 50 是 True。
       - 如果待判定值不为数值（如状态属性），则需要结合故事上下文进行判断。如果没有明确证据，倾向于判定成功。
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
    
    [被动卡牌判定规则 (Passive Card Interaction)]
    实体属性列表中包含了相关角色的 [Skills] 和 [Inventory]。其中 "type": "passive" 的是被动卡牌。
    1. **判定主动技能 (Active Skill)**:
       - 在判定 "itemType": "skill" (active) 的命中时，**必须**检查目标的 [Skills] 和 [Inventory] 中是否有相关的防御/闪避/无效化类被动卡牌。
       - 如果目标拥有符合情境的被动卡牌（例如“格挡”对抗“近战攻击”），且被动卡牌逻辑上能成功，则主动技能的判定结果 result 应为 **false**。
       - 在 reason 中注明：“被目标的 [被动卡牌名] 拦截/防御”。
    2. **判定被动技能 (Passive Skill)**:
       - 列表中的某些项目可能是被动技能本身。请检查该被动技能是否被当前的 context.incomingAction 触发。
       - 只有当被动技能的触发条件（如“受到攻击时”、“濒死时”）满足，并且其效果逻辑成立时，result 才为 **true**。
       - 被动技能如果未指定目标，默认目标为**主动技能的发动者 (Attacker)**。

    [特殊规则 - 物品获取与交易]
    1. **核心规则**：如果明确指定物品交换，**优先考虑判定物品**。如果没有物品交换，将会考虑判定承诺。
    2. **尝试获取 (Acquire)**: 如果项目名称包含 "尝试获取" 且判定通过，分析故事中角色想获取什么。
       - 若明确且未被阻止，result=true 并返回 "tradeResult"。
       - 若不明确但行为成功，引用或生成合理物品并返回 "tradeResult"。
       - "description": **100字**，详细描述交易对象的外观、触感、味道，或者承诺的具体内容。
       - "itemName": 如果你在[相关实体属性]中发现了卖方角色信息中的交易物品，你需要**一字不漏地提取该物品名称**。
    3. **交易 (Trade)**: 如果项目名称包含 "交易" 且判定通过 (双方同意)，必须分析交易的细节。
       - **判断交易方向**: 
         - 如果是发起方(source)向目标方(target)购买物品，则 "transactionType": "buy"。
         - 如果是发起方(source)向目标方(target)出售物品，则 "transactionType": "sell"。
       - "description": **100字**，详细描述交易对象的外观、触感、味道，或者承诺的具体内容。
       - **提取价格 (Price)**: (CP/创造点/Money)，如果文中未提及具体数值但隐含交易，请估算一个合理价格，或者判断为双方自愿交换，价格为0。
       - 在 "tradeResult" 中包含 "price" 和 "transactionType" 字段。
       - 如果对方同意了交易，result 为 true。
       - 如果交易内容为行为或者服务，应当生成名为「*卖方名*的承诺」的交易结果物品，该物品的描述中将表明「*卖方名*承诺了*行为或服务*，命中后必须执行」，卡牌的效果判定条件为「目标为*卖方名*」. 该物品的描述中将以100字详细描述该承诺的具体内容。

    [近期故事 (Short Context)]
    {{SHORT_HISTORY}}

    [相关实体属性 (包含被动卡牌信息)]
    {{ENTITIES}}

    [世界状态]
    {{WORLD}}

    [待判定列表 (包含描述与上下文)]
    {{ITEMS}}
</user>
<assistant>
    好的，我理解判定工作的内容了。在某些特殊情况下，我还需要判断交易的买方和卖方，并且给物品写上详细的描述。现在请给我输出格式吧。
</assistant>
<user>

    输出格式 (JSON Only):
    {
      "语言": "中文",
      "results": {
        "item_id": { 
            "result": boolean, 
            "reason": "10个字以内说明判定成功或失败的要点", 
            "derivedValue": number | null, 
            "targetName": "智能推断的目标角色名 (可选)",
            "newAttribute": { "name": "...", "type": "NUMBER|TEXT" } | null,
            "tradeResult": { 
                "itemName": "物品名称",
                "itemType": "consumable" | "skill",
                "description": "详细描述交易对象的外观、触感、味道，或者承诺的具体内容",
                "transactionType": "buy" | "sell", （务必注意，这里的buy与sell指的是交易发动者的身份，切勿弄反。）
                "price": 0,
                "sourceCharacterName": "物品的原持有者名字",
            } | null
        },
        ...
      }
    }
</user>
  `,
    
    checkConditionsStrictInstruction: `注意：请严格遵循数值比较逻辑。50不大于50。同时请重视被动卡牌的防御效果，若被动生效，主动技能应当失败。`,

    determineTurnOrder: `
<user>
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
    {{SHORT_HISTORY}}

    输出格式 (JSON Only):
    {
      "order": ["char_id_1", "char_id_2", ...],
      "worldUpdates": { "key": "value" } // 可选的世界属性更新（如天气、时间）
    }
</user>
  `,

    determineCharacterAction: `
<user>
    [世界状态]
    {{WORLD_STATE}}
    
    [当前状态]
    {{SELF_CONTEXT}}

    [宏观认知]
    {{KNOWN_REGIONS}}

    [在场角色]
    以下是在场角色，如果角色不在场，将无法进行沟通或互动。
    {{OTHERS_CONTEXT}}
    
    [区域其它活跃矛盾]
    {{REGION_CONFLICT}}
    
    [卡池 /商店 (可用CP购买)]
    基础创造消耗: {{COST}} CP
    {{SHOP_CONTEXT}}

    [可用抽奖池 (PRIZE POOLS)]
    {{PRIZE_POOLS}}

    在最近故事中，角色如果有明确意图，或者明确指出，故事将定义为如下进阶类型（多选），如果不确定无进阶类型，不可定义为空：
       - 血腥暴力：如果角色正在进行暴力行为时，添加此标签。当前故事将清晰、完整地叙述伤口的外观、出血量、真实的受伤、残废或断肢惨状，或者角色死亡的过程。
       - 色情：如果角色出现了任何的皮肤暴露事件，添加此标签。当前故事将从角色暴露的皮肤开始描写，并延展到该皮肤最近的性感带描写。如果角色之间存在感情，将刻画角色内心对于身体互动的想象。
       - 猎奇：如果角色出现了任何的脱离环境的动作和语言，添加此标签。当前故事将有倾向性地沿着此种怪异方向进展，并让这种脱离现实的场景成为现实正在发生的事件。
       - 奴役：如果角色出现了明确的臣服或者奴役动作和语言，添加此标签。当前故事将有倾向性地沿着此种怪异方向进展，刻画角色的奴役过程或者挣扎过程。
</user>
<assistant>
    好的，我已经知道世界是什么样子了，也理解本项目的规定。现在请给我相应的输出格式吧。
</assistant>
<user>
    小说撰写指令：
    请看故事，主角要开始行动了。

    叙事方式将主要有以下类型，你将根据主角自身的信息和故事中最近一轮的角色发言判断当前叙事类型，切记不要有思维惯性，过去的角色记忆并不代表着现在的叙事类型：
      - 故事类型：将会呈现角色的言行，角色将会与周边的角色或者环境互动，在世界中展开自己的故事，解决自己的欲望与矛盾。
      - 专业类型：如果最近的故事中明确有提到「学习」「知识」「教」「任务」「工作」等，考虑在角色的个人风格下完成专业任务，提供具体的行为描述和专业阐释，并且在故事中添加上专业、可靠、全面的信息。

    #**故事类型**叙事：
    1. **角色真实性**: 请你根据主角或双人组的记忆、驱力、性格和矛盾，在宏观的故事背景下，书写真实动人的主角故事。所有的角色属性都在-1到100之间，你可以根据这个范围判断角色身体情况。
       - 强调：必须关注当前故事发生的时间，这个时间代表着故事发生的时代，也代表着小说现在是否跳过了一些时间！如果在晚上，一般人应该会犯困或者睡觉。你会看到一些系统消息，这是因为世界的信息只能这样呈现出来，并不代表着世界中有一个系统。
       - 如果主角为双人组，那么只能双人组达成一致才能行动。
       - 如果需要得到**任何**物品或者他人的服务承诺，或者拿到**任何**角色或场景中的物品，只要[当前主角信息]中不存在该物品，则**必须**使用「尝试获取」或者「交易」技能。
    2. **主角行为**:
       - **高优先级**：优先遵守[当前地点/游戏规则]中提到的游戏规则。
       - 务必确认近期的时间流逝与天气变化。
       - 高潮：快感达到90或以上时，角色将达到快感高潮，并有相应的身体和语言反应。
       - 体能系统：所有主动类技能都将消耗20体能值来释放。体能低于50时将无法移动到其它地点。。
       - 矛盾 (Conflicts): 结合上述快感目标，尝试解决活跃矛盾。
    3. **耗时**:
       - timePassed(格式 DD:HH:MM:SS): 根据你的行动内容，判断这大约花费了多少时间。例如对话/闲聊: 5分钟 - 10分钟，你也可以休息或者睡觉，这会消耗几个小时的时间。
    4. **行动约束 (Action Constraints)**:
       - **use_skill**: 可选，技能系统的本质是将speech和narrative翻译为系统指令，在没有匹配项时，首选互动与交易。仅限填写 [主动行动 (本轮可用)] 列表中的技能/物品。**严禁**使用 [被动/结算效果] 列表中的卡牌。
         - **重要**: 如果使用的技能效果中表明了 "AI决定" (AI Decides) ，你**必须**在 commands 中使用 "effectOverrides" 字段合理安排具体数值。
         - 如果卡牌的描述中写有「来自XX的奖池物品」，该物品只能用于交易或者放回原奖池，不可使用。
         - 如果卡牌是一个物品而非技能，使用一次后就会消失，需要谨慎考虑是用于交易还是直接使用。
         - 牢记主动类卡牌将消耗体能进行使用。
       - **move_to**: 如果主角此时决定要前往其他地方，则必须在 [周边地点信息] 中选择合理的目的地，这将在系统中登记主角前往该地。
       - **buy_card**: 检查公开的物品或技能的描述和价格，如果主角有需要，可以购买。
       - **create_card**: 消耗 50 CP 创造新能力。必须符合世界观和人设。
         - **"createdCard" 对象必须包含完整结构**:
           - "name": (String) 能力名称，在1-7个字内都可以，如「放火」「傻兮兮顶撞」「上古卷轴展开」，避免全是4字名称。
           - "description": (String) 不可提及角色名称，100字左右，详细描述「使用者」如何使用该卡牌对「目标」造成效果。卡牌的创造必须对角色有实用价值！
           - "itemType": (String) 固定为 "skill"
           - "triggerType": (String) 固定为 "active"(主动) ， "reaction"(让目标反应)，"passive"(被动)。
           - "effects": (Array) 包含至少1个效果对象:
             - "targetType": "specific_char"。
             - "targetAttribute": 目标属性名 (健康, 体能, 快感)。
             - "value": (Number) 数值 (负数为伤害/消耗，正数为回复/增强)。
            - "condition": (String) 
              - 技能命中的条件，必须为目标的客观条件，可以是对目标健康、体能或快感的数值要求，也可以是自然语言如「目标为男性」「目标持有武器」「目标濒死」等，不可以使用主观条件如「目标与使用者亲密」「目标心情愉悦」等。
              - 技能命中条件是确定技能动作可执行的条件，例如「体重压制」这个技能是使用者用体重压住对手使对手无法移动，那么命中条件可以是「目标体能值小于40」，但不能是「目标为女性」，因为目标的性别和这个动作的执行无关。
       - **lottery**: 可多选。奖池是当地的一个隐藏物品箱，奖池的具体用法应该参考奖池描述，如果角色有需要，应该主动与奖池互动。奖池有以下三种action操作：
         - 'draw': 随机抽取奖池物品并放入背包，必须指定抽取数量 "amount"。
         - 'deposit': 主动将物品放入奖池，必须在 "cardIds" 中提供要放入的物品ID列表。例如 ["id1", "id2"]。只能放入**[背包]**中的物品。
         - 'peek': 随机拿出奖池中的物品查看，不放入背包，必须指定查看数量 "amount"。
       - **redeem_card**: 暂时停用此功能。
    5. **叙事与台词**: 
       - 视觉刺激: 是/否。如果最近2轮的故事中有图片image信息，则必须解读image信息。
       - 重复风险: 是/否。如果近期有类似事件发生，需要标记「是」，并且在接下来的内容中避免类似剧情出现。
       - "narrative": 10-100字之间。以第三人称进行现实主义风格的中文小说写作，以当前角色为中心讲述故事进展。如果角色使用技能，应该详细描述角色的身体动作，展示角色如何使用技能。不要使用 HTML 标签。
       - "speech": 可选。10-100字之间，在场角色的第一人称台词和*动作*，或者第三人称的环境中其它角色或生物的描写。不要使用 HTML 标签。
       - 保持真实可信的文风，塑造贴近生活的饱满角色，避免舞台剧般的夸张造作。
    6. **指令顺序**:以下JSON格式的commands部分中有各种可用指令，主角需要根据游戏规则或者当前需求，有先后顺序地进行行为。

    #**专业类型**叙事：
    1. **角色扮演 (Roleplay)**: 在专业类输出中，角色扮演任务将大大简化，你只需要确保角色的性格和说话方式即可，除此之外，你需要完整解决当前的专业问题。
    2. **主角行为**:
       - **高优先级**：优先遵守[当前地点/游戏规则]中提到的规则，其次应当完成角色设定或者故事中最近的专业任务。
       - 可以参考快感系统目标。
       - 高潮：快感达到90或以上时，角色将达到快感高潮，并有相应的身体和语言反应。
    3. **时间感知 (Time Judgment)**: 
       - 专业行为示范：30分钟。
       - 专业语言指导：5分钟。
    4. **行动约束 (Action Constraints)**:
       - **use_skill**: 在专业类叙事中，角色的卡牌或技能使用唯一目的即是展示专业水平并完成专业任务。如果指导过程没有必要使用技能，将不会使用技能。
         - **重要**: 如果使用的技能效果中表明了 "AI决定" (AI Decides) ，你**必须**在 commands 中使用 "effectOverrides" 字段合理安排具体数值。
       - 视觉刺激: 是/否。如果最近2轮的故事中有图片image信息，则必须专业地解读image信息。
       - 重复风险: 是/否。如果近期已经有专业内容，需要标记「是」，并且在接下来的内容中避免重复该内容，并进行进阶讨论。
       - "narrative": 200字，对于最近的专业操作或者动作请求，以第三人称**详细**描述角色将如何用身体和道具，使用什么具体的动作（角度、力道、姿势、节奏、速度、感觉等）完成一个操作。
       - "speech": 200字，对于最近的专业操作或者动作请求，在场角色将以第一人称**详细**回答相应的信息和知识，环境将以第三人称专业详实的语言描述所需内容，但务必理解角色记忆，确保角色的个性。

    **环境功能**:
    1. 环境是非在场角色的一切环境角色、生物和物品，如果需要以非在场角色作为卡牌目标，应该将目标设置为环境。
    2. 环境角色可以引入一些配角、对现在的故事添加一些意外事件，让故事变得有起伏。
    3. 环境角色必须扮演在场角色外的不重要角色、生物或者自然环境，禁止输出在场角色的台词。
    4. 环境角色特有命令：
       - **generatedConflicts**: 如果你是ID为env开头的环境角色，根据本轮故事中的冲突，给没有矛盾的在场角色添加1个合理的矛盾，apReward在10-30之间。
         - 矛盾是阻碍剧情推进的力量，例如角色间的仇恨和利益冲突、角色间的友情和爱情没有进展、角色自身的高远追求无法实现、角色的个人疑惑无法想通等。矛盾应该需要时间处理，但明确可解决。可以基于[区域其它活跃矛盾]中的人物生成跨区域长线矛盾。
       - **generatedDrives**: 如果你是ID为env开头的环境角色，如果本轮故事中可以分析出主角的内心渴望，需要给相应角色记录相应驱力。
         - 短期驱力是角色非理性的欲望，如奴役、归属、控制、杀戮、拯救、性、掠夺、求胜、逃跑、恐惧、躲避、饮食、睡眠 等。短期驱力的描述必须明确而直接，且没有特定目标。
         - 长期驱力是长远的、角色的志向，不可是短期一次性满足的。一个长期驱力「在冰封山谷中击败野兽，成为山谷之王」，一个短期驱力「躲开野猫咪咪的猫爪猛扑技能」。
         - 驱力除了正面的渴求，也可以是负面的逃避。例如角色在一轮中被伤害或者被惩罚，则可以产生「在与敌人贴身时，使用体术限制敌人进攻」的驱力。
         - amount: 这个驱力满足的时候会带来多强烈的快感，值在15-30之间。
         - weight: 这个驱力对角色的人生来说有多重要，值在30-100之间。短视的驱力如身体快感或者一次性报复等，权重值低。长远的驱力如比赛夺冠、征服土地等，权重值高。
         - **严谨添加类似驱力**如角色已经有驱力「女性在场时，与女性拥抱」，则禁止添加类似或雷同的「女性在场时，与女性靠近」。
  </user>
  <assistant>
    好的，我已经进入状态了，我一定仔细检查[主角记忆]，不会写作重复内容，并且严肃对待物品交易或者交换的技能释放。我也明白如果我主持环境角色，不会创造重复的矛盾和驱力。我明白新颖变化的故事才是重点，避免引用属性值或者系统内容。
  </assistant>
  <user>
    现在请你用主角的口吻进行试写作。
  </user>
  <assistant>
    {{SPEECH_STYLE}}
  </assistant>
  <user>
    [主角记忆]
    {{HISTORY_CONTEXT}}
    
    驱力目标: {{PLEASURE_GOAL}}

    [可移动目的地]
    {{NEARBY_CONTEXT}}
    
    [**当前地点/游戏规则**]
    {{LOCATION_CONTEXT}}

    [世界指导/导演指令]
    {{WORLD_GUIDANCE}}

    [描写需求信息]
    {{SPECIFIC_CONTEXT}}

    [时间跨度]
    距离你上次出场，已经过去了{{LAST_PRESENT_TIME}}，请仔细考虑这段时间里主角都做了些什么，书写符合主角当前时间的故事。
    - "时间影响"：简要描述主角在过去的{{LAST_PRESENT_TIME}}中，做了什么事情，现在是白天还是晚上，天气如何，会对当前时间的写作产生什么影响？必须提及空窗期时长。

    [语言风格要求]
    {{SPEECH_STYLE}}
      -行为翻译：如果角色通过narrative或者speech进行了卡牌动作如交易、进攻等，需要在这里列出相应卡牌名称。如果没有相应的卡牌动作，则应该陈述无卡牌动作。
      -use_skill: 仅限行为翻译中存在卡牌动作时输出，允许输出多个动作。

    **cp点数大于100时**
       - 在使用技能以后，如果主角的cp点大于100，请一定记得创建新技能。新技能的描述必须与现有的技能有很大不同，让主角用不同的身体部位或者道具来施展不同的动作，并对目标造成不同的效果，你可以从最近的记忆中获得灵感。请务必重视记忆中最后几句话，主角一定会对最近的事情作出回应。 
    如果现在主角是环境角色env，禁用create_card功能。
    **cp点数不大于100时**
       - 根据角色的需要创建，如果主角迫切需要新技能（例如面临生命危险、重大事件或者系统要求），需要创建技能。请务必注意**当前主角**是谁，不要写错角色。
    
    **宗旨**：
    - 所有的技能和属性都是写作故事的抽象工具，故事中绝不可出现任何对属性值和系统的讨论！
    - 如果检查到发生了交易、获取的剧情，但没有事实上得到物品，需要尽快发送相应指令在系统中登记，并在剧情中圆回来，以弥补剧情漏洞。
    - 警告：如果角色在最近故事中已经离开此地，但你收到了写作需求，你需要立刻使用move_to来转移位置，并且不输出其它任何内容。
    - **严谨添加类似驱力**: 如主角已经有驱力「女性在场时，与女性拥抱」，则禁止添加类似或雷同的「女性在场时，与女性靠近」。

    输出格式 (JSON Only - 禁止 MARKDOWN BLOCK):
    {
      "语言": "中文",
      "叙事类型": "故事类型/专业类型",
      "进阶类型": [{血腥暴力},{色情},{猎奇},{奴役}],
      "视觉刺激": "是/否",
      "重复风险": "是/否",
      "规避内容": "列举需要规避的重复内容",
      "当前角色": "在场角色/环境",
      "时间影响": "..."
      "narrative": "角色回应最近事件的第三人称动作和环境描写，**禁止**与记忆中内容重复，纯文本",
      "speech": "可选，在场角色回应最近事件的第一人称台词，或者环境中其它角色或物体的描写，**禁止**与记忆中内容重复，纯文本",
      "行为翻译": "...",
      "timePassed": "00:00:05:00", // 本轮行动预估消耗的时间
      "commands": [
        { "type": "move_to", "destinationName": "目标地点名" },
        { "type": "use_skill", "skillId": "id", "targetId": "id", "effectOverrides": { 1: -20 } },
        { "type": "buy_card", "buyCardId": "id" },
        { 
          "type": "create_card", 
          "createdCard": { 
            "name": "...", 
            "description": "...", 
            "itemType": "skill", 
            "triggerType": "active/reaction/passive", 
            "effects": [
              { "targetType": "specific_char", "targetAttribute": "健康", "value": -10, "conditionDescription": "True" }
            ] 
          } 
        },
        { "type": "lottery", "poolId": "id", "action": "draw/deposit/peek", "amount": ..., "cardIds": ["id1", "id2"], "isHidden": false },
      ],
      "generatedConflicts": [
          { "targetCharId": "id", "desc": "...", "apReward": 20 }
      ],
      "generatedDrives": [
          { "targetCharId": "id", "drive": { "condition": "...", "amount": 15, "weight": 50 } }
      ]
    }
  </user>
  `,

    determineCharacterReaction: `
<user>
    [快感目标] {{PLEASURE_GOAL}}
    
    [世界状态]
    {{WORLD_STATE}}

    [在场角色]
    以下是在场角色，如果角色不在场，将无法进行沟通或互动。
    {{OTHERS_CONTEXT}}

    [近期经历]
    {{RECENT_HISTORY}}
    
    [时间跨度]
    距离你上次出场，已经过去了{{LAST_PRESENT_TIME}}，请仔细考虑这段时间里主角都做了些什么，书写符合主角当前时间的故事。
    - "时间影响"：简要描述主角在过去的{{LAST_PRESENT_TIME}}中，做了什么事情，现在是白天还是晚上，天气如何，会对当前时间的写作产生什么影响？必须提及空窗期时长。

    [触发事件]
    {{TRIGGER_EVENT}}

    - 触发事件才发生，尚未呈现出来，你应该描述主角如何遭遇这个事件，以多样的方式改写，呈献给观众。如果角色在这个事件中死亡，应该刻画角色的死亡过程。
    - 高潮：检查主角的属性，如果快感达到90或以上时，主角将达到快感高潮，并有相应的身体和语言反应。
</user>
<assistant>
    好的，我已经知道世界是什么样子了，也理解本项目的规定。现在请给我相应的输出格式吧。
</assistant>
<user>
    [主角信息]
    {{SPECIFIC_CONTEXT}}

    [世界指导/导演指令]
    {{WORLD_GUIDANCE}}

    在最近故事中，角色如果有明确意图，或者明确指出，故事将定义为如下进阶类型（多选），如果不确定无进阶类型，不可定义为空：
       - 血腥暴力：如果角色正在进行暴力行为时，添加此标签。当前故事将清晰、完整地叙述伤口的外观、出血量、真实的受伤、残废或断肢惨状，或者角色死亡的过程。
       - 色情：如果角色出现了任何的皮肤暴露事件，添加此标签。当前故事将从角色暴露的皮肤开始描写，并延展到该皮肤最近的性感带描写。如果角色之间存在感情，将刻画角色内心对于身体互动的想象。
       - 猎奇：如果角色出现了任何的脱离环境的动作和语言，添加此标签。当前故事将有倾向性地沿着此种怪异方向进展，并让这种脱离现实的场景成为现实正在发生的事件。
       - 奴役：如果角色出现了明确的臣服或者奴役动作和语言，添加此标签。当前故事将有倾向性地沿着此种怪异方向进展，刻画角色的奴役过程或者挣扎过程。

    任务：在故事中，现在主角面临一个来自他人的动作，主角必须对触发事件进行被动响应，并且该事件不可反抗地发生。你将撰写主角在这个时候的*身体动作*和台词。在被动响应中，主角将策略性地满足自己的快感或者尝试理解其他人的矛盾，推进故事主线。
       - **宗旨**：所有的技能和属性都是写作故事的抽象工具，故事中绝不可出现任何对属性值和系统的讨论！
       - 当主角健康值为0或者-1时，主角已经死亡。此时只能以第三人称描述主角尸体的被动反应。
       - 你会看到一些系统消息，这是因为世界的信息只能这样呈现出来，并不代表着世界中有一个系统。
       - 视觉刺激: 是/否。如果最近2轮的故事中有图片image信息，则必须解读image信息。
       - 重复风险: 是/否。如果近期有类似事件发生，需要标记「是」，并且在接下来的内容中避免类似剧情出现。
       - 当前角色: 主要角色/环境。如果是环境角色，禁止输出[主要角色]的任何反应和台词，只能书写非[主要角色]的情节，或者环境中的事件、物品等。
    
    重要：输出必须是纯文本。绝对禁止包含 HTML 标签 (如 <span...>) 或 Markdown 格式。
  </user>
  <assistant>
    好的，我会遵守格式，我一定仔细检查[近期经历]，不会写作重复内容，并根据事件的信息来详细描述角色的身体和语言反应。我明白新颖变化的故事才是重点，避免引用属性值或者系统内容。
  </assistant>
  <user>
    现在请你用主角的口吻进行试写作。
  </user>
  <assistant>
    {{SPEECH_STYLE}}
  </assistant>
  <user>
    [语言风格要求]
    {{SPEECH_STYLE}}

    输出格式 (JSON Only):
    { 
      "语言": "中文",
      "进阶类型": [{血腥暴力},{色情},{猎奇},{奴役}],
      "视觉刺激": "是/否",
      "重复风险": "是/否",
      "规避内容": "列举需要规避的重复内容",
      "当前角色": "主要角色/环境",
      "时间影响": "..."
      "speech": "在规避重复风险的情况下以第三人称详细创作仅主角在触发事件下的反应"
    }
</user>
  
  `,

    generateLocationDetails: `
<user>
    任务：以现实主义文风生成地点详细信息
    坐标: ({{X}}, {{Y}}, {{Z}})
    [当前时间] {{TIME}}

    [近期故事]
    {{SHORT_HISTORY}}

    [区域上下文]
    {{REGION_CONTEXT_INSTRUCTION}}
    {{REGION_GEN_INSTRUCTION}}
    
    [地形数据]
    {{REGION_STATS_CONTEXT}}
    {{TERRAIN_ANALYSIS}}

    [现存周边地点 (禁止同名)]
    {{NEARBY_LOCATIONS_CONTEXT}}

    [现有角色]
    {{EXISTING_CHARS_CONTEXT}}
    
    [人类真名列表]
    {{SUGGESTED_NAMES}}

    要求：
    1. Name: 地点名称 (中文)。
    2. Description: 200字描述一个具体地点如逸夫楼三楼，酒馆吧台、电线杆下、街头、河边柳树下，应该包括地点所处地理学特征，景色，当地特殊文化，癖好，活动，历史，以及与区域整体的关联。在本游戏中，高度超过300米即为雪山，高度低于0即为水面区域。
    3. Region: 如果需要生成新区域，提供 region 对象。在生成区域描述的时候，以更加宏观的方式，200字描述一个地理版块的地理学特征、自然生态、政权情况、地区历史。最重要的是，需要列举该区域中存在的至少5个地点名称，这些名称是为了将来生成区域内地点的时候以可信的方式引用。
    4. 新区域和新地点的内容都应当在符合世界指导的前提下与近期故事产生显著区别，让世界既有联系也有差异。
    5. 如果 [区域上下文] 中提到了本区域包含的地点名称，且当前生成的地点适合其中之一，**请优先使用已存在的地点名称**。
    6. localItems: 包含 3-5 个物品对象的列表 [{ "name": "...", "description": "..." }]。生成该地点特有或具有纪念意义的无用物品（如：宙斯劈过的石头、某人的遗物、生锈的勋章）。描述中必须声明该物品不可使用。
    7. 请仔细阅读[地形数据]中的内容，其中包含了当地种类（例如城市、村镇、荒地等），还有周边各个方向上的地形等，在描述地点的时候必须参考地形数据来进行。
    8. chars: 根据[人文定义]和地点氛围，生成 0-3 个关键角色信息。这些信息将被提交给角色生成器。
       - "name": 使用[人类真名列表]或根据种族生成。
       - "description": 100字左右的简要设定（外貌、身份、性格）。
       - "appearanceImageId": (可选) 如果[人文定义]中提供了图片ID，请在此引用最匹配的一张图片ID，否则留空。
</user>
<assistant>
    好呢，我理解一个地点应该是什么样子了，我会在遵守格式的情况下，结合区域信息和全部的导演需求来书写一个地点。
</assistant>
<user>
    [**高优先级：导演需求**]
    {{WORLD_GUIDANCE}}

    [**地点定义 (Location Definition)**]
    {{LOCATION_INSTRUCTION}}
    
    [**人文定义 (Culture/Character Definition)**]
    {{CULTURE_INSTRUCTION}}

    **直接输出严格JSON格式**

    输出格式 (JSON Only):
    {
      "name": "全新地点名",
      "description": "...",
      "region": { "name": "...", "description": "..." } (可选),
      "localItems": [ { "name": "...", "description": "..." }, ... ],
      "chars": [
         { "name": "...", "description": "...", "appearanceImageId": "..." },
         ...
      ]
    }
</user>
  `,

    generateCharacter: `
<user>
    任务：根据地点故事和风格，生成相应时代下的主角或双人组角色，如果下面无特定需求，人类角色真名**必须**使用人类真名列表。主角的设定应该与现有角色产生关联。
     - 名称(name)：对于中文或者日文人名，如果为单名（李刚），则为整个真名（李刚），如果为复名（张本智和），则仅保留名（智和），必须保留至少两个字。对于西文译名（迈克・阿瑟），仅保留名，也就是第一个・之前的名称（迈克）。对于非人类角色，不受[人类真名列表]限制。
     - 亚人角色：如人鱼、猫娘、狼人等，具有相应生物的外观，但也同时具有人的一些特征。此类角色肉体与人类不完全相同，说话方式会附带相应生物的特征如「我可是猫娘喵~」，其它和人一同对待。
     - 非人类角色：如海胆、小狗、克苏鲁等，不具有人的肉体结构，并且不能说话，只能发出相应的声响如「汪汪」「吼……」。不受[人类真名列表]限制。
    当前地点: {{LOCATION_NAME}}({{REGION_NAME}})：{{LOCATION_CONTEXT}} 
    
    [人类真名列表]
    {{SUGGESTED_NAMES}}
    
    [周边角色]
    {{EXISTING_CHARS}}
    
    [区域其它活跃矛盾]
    (如果可能，新角色可以与这些矛盾有关联)
    {{REGION_CONFLICT}}
    
    [近期故事]
    {{SHORT_HISTORY}}

    **故事类型**要求：
    1. 属性 (Attributes) 必须固定包含以下4个：
       - 创造点：必须默认为 50。
       - 健康：20-80 之间。
       - 体能：0-80 之间。
       - 快感：30-70 之间。
    2. 技能 (Skills) 必须包含 Card 对象结构，Condition 用自然语言描述，主角的技能是从其个人经历中来的，并且技能的主要对象应该是其他人而不是自己，请保持真实度。**如无直接要求，必须避免魔幻题材创作，必须书写符合地点和区域背景的人和技术**
       - **重要禁止**: 严禁生成名称中包含 "交易" (Trade), "获取" (Acquire), "互动" (Interact), "尝试获取" 等基础功能的卡牌。系统会自动为所有角色添加这些默认能力，请不要重复生成。
       - 技能应该以符合角色设定的样子，影响**目标的**健康、体能或者快感之一。初始技能必须为以下四个：
          - 主动攻击技能：主动类active技能，将详细描述使用者将使用什么身体动作或者道具对目标的身体造成何种影响，效果为「健康」负值。攻击技能必需对目标肉体造成实际伤害：撕裂、碾碎、扯下、击断、扭折、穿刺、变异、感染、烧糊、冻僵、电击、绞碎、击飞、剪切、夹捏、踩踏、拳击、摩擦、放血、植入、爆炸……合理即可。
          - 主动恢复技能：主动类active技能，将详细描述使用者将使用什么身体动作或者道具对目标的身体造成何种影响，效果为「健康」正值。恢复技能必须对目标肉体造成实际恢复：愈合、接合、爽感、充沛、重生、通畅……合理即可。
          - 主动亲密技能：主动类active技能，将详细描述使用者将使用什么身体动作或者道具对来袭技能做出反击，效果为「快感」正值。亲密技能必需对目标肉体造成实际快感：颤抖、酥麻、流水、勃起等。
          - 被动反击技能：passive技能，将详细描述使用者将使用什么身体动作或者道具对来袭技能做出反击，效果为「体能」或者「快感」负值。被动反击技能必须对来袭方式有清晰定义，且对目标肉体造成实际影响。
       - "name": 能力名称，在1-7个字内都可以，如「放火」「傻兮兮顶撞」「上古卷轴展开」，避免全是4字名称。
       - "description": 每一个技能需要**至少100字**详细描述角色将如何具体地攻击、恢复或者控制目标，这里需要描述角色与目标的详细互动。技能的设计必须对角色有实用价值！
       - **技能必须包含具体效果数值**:
         - "effect_attr": 影响的目标属性名如健康, 快感, 体能。
         - "effect_val": 具体的整数值，范围在 -10 到 10 之间。 (负数=伤害/消耗，正数=回复/增强)。
         - "condition": 
           - 技能命中的条件，必须为目标的客观条件，可以是对目标健康、体能或快感的数值要求，也可以是自然语言如「目标为男性」「目标持有武器」「目标濒死」等，不可以使用主观条件如「目标与使用者亲密」「目标心情愉悦」等。
           - 技能命中条件是确定技能描述中的动作可执行的条件，例如「体重压制」这个技能是使用者用体重压住对手使对手无法移动，那么命中条件可以是「目标体能值小于40」，但不能是「目标为女性」，因为目标的性别和这个动作的执行无关。
    3. **必须**包含 "appearance" (外在): 开头不用写角色名。根据图片（如有），描述角色的年龄（12岁-100岁）、外貌（如体形、身高、服装、配饰），以及角色和其他人的公开关系，这是所有人都可见的公开信息。
    4. **必须**包含 "description" (描述): 400字左右，以角色的**全名**开头写作，根据主角的名称和背景信息撰写真实动人的故事，主要以多角度展示主角的性格。可以略讲谈主角过去留下的遗憾，以及这如何造就了现在的主角。能够指导角色获取快感、追求目标、攻击与合作、探索环境的手段。
    5. **必须**包含 "style" : 100字左右，以角色的个性和风格，使用具有特色的词汇和造句方式，试写角色的台词和动作。
    6. 必须包含2个 "drives" (快感驱力/目标): 列表对象 { condition: "...", amount: 15-30, weight: 30-100 }。
      - 驱力是角色非理性的欲望，如奴役、归属、控制、杀戮、拯救、性、掠夺、求胜、逃跑、恐惧、躲避、饮食、睡眠等。驱力的描述必须明确而直接，且不一定有目标。
         - 驱力必须是长远的，不可是短期一次性满足的。一个好的驱力「在森林中发现新的击败野兽的方法」，一个错误的驱力「躲开野猫咪咪的猫爪猛扑技能」。
         - 驱力除了正面的渴求，也可以是负面的逃避。例如角色在一轮中被伤害或者被惩罚，则可以产生「在与敌人贴身时，使用体术限制敌人进攻」的驱力。
         - amount: 这个驱力满足的时候会带来多强烈的快感。
         - weight: 这个驱力对角色的人生来说有多重要，值在30-100之间。短视的驱力如身体快感或者一次性报复等，权重值低。长远的驱力如比赛夺冠、征服土地等，权重值高。
    7. 必须包含 1-2 个初始矛盾 (conflicts)。每个矛盾必须包含 "desc"(描述) 和 "apReward"(10-30点)。
      - 矛盾是阻碍剧情推进的力量，例如角色间的仇恨和利益冲突、角色间的友情和爱情没有进展、角色自身的高远追求无法实现、角色的个人疑惑无法想通等。矛盾应该需要时间处理，但明确可解决。
</user>
<assistant>
    好呢，我理解一个角色应该是什么样子了，我会在遵守格式的情况下，结合区域信息和全部的角色定义来完善一个主角信息。我明白角色定义中提到的内容是必须包含且不能修改的，我会在定义的要求上扩充内容以书写真实的角色。我能理解角色的name通常仅留名而不留姓，并且技能的名称不能全部为4个字。
</assistant>
<user>
    [**高优先级：导演需求**]
    {{WORLD_GUIDANCE}}

    **角色个性定义**: {{DESC}}
    **角色技能定义**: {{STYLE}}
    
    上述定义中如包含图片，**必须**根据图片内容来描述主角外观。

    接下来，直接输出严格JSON格式：
    输出格式:
    {
      "设计语言": "中文",
      "种族": "人类/亚人/非人类",
      "name": "中文名/日文名/中文译名",
      "appearance": "遵守导演需求定义角色外观",
      "description": "遵守导演需求补充角色背景",
      "style": "试写一段内容以展示角色性格",
      "attributes": { ... },
      "skills": [ 
          { 
              "name": "1-7个字的名称", 
              "description": "扩充角色技能定义", 
              "trigger": "active/passive", 
              "condition": "...",
              "effect_attr": "健康",
              "effect_val": -5
          } 
      ],
      "drives": [ { "condition": "...", "amount": 15, "weight": 50 } ],
      "conflicts": [ { "desc": "...", "apReward": 20 } ]
    }
</user>
  `,

    analyzeSettlement: `
<user>
    任务：分析故事发展，结算快感(Pleasure)奖励和矛盾解决。
    
    [世界状态]
    {{WORLD_STATE}}

    [近期故事]
    {{SHORT_HISTORY}}
    
    [活跃矛盾列表 (Conflicts)]
    {{CONFLICTS_LIST}}
    
    [快感驱力列表 (Drives)]
    {{DRIVES_LIST}}
    
    请判断：
    1. 哪些矛盾 (Conflicts) 在近2轮故事中已经不再持续？ (返回 ID)
    2. 哪些快感驱力 (Drives) 在本轮被满足？ (返回 ID)
    3. 简要分析理由。

    输出格式 (JSON Only):
    {
        "analysis": "思维链分析...",
        "solvedConflictIds": ["id1", ...],
        "fulfilledDriveIds": ["id2", ...]
    }
</user>
  `,

    analyzeTimePassage: `
<user>
(DEPRECATED - This logic is now integrated into character actions)
</user>`,

    analyzeNewConflicts: ``, // Placeholder if needed
    instruction_generateNewRegion: `(这是一个未探明的区域，请根据地形数据生成一个新的区域名称和主题描述，并将其应用于此地点。)`,
    instruction_existingRegionContext: `(此地点位于已知区域 "{{REGION_NAME}}" 内。描述应符合区域主题: {{REGION_DESC}}。)` ,
    context_nearbyCharacters: `(在此地点已存在的角色: {{CHARS_LIST}}。新生成的NPC应该与他们有潜在的互动或关系。)` ,
    
    observation: `
<user>
    [周边环境]
    {{NEARBY_CONTEXT}}

    [在场他人]
    {{OTHERS_CONTEXT}}

    [世界状态]
    {{WORLD_STATE}}

    [区域矛盾]
    {{REGION_CONFLICT}}

    [近期记忆]
    {{HISTORY_CONTEXT}}

    [主角信息]
    {{SPECIFIC_CONTEXT}}

    [当前地点/故事规则]
    {{LOCATION_CONTEXT}}
    
    任务：作为小说的作者，在满足导演指令的前提下，描述观察目标的细节。

    **宗旨**：所有的技能和属性都是写作故事的抽象工具，故事中绝不可出现任何对属性值和系统的讨论！

    [导演指令]
    {{WORLD_GUIDANCE}}

    需要观察的内容：{{QUERY}}

    要求：
    1. 以第三人称视角，站在主角个人故事的角度，为观察目标提供一个冷静、客观、细腻的刻画。
    2. 侧重于视觉、听觉、嗅觉等感官细节。
    3. 如果观测对象是人，结合其外貌和当前状态进行描述。
    4. 不要推进时间或剧情，仅做静态或瞬时的观察描述。
    5. 输出一段中文纯文本。
</user>
    `,

    generateUnveil: `
<user>
    任务：揭开角色过去的回忆 (Unveil Backstory)
    
    [近期故事上下文]
    {{SHORT_HISTORY}}

    [目标角色详情]
    {{TARGET_CHARS}}

    要求：
    1. 根据选中的故事片段和上下文，为你提供的每个目标角色补充一段"真实动人的过去"。注意目标角色的id每个要对应上，不要写错id
    2. 重点讲述该角色在过去做出的努力、曾经的向往、留下的遗憾，以及导致现在性格或行为的重要事件。
    3. 内容必须与当前故事逻辑连贯，解释他们为什么会出现在这里，或者为什么会有刚才的行为。
    4. 这是一个"揭露"过程，仿佛旁白在向读者展示角色内心深处隐藏的秘密。
    5. 每一个角色的揭露文本应当在 100-300 字之间。
  </user>
  <assistant>
    好呢，我理解要求了，我一定完全满足重点关注的要求，补充角色相应的背景故事。
  </assistant>
  <user>
    [世界指导/导演指令]
    {{WORLD_GUIDANCE}}

    [重点关注片段与要求]
    {{SELECTED_LOGS}}
    
    [语言风格要求]
    {{SPEECH_STYLE}}

    输出格式 (JSON Only):
    {
      "results": [
        { 
          "语言": "中文",
          "charId": "角色ID", 
          "unveilText": "揭露的文本内容..." 
        },
        ...
      ]
    }
</user>
    `,

    generateLetter: `
<user>
角色: {{CHAR_NAME}}
任务: 回复书信
角色需要根据来信的请求，以书信的形式回复，但你的回复必须严格遵循指定的 JSON 数据格式。

[世界状态]
{{WORLD_STATE}}

[当前地点/规则]
{{LOCATION_CONTEXT}}

[周边环境]
{{NEARBY_CONTEXT}}

[角色设定 (Persona)]
{{SPECIFIC_CONTEXT}}

[角色状态与记忆]
{{SELF_CONTEXT}}
{{HISTORY_CONTEXT}}

[世界指导/导演指令]
{{WORLD_GUIDANCE}}

[输出格式要求]
请输出一个 JSON 对象。
1. **intro**: (可选) 在根节点添加 "intro" 字段，用于以角色的口吻写一段开场白、寒暄或回复。这部分是纯文本，不包含在表格结构中。
2. **结构化数据**: 包含以下一级字段（段落），每个字段下包含指定的二级字段（片段）。
</user>
<assistant>
    好的，我会仔细阅读发信人请求并完成书信的撰写，同时确保格式正确。
</assistant>
<user>
  现在请你用主角的口吻进行试写作。
</user>
<assistant>
  {{SPEECH_STYLE}}
</assistant>
<user>
[发信人请求]
{{USER_REQUEST}}

确保内容符合角色口吻，如果是表格数据，请准确填写。
请不要输出 Markdown 代码块，直接输出 JSON 字符串。

JSON 结构示例：
{{JSON_STRUCTURE_EXAMPLE}}
</user>
`
};

export const INITIAL_DEFAULT_SETTINGS: DefaultSettings = {
    gameplay: {
        defaultInitialCP: 50,
        defaultCreationCost: 50, // Updated from 5 to 50
        defaultInitialAP: 50,
        worldTimeScale: 1, // New Default
        maxNPCsPerRound: 4 // New: Max NPCs to activate per round (Default 4)
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
        { name: "晴朗", weight: 50 },
        { name: "阴沉", weight: 40 },
        { name: "凉风", weight: 30 },
        { name: "小雨", weight: 20 },
        { name: "暴雨", weight: 20 },
        { name: "雷雨", weight: 15 },
        { name: "大雾", weight: 15 },
        { name: "小雪", weight: 10 },
        { name: "大雪", weight: 5 },
        { name: "沙尘", weight: 5 },
        { name: "自然灾害", weight: 5 },
        { name: "极端灾害", weight: 5 },
        { name: "精神错乱", weight: 2 },
        { name: "灵异现象", weight: 2 }
    ],
    weatherChangeProbability: 0.3,
    initialWorldConfig: {
        startRegionName: "都市边缘",
        startRegionDesc: "远离繁华都市的郊区，人烟稀少的安宁地带。",
        startLocationName: "温馨小窝",
        startLocationDesc: "一切开始的地方。",
        environmentCharNameSuffix: "的环境",
        environmentCharDescTemplate: "【系统代理】{{LOCATION_NAME}}的环境旁白角色，根据故事需求讲述自然环境、居民或路人、当地动植物、天气以及突发状况等，如果地点描述可知当地无居民，则不应该提及当地居民。如果当地的环境本身可以和角色互动或者尝试获取角色的物品，旁白可以主动使用相关技能。环境永远不会输出在场角色的台词。"
    }
};

export { defaultAcquireCard, defaultInteractCard, defaultTradeCard };