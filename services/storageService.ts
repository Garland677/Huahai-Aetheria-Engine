
import localforage from 'localforage';

// 配置 LocalForage 使用 IndexedDB
localforage.config({
    driver: localforage.INDEXEDDB, // 强制使用 IndexedDB
    name: 'AetheriaEngine',        // 数据库名称
    version: 1.0,
    storeName: 'game_saves',       // 存储表名称
    description: 'Storage for Aetheria Game States'
});

export const storage = localforage;
