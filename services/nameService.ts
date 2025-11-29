
const FALLBACK_NAMES = [
    "李逍遥", "赵灵儿", "林月如", "阿奴", "景天", "雪见", "徐长卿", "紫萱", "重楼", 
    "云天河", "韩菱纱", "柳梦璃", "慕容紫英", "宇文拓", "陈靖仇", "于小雪", "拓跋玉儿",
    "张无忌", "赵敏", "周芷若", "小昭", "杨过", "小龙女", "郭靖", "黄蓉", "黄药师",
    "欧阳锋", "洪七公", "段誉", "萧峰", "虚竹", "王语嫣", "令狐冲", "任盈盈", "岳灵珊",
    "林平之", "东方不败", "风清扬", "楚留香", "陆小凤", "花满楼", "西门吹雪", "叶孤城",
    "沈浪", "李寻欢", "阿飞", "叶开", "傅红雪", "萧十一郎", "沈璧君", "连城璧",
    "张伟", "李明", "王强", "刘勇", "陈静", "杨艳", "赵刚", "孙丽", "周杰", "吴敏",
    "郑洁", "王军", "郭涛", "宋丹", "马超", "韩梅", "曹颖", "许巍", "邓超", "苏有朋"
];

export const getRandomChineseNames = async (count: number = 10): Promise<string[]> => {
    let allNames: string[] = [];

    try {
        // Try fetching from root data folder with .txt extension
        const response = await fetch('/data/chinese_name.txt');
        if (response.ok) {
            const text = await response.text();
            // Split by newline, trim, filter empty
            allNames = text.split(/\r?\n/).map(n => n.trim()).filter(n => n);
        } else {
            console.warn(`Name database fetch failed. Status: ${response.status}. Using fallback list.`);
        }
    } catch (e) {
        console.error("Failed to fetch name database:", e);
    }

    // Fallback if fetch failed or file was empty
    if (allNames.length === 0) {
        allNames = FALLBACK_NAMES;
    }

    const selected = new Set<string>();
    // Safety clamp to prevent infinite loop if count > allNames.length
    const targetCount = Math.min(count, allNames.length);
    
    // Simple random selection
    let attempts = 0;
    while (selected.size < targetCount && attempts < 1000) {
        const idx = Math.floor(Math.random() * allNames.length);
        selected.add(allNames[idx]);
        attempts++;
    }
    
    return Array.from(selected);
};
